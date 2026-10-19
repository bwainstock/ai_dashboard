import type { CalendarEvent } from "./calendar";
import {
  CalendarFeedFetchError,
  fetchCalendarFeed,
  fetchCalendarFeedsBounded
} from "./calendar-feed-fetch";
import {
  normalizeICalendarFeed,
  type CalendarFeedNormalizationResult
} from "./ical-normalization";
import { expandAndMergeCalendarFeedEvents } from "./ical-recurrence";
import { parseCalendarFeedUrl } from "./calendar-feed-url";

const FEED_URL_CONTRACT = "calendar-feed-url";
const FEED_URL_AAD = new TextEncoder().encode(`${FEED_URL_CONTRACT}:v1`);
const MAXIMUM_FEEDS = 20;
const MAXIMUM_STALE_AGE_MS = 72 * 60 * 60 * 1000;
const NON_RECURRING_HISTORY_BUFFER_MS = 2 * 24 * 60 * 60 * 1000;
const DEFAULT_CALENDAR_FEED_FETCHER: typeof fetch = (input, init) =>
  fetch(input, init);

export interface CalendarFeedEnvironment {
  DB: D1Database;
  CALENDAR_FEED_URL_ENCRYPTION_KEY?: string;
  CALENDAR_FEED_FETCHER?: typeof fetch;
  CALENDAR_FEED_RESOLVE_HOSTNAME?(hostname: string): Promise<string[]>;
  CALENDAR_FEED_NOW?(): Date;
}

export interface CalendarFeedInput {
  url: string;
  hostname: string;
  calendarLabel: string;
  householdLabel: string | null;
}

export interface CalendarFeedUpdate {
  calendarLabel?: string;
  householdLabel?: string | null;
  disable?: true;
}

interface CalendarFeedRow {
  id: string;
  encrypted_url: string;
  hostname: string;
  url_fingerprint: string;
  calendar_label: string;
  household_label: string | null;
  enabled: number;
  health_state: "healthy" | "stale" | "unavailable" | null;
  last_attempt_at: string | null;
  last_success_at: string | null;
  snapshot_fetched_at: string | null;
  snapshot_event_count: number | null;
  snapshot_skipped_event_count: number | null;
  updated_at: string;
}

function bytesToBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function base64ToBytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

async function encryptionKey(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(secret)
  );
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, [
    "encrypt",
    "decrypt"
  ]);
}

export async function encryptCalendarFeedUrl(
  url: string,
  secret: string
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: FEED_URL_AAD },
    await encryptionKey(secret),
    new TextEncoder().encode(url)
  );
  return JSON.stringify({
    contract: FEED_URL_CONTRACT,
    version: 1,
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext))
  });
}

export async function decryptCalendarFeedUrl(
  stored: string,
  secret: string
): Promise<string> {
  const parsed = JSON.parse(stored) as {
    contract: string;
    version: number;
    iv: string;
    ciphertext: string;
  };
  if (parsed.contract !== FEED_URL_CONTRACT || parsed.version !== 1) {
    throw new Error("Unsupported Calendar Feed URL encryption");
  }
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: new Uint8Array(base64ToBytes(parsed.iv)).buffer,
      additionalData: FEED_URL_AAD
    },
    await encryptionKey(secret),
    new Uint8Array(base64ToBytes(parsed.ciphertext)).buffer
  );
  return new TextDecoder().decode(plaintext);
}

