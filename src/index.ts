import puppeteer from "@cloudflare/puppeteer";
import {
  authorizeAdministration,
  handleAuthorizedAdministration,
  isAdministrationHost
} from "./admin";
import { dailyBriefHtml } from "./daily-brief";
import { calendarViewHtml, type CalendarViewModel } from "./calendar-view";
import { lunchViewHtml, type LunchViewModel } from "./lunch-view";
import { noticesViewHtml, type NoticesViewModel } from "./notices-view";
import { validateRenderedPage } from "./render-validation";
import { effectiveMaximumImageBytes } from "./device-limits";
import {
  normalizeCalendarEvents,
  type CalendarEvent,
  type CalendarSourceEvent
} from "./calendar";
import {
  buildCalendarAuthorizationUrl,
  createCalendarOAuthState,
  decryptRefreshToken,
  encryptRefreshToken,
  verifyCalendarOAuthState
} from "./calendar-oauth";
import { fixtureHtml } from "./fixture";
import {
  runScheduledWeatherGeneration,
  secondsUntilNextSlot,
  type DashboardConfiguration,
  type DailyBriefNotice,
  type DailyBriefWeatherModel,
  type Publication
} from "./generation";
import { fetchWeather, type WeatherSnapshot } from "./weather";
import {
  fetchMealViewerMenu,
  type LunchIcon,
  type LunchSnapshot
} from "./lunch";
import { runOperationalIncidentCheck } from "./incidents";
import {
  disconnectGoogleAccount,
  type GmailAccountDataRepository,
  type GmailAccountId
} from "./gmail-controls";
import {
  exchangeCalendarAuthorizationCode,
  fetchGoogleCalendarEvents,
  listGoogleCalendars,
  refreshCalendarAccessToken,
  revokeGoogleAccess
} from "./google-calendar";
import type { OperationalCode } from "./operational-codes";
import {
  type CalendarConfigurationAccount,
  type CalendarSelectionValidationFailure,
  calendarSelectionValidationError,
  normalizeCalendarConfiguration,
  normalizeGmailSenderDomains,
  replaceCalendarConfiguration,
  replaceWeatherConfiguration
} from "./administration-configuration";

export interface Env {
  DB: D1Database;
  IMAGES: R2Bucket;
  BROWSER: Fetcher;
  GENERATION_SECRET: string;
  DEVICE_ORIGIN: string;
  ADMIN_ORIGIN?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  CALENDAR_TOKEN_ENCRYPTION_KEY?: string;
  MAX_IMAGE_BYTES?: string;
  GENERATION_RETRY_MINUTES?: string;
  MEALVIEWER_MENU_URL?: string;
  AI?: {
    run(model: string, input: unknown): Promise<unknown>;
  };
  LUNCH_AI_MODEL?: string;
  INCIDENT_EMAIL?: SendEmail;
  OPERATIONAL_EMAIL_FROM?: string;
  OPERATIONAL_EMAIL_TO?: string;
  GMAIL_PROCESSOR?: Fetcher;
  GMAIL_PROCESSOR_KEY?: string;
  NOTICE_GRACE_DAYS?: string;
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" }
  });
}

async function administrationBodyTooLarge(request: Request): Promise<boolean> {
  if (!["POST", "PUT", "PATCH"].includes(request.method)) return false;
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > 65_536) return true;
  return (await request.clone().arrayBuffer()).byteLength > 65_536;
}

