import { decryptRefreshToken } from "./calendar-oauth";
import {
  processGmailCandidate,
  type ProtectedGmailReview
} from "./gmail";
import {
  fetchIncrementalInboxCandidates,
  fetchInitialInboxCandidates
} from "./google-gmail";
import { refreshCalendarAccessToken } from "./google-calendar";
import { noticeLifecycle } from "./notice-lifecycle";
import { purgeExpiredGmailData } from "./gmail-controls";

export interface GmailWorkerEnv {
  DB: D1Database;
  AI: {
    run(model: string, input: unknown): Promise<unknown>;
  };
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  CALENDAR_TOKEN_ENCRYPTION_KEY: string;
  GMAIL_AI_MODEL: string;
  GMAIL_AI_MODEL_VERSION: string;
  GMAIL_PROCESSOR_KEY: string;
  NOTICE_GRACE_DAYS?: string;
}

interface GmailAccountRow {
  account_id: "mom" | "dad";
  encrypted_refresh_token: string;
  gmail_history_id: string | null;
}

function datePlus(date: Date, days: number): string {
  return new Date(date.getTime() + days * 24 * 60 * 60_000).toISOString();
}

function changes(result: D1Result): number {
  return result.meta.changes ?? 0;
}

export async function runGmailRetentionMaintenance(
  database: D1Database,
  now: Date
): Promise<{ accepted: number; protected: number; failures: number }> {
  return purgeExpiredGmailData(
    {
      async purgeAccepted(cutoff) {
        return changes(
          await database
            .prepare("DELETE FROM household_notices WHERE retained_until <= ?")
            .bind(cutoff)
            .run()
        );
      },
      async purgeProtected(cutoff) {
        return changes(
          await database
            .prepare(
              "DELETE FROM gmail_protected_reviews WHERE expires_at <= ?"
            )
            .bind(cutoff)
            .run()
        );
      },
      async purgeFailures(cutoff) {
        return changes(
          await database
            .prepare("DELETE FROM gmail_review_records WHERE expires_at <= ?")
            .bind(cutoff)
            .run()
        );
      }
    },
    now
  );
}

export async function recordGmailProcessingFailure(
  database: D1Database,
  errorCode:
    | "GMAIL_PROCESSING_FAILED"
    | "GMAIL_OAUTH_REVOKED"
    | "AI_QUOTA_EXHAUSTED"
): Promise<void> {
  await database
    .prepare(
      `UPDATE source_status
       SET state = 'error', error_code = ?,
           consecutive_failures = consecutive_failures + 1,
           updated_at = CURRENT_TIMESTAMP
       WHERE source = 'gmail'`
    )
    .bind(errorCode)
    .run();
  if (errorCode === "AI_QUOTA_EXHAUSTED") {
    await database
      .prepare(
        `UPDATE operational_status SET status_value = 'exhausted',
           updated_at = CURRENT_TIMESTAMP WHERE status_key = 'ai_quota'`
      )
      .run();
  }
}

export async function recordGmailProcessingRecovery(
  database: D1Database,
  now: Date
): Promise<void> {
  await database
    .prepare(
      `UPDATE source_status SET state = 'fresh', last_success_at = ?,
         error_code = NULL, consecutive_failures = 0,
         last_failure_slot_key = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE source = 'gmail'`
    )
    .bind(now.toISOString())
    .run();
  await database
    .prepare(
      `UPDATE operational_status SET status_value = 'available',
         updated_at = CURRENT_TIMESTAMP WHERE status_key = 'ai_quota'`
    )
    .run();
}

export async function processConnectedGmailAccounts(
  env: GmailWorkerEnv,
  now = new Date()
): Promise<{ accounts: number; candidates: number; accepted: number }> {
  await runGmailRetentionMaintenance(env.DB, now);
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
    let accessToken: string;
    try {
      accessToken = await refreshCalendarAccessToken({
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        refreshToken: await decryptRefreshToken(
          account.encrypted_refresh_token,
          env.CALENDAR_TOKEN_ENCRYPTION_KEY
        )
      });
    } catch (error) {
      if (
        error !== null &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "CALENDAR_OAUTH_REVOKED"
      ) {
        await env.DB.prepare(
          `UPDATE calendar_accounts SET oauth_status = 'revoked',
             updated_at = CURRENT_TIMESTAMP WHERE account_id = ?`
        )
          .bind(account.account_id)
          .run();
      }
      throw error;
    }
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
            modelVersion: env.GMAIL_AI_MODEL_VERSION
          };
        },
        async saveValidated(notice) {
          const lifecycle = noticeLifecycle(
            notice.relevantDate,
            now,
            env.NOTICE_GRACE_DAYS
          );
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
              lifecycle.expiresAt,
              lifecycle.retainedUntil
            )
            .run();
        },
        async saveProtected(review: ProtectedGmailReview) {
          await env.DB.prepare(
            `INSERT INTO gmail_protected_reviews
               (account_id, source_key, review_kind, category, summary,
                relevant_date, action, sender_organization, confidence,
                created_at, expires_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(account_id, source_key) DO UPDATE SET
               review_kind = excluded.review_kind,
               category = excluded.category,
               summary = excluded.summary,
               relevant_date = excluded.relevant_date,
               action = excluded.action,
               sender_organization = excluded.sender_organization,
               confidence = excluded.confidence,
               created_at = excluded.created_at,
               expires_at = excluded.expires_at`
          )
            .bind(
              review.accountId,
              review.sourceKey,
              review.kind,
              review.category,
              review.summary,
              review.relevantDate,
              review.action,
              review.senderOrganization,
              review.confidence,
              now.toISOString(),
              datePlus(now, 14)
            )
            .run();
        },
        async recordFailure(accountId, reason) {
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
    ]);
  }
  await recordGmailProcessingRecovery(env.DB, now);
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
      const oauth =
        error !== null &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "CALENDAR_OAUTH_REVOKED";
      const code = quota
        ? "AI_QUOTA_EXHAUSTED"
        : oauth
          ? "GMAIL_OAUTH_REVOKED"
          : "GMAIL_PROCESSING_FAILED";
      await recordGmailProcessingFailure(env.DB, code);
      return Response.json(
        { error: code },
        {
          status: quota ? 429 : oauth ? 401 : 502,
          headers: { "cache-control": "no-store" }
        }
      );
    }
  }
};