function normalizedLabel(
  value: unknown,
  maximumLength: number,
  optional = false
): string | null {
  if (optional && (value === undefined || value === null || value === "")) {
    return null;
  }
  if (typeof value !== "string" || /\p{Cc}/u.test(value)) return null;
  const normalized = value.normalize("NFC").trim().replaceAll(/\s+/gu, " ");
  if (
    normalized.length < 1 ||
    normalized.length > maximumLength ||
    !/^[\p{L}\p{N} &'’.-]+$/u.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

function normalizeFeedUrl(value: unknown): Pick<
  CalendarFeedInput,
  "url" | "hostname"
> | null {
  if (typeof value !== "string") return null;
  const url = parseCalendarFeedUrl(value.trim());
  if (!url || /\s/u.test(value.trim())) return null;
  return { url: url.toString(), hostname: url.hostname };
}

async function resolveCalendarFeedHostname(
  hostname: string
): Promise<string[]> {
  const answers = await Promise.all(
    ["A", "AAAA"].map(async (type) => {
      const response = await fetch(
        `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=${type}`,
        {
          headers: { accept: "application/dns-json" },
          // Workers does not support redirect: "error"; manual preserves no-follow.
          redirect: "manual"
        }
      );
      if (!response.ok) throw new Error("DNS resolution failed");
      const body = (await response.json()) as {
        Answer?: Array<{ type: number; data: string }>;
      };
      const expectedType = type === "A" ? 1 : 28;
      return (body.Answer ?? [])
        .filter((answer) => answer.type === expectedType)
        .map((answer) => answer.data);
    })
  );
  return answers.flat();
}

async function dashboardTimezone(db: D1Database): Promise<string> {
  const configuration = await db
    .prepare("SELECT timezone FROM dashboard_configuration WHERE id = 1")
    .first<{ timezone: string }>();
  if (!configuration?.timezone) {
    throw new Error("Dashboard timezone is unavailable");
  }
  return configuration.timezone;
}

function productionFeedParser(
  feed: Pick<CalendarFeedRow, "calendar_label" | "household_label">,
  timezone: string,
  now: Date
): (input: string) => Promise<CalendarFeedNormalizationResult> {
  return async (input) =>
    normalizeICalendarFeed(input, {
      timezone,
      calendarLabel: feed.calendar_label,
      householdLabel: feed.household_label,
      minimumNonRecurringStart: new Date(
        now.getTime() - NON_RECURRING_HISTORY_BUFFER_MS
      )
    });
}

export function normalizeCalendarFeedInput(
  value: unknown
): CalendarFeedInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as {
    url?: unknown;
    calendarLabel?: unknown;
    householdLabel?: unknown;
  };
  if (
    Object.keys(input).some(
      (key) =>
        key !== "url" &&
        key !== "calendarLabel" &&
        key !== "householdLabel"
    )
  ) {
    return null;
  }
  const normalizedUrl = normalizeFeedUrl(input.url);
  const calendarLabel = normalizedLabel(input.calendarLabel, 40);
  const householdLabel = normalizedLabel(input.householdLabel, 20, true);
  if (!normalizedUrl || !calendarLabel) return null;
  if (
    input.householdLabel !== undefined &&
    input.householdLabel !== null &&
    input.householdLabel !== "" &&
    !householdLabel
  ) {
    return null;
  }
  return { ...normalizedUrl, calendarLabel, householdLabel };
}

export function normalizeCalendarFeedUpdate(
  value: unknown
): CalendarFeedUpdate | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as {
    calendarLabel?: unknown;
    householdLabel?: unknown;
    enabled?: unknown;
  };
  const keys = Object.keys(input);
  if (
    keys.length === 0 ||
    keys.some(
      (key) =>
        key !== "calendarLabel" &&
        key !== "householdLabel" &&
        key !== "enabled"
    ) ||
    input.enabled === true
  ) {
    return null;
  }
  const update: CalendarFeedUpdate = {};
  if ("calendarLabel" in input) {
    const calendarLabel = normalizedLabel(input.calendarLabel, 40);
    if (!calendarLabel) return null;
    update.calendarLabel = calendarLabel;
  }
  if ("householdLabel" in input) {
    const householdLabel = normalizedLabel(input.householdLabel, 20, true);
    if (
      input.householdLabel !== undefined &&
      input.householdLabel !== null &&
      input.householdLabel !== "" &&
      !householdLabel
    ) {
      return null;
    }
    update.householdLabel = householdLabel;
  }
  if ("enabled" in input) {
    if (input.enabled !== false) return null;
    update.disable = true;
  }
  return Object.keys(update).length > 0 ? update : null;
}

async function urlIdentity(url: string): Promise<{
  hash: string;
  fingerprint: string;
}> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(url)
  );
  const hash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  return { hash, fingerprint: hash.slice(0, 12) };
}

