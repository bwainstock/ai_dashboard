const FEED_URL_CONTRACT = "calendar-feed-url";
const FEED_URL_AAD = new TextEncoder().encode(`${FEED_URL_CONTRACT}:v1`);
const MAXIMUM_FEEDS = 20;

export interface CalendarFeedEnvironment {
  DB: D1Database;
  CALENDAR_FEED_URL_ENCRYPTION_KEY?: string;
  CALENDAR_FEED_FETCHER?: typeof fetch;
  CALENDAR_FEED_RESOLVE_HOSTNAME?(hostname: string): Promise<string[]>;
  CALENDAR_FEED_PARSE?(input: string): Promise<unknown>;
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
  if (typeof value !== "string" || value.length > 4096) return null;
  const trimmed = value.trim();
  if (/\s/u.test(trimmed)) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  if (
    url.protocol !== "https:" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== "" ||
    !url.hostname
  ) {
    return null;
  }
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
          redirect: "error"
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

export async function parseCalendarFeedEnvelope(
  input: string
): Promise<unknown[]> {
  const lines = input
    .replace(/^\uFEFF/, "")
    .replaceAll("\r\n", "\n")
    .trim()
    .split("\n");
  if (lines[0] !== "BEGIN:VCALENDAR" || lines.at(-1) !== "END:VCALENDAR") {
    throw new CalendarFeedFetchError("invalid_response");
  }
  return [];
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
    updatedAt: row.updated_at
  };
}

async function feedRows(db: D1Database, id?: string) {
  const where = id ? "WHERE feed.id = ?" : "";
  const statement = db.prepare(
    `SELECT feed.id, feed.encrypted_url, feed.hostname, feed.url_fingerprint,
            feed.calendar_label, feed.household_label, feed.enabled,
            health.state AS health_state, health.last_attempt_at,
            health.last_success_at, feed.updated_at
     FROM calendar_feeds AS feed
     LEFT JOIN calendar_feed_health AS health ON health.feed_id = feed.id
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
  let result;
  try {
    result = await fetchCalendarFeed(url, {
      fetcher: env.CALENDAR_FEED_FETCHER ?? fetch,
      resolveHostname:
        env.CALENDAR_FEED_RESOLVE_HOSTNAME ?? resolveCalendarFeedHostname,
      parse: env.CALENDAR_FEED_PARSE ?? parseCalendarFeedEnvelope
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
  const now = (env.CALENDAR_FEED_NOW?.() ?? new Date()).toISOString();
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
      now,
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
    ).bind(id, now, now),
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
  const result = await fetchCalendarFeed(
    await decryptCalendarFeedUrl(
      feed.encrypted_url,
      env.CALENDAR_FEED_URL_ENCRYPTION_KEY
    ),
    {
      fetcher: env.CALENDAR_FEED_FETCHER ?? fetch,
      resolveHostname:
        env.CALENDAR_FEED_RESOLVE_HOSTNAME ?? resolveCalendarFeedHostname,
      parse: env.CALENDAR_FEED_PARSE ?? parseCalendarFeedEnvelope,
      etag: snapshot?.etag,
      lastModified: snapshot?.last_modified
    }
  );
  const now = (env.CALENDAR_FEED_NOW?.() ?? new Date()).toISOString();
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
        now,
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
    ).bind(id, now, now),
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
import {
  CalendarFeedFetchError,
  fetchCalendarFeed,
  fetchCalendarFeedsBounded
} from "./calendar-feed-fetch";
