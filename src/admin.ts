import {
  statusSafeOperationalCode,
  type OperationalCode
} from "./operational-codes";
import { handleCalendarFeedAdministration } from "./calendar-feeds";
import type { CalendarFeedFetchFailureCode } from "./calendar-feed-fetch";
import {
  administrationPage,
  administrationScript,
  administrationStyles,
  type AdministrationPageRole
} from "./admin-page";

export type AdministrationRole = AdministrationPageRole;

export interface AdministrationEnv {
  DB: D1Database;
  ADMIN_ORIGIN?: string;
  CALENDAR_FEED_URL_ENCRYPTION_KEY?: string;
  CALENDAR_FEED_FETCHER?: typeof fetch;
  CALENDAR_FEED_RESOLVE_HOSTNAME?(hostname: string): Promise<string[]>;
  CALENDAR_FEED_NOW?(): Date;
}

interface AdministrationUser {
  role: AdministrationRole;
}

const CALENDAR_FEED_FAILURE_MESSAGES: Record<
  CalendarFeedFetchFailureCode,
  string
> = {
  unsafe_url: "The URL is not a permitted HTTPS Calendar Feed URL.",
  dns_failed: "The feed hostname could not be resolved.",
  unsafe_address: "The feed hostname resolves to a blocked network address.",
  too_many_redirects: "The feed redirected too many times.",
  timeout: "The feed did not respond within 10 seconds.",
  compressed_too_large: "The compressed feed response is too large.",
  decompressed_too_large: "The feed contains too much data.",
  unsupported_encoding: "The feed uses an unsupported compression format.",
  invalid_response: "The response is not a valid supported iCalendar feed.",
  http_error: "The feed server returned an HTTP error."
};

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "content-security-policy": "default-src 'none'",
      "x-content-type-options": "nosniff"
    }
  });
}

export function isAdministrationHost(
  request: Request,
  env: AdministrationEnv
): boolean {
  if (!env.ADMIN_ORIGIN) return false;
  return new URL(request.url).host === new URL(env.ADMIN_ORIGIN).host;
}

export async function authorizeAdministration(
  request: Request,
  env: AdministrationEnv
): Promise<AdministrationUser | Response> {
  const email = request.headers
    .get("Cf-Access-Authenticated-User-Email")
    ?.trim()
    .toLowerCase();
  const assertion = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!email || !assertion) {
    return json({ error: "Access authentication required" }, 401);
  }
  const user = await env.DB.prepare(
    `SELECT role FROM administration_users
     WHERE email = ? AND active = 1`
  )
    .bind(email)
    .first<AdministrationUser>();
  return user ?? json({ error: "Access identity is not authorized" }, 403);
}

async function operationalStatus(env: AdministrationEnv): Promise<Response> {
  const [device, render, attempt, sources, incidents] = await Promise.all([
    env.DB.prepare(
      "SELECT MAX(last_check_in_at) AS last_check_in_at FROM devices"
    ).first<{ last_check_in_at: string | null }>(),
    env.DB.prepare(
      `SELECT current.generation_id, generation.published_at
       FROM current_render_generation AS current
       JOIN render_generation_sets AS generation
         ON generation.generation_id = current.generation_id
       WHERE current.id = 1`
    ).first<{ generation_id: string; published_at: string }>(),
    env.DB.prepare(
      `SELECT slot_key, status, attempt_count, retry_at, error_code
       FROM scheduled_generation_slots
       ORDER BY started_at DESC LIMIT 1`
    ).first<{
      slot_key: string;
      status: "running" | "published" | "failed";
      attempt_count: number;
      retry_at: string | null;
      error_code: string | null;
    }>(),
    env.DB.prepare(
      `SELECT source, state, last_success_at, error_code
       FROM source_status ORDER BY source`
    ).all<{
      source: string;
      state: "fresh" | "stale" | "error";
      last_success_at: string | null;
      error_code: string | null;
    }>(),
    env.DB.prepare(
      `SELECT error_code, occurred_at, notified_at
       FROM operational_incidents
       WHERE resolved_at IS NULL ORDER BY occurred_at DESC LIMIT 20`
    ).all<{
      error_code: string;
      occurred_at: string;
      notified_at: string | null;
    }>()
  ]);

  return json({
    device: { lastCheckInAt: device?.last_check_in_at ?? null },
    rendering: {
      currentGenerationId: render?.generation_id ?? null,
      lastSuccessfulAt: render?.published_at ?? null,
      latestAttempt: attempt
        ? {
            slotKey: attempt.slot_key,
            state: attempt.status,
            attempt: attempt.attempt_count,
            retryAt: attempt.retry_at,
            errorCode: statusSafeOperationalCode(attempt.error_code)
          }
        : null
    },
    sources: sources.results.map((source) => ({
      source: source.source,
      state: source.state,
      lastSuccessfulAt: source.last_success_at,
      errorCode: statusSafeOperationalCode(source.error_code)
    })),
    incidents: incidents.results
      .map((incident) => ({
        errorCode: statusSafeOperationalCode(incident.error_code),
        occurredAt: incident.occurred_at,
        notifiedAt: incident.notified_at
      }))
      .filter(
        (
          incident
        ): incident is {
          errorCode: OperationalCode;
          occurredAt: string;
          notifiedAt: string | null;
        } => incident.errorCode !== null
      )
  });
}

export async function handleAuthorizedAdministration(
  request: Request,
  env: AdministrationEnv,
  identity: AdministrationUser
): Promise<Response> {
  const pathname = new URL(request.url).pathname;
  if (pathname === "/admin" && request.method === "GET") {
    return administrationPage(identity.role);
  }
  if (pathname === "/admin/app.js" && request.method === "GET") {
    return administrationScript(CALENDAR_FEED_FAILURE_MESSAGES);
  }
  if (pathname === "/admin/app.css" && request.method === "GET") {
    return administrationStyles();
  }
  if (pathname === "/admin/status" && request.method === "GET") {
    return operationalStatus(env);
  }
  if (
    pathname === "/admin/calendar-feeds" ||
    pathname.startsWith("/admin/calendar-feeds/")
  ) {
    return handleCalendarFeedAdministration(request, env, identity.role);
  }
  return json({ error: "Not found" }, 404);
}