function publicFeed(row: CalendarFeedRow) {
  const enabled = row.enabled === 1;
  return {
    id: row.id,
    hostname: row.hostname,
    fingerprint: row.url_fingerprint,
    calendarLabel: row.calendar_label,
    householdLabel: row.household_label,
    enabled,
    status: enabled
      ? row.health_state === "healthy"
        ? "Healthy"
        : row.health_state === "stale"
          ? "Stale"
          : "Unavailable"
      : "Disabled",
    lastAttemptAt: row.last_attempt_at,
    lastSuccessAt: row.last_success_at,
    snapshotFetchedAt: row.snapshot_fetched_at,
    eventCount: row.snapshot_event_count,
    skippedEventCount: row.snapshot_skipped_event_count,
    updatedAt: row.updated_at
  };
}

async function feedRows(db: D1Database, id?: string) {
  const where = id ? "WHERE feed.id = ?" : "";
  const statement = db.prepare(
    `SELECT feed.id, feed.encrypted_url, feed.hostname, feed.url_fingerprint,
            feed.calendar_label, feed.household_label, feed.enabled,
            health.state AS health_state, health.last_attempt_at,
            health.last_success_at, snapshot.fetched_at AS snapshot_fetched_at,
            CASE WHEN snapshot.events_json IS NULL THEN NULL
                 ELSE json_array_length(snapshot.events_json, '$.events')
            END AS snapshot_event_count,
            CASE WHEN snapshot.events_json IS NULL THEN NULL
                 ELSE CAST(json_extract(
                   snapshot.events_json, '$.skippedEventCount'
                 ) AS INTEGER)
            END AS snapshot_skipped_event_count,
            feed.updated_at
     FROM calendar_feeds AS feed
     LEFT JOIN calendar_feed_health AS health ON health.feed_id = feed.id
     LEFT JOIN calendar_feed_snapshots AS snapshot ON snapshot.feed_id = feed.id
     ${where}
     ORDER BY feed.created_at, feed.id`
  );
  return id
    ? [await statement.bind(id).first<CalendarFeedRow>()].filter(
        (row): row is CalendarFeedRow => row !== null
      )
    : (await statement.all<CalendarFeedRow>()).results;
}

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

async function createFeed(
  request: Request,
  env: CalendarFeedEnvironment
): Promise<Response> {
  if (!env.CALENDAR_FEED_URL_ENCRYPTION_KEY) {
    return json({ error: "Calendar Feed encryption is not configured" }, 503);
  }
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: "Invalid Calendar Feed" }, 400);
  }
  const input = normalizeCalendarFeedInput(raw);
  if (!input) return json({ error: "Invalid Calendar Feed" }, 400);
  const id = crypto.randomUUID();
  const identity = await urlIdentity(input.url);
  const encryptedUrl = await encryptCalendarFeedUrl(
    input.url,
    env.CALENDAR_FEED_URL_ENCRYPTION_KEY
  );
  try {
    const result = await env.DB.prepare(
      `INSERT INTO calendar_feeds
         (id, encrypted_url, hostname, url_hash, url_fingerprint,
          calendar_label, household_label, enabled)
       SELECT ?, ?, ?, ?, ?, ?, ?, 0
       WHERE (SELECT COUNT(*) FROM calendar_feeds) < ?`
    )
      .bind(
        id,
        encryptedUrl,
        input.hostname,
        identity.hash,
        identity.fingerprint,
        input.calendarLabel,
        input.householdLabel,
        MAXIMUM_FEEDS
      )
      .run();
    if ((result.meta?.changes ?? 0) !== 1) {
      return json({ error: "Calendar Feed limit reached" }, 409);
    }
  } catch {
    return json({ error: "Calendar Feed already exists" }, 409);
  }
  const [created] = await feedRows(env.DB, id);
  return json(publicFeed(created), 201);
}