function randomToken(byteLength: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

async function hash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

async function setup(request: Request, env: Env): Promise<Response> {
  const deviceId = request.headers.get("ID")?.trim().toUpperCase();
  if (!deviceId) {
    return json({ status: 400, error: "Missing device ID" }, 400);
  }

  const token = randomToken(32);
  const friendlyId = randomToken(5)
    .replaceAll("-", "")
    .replaceAll("_", "")
    .slice(0, 6)
    .toUpperCase()
    .padEnd(6, "0");

  await env.DB.prepare(
    `INSERT INTO devices (device_id, token_hash, friendly_id)
     VALUES (?, ?, ?)
     ON CONFLICT(device_id) DO UPDATE SET
       token_hash = excluded.token_hash,
       friendly_id = excluded.friendly_id,
       updated_at = CURRENT_TIMESTAMP`
  )
    .bind(deviceId, await hash(token), friendlyId)
    .run();

  return json({
    status: 200,
    api_key: token,
    friendly_id: friendlyId,
    message: `Family Dashboard device ${friendlyId} is ready`
  });
}

async function isAuthenticated(request: Request, env: Env): Promise<boolean> {
  const deviceId = request.headers.get("ID")?.trim().toUpperCase();
  const token = request.headers.get("Access-Token");
  if (!deviceId || !token) {
    await recordDeviceAuthentication(env, false);
    return false;
  }

  const device = await env.DB.prepare(
    "SELECT token_hash FROM devices WHERE device_id = ?"
  )
    .bind(deviceId)
    .first<{ token_hash: string }>();

  const authenticated = device?.token_hash === (await hash(token));
  await recordDeviceAuthentication(env, authenticated);
  return authenticated;
}

async function recordDeviceAuthentication(
  env: Env,
  authenticated: boolean
): Promise<void> {
  const active = authenticated ? 0 : 1;
  const result = await env.DB.prepare(
    `UPDATE operational_signals
     SET active = ?, updated_at = CURRENT_TIMESTAMP
     WHERE signal_key = 'device_auth_suspicious' AND active != ?`
  )
    .bind(active, active)
    .run();
  if (
    (result.meta?.changes ?? 0) > 0 &&
    env.INCIDENT_EMAIL &&
    env.OPERATIONAL_EMAIL_FROM &&
    env.OPERATIONAL_EMAIL_TO
  ) {
    await runOperationalIncidentCheck(env, new Date()).catch(() => undefined);
  }
}

async function display(request: Request, env: Env): Promise<Response> {
  if (!(await isAuthenticated(request, env))) {
    return json(
      {
        status: 401,
        error: "Invalid device credentials",
        reset_firmware: false
      },
      401
    );
  }

  const deviceId = request.headers.get("ID")!.trim().toUpperCase();
  await env.DB.prepare(
    `UPDATE devices SET last_check_in_at = CURRENT_TIMESTAMP,
       updated_at = CURRENT_TIMESTAMP WHERE device_id = ?`
  )
    .bind(deviceId)
    .run();
  const device = await env.DB.prepare(
    "SELECT view_cursor FROM devices WHERE device_id = ?"
  )
    .bind(deviceId)
    .first<{ view_cursor: number }>();
  const updateSource = request.headers.get("Update-Source")?.toLowerCase();
  const manualWake =
    updateSource !== undefined &&
    !["timer", "scheduled", "powercycle", "unknown"].includes(updateSource);
  const viewCursor = manualWake ? ((device?.view_cursor ?? 0) + 1) % 4 : 0;
  const viewType = ["daily_brief", "calendar", "lunch", "notices"][viewCursor];
  await env.DB.prepare(
    `UPDATE devices SET view_cursor = ?, updated_at = CURRENT_TIMESTAMP
     WHERE device_id = ?`
  )
    .bind(viewCursor, deviceId)
    .run();

  const generation = await env.DB.prepare(
    `SELECT filename, object_key, byte_size
     FROM current_render_generation AS current_pointer
     JOIN render_generations AS generation
       ON generation.generation_id = current_pointer.generation_id
     WHERE current_pointer.id = 1 AND generation.view_type = ?
     LIMIT 1`
  )
    .bind(viewType)
    .first<{ filename: string; object_key: string; byte_size: number }>();
  if (!generation) {
    return json({ status: 503, error: "No published generation" }, 503);
  }
  const configuration = await loadConfiguration(env);

  return json({
    status: 0,
    image_url: `${env.DEVICE_ORIGIN.replace(/\/$/, "")}/images/${encodeURIComponent(generation.filename)}`,
    filename: generation.filename,
    refresh_rate: secondsUntilNextSlot(new Date(), configuration),
    reset_firmware: false,
    update_firmware: false,
    firmware_url: "",
    special_function: "sleep"
  });
}

async function image(
  request: Request,
  env: Env,
  filename: string
): Promise<Response> {
  if (!(await isAuthenticated(request, env))) {
    return json({ error: "Invalid device credentials" }, 401);
  }

  const generation = await env.DB.prepare(
    `SELECT object_key, byte_size
     FROM render_generations
     WHERE filename = ? AND published_at IS NOT NULL
     LIMIT 1`
  )
    .bind(filename)
    .first<{ object_key: string; byte_size: number }>();
  if (!generation) {
    return json({ error: "Image not found" }, 404);
  }

  const object = await env.IMAGES.get(generation.object_key);
  if (!object || object.size !== generation.byte_size) {
    return json({ error: "Image unavailable" }, 503);
  }

  return new Response(object.body, {
    headers: {
      "cache-control": "private, no-store",
      "content-length": String(object.size),
      "content-type": "image/png",
      etag: object.httpEtag,
      "x-content-type-options": "nosniff"
    }
  });
}

function readPngDimensions(bytes: Uint8Array): [number, number] | null {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (
    bytes.byteLength < 24 ||
    !signature.every((value, index) => bytes[index] === value)
  ) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return [view.getUint32(16), view.getUint32(20)];
}

function isAdministrator(request: Request, env: Env): boolean {
  if (request.headers.get("X-Administration-Role") === "administrator") {
    return true;
  }
  const authorization = request.headers.get("Authorization");
  return (
    request.headers.get("X-Admin-Token") === env.GENERATION_SECRET ||
    authorization === env.GENERATION_SECRET ||
    authorization === `Bearer ${env.GENERATION_SECRET}`
  );
}

interface StoredConfiguration {
  latitude: number;
  longitude: number;
  timezone: string;
  slots_json: string;
}

async function loadConfiguration(env: Env): Promise<DashboardConfiguration> {
  const stored = await env.DB.prepare(
    `SELECT latitude, longitude, timezone, slots_json
     FROM dashboard_configuration WHERE id = 1`
  ).first<StoredConfiguration>();
  if (!stored) throw new Error("Weather configuration unavailable");
  return {
    latitude: stored.latitude,
    longitude: stored.longitude,
    timezone: stored.timezone,
    slots: JSON.parse(stored.slots_json) as string[]
  };
}

async function weatherConfiguration(
  request: Request,
  env: Env
): Promise<Response> {
  if (!isSectionConfigurationAuthorized(request, env)) {
    return json({ error: "Unauthorized" }, 401);
  }
  return weatherConfigurationAuthorized(request, env);
}

function isSectionConfigurationAuthorized(request: Request, env: Env): boolean {
  if (isAdministrator(request, env)) return true;
  return (
    request.method === "GET" &&
    request.headers.get("X-Administration-Role") === "reviewer"
  );
}

function calendarSecrets(env: Env) {
    if (
      !env.GOOGLE_CLIENT_ID ||
      !env.GOOGLE_CLIENT_SECRET ||
      !env.CALENDAR_TOKEN_ENCRYPTION_KEY ||
      !env.ADMIN_ORIGIN
    ) {
      throw new Error("Calendar OAuth is not configured");
    }
    return {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      encryptionKey: env.CALENDAR_TOKEN_ENCRYPTION_KEY,
      redirectUri: `${env.ADMIN_ORIGIN.replace(/\/$/, "")}/admin/calendar/oauth/callback`
    };
  }

interface CalendarAccountRow {
    account_id: "mom" | "dad";
    display_label: string;
    encrypted_refresh_token: string | null;
    oauth_status: "connected" | "disconnected" | "revoked";
    gmail_disconnect_state?: "revocation_pending" | "cleanup_pending" | null;
  }

interface SelectedCalendarRow {
    account_id: "mom" | "dad";
    calendar_id: string;
    display_label: string;
  }

async function validateNewSelectedCalendars(
  env: Env,
  accounts: CalendarConfigurationAccount[]
): Promise<CalendarSelectionValidationFailure | null> {
  const current = await env.DB.prepare(
    `SELECT account_id, calendar_id, display_label
     FROM selected_calendars ORDER BY account_id, calendar_id`
  ).all<SelectedCalendarRow>();
  for (const accountInput of accounts) {
    const existingIds = new Set(
      current.results
        .filter(({ account_id }) => account_id === accountInput.accountId)
        .map(({ calendar_id }) => calendar_id)
    );
    const newIds = accountInput.calendars
      .map(({ id }) => id)
      .filter((id) => !existingIds.has(id));
    if (newIds.length === 0) continue;
    const account = await env.DB.prepare(
      `SELECT account_id, display_label, encrypted_refresh_token,
              oauth_status
       FROM calendar_accounts WHERE account_id = ?`
    )
      .bind(accountInput.accountId)
      .first<CalendarAccountRow>();
    if (!account || account.oauth_status !== "connected") return "disconnected";
    try {
      const discovered = await listGoogleCalendars(
        await accessTokenForAccount(env, account)
      );
      const discoveredIds = new Set(discovered.map(({ id }) => id));
      if (newIds.some((id) => !discoveredIds.has(id))) return "not_discovered";
    } catch {
      return "discovery_failed";
    }
  }
  return null;
}

async function calendarConfiguration(
    request: Request,
    env: Env
  ): Promise<Response> {
    if (!isSectionConfigurationAuthorized(request, env)) {
      return json({ error: "Unauthorized" }, 401);
    }
    if (request.method === "PUT") {
      let input: { accounts?: unknown };
      try {
        input = await request.json();
      } catch {
        return json({ error: "Invalid calendar configuration" }, 400);
      }
      const accounts = normalizeCalendarConfiguration(input.accounts);
      if (!accounts) {
        return json({ error: "Invalid calendar configuration" }, 400);
      }
      const validationError = calendarSelectionValidationError(
        await validateNewSelectedCalendars(env, accounts)
      );
      if (validationError) {
        return json({ error: validationError.error }, validationError.status);
      }
      await replaceCalendarConfiguration(env.DB, accounts);
    }
    const accounts = await env.DB.prepare(
      `SELECT account_id, display_label, oauth_status, gmail_disconnect_state
       FROM calendar_accounts ORDER BY account_id`
    ).all<Omit<CalendarAccountRow, "encrypted_refresh_token">>();
    const calendars = await env.DB.prepare(
      `SELECT account_id, calendar_id, display_label
       FROM selected_calendars ORDER BY account_id, display_label`
    ).all<SelectedCalendarRow>();
    return json({
      accounts: accounts.results.map((account) => ({
        accountId: account.account_id,
        displayLabel: account.display_label,
        connected:
          account.oauth_status === "connected" &&
          account.gmail_disconnect_state == null,
        ...(account.oauth_status === "revoked"
          ? { reconnectRequired: true }
          : {}),
        ...(account.gmail_disconnect_state == null
          ? {}
          : { cleanupPending: true }),
        calendars: calendars.results
          .filter(({ account_id }) => account_id === account.account_id)
          .map(({ calendar_id, display_label }) => ({
            id: calendar_id,
            label: display_label
          }))
      }))
    });
  }

async function calendarOAuthStart(
    request: Request,
    env: Env
  ): Promise<Response> {
    if (!isAdministrator(request, env)) {
      return json({ error: "Unauthorized" }, 401);
    }
    try {
      const secrets = calendarSecrets(env);
      const accountId = new URL(request.url).searchParams.get("account");
      if (accountId !== "mom" && accountId !== "dad") {
        return json({ error: "Invalid calendar account" }, 400);
      }
      const state = await createCalendarOAuthState(
        accountId,
        secrets.encryptionKey
      );
      return json({
        authorizationUrl: buildCalendarAuthorizationUrl({
          clientId: secrets.clientId,
          redirectUri: secrets.redirectUri,
          state
        })
      });
    } catch {
      return json({ error: "Calendar OAuth is not configured" }, 503);
    }
  }

async function calendarOAuthCallback(
    request: Request,
    env: Env
  ): Promise<Response> {
    if (!isAdministrator(request, env)) {
      return json({ error: "Unauthorized" }, 401);
    }
    const wantsJson = request.headers
      .get("accept")
      ?.split(",")
      .some((value) => value.trim().split(";")[0] === "application/json");
    let accountId: "mom" | "dad" | null = null;
    try {
      const secrets = calendarSecrets(env);
      const url = new URL(request.url);
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      if (!state) throw new Error("Invalid OAuth callback");
      accountId = await verifyCalendarOAuthState(
        state,
        secrets.encryptionKey
      );
      if (!code || url.searchParams.has("error")) {
        throw new Error("Calendar authorization failed");
      }
      const tokens = await exchangeCalendarAuthorizationCode({
        clientId: secrets.clientId,
        clientSecret: secrets.clientSecret,
        code,
        redirectUri: secrets.redirectUri
      });
      const encrypted = await encryptRefreshToken(
        tokens.refreshToken,
        secrets.encryptionKey
      );
      await env.DB.prepare(
        `UPDATE calendar_accounts
         SET encrypted_refresh_token = ?, oauth_status = 'connected',
             updated_at = CURRENT_TIMESTAMP
         WHERE account_id = ?`
      )
        .bind(encrypted, accountId)
        .run();
      return wantsJson
        ? json({ accountId, connected: true })
        : new Response(null, {
            status: 302,
            headers: { location: `/admin?calendar=${accountId}-connected` }
          });
    } catch {
      if (wantsJson) {
        return json({ error: "Calendar authorization failed" }, 400);
      }
      return new Response(null, {
        status: 302,
        headers: {
          location: `/admin?calendar=${accountId ?? "unknown"}-authorization-failed`
        }
      });
    }
  }

async function gmailConfiguration(
  request: Request,
  env: Env
): Promise<Response> {
  if (!isSectionConfigurationAuthorized(request, env)) {
    return json({ error: "Unauthorized" }, 401);
  }

  if (request.method === "PUT") {
    let input: { senders?: unknown };
    try {
      input = await request.json();
    } catch {
      return json({ error: "Invalid Gmail sender configuration" }, 400);
    }
    const senders = normalizeGmailSenderDomains(input.senders);
    if (!senders) {
      return json({ error: "Invalid Gmail sender configuration" }, 400);
    }
    await env.DB.batch([
      env.DB.prepare("DELETE FROM gmail_sender_allowlist"),
      ...senders.map(({ domain, kind }) =>
        env.DB.prepare(
          `INSERT INTO gmail_sender_allowlist (domain, kind)
           VALUES (?, ?)`
        ).bind(domain, kind)
      )
    ]);
  }
  const senders = await env.DB.prepare(
    `SELECT domain, kind FROM gmail_sender_allowlist
     ORDER BY kind, domain`
  ).all<{ domain: string; kind: "school" | "childcare" }>();
  const accounts = await env.DB.prepare(
    `SELECT account_id, oauth_status, gmail_scan_completed_at,
            gmail_disconnect_state
     FROM calendar_accounts ORDER BY account_id`
  ).all<{
    account_id: "mom" | "dad";
    oauth_status: string;
    gmail_scan_completed_at: string | null;
    gmail_disconnect_state: string | null;
  }>();
  return json({
    senders: senders.results,
    accounts: accounts.results.map((account) => ({
      accountId: account.account_id,
      connected:
        account.oauth_status === "connected" &&
        account.gmail_disconnect_state == null,
      ...(account.oauth_status === "revoked"
        ? { reconnectRequired: true }
        : {}),
      lastProcessedAt: account.gmail_scan_completed_at,
      ...(account.gmail_disconnect_state == null
        ? {}
        : { cleanupPending: true })
    }))
  });
}

async function deletePrivateImages(images: R2Bucket): Promise<void> {
  let cursor: string | undefined;
  do {
    const page = await images.list({ cursor });
    const keys = page.objects.map(({ key }) => key);
    if (keys.length > 0) await images.delete(keys);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}

function gmailAccountRepository(
  database: D1Database
): GmailAccountDataRepository {
  return {
    async beginDisconnect(accountId) {
      await database
        .prepare(
          `UPDATE calendar_accounts
           SET gmail_disconnect_state = 'revocation_pending',
               updated_at = CURRENT_TIMESTAMP
           WHERE account_id = ?`
        )
        .bind(accountId)
        .run();
    },
    async markRevokedForCleanup(accountId) {
      await database
        .prepare(
          `UPDATE calendar_accounts
           SET encrypted_refresh_token = NULL, oauth_status = 'disconnected',
               gmail_disconnect_state = 'cleanup_pending',
               updated_at = CURRENT_TIMESTAMP
           WHERE account_id = ?`
        )
        .bind(accountId)
        .run();
    },
    async deleteRetainedAccountData(accountId) {
      await database.batch([
        database
          .prepare("DELETE FROM selected_calendars WHERE account_id = ?")
          .bind(accountId),
        database.prepare("DELETE FROM calendar_snapshots"),
        database
          .prepare("DELETE FROM household_notices WHERE account_id = ?")
          .bind(accountId),
        database
          .prepare("DELETE FROM gmail_protected_reviews WHERE account_id = ?")
          .bind(accountId),
        database
          .prepare("DELETE FROM gmail_review_records WHERE account_id = ?")
          .bind(accountId),
        database.prepare("DELETE FROM current_render_generation"),
        database.prepare("DELETE FROM render_generations"),
        database
          .prepare(
            `UPDATE calendar_accounts
             SET gmail_history_id = NULL, gmail_scan_started_at = NULL,
                 gmail_scan_completed_at = NULL,
                 updated_at = CURRENT_TIMESTAMP
             WHERE account_id = ?`
          )
          .bind(accountId)
      ]);
    },
    async completeDisconnectCleanup(accountId) {
      await database
        .prepare(
          `UPDATE calendar_accounts
           SET gmail_disconnect_state = NULL, updated_at = CURRENT_TIMESTAMP
           WHERE account_id = ? AND gmail_disconnect_state = 'cleanup_pending'`
        )
        .bind(accountId)
        .run();
    }
  };
}

async function disconnectGmailAccount(
  request: Request,
  env: Env,
  accountId: GmailAccountId
): Promise<Response> {
  if (!isAdministrator(request, env)) {
    return json({ error: "Unauthorized" }, 401);
  }
  if (!env.CALENDAR_TOKEN_ENCRYPTION_KEY) {
    return json({ error: "Google account controls are not configured" }, 503);
  }
  const account = await env.DB.prepare(
    `SELECT account_id, encrypted_refresh_token, oauth_status,
            gmail_disconnect_state
     FROM calendar_accounts WHERE account_id = ?`
  )
    .bind(accountId)
    .first<{
      account_id: GmailAccountId;
      encrypted_refresh_token: string | null;
      oauth_status: string;
      gmail_disconnect_state:
        | "revocation_pending"
        | "cleanup_pending"
        | null;
    }>();
  if (
    !account ||
    (!account.encrypted_refresh_token &&
      account.gmail_disconnect_state !== "cleanup_pending")
  ) {
    return json({ error: "Google account is disconnected" }, 409);
  }
  try {
    const result = await disconnectGoogleAccount(
      {
        accountId,
        refreshToken: account.encrypted_refresh_token
          ? await decryptRefreshToken(
              account.encrypted_refresh_token,
              env.CALENDAR_TOKEN_ENCRYPTION_KEY
            )
          : null,
        state: account.gmail_disconnect_state ?? "connected"
      },
      {
        repository: gmailAccountRepository(env.DB),
        revokeGoogleAccess: (token) => revokeGoogleAccess(token),
        deletePrivateImages: () => deletePrivateImages(env.IMAGES)
      }
    );
    if (result.status === "pending") {
      return json(
        {
          accountId,
          disconnected: true,
          cleanupPending: true,
          errorCode: result.errorCode
        },
        202
      );
    }
    return json({ accountId, disconnected: true });
  } catch {
    return json(
      {
        error: "Google access revocation failed",
        errorCode: "GOOGLE_REVOCATION_FAILED"
      },
      502
    );
  }
}

async function accessTokenForAccount(
    env: Env,
    account: CalendarAccountRow
  ): Promise<string> {
    const secrets = calendarSecrets(env);
    if (!account.encrypted_refresh_token) {
      throw new Error("Calendar account is disconnected");
    }
    try {
      return await refreshCalendarAccessToken({
        clientId: secrets.clientId,
        clientSecret: secrets.clientSecret,
        refreshToken: await decryptRefreshToken(
          account.encrypted_refresh_token,
          secrets.encryptionKey
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
          `UPDATE calendar_accounts
           SET oauth_status = 'revoked', updated_at = CURRENT_TIMESTAMP
           WHERE account_id = ?`
        )
          .bind(account.account_id)
          .run();
      }
      throw error;
    }
  }

async function discoverCalendars(
    request: Request,
    env: Env
  ): Promise<Response> {
    if (!isAdministrator(request, env)) {
      return json({ error: "Unauthorized" }, 401);
    }
    const accountId = new URL(request.url).searchParams.get("account");
    if (accountId !== "mom" && accountId !== "dad") {
      return json({ error: "Invalid calendar account" }, 400);
    }
    const account = await env.DB.prepare(
      `SELECT account_id, display_label, encrypted_refresh_token, oauth_status
       FROM calendar_accounts WHERE account_id = ?`
    )
      .bind(accountId)
      .first<CalendarAccountRow>();
    if (!account || account.oauth_status !== "connected") {
      return json({ error: "Calendar account is disconnected" }, 409);
    }
    try {
      return json({
        accountId,
        calendars: await listGoogleCalendars(
          await accessTokenForAccount(env, account)
        )
      });
    } catch {
      return json({ error: "Calendar discovery failed" }, 502);
    }
  }

async function fetchCalendarSnapshot(
    env: Env,
    now: Date,
    timezone: string
  ): Promise<CalendarEvent[]> {
    const accounts = await env.DB.prepare(
      `SELECT account_id, display_label, encrypted_refresh_token, oauth_status
       FROM calendar_accounts
       WHERE oauth_status = 'connected'
       ORDER BY account_id`
    ).all<CalendarAccountRow>();
    const selected = await env.DB.prepare(
      `SELECT account_id, calendar_id, display_label
       FROM selected_calendars ORDER BY account_id, calendar_id`
    ).all<SelectedCalendarRow>();
    const source: CalendarSourceEvent[] = [];
    const pageBudget = { remaining: 100 };
    for (const account of accounts.results) {
      const calendarIds = selected.results
        .filter(({ account_id }) => account_id === account.account_id)
        .map(({ calendar_id }) => calendar_id);
      if (calendarIds.length === 0) continue;
      source.push(
        ...(await fetchGoogleCalendarEvents({
          accessToken: await accessTokenForAccount(env, account),
          accountId: account.account_id,
          ownerLabel: account.display_label,
          calendarIds,
          timeMin: now.toISOString(),
          timeMax: new Date(now.getTime() + 4 * 86_400_000).toISOString(),
          pageBudget
        }))
      );
    }
    return normalizeCalendarEvents(source, { now, timezone, days: 3 });
  }

async function weatherConfigurationAuthorized(
  request: Request,
  env: Env
): Promise<Response> {
  if (request.method === "PUT") {
    let input: unknown;
    try {
      input = await request.json();
    } catch {
      return json({ error: "Invalid weather configuration" }, 400);
    }
    if (!(await replaceWeatherConfiguration(env.DB, input))) {
      return json({ error: "Invalid weather configuration" }, 400);
    }
  }

  let stored: DashboardConfiguration;
  try {
    stored = await loadConfiguration(env);
  } catch {
    return json({ error: "Weather configuration unavailable" }, 503);
  }
  return json(stored);
}

async function generateFixture(request: Request, env: Env): Promise<Response> {
  if (!isAdministrator(request, env)) {
    return json({ error: "Unauthorized" }, 401);
  }

  const browser = await puppeteer.launch(env.BROWSER);
  let screenshot: Uint8Array;
  try {
    const page = await browser.newPage();
    await page.setViewport({
      width: 800,
      height: 480,
      deviceScaleFactor: 1
    });
    await page.setContent(fixtureHtml(), { waitUntil: "networkidle0" });
    screenshot = await page.screenshot({
      type: "png",
      fullPage: false,
      captureBeyondViewport: false
    });
  } finally {
    await browser.close();
  }

  const dimensions = readPngDimensions(screenshot);
  const maximumSize = effectiveMaximumImageBytes(env.MAX_IMAGE_BYTES);
  if (
    dimensions?.[0] !== 800 ||
    dimensions[1] !== 480 ||
    screenshot.byteLength > maximumSize
  ) {
    return json(
      {
        error: "Rendered fixture failed PNG validation",
        dimensions,
        byte_size: screenshot.byteLength,
        maximum_byte_size: maximumSize
      },
      422
    );
  }

  const timestamp = new Date().toISOString().replaceAll(/[-:.]/g, "");
  const generationId = `${timestamp}-${randomToken(5)}`;
  const filename = `daily-brief-${generationId}.png`;
  const objectKey = `generations/${generationId}/daily-brief.png`;
  await publishGeneration(env, {
    generationId,
    slotKey: generationId,
    generatedAt: new Date().toISOString(),
    views: [
      {
        viewType: "daily_brief",
        filename,
        objectKey,
        image: screenshot
      }
    ]
  });

  return json(
    {
      filename,
      byte_size: screenshot.byteLength,
      width: 800,
      height: 480
    },
    201
  );
}

async function renderDailyBrief(
  browser: Awaited<ReturnType<typeof puppeteer.launch>>,
  model: DailyBriefWeatherModel
): Promise<Uint8Array> {
  return renderDashboardView(
    browser,
    dailyBriefHtml(model),
    "Daily Brief"
  );
}

async function renderCalendarView(
  browser: Awaited<ReturnType<typeof puppeteer.launch>>,
  model: CalendarViewModel
): Promise<Uint8Array> {
  return renderDashboardView(
    browser,
    calendarViewHtml(model),
    "Calendar View"
  );
}

async function renderLunchView(
  browser: Awaited<ReturnType<typeof puppeteer.launch>>,
  model: LunchViewModel
): Promise<Uint8Array> {
  return renderDashboardView(browser, lunchViewHtml(model), "Lunch View");
}

async function renderNoticesView(
  browser: Awaited<ReturnType<typeof puppeteer.launch>>,
  model: NoticesViewModel
): Promise<Uint8Array> {
  return renderDashboardView(browser, noticesViewHtml(model), "Notices View");
}

async function renderDashboardView(
  browser: Awaited<ReturnType<typeof puppeteer.launch>>,
  html: string,
  view: "Daily Brief" | "Calendar View" | "Lunch View" | "Notices View"
): Promise<Uint8Array> {
  const page = await browser.newPage();
  await page.setViewport({
    width: 800,
    height: 480,
    deviceScaleFactor: 1
  });
  await page.setContent(html, { waitUntil: "networkidle0" });
  await validateRenderedPage(page, view);
  return page.screenshot({
    type: "png",
    fullPage: false,
    captureBeyondViewport: false
  });
}

async function publishGeneration(
  env: Env,
  publication: Pick<
    Publication,
    "generationId" | "slotKey" | "views" | "generatedAt"
  >
) {
  await Promise.all(
    publication.views.map((view) =>
      env.IMAGES.put(view.objectKey, view.image, {
        httpMetadata: { contentType: "image/png" },
        customMetadata: { width: "800", height: "480", palette: "monochrome" }
      })
    )
  );
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO render_generation_sets
         (generation_id, slot_key, generated_at, published_at)
       VALUES (?, ?, ?, ?)`
    ).bind(
      publication.generationId,
      publication.slotKey,
      publication.generatedAt,
      publication.generatedAt
    ),
    ...publication.views.map((view) =>
      env.DB.prepare(
        `INSERT INTO render_generations
           (filename, object_key, byte_size, width, height, slot_key,
            view_type, published_at, generation_id)
         VALUES (?, ?, ?, 800, 480, ?, ?, ?, ?)`
      ).bind(
        view.filename,
        view.objectKey,
        view.image.byteLength,
        publication.slotKey,
        view.viewType,
        publication.generatedAt,
        publication.generationId
      )
    ),
    env.DB.prepare(
      `INSERT INTO current_render_generation (id, generation_id, updated_at)
       VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         generation_id = excluded.generation_id,
         updated_at = excluded.updated_at`
    ).bind(publication.generationId, publication.generatedAt),
    env.DB.prepare(
      `UPDATE scheduled_generation_slots
       SET status = 'published', completed_at = ?, retry_at = NULL
       WHERE slot_key = ?`
    ).bind(publication.generatedAt, publication.slotKey)
  ]);
}

async function runScheduled(env: Env, now: Date): Promise<void> {
  const configuration = await loadConfiguration(env);
  const configuredRetryDelay = Number(env.GENERATION_RETRY_MINUTES);
  const session: {
    browser?: Awaited<ReturnType<typeof puppeteer.launch>>;
  } = {};
  const scheduledBrowser = async () => {
    session.browser ??= await puppeteer.launch(env.BROWSER);
    return session.browser;
  };
  try {
    await runScheduledWeatherGeneration(
      {
        now,
        configuration,
        maximumImageBytes: effectiveMaximumImageBytes(env.MAX_IMAGE_BYTES),
        retryDelayMinutes:
          Number.isInteger(configuredRetryDelay) && configuredRetryDelay > 0
            ? configuredRetryDelay
            : 15
      },
      {
      async claimSlot(slotKey) {
        const result = await env.DB.prepare(
          `INSERT OR IGNORE INTO scheduled_generation_slots
             (slot_key, status, started_at)
           VALUES (?, 'running', ?)`
        )
          .bind(slotKey, now.toISOString())
          .run();
        return (result.meta.changes ?? 0) > 0;
      },
      async claimRetry(nowIso) {
        const candidate = await env.DB.prepare(
          `SELECT slot_key FROM scheduled_generation_slots
           WHERE status = 'failed' AND retry_at IS NOT NULL
             AND retry_at <= ? AND retry_claimed_at IS NULL
             AND attempt_count = 1
           ORDER BY retry_at, started_at
           LIMIT 1`
        )
          .bind(nowIso)
          .first<{ slot_key: string }>();
        if (!candidate) return null;
        const result = await env.DB.prepare(
          `UPDATE scheduled_generation_slots
           SET status = 'running', retry_claimed_at = ?, attempt_count = 2,
               completed_at = NULL, retry_at = NULL
           WHERE slot_key = ? AND status = 'failed'
             AND retry_claimed_at IS NULL AND attempt_count = 1`
        )
          .bind(nowIso, candidate.slot_key)
          .run();
        return (result.meta.changes ?? 0) > 0
          ? { slotKey: candidate.slot_key }
          : null;
      },
      async prepareGeneration() {
        if (!env.GMAIL_PROCESSOR || !env.GMAIL_PROCESSOR_KEY) return;
        try {
          const response = await env.GMAIL_PROCESSOR.fetch(
            "https://gmail-processor/process",
            {
              method: "POST",
              headers: { "X-Gmail-Processor-Key": env.GMAIL_PROCESSOR_KEY }
            }
          );
          if (!response.ok) {
            throw new Error("Gmail processor unavailable");
          }
        } catch {
          const code =
            "GMAIL_PROCESSOR_UNREACHABLE" satisfies OperationalCode;
          await env.DB.prepare(
            `UPDATE source_status
             SET state = 'error', error_code = ?,
                 consecutive_failures = consecutive_failures + 1,
                 updated_at = CURRENT_TIMESTAMP
             WHERE source = 'gmail'`
          )
            .bind(code)
            .run();
        }
      },
      fetchWeather: (location) => fetchWeather(location),
      async loadLatestWeather() {
        const row = await env.DB.prepare(
          `SELECT snapshot_json, fetched_at FROM weather_snapshots
           ORDER BY fetched_at DESC, id DESC LIMIT 1`
        ).first<{ snapshot_json: string; fetched_at: string }>();
        return row
          ? {
              snapshot: JSON.parse(row.snapshot_json) as WeatherSnapshot,
              fetchedAt: row.fetched_at
            }
          : null;
      },
      async saveWeather(snapshot, fetchedAt) {
        await env.DB.prepare(
          `INSERT INTO weather_snapshots
             (observed_at, fetched_at, snapshot_json)
           VALUES (?, ?, ?)`
        )
          .bind(snapshot.observedAt, fetchedAt, JSON.stringify(snapshot))
          .run();
        await env.DB.prepare(
          `UPDATE source_status SET state = 'fresh', last_success_at = ?,
             error_code = NULL, consecutive_failures = 0,
             last_failure_slot_key = NULL,
             updated_at = CURRENT_TIMESTAMP
           WHERE source = 'weather'`
        )
          .bind(fetchedAt)
          .run();
      },
      async fetchLunch() {
        if (!env.MEALVIEWER_MENU_URL) {
          throw Object.assign(new Error("MealViewer URL is not configured"), {
            code: "LUNCH_UPSTREAM_NETWORK"
          });
        }
        return fetchMealViewerMenu(env.MEALVIEWER_MENU_URL, fetch, {
          now,
          timezone: configuration.timezone
        });
      },
      async loadLatestLunch() {
        const row = await env.DB.prepare(
          `SELECT snapshot_json, fetched_at FROM lunch_snapshots
           ORDER BY fetched_at DESC, id DESC LIMIT 1`
        ).first<{ snapshot_json: string; fetched_at: string }>();
        return row
          ? {
              snapshot: JSON.parse(row.snapshot_json) as LunchSnapshot,
              fetchedAt: row.fetched_at
            }
          : null;
      },
      async saveLunch(snapshot, fetchedAt) {
        await env.DB.prepare(
          `INSERT INTO lunch_snapshots (fetched_at, snapshot_json)
           VALUES (?, ?)`
        )
          .bind(fetchedAt, JSON.stringify(snapshot))
          .run();
        await env.DB.prepare(
          `UPDATE source_status SET state = 'fresh', last_success_at = ?,
             error_code = NULL, consecutive_failures = 0,
             last_failure_slot_key = NULL,
             updated_at = CURRENT_TIMESTAMP
           WHERE source = 'lunch'`
        )
          .bind(fetchedAt)
          .run();
      },
      async loadCachedLunchIcon(entreeKey) {
        const row = await env.DB.prepare(
          "SELECT icon FROM lunch_icon_mappings WHERE entree_key = ?"
        )
          .bind(entreeKey)
          .first<{ icon: string }>();
        return row?.icon ?? null;
      },
      async saveCachedLunchIcon(entreeKey, icon: LunchIcon) {
        await env.DB.prepare(
          `INSERT INTO lunch_icon_mappings
             (entree_key, icon, source, updated_at)
           VALUES (?, ?, 'ai', CURRENT_TIMESTAMP)
           ON CONFLICT(entree_key) DO UPDATE SET
             icon = excluded.icon,
             source = excluded.source,
             updated_at = excluded.updated_at`
        )
          .bind(entreeKey, icon)
          .run();
      },
      classifyLunchWithAi:
        env.AI && env.LUNCH_AI_MODEL
          ? async ({ entree, allowedIcons }) => {
              let result: unknown;
              try {
                result = await env.AI!.run(env.LUNCH_AI_MODEL!, {
                  messages: [
                    {
                      role: "system",
                      content:
                        "Return exactly one allowed lunch icon token and nothing else. If uncertain, return generic."
                    },
                    {
                      role: "user",
                      content: `Allowed: ${allowedIcons.join(",")}\nEntree: ${entree}`
                    }
                  ],
                  max_tokens: 5,
                  temperature: 0
                });
                await env.DB.prepare(
                  `UPDATE operational_status SET status_value = 'available',
                     updated_at = CURRENT_TIMESTAMP
                   WHERE status_key = 'ai_quota'`
                ).run();
              } catch (error) {
                const quotaExhausted =
                  error !== null &&
                  typeof error === "object" &&
                  (("status" in error && error.status === 429) ||
                    ("code" in error &&
                      typeof error.code === "string" &&
                      error.code.toLowerCase().includes("quota")));
                if (quotaExhausted) {
                  await env.DB.prepare(
                    `UPDATE operational_status
                     SET status_value = 'exhausted',
                         updated_at = CURRENT_TIMESTAMP
                     WHERE status_key = 'ai_quota'`
                  ).run();
                }
                throw error;
              }
              return result &&
                typeof result === "object" &&
                "response" in result
                ? (result as { response: unknown }).response
                : null;
            }
          : undefined,
      fetchCalendar: () =>
        fetchCalendarSnapshot(env, now, configuration.timezone),
      async loadLatestCalendar() {
        const row = await env.DB.prepare(
          `SELECT events_json, fetched_at FROM calendar_snapshots
           ORDER BY fetched_at DESC, id DESC LIMIT 1`
        ).first<{ events_json: string; fetched_at: string }>();
        return row
          ? {
              snapshot: JSON.parse(row.events_json) as CalendarEvent[],
              fetchedAt: row.fetched_at
            }
          : null;
      },
      async saveCalendar(events, fetchedAt) {
        await env.DB.prepare(
          `INSERT INTO calendar_snapshots (fetched_at, events_json)
           VALUES (?, ?)`
        )
          .bind(fetchedAt, JSON.stringify(events))
          .run();
        await env.DB.prepare(
          `UPDATE source_status SET state = 'fresh', last_success_at = ?,
             error_code = NULL, consecutive_failures = 0,
             last_failure_slot_key = NULL,
             updated_at = CURRENT_TIMESTAMP
           WHERE source = 'calendar'`
        )
          .bind(fetchedAt)
          .run();
      },
      async loadNotices() {
        const rows = await env.DB.prepare(
          `SELECT category, summary, relevant_date, action, sender_organization
           FROM household_notices
           WHERE expires_at >= ?
           ORDER BY accepted_at DESC, id DESC
           LIMIT 8`
        )
          .bind(now.toISOString())
          .all<{
            category: DailyBriefNotice["category"];
            summary: string;
            relevant_date: string | null;
            action: string | null;
            sender_organization: string;
          }>();
        return rows.results.map((row) => ({
          category: row.category,
          summary: row.summary,
          relevantDate: row.relevant_date,
          action: row.action,
          senderOrganization: row.sender_organization
        }));
      },
      async loadPrivateNoticeMarkers() {
        const rows = await env.DB.prepare(
          `SELECT DISTINCT account_id
           FROM gmail_protected_reviews
           WHERE review_kind = 'sensitive' AND expires_at >= ?
           ORDER BY account_id`
        )
          .bind(now.toISOString())
          .all<{ account_id: "mom" | "dad" }>();
        return rows.results.map(({ account_id }) => ({ accountId: account_id }));
      },
      renderDailyBrief: async (model) =>
        renderDailyBrief(await scheduledBrowser(), model),
      renderCalendarView: async (model) =>
        renderCalendarView(await scheduledBrowser(), model),
      renderLunchView: async (model) =>
        renderLunchView(await scheduledBrowser(), model),
      renderNoticesView: async (model) =>
        renderNoticesView(await scheduledBrowser(), model),
      publish: (publication) => publishGeneration(env, publication),
      async recordSourceFailure(slotKey, source, code, message) {
        void message;
        await env.DB.batch([
          env.DB.prepare(
            `INSERT INTO generation_source_failures
               (slot_key, source, error_code, error_message, occurred_at)
             VALUES (?, ?, ?, ?, ?)`
          ).bind(slotKey, source, code, code, now.toISOString()),
          env.DB.prepare(
            `UPDATE source_status SET state = 'stale', error_code = ?,
               consecutive_failures = CASE
                 WHEN last_failure_slot_key = ? THEN consecutive_failures
                 ELSE consecutive_failures + 1
               END,
               last_failure_slot_key = ?,
               updated_at = CURRENT_TIMESTAMP WHERE source = ?`
          ).bind(code, slotKey, slotKey, source)
        ]);
      },
      async failGeneration(slotKey, code, message, retryAt) {
        void message;
        await env.DB.batch([
          env.DB.prepare(
            `UPDATE scheduled_generation_slots
             SET status = 'failed', completed_at = ?, error_code = ?,
                 error_message = ?, retry_at = ?
             WHERE slot_key = ?`
          ).bind(now.toISOString(), code, code, retryAt, slotKey)
        ]);
      }
      }
    );
  } finally {
    await session.browser?.close();
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (
      request.method === "POST" &&
      url.pathname === "/admin/fixture-generations"
    ) {
      return generateFixture(request, env);
    }
    if (url.pathname.startsWith("/admin")) {
      if (!isAdministrationHost(request, env)) {
        return json({ error: "Not found" }, 404);
      }
      const identity = await authorizeAdministration(request, env);
      if (identity instanceof Response) return identity;
      if (await administrationBodyTooLarge(request)) {
        return json({ error: "Administration request is too large" }, 413);
      }
      if (
        url.pathname === "/admin" ||
        url.pathname === "/admin/app.js" ||
        url.pathname === "/admin/configuration" ||
        url.pathname === "/admin/status" ||
        url.pathname === "/admin/gmail-review" ||
        url.pathname.startsWith("/admin/gmail-review/")
      ) {
        return handleAuthorizedAdministration(
          request,
          {
            ...env,
            validateCalendarSelection: (accounts) =>
              validateNewSelectedCalendars(env, accounts)
          },
          identity
        );
      }
      const headers = new Headers(request.headers);
      headers.set("X-Administration-Role", identity.role);
      request = new Request(request, { headers });
      const reviewerReadable =
        request.method === "GET" &&
        (url.pathname === "/admin/weather-configuration" ||
          url.pathname === "/admin/calendar-configuration" ||
          url.pathname === "/admin/gmail-configuration");
      if (identity.role !== "administrator" && !reviewerReadable) {
        return json({ error: "Administrator role required" }, 403);
      }
    }
    if (!url.pathname.startsWith("/admin") && isAdministrationHost(request, env)) {
      return json({ error: "Not found" }, 404);
    }
    if (request.method === "GET" && url.pathname === "/api/setup") {
      return setup(request, env);
    }
    if (request.method === "GET" && url.pathname === "/api/display") {
      return display(request, env);
    }
    if (request.method === "GET" && url.pathname.startsWith("/images/")) {
      return image(request, env, url.pathname.slice("/images/".length));
    }
    if (
      (request.method === "GET" || request.method === "PUT") &&
      url.pathname === "/admin/weather-configuration"
    ) {
      return weatherConfiguration(request, env);
    }
    if (
      (request.method === "GET" || request.method === "PUT") &&
      url.pathname === "/admin/calendar-configuration"
    ) {
      return calendarConfiguration(request, env);
    }
    if (
      request.method === "GET" &&
      url.pathname === "/admin/calendar/oauth/start"
    ) {
      return calendarOAuthStart(request, env);
    }
    if (
      request.method === "GET" &&
      url.pathname === "/admin/calendar/oauth/callback"
    ) {
      return calendarOAuthCallback(request, env);
    }
    if (
      request.method === "GET" &&
      url.pathname === "/admin/calendar/discovery"
    ) {
      return discoverCalendars(request, env);
    }
    if (
      (request.method === "GET" || request.method === "PUT") &&
      url.pathname === "/admin/gmail-configuration"
    ) {
      return gmailConfiguration(request, env);
    }
    const disconnectMatch = url.pathname.match(
      /^\/admin\/gmail-accounts\/(mom|dad)\/disconnect$/
    );
    if (request.method === "POST" && disconnectMatch) {
      return disconnectGmailAccount(
        request,
        env,
        disconnectMatch[1] as GmailAccountId
      );
    }
    return json({ error: "Not found" }, 404);
  },
  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    const now = new Date(controller.scheduledTime);
    try {
      await runScheduled(env, now);
    } finally {
      await runOperationalIncidentCheck(env, now);
    }
  }
};
