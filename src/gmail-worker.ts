import { decryptRefreshToken } from "./calendar-oauth";
import {
  processGmailCandidate,
  type HouseholdNotice
} from "./gmail";
import {
  fetchIncrementalInboxCandidates,
  fetchInitialInboxCandidates
} from "./google-gmail";
import { refreshCalendarAccessToken } from "./google-calendar";

export interface GmailWorkerEnv {
  DB: D1Database;
  AI: {
    run(model: string, input: unknown): Promise<unknown>;
  };
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  CALENDAR_TOKEN_ENCRYPTION_KEY: string;
  GMAIL_AI_MODEL: string;
  GMAIL_AI_MODEL_VERSION?: string;
  GMAIL_PROCESSOR_KEY: string;
}

interface GmailAccountRow {
  account_id: "mom" | "dad";
  encrypted_refresh_token: string;
  gmail_history_id: string | null;
}

function datePlus(date: Date, days: number): string {
  return new Date(date.getTime() + days * 24 * 60 * 60_000).toISOString();
}

function noticeExpiry(notice: HouseholdNotice, now: Date): Date {
  if (!notice.relevantDate) {
    return new Date(now.getTime() + 14 * 24 * 60 * 60_000);
  }
  return new Date(`${notice.relevantDate}T12:00:00.000Z`);
}

export async function processConnectedGmailAccounts(
  env: GmailWorkerEnv,
  now = new Date()
): Promise<{ accounts: number; candidates: number; accepted: number }> {
  const rows = await env.DB.prepare(
    `SELECT account_id, encrypted_refresh_token, gmail_history_id
     FROM calendar_accounts
     WHERE oauth_status = 'connected' AND encrypted_refresh_token IS NOT NULL
     ORDER BY account_id`
  ).all<GmailAccountRow>();
  const allowlist = await env.DB.prepare(
    "SELECT domain FROM gmail_sender_allowlist ORDER BY domain"
  ).all<{ domain: string }>();
  let candidateCount = 0;
  let acceptedCount = 0;
  for (const account of rows.results) {
    const accessToken = await refreshCalendarAccessToken({
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      refreshToken: await decryptRefreshToken(
        account.encrypted_refresh_token,
        env.CALENDAR_TOKEN_ENCRYPTION_KEY
      )
    });
    const scan = account.gmail_history_id
      ? await fetchIncrementalInboxCandidates({
          accessToken,
          startHistoryId: account.gmail_history_id
        })
      : await fetchInitialInboxCandidates({ accessToken, now });
    candidateCount += scan.candidates.length;
    for (const candidate of scan.candidates) {
      const result = await processGmailCandidate(candidate, {
        now,
        accountId: account.account_id,
        allowedSenderDomains: allowlist.results.map(({ domain }) => domain),
        modelId: env.GMAIL_AI_MODEL,
        async runAi(input) {
          const output = await env.AI.run(env.GMAIL_AI_MODEL, input);
          return {
            ...(output && typeof output === "object" ? output : { response: output }),
            modelVersion: env.GMAIL_AI_MODEL_VERSION ?? "provider-current"
          };
        },
        async saveValidated(notice) {
          const expiresAt = noticeExpiry(notice, now);
          await env.DB.prepare(
            `INSERT INTO household_notices
               (account_id, source_key, category, summary, relevant_date,
                action, sender_organization, model_id, model_version,
                accepted_at, expires_at, retained_until)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(account_id, source_key) DO UPDATE SET
               category = excluded.category,
               summary = excluded.summary,
               relevant_date = excluded.relevant_date,
               action = excluded.action,
               sender_organization = excluded.sender_organization,
               model_id = excluded.model_id,
               model_version = excluded.model_version,
               accepted_at = excluded.accepted_at,
               expires_at = excluded.expires_at,
               retained_until = excluded.retained_until`
          )
            .bind(
              notice.accountId,
              notice.sourceKey,
              notice.category,
              notice.summary,
              notice.relevantDate,
              notice.action,
              notice.senderOrganization,
              notice.modelId,
              notice.modelVersion,
              now.toISOString(),
              datePlus(expiresAt, 3),
              datePlus(expiresAt, 33)
            )
            .run();
        },
        async recordReview(accountId, reason) {
          await env.DB.prepare(
            `INSERT INTO gmail_review_records
               (account_id, reason, created_at, expires_at)
             VALUES (?, ?, ?, ?)`
          )
            .bind(
              accountId,
              reason,
              now.toISOString(),
              datePlus(now, 14)
            )
            .run();
        }
      });
      if (result.status === "accepted") acceptedCount += 1;
    }
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE calendar_accounts
         SET gmail_history_id = ?,
             gmail_scan_started_at = COALESCE(gmail_scan_started_at, ?),
             gmail_scan_completed_at = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE account_id = ?`
      ).bind(
        scan.historyId,
        now.toISOString(),
        now.toISOString(),
        account.account_id
      ),
      env.DB.prepare(
        `DELETE FROM household_notices WHERE retained_until < ?`
      ).bind(now.toISOString()),
      env.DB.prepare(
        `DELETE FROM gmail_review_records WHERE expires_at < ?`
      ).bind(now.toISOString())
    ]);
  }
  await env.DB.prepare(
    `UPDATE source_status SET state = 'fresh', last_success_at = ?,
       error_code = NULL, consecutive_failures = 0,
       last_failure_slot_key = NULL, updated_at = CURRENT_TIMESTAMP
     WHERE source = 'gmail'`
  )
    .bind(now.toISOString())
    .run();
  return {
    accounts: rows.results.length,
    candidates: candidateCount,
    accepted: acceptedCount
  };
}

export default {
  async fetch(request: Request, env: GmailWorkerEnv): Promise<Response> {
    if (
      request.method !== "POST" ||
      new URL(request.url).pathname !== "/process" ||
      request.headers.get("X-Gmail-Processor-Key") !== env.GMAIL_PROCESSOR_KEY
    ) {
      return new Response(null, { status: 404 });
    }
    try {
      return Response.json(await processConnectedGmailAccounts(env), {
        headers: { "cache-control": "no-store" }
      });
    } catch (error) {
      const quota =
        error !== null &&
        typeof error === "object" &&
        (("status" in error && error.status === 429) ||
          ("code" in error &&
            typeof error.code === "string" &&
            error.code.toLowerCase().includes("quota")));
      await env.DB.prepare(
        `UPDATE operational_status SET status_value = ?,
           updated_at = CURRENT_TIMESTAMP WHERE status_key = 'ai_quota'`
      )
        .bind(quota ? "exhausted" : "available")
        .run();
      return Response.json(
        { error: quota ? "AI_QUOTA_EXHAUSTED" : "GMAIL_PROCESSING_FAILED" },
        { status: quota ? 429 : 502, headers: { "cache-control": "no-store" } }
      );
    }
  }
};