async function updateFeed(
  request: Request,
  env: CalendarFeedEnvironment,
  id: string
): Promise<Response> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: "Invalid Calendar Feed update" }, 400);
  }
  const update = normalizeCalendarFeedUpdate(raw);
  if (!update) {
    return json({ error: "Invalid Calendar Feed update" }, 400);
  }
  const assignments: string[] = [];
  const values: unknown[] = [];
  if (update.calendarLabel !== undefined) {
    assignments.push("calendar_label = ?");
    values.push(update.calendarLabel);
  }
  if (update.householdLabel !== undefined) {
    assignments.push("household_label = ?");
    values.push(update.householdLabel);
  }
  if (update.disable) assignments.push("enabled = 0");
  assignments.push("updated_at = CURRENT_TIMESTAMP");
  const result = await env.DB.prepare(
    `UPDATE calendar_feeds SET ${assignments.join(", ")} WHERE id = ?`
  )
    .bind(...values, id)
    .run();
  if ((result.meta?.changes ?? 0) !== 1) {
    return json({ error: "Calendar Feed not found" }, 404);
  }
  const [updated] = await feedRows(env.DB, id);
  return json(publicFeed(updated));
}

async function deleteFeed(
  env: CalendarFeedEnvironment,
  id: string
): Promise<Response> {
  const results = await env.DB.batch([
    env.DB.prepare("DELETE FROM calendar_feed_health_history WHERE feed_id = ?").bind(id),
    env.DB.prepare("DELETE FROM calendar_feed_health WHERE feed_id = ?").bind(id),
    env.DB.prepare("DELETE FROM calendar_feed_snapshots WHERE feed_id = ?").bind(id),
    env.DB.prepare("DELETE FROM calendar_feeds WHERE id = ?").bind(id)
  ]);
  const deleted = results.at(-1)?.meta?.changes ?? 0;
  return deleted === 1
    ? new Response(null, { status: 204 })
    : json({ error: "Calendar Feed not found" }, 404);
}

async function testAndActivateFeed(
  request: Request,
  env: CalendarFeedEnvironment,
  id: string
): Promise<Response> {
  if (!env.CALENDAR_FEED_URL_ENCRYPTION_KEY) {
    return json({ error: "Calendar Feed encryption is not configured" }, 503);
  }
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: "Invalid Calendar Feed test" }, 400);
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return json({ error: "Invalid Calendar Feed test" }, 400);
  }
  const body = raw as { url?: unknown };
  if (Object.keys(body).some((key) => key !== "url")) {
    return json({ error: "Invalid Calendar Feed test" }, 400);
  }
  const [existing] = await feedRows(env.DB, id);
  if (!existing) return json({ error: "Calendar Feed not found" }, 404);
  const replacement =
    body.url === undefined ? null : normalizeFeedUrl(body.url);
  if (body.url !== undefined && !replacement) {
    return json({ error: "Invalid Calendar Feed test" }, 400);
  }
  const url =
    replacement?.url ??
    (await decryptCalendarFeedUrl(
      existing.encrypted_url,
      env.CALENDAR_FEED_URL_ENCRYPTION_KEY
    ));
  const now = env.CALENDAR_FEED_NOW?.() ?? new Date();
  let result;
  try {
    const timezone = await dashboardTimezone(env.DB);
    result = await fetchCalendarFeed(url, {
      fetcher: env.CALENDAR_FEED_FETCHER ?? DEFAULT_CALENDAR_FEED_FETCHER,
      resolveHostname:
        env.CALENDAR_FEED_RESOLVE_HOSTNAME ?? resolveCalendarFeedHostname,
      parse: productionFeedParser(existing, timezone, now)
    });
  } catch (error) {
    const code =
      error instanceof CalendarFeedFetchError ? error.code : "invalid_response";
    return json({ error: "Calendar Feed test failed", code }, 422);
  }
  if (result.kind !== "updated") {
    return json(
      { error: "Calendar Feed test failed", code: "invalid_response" },
      422
    );
  }
  const nowIso = now.toISOString();
  const statements: D1PreparedStatement[] = [];
  if (replacement) {
    const identity = await urlIdentity(replacement.url);
    statements.push(
      env.DB.prepare(
        `UPDATE calendar_feeds
         SET encrypted_url = ?, hostname = ?, url_hash = ?,
             url_fingerprint = ?, enabled = 1,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      ).bind(
        await encryptCalendarFeedUrl(
          replacement.url,
          env.CALENDAR_FEED_URL_ENCRYPTION_KEY
        ),
        replacement.hostname,
        identity.hash,
        identity.fingerprint,
        id
      )
    );
  } else {
    statements.push(
      env.DB.prepare(
        `UPDATE calendar_feeds
         SET enabled = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
      ).bind(id)
    );
  }
  statements.push(
    env.DB.prepare(
      `INSERT INTO calendar_feed_snapshots
         (feed_id, fetched_at, events_json, etag, last_modified)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(feed_id) DO UPDATE SET
         fetched_at = excluded.fetched_at,
         events_json = excluded.events_json,
         etag = excluded.etag,
         last_modified = excluded.last_modified`
    ).bind(
      id,
      nowIso,
      JSON.stringify(result.snapshot),
      result.etag,
      result.lastModified
    ),
    env.DB.prepare(
      `INSERT INTO calendar_feed_health
         (feed_id, state, last_attempt_at, last_success_at, failure_code)
       VALUES (?, 'healthy', ?, ?, NULL)
       ON CONFLICT(feed_id) DO UPDATE SET
         state = 'healthy',
         last_attempt_at = excluded.last_attempt_at,
         last_success_at = excluded.last_success_at,
         failure_code = NULL,
         updated_at = CURRENT_TIMESTAMP`
    ).bind(id, nowIso, nowIso),
    env.DB.prepare(
      `INSERT INTO calendar_feed_health_history (feed_id, state, failure_code)
       VALUES (?, 'healthy', NULL)`
    ).bind(id)
  );
  try {
    await env.DB.batch(statements);
  } catch {
    return json({ error: "Calendar Feed could not be activated" }, 503);
  }
  const [activated] = await feedRows(env.DB, id);
  return json(publicFeed(activated));
}

export async function handleCalendarFeedAdministration(
  request: Request,
  env: CalendarFeedEnvironment,
  role: "administrator" | "reviewer"
): Promise<Response> {
  const pathname = new URL(request.url).pathname;
  if (pathname === "/admin/calendar-feeds") {
    if (request.method === "GET") {
      return json({
        feeds: (await feedRows(env.DB)).map(publicFeed),
        limit: MAXIMUM_FEEDS
      });
    }
    if (request.method === "POST") {
      if (role !== "administrator") {
        return json({ error: "Administrator role required" }, 403);
      }
      return createFeed(request, env);
    }
  }
  const match = pathname.match(/^\/admin\/calendar-feeds\/([^/]+)$/);
  if (match && (request.method === "PATCH" || request.method === "DELETE")) {
    if (role !== "administrator") {
      return json({ error: "Administrator role required" }, 403);
    }
    const id = decodeURIComponent(match[1]);
    return request.method === "PATCH"
      ? updateFeed(request, env, id)
      : deleteFeed(env, id);
  }
  const testMatch = pathname.match(
    /^\/admin\/calendar-feeds\/([^/]+)\/test$/
  );
  if (testMatch && request.method === "POST") {
    if (role !== "administrator") {
      return json({ error: "Administrator role required" }, 403);
    }
    return testAndActivateFeed(
      request,
      env,
      decodeURIComponent(testMatch[1])
    );
  }
  return json({ error: "Not found" }, 404);
}

export async function listEnabledCalendarFeedSources(
  env: CalendarFeedEnvironment
): Promise<
  Array<{
    id: string;
    url: string;
    calendarLabel: string;
    householdLabel: string | null;
  }>
> {
  if (!env.CALENDAR_FEED_URL_ENCRYPTION_KEY) {
    throw new Error("Calendar Feed encryption is not configured");
  }
  const rows = await env.DB.prepare(
    `SELECT id, encrypted_url, calendar_label, household_label
     FROM calendar_feeds WHERE enabled = 1 ORDER BY created_at, id`
  ).all<Pick<
    CalendarFeedRow,
    "id" | "encrypted_url" | "calendar_label" | "household_label"
  >>();
  return Promise.all(
    rows.results.map(async (row) => ({
      id: row.id,
      url: await decryptCalendarFeedUrl(
        row.encrypted_url,
        env.CALENDAR_FEED_URL_ENCRYPTION_KEY!
      ),
      calendarLabel: row.calendar_label,
      householdLabel: row.household_label
    }))
  );
}

export async function refreshCalendarFeed(
  env: CalendarFeedEnvironment,
  id: string
): Promise<{ kind: "updated" | "unchanged" }> {
  if (!env.CALENDAR_FEED_URL_ENCRYPTION_KEY) {
    throw new Error("Calendar Feed encryption is not configured");
  }
  const [feed] = await feedRows(env.DB, id);
  if (!feed || feed.enabled !== 1) {
    throw new Error("Enabled Calendar Feed not found");
  }
  const snapshot = await env.DB.prepare(
    `SELECT fetched_at, events_json, etag, last_modified
     FROM calendar_feed_snapshots WHERE feed_id = ?`
  )
    .bind(id)
    .first<{
      fetched_at: string;
      events_json: string;
      etag: string | null;
      last_modified: string | null;
    }>();
  const now = env.CALENDAR_FEED_NOW?.() ?? new Date();
  const result = await fetchCalendarFeed(
    await decryptCalendarFeedUrl(
      feed.encrypted_url,
      env.CALENDAR_FEED_URL_ENCRYPTION_KEY
    ),
    {
      fetcher: env.CALENDAR_FEED_FETCHER ?? DEFAULT_CALENDAR_FEED_FETCHER,
      resolveHostname:
        env.CALENDAR_FEED_RESOLVE_HOSTNAME ?? resolveCalendarFeedHostname,
      parse: productionFeedParser(
        feed,
        await dashboardTimezone(env.DB),
        now
      ),
      etag: snapshot?.etag,
      lastModified: snapshot?.last_modified
    }
  );
  const nowIso = now.toISOString();
  const statements: D1PreparedStatement[] = [];
  if (result.kind === "updated") {
    statements.push(
      env.DB.prepare(
        `INSERT INTO calendar_feed_snapshots
           (feed_id, fetched_at, events_json, etag, last_modified)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(feed_id) DO UPDATE SET
           fetched_at = excluded.fetched_at,
           events_json = excluded.events_json,
           etag = excluded.etag,
           last_modified = excluded.last_modified`
      ).bind(
        id,
        nowIso,
        JSON.stringify(result.snapshot),
        result.etag,
        result.lastModified
      )
    );
  }
  statements.push(
    env.DB.prepare(
      `INSERT INTO calendar_feed_health
         (feed_id, state, last_attempt_at, last_success_at, failure_code)
       VALUES (?, 'healthy', ?, ?, NULL)
       ON CONFLICT(feed_id) DO UPDATE SET
         state = 'healthy',
         last_attempt_at = excluded.last_attempt_at,
         last_success_at = excluded.last_success_at,
         failure_code = NULL,
         updated_at = CURRENT_TIMESTAMP`
    ).bind(id, nowIso, nowIso),
    env.DB.prepare(
      `INSERT INTO calendar_feed_health_history (feed_id, state, failure_code)
       VALUES (?, 'healthy', NULL)`
    ).bind(id)
  );
  await env.DB.batch(statements);
  return { kind: result.kind };
}

export async function refreshEnabledCalendarFeeds(
  env: CalendarFeedEnvironment,
  concurrency = 4
): Promise<
  Array<
    | { id: string; kind: "updated" | "unchanged" }
    | { id: string; kind: "failed"; code: string }
  >
> {
  const feeds = await env.DB.prepare(
    `SELECT id FROM calendar_feeds
     WHERE enabled = 1 ORDER BY created_at, id`
  ).all<{ id: string }>();
  return fetchCalendarFeedsBounded(
    feeds.results,
    async ({ id }) => {
      try {
        return { id, ...(await refreshCalendarFeed(env, id)) };
      } catch (error) {
        return {
          id,
          kind: "failed" as const,
          code:
            error instanceof CalendarFeedFetchError
              ? error.code
              : "invalid_response"
        };
      }
    },
    concurrency
  );
}

interface GenerationFeedRow {
  id: string;
  encrypted_url: string;
  calendar_label: string;
  household_label: string | null;
  fetched_at: string | null;
  events_json: string | null;
  etag: string | null;
  last_modified: string | null;
  last_success_at: string | null;
}

export interface CalendarFeedGenerationSnapshot {
  calendar: CalendarEvent[];
  unavailable: boolean;
  staleAgeMinutes?: number;
  failures: Array<{ id: string; code: string }>;
}

function snapshotWithCurrentLabels(
  value: string,
  calendarLabel: string,
  householdLabel: string | null
): CalendarFeedNormalizationResult | null {
  try {
    const snapshot = JSON.parse(value) as CalendarFeedNormalizationResult;
    if (
      !snapshot ||
      !Array.isArray(snapshot.events) ||
      typeof snapshot.skippedEventCount !== "number" ||
      !Array.isArray(snapshot.skipReasons)
    ) {
      return null;
    }
    return {
      ...snapshot,
      events: snapshot.events.map((event) => ({
        ...event,
        calendarLabel,
        householdLabel
      }))
    };
  } catch {
    return null;
  }
}

function generationCalendarEvent(
  event: ReturnType<typeof expandAndMergeCalendarFeedEvents>[number]
): CalendarEvent {
  return {
    occurrenceId: `${event.uid.trim().normalize("NFC")}|${event.occurrenceId}`,
    title: event.summary,
    start: event.start,
    end: event.end,
    allDay: event.allDay,
    tentative: event.status === "tentative",
    private: event.summary === "Busy" && event.location === undefined,
    ownerLabels:
      event.householdLabels.length > 0 ? event.householdLabels : ["Family"],
    calendarLabels: event.calendarLabels,
    ...(event.location ? { location: event.location } : {})
  };
}

export async function refreshCalendarFeedsForGeneration(
  env: CalendarFeedEnvironment,
  now: Date,
  timezone: string,
  concurrency = 4
): Promise<CalendarFeedGenerationSnapshot> {
  const feeds = await env.DB.prepare(
    `SELECT feed.id, feed.encrypted_url, feed.calendar_label,
            feed.household_label, snapshot.fetched_at, snapshot.events_json,
            snapshot.etag, snapshot.last_modified, health.last_success_at
     FROM calendar_feeds AS feed
     LEFT JOIN calendar_feed_snapshots AS snapshot ON snapshot.feed_id = feed.id
     LEFT JOIN calendar_feed_health AS health ON health.feed_id = feed.id
     WHERE feed.enabled = 1
     ORDER BY feed.created_at, feed.id`
  ).all<GenerationFeedRow>();
  if (feeds.results.length === 0) {
    return { calendar: [], unavailable: true, failures: [] };
  }
  const nowIso = now.toISOString();

  const results = await fetchCalendarFeedsBounded(
    feeds.results,
    async (feed) => {
      try {
        if (!env.CALENDAR_FEED_URL_ENCRYPTION_KEY) {
          throw new Error("Calendar Feed encryption is not configured");
        }
        const fetched = await fetchCalendarFeed(
          await decryptCalendarFeedUrl(
            feed.encrypted_url,
            env.CALENDAR_FEED_URL_ENCRYPTION_KEY!
          ),
          {
            fetcher:
              env.CALENDAR_FEED_FETCHER ?? DEFAULT_CALENDAR_FEED_FETCHER,
            resolveHostname:
              env.CALENDAR_FEED_RESOLVE_HOSTNAME ??
              resolveCalendarFeedHostname,
            parse: async (input) =>
              normalizeICalendarFeed(input, {
                timezone,
                calendarLabel: feed.calendar_label,
                householdLabel: feed.household_label,
                minimumNonRecurringStart: new Date(
                  now.getTime() - NON_RECURRING_HISTORY_BUFFER_MS
                )
              }),
            etag: feed.etag,
            lastModified: feed.last_modified
          }
        );
        const snapshot =
          fetched.kind === "updated"
            ? fetched.snapshot
            : feed.events_json
              ? snapshotWithCurrentLabels(
                  feed.events_json,
                  feed.calendar_label,
                  feed.household_label
                )
              : null;
        if (!snapshot) {
          throw new CalendarFeedFetchError("invalid_response");
        }
        const statements: D1PreparedStatement[] = [];
        if (fetched.kind === "updated") {
          statements.push(
            env.DB.prepare(
              `INSERT INTO calendar_feed_snapshots
                 (feed_id, fetched_at, events_json, etag, last_modified)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(feed_id) DO UPDATE SET
                 fetched_at = excluded.fetched_at,
                 events_json = excluded.events_json,
                 etag = excluded.etag,
                 last_modified = excluded.last_modified`
            ).bind(
              feed.id,
              nowIso,
              JSON.stringify(snapshot),
              fetched.etag,
              fetched.lastModified
            )
          );
        }
        statements.push(
          env.DB.prepare(
            `INSERT INTO calendar_feed_health
               (feed_id, state, last_attempt_at, last_success_at, failure_code)
             VALUES (?, 'healthy', ?, ?, NULL)
             ON CONFLICT(feed_id) DO UPDATE SET
               state = 'healthy',
               last_attempt_at = excluded.last_attempt_at,
               last_success_at = excluded.last_success_at,
               failure_code = NULL,
               updated_at = CURRENT_TIMESTAMP`
          ).bind(feed.id, nowIso, nowIso),
          env.DB.prepare(
            `INSERT INTO calendar_feed_health_history
               (feed_id, state, failure_code)
             VALUES (?, 'healthy', NULL)`
          ).bind(feed.id)
        );
        await env.DB.batch(statements);
        return { feed, snapshot, staleAgeMinutes: undefined, failure: null };
      } catch (error) {
        const code =
          error instanceof CalendarFeedFetchError
            ? error.code
            : "invalid_response";
        const lastSuccess = feed.last_success_at ?? feed.fetched_at;
        const ageMilliseconds = lastSuccess
          ? Math.max(0, now.getTime() - new Date(lastSuccess).getTime())
          : Number.POSITIVE_INFINITY;
        const storedSnapshot = feed.events_json
          ? snapshotWithCurrentLabels(
              feed.events_json,
              feed.calendar_label,
              feed.household_label
            )
          : null;
        const usable =
          storedSnapshot !== null &&
          Number.isFinite(ageMilliseconds) &&
          ageMilliseconds <= MAXIMUM_STALE_AGE_MS;
        const state = usable ? "stale" : "unavailable";
        await env.DB.batch([
          env.DB.prepare(
            `INSERT INTO calendar_feed_health
               (feed_id, state, last_attempt_at, last_success_at, failure_code)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(feed_id) DO UPDATE SET
               state = excluded.state,
               last_attempt_at = excluded.last_attempt_at,
               last_success_at = excluded.last_success_at,
               failure_code = excluded.failure_code,
               updated_at = CURRENT_TIMESTAMP`
          ).bind(feed.id, state, nowIso, lastSuccess, code),
          env.DB.prepare(
            `INSERT INTO calendar_feed_health_history
               (feed_id, state, failure_code)
             VALUES (?, ?, ?)`
          ).bind(feed.id, state, code)
        ]);
        return {
          feed,
          snapshot: usable ? storedSnapshot : null,
          staleAgeMinutes: usable
            ? Math.floor(ageMilliseconds / 60_000)
            : undefined,
          failure: { id: feed.id, code }
        };
      }
    },
    concurrency
  );

  const usable = results.filter(
    (
      result
    ): result is typeof result & {
      snapshot: CalendarFeedNormalizationResult;
    } => result.snapshot !== null
  );
  const staleAges = usable.flatMap((result) =>
    result.staleAgeMinutes === undefined ? [] : [result.staleAgeMinutes]
  );
  const calendar = expandAndMergeCalendarFeedEvents(
    usable.map(({ snapshot }) => snapshot),
    { now, timezone, days: 3 }
  ).map(generationCalendarEvent);
  const failures = results.flatMap(({ failure }) => (failure ? [failure] : []));
  if (failures.length === 0) {
    await env.DB.prepare(
      `UPDATE source_status SET state = 'fresh', last_success_at = ?,
         error_code = NULL, consecutive_failures = 0,
         last_failure_slot_key = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE source = 'calendar'`
    )
      .bind(nowIso)
      .run();
  }

  return {
    calendar,
    unavailable: usable.length === 0,
    ...(staleAges.length > 0
      ? { staleAgeMinutes: Math.max(...staleAges) }
      : {}),
    failures
  };
}
