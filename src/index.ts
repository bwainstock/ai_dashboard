import puppeteer from "@cloudflare/puppeteer";
import { dailyBriefHtml } from "./daily-brief";
import { calendarViewHtml, type CalendarViewModel } from "./calendar-view";
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
  type DailyBriefWeatherModel,
  type Publication
} from "./generation";
import { fetchWeather, type WeatherSnapshot } from "./weather";
import {
  fetchMealViewerMenu,
  type LunchIcon,
  type LunchSnapshot
} from "./lunch";
import {
  exchangeCalendarAuthorizationCode,
  fetchGoogleCalendarEvents,
  listGoogleCalendars,
  refreshCalendarAccessToken
} from "./google-calendar";

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
  MEALVIEWER_MENU_URL?: string;
  AI?: {
    run(model: string, input: unknown): Promise<unknown>;
  };
  LUNCH_AI_MODEL?: string;
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" }
  });
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
  if (!deviceId || !token) return false;

  const device = await env.DB.prepare(
    "SELECT token_hash FROM devices WHERE device_id = ?"
  )
    .bind(deviceId)
    .first<{ token_hash: string }>();

  return device?.token_hash === (await hash(token));
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
  const device = await env.DB.prepare(
    "SELECT view_cursor FROM devices WHERE device_id = ?"
  )
    .bind(deviceId)
    .first<{ view_cursor: number }>();
  const updateSource = request.headers.get("Update-Source")?.toLowerCase();
  const manualWake =
    updateSource !== undefined &&
    !["timer", "scheduled", "powercycle", "unknown"].includes(updateSource);
  const viewCursor = manualWake ? ((device?.view_cursor ?? 0) + 1) % 2 : 0;
  const viewType = viewCursor === 1 ? "calendar" : "daily_brief";
  await env.DB.prepare(
    `UPDATE devices SET view_cursor = ?, updated_at = CURRENT_TIMESTAMP
     WHERE device_id = ?`
  )
    .bind(viewCursor, deviceId)
    .run();

  const generation = await env.DB.prepare(
    `SELECT filename, object_key, byte_size
     FROM render_generations
     WHERE view_type = ? AND published_at IS NOT NULL
     ORDER BY published_at DESC, id DESC
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
  if (!isAdministrator(request, env)) {
    return json({ error: "Unauthorized" }, 401);
  }
  return weatherConfigurationAuthorized(request, env);
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
  }

interface SelectedCalendarRow {
    account_id: "mom" | "dad";
    calendar_id: string;
    display_label: string;
  }

async function calendarConfiguration(
    request: Request,
    env: Env
  ): Promise<Response> {
    if (!isAdministrator(request, env)) {
      return json({ error: "Unauthorized" }, 401);
    }
    if (request.method === "PUT") {
      const input = await request.json<{
        accounts?: Array<{
          accountId?: string;
          displayLabel?: string;
          calendars?: Array<{ id?: string; label?: string }>;
        }>;
      }>();
      if (
        !Array.isArray(input.accounts) ||
        input.accounts.length !== 2 ||
        new Set(input.accounts.map(({ accountId }) => accountId)).size !== 2 ||
        input.accounts.some(
          ({ accountId, displayLabel, calendars }) =>
            !["mom", "dad"].includes(accountId ?? "") ||
            typeof displayLabel !== "string" ||
            displayLabel.trim().length < 1 ||
            displayLabel.trim().length > 20 ||
            displayLabel.includes("@") ||
            !Array.isArray(calendars) ||
            calendars.some(
              ({ id, label }) =>
                typeof id !== "string" ||
                !id ||
                typeof label !== "string" ||
                !label ||
                label.length > 80
            )
        )
      ) {
        return json({ error: "Invalid calendar configuration" }, 400);
      }
      const statements = input.accounts.flatMap((account) => [
        env.DB.prepare(
          `UPDATE calendar_accounts
           SET display_label = ?, updated_at = CURRENT_TIMESTAMP
           WHERE account_id = ?`
        ).bind(account.displayLabel!.trim(), account.accountId),
        env.DB.prepare(
          "DELETE FROM selected_calendars WHERE account_id = ?"
        ).bind(account.accountId),
        ...account.calendars!.map((calendar) =>
          env.DB.prepare(
            `INSERT INTO selected_calendars
               (account_id, calendar_id, display_label)
             VALUES (?, ?, ?)`
          ).bind(account.accountId, calendar.id, calendar.label)
        )
      ]);
      await env.DB.batch(statements);
    }
    const accounts = await env.DB.prepare(
      `SELECT account_id, display_label, oauth_status
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
        connected: account.oauth_status === "connected",
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
    try {
      const secrets = calendarSecrets(env);
      const url = new URL(request.url);
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      if (!code || !state) return json({ error: "Invalid OAuth callback" }, 400);
      const accountId = await verifyCalendarOAuthState(
        state,
        secrets.encryptionKey
      );
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
      return json({ accountId, connected: true });
    } catch {
      return json({ error: "Calendar authorization failed" }, 400);
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
    return refreshCalendarAccessToken({
      clientId: secrets.clientId,
      clientSecret: secrets.clientSecret,
      refreshToken: await decryptRefreshToken(
        account.encrypted_refresh_token,
        secrets.encryptionKey
      )
    });
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
          timeMax: new Date(now.getTime() + 4 * 86_400_000).toISOString()
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
    const input = await request.json<{
      latitude?: number;
      longitude?: number;
      slots?: string[];
    }>();
    const slots = input.slots;
    if (
      typeof input.latitude !== "number" ||
      input.latitude < -90 ||
      input.latitude > 90 ||
      typeof input.longitude !== "number" ||
      input.longitude < -180 ||
      input.longitude > 180 ||
      !Array.isArray(slots) ||
      slots.length === 0 ||
      new Set(slots).size !== slots.length ||
      slots.some((slot) => !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(slot))
    ) {
      return json({ error: "Invalid weather configuration" }, 400);
    }
    const sortedSlots = [...slots].sort();
    await env.DB.prepare(
      `UPDATE dashboard_configuration
       SET latitude = ?, longitude = ?, slots_json = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = 1`
    )
      .bind(input.latitude, input.longitude, JSON.stringify(sortedSlots))
      .run();
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
  const configuredMaximum = Number(env.MAX_IMAGE_BYTES);
  const maximumSize =
    Number.isFinite(configuredMaximum) && configuredMaximum > 0
      ? configuredMaximum
      : 1_000_000;
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

  await env.IMAGES.put(objectKey, screenshot, {
    httpMetadata: { contentType: "image/png" },
    customMetadata: { width: "800", height: "480", palette: "monochrome" }
  });
  await env.DB.prepare(
    `INSERT INTO render_generations
       (filename, object_key, byte_size, width, height, published_at)
     VALUES (?, ?, ?, 800, 480, CURRENT_TIMESTAMP)`
  )
    .bind(filename, objectKey, screenshot.byteLength)
    .run();

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
  env: Env,
  model: DailyBriefWeatherModel
): Promise<Uint8Array> {
  const browser = await puppeteer.launch(env.BROWSER);
  try {
    const page = await browser.newPage();
    await page.setViewport({
      width: 800,
      height: 480,
      deviceScaleFactor: 1
    });
    await page.setContent(dailyBriefHtml(model), { waitUntil: "networkidle0" });
    return await page.screenshot({
      type: "png",
      fullPage: false,
      captureBeyondViewport: false
    });
  } finally {
    await browser.close();
  }
}

async function renderCalendarView(
  env: Env,
  model: CalendarViewModel
): Promise<Uint8Array> {
  const browser = await puppeteer.launch(env.BROWSER);
  try {
    const page = await browser.newPage();
    await page.setViewport({
      width: 800,
      height: 480,
      deviceScaleFactor: 1
    });
    await page.setContent(calendarViewHtml(model), {
      waitUntil: "networkidle0"
    });
    return await page.screenshot({
      type: "png",
      fullPage: false,
      captureBeyondViewport: false
    });
  } finally {
    await browser.close();
  }
}

async function publishGeneration(env: Env, publication: Publication) {
  await Promise.all(
    publication.views.map((view) =>
      env.IMAGES.put(view.objectKey, view.image, {
        httpMetadata: { contentType: "image/png" },
        customMetadata: { width: "800", height: "480", palette: "monochrome" }
      })
    )
  );
  await env.DB.batch([
    ...publication.views.map((view) =>
      env.DB.prepare(
        `INSERT INTO render_generations
           (filename, object_key, byte_size, width, height, slot_key,
            view_type, published_at)
         VALUES (?, ?, ?, 800, 480, ?, ?, ?)`
      ).bind(
        view.filename,
        view.objectKey,
        view.image.byteLength,
        publication.slotKey,
        view.viewType,
        publication.generatedAt
      )
    ),
    env.DB.prepare(
      `UPDATE scheduled_generation_slots
       SET status = 'published', completed_at = ?
       WHERE slot_key = ?`
    ).bind(publication.generatedAt, publication.slotKey)
  ]);
}

async function runScheduled(env: Env, now: Date): Promise<void> {
  const configuration = await loadConfiguration(env);
  const configuredMaximum = Number(env.MAX_IMAGE_BYTES);
  await runScheduledWeatherGeneration(
    {
      now,
      configuration,
      maximumImageBytes:
        Number.isFinite(configuredMaximum) && configuredMaximum > 0
          ? configuredMaximum
          : 1_000_000
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
      fetchWeather: (location) => fetchWeather(location),
      async loadLatestWeather() {
        const row = await env.DB.prepare(
          `SELECT snapshot_json FROM weather_snapshots
           ORDER BY fetched_at DESC, id DESC LIMIT 1`
        ).first<{ snapshot_json: string }>();
        return row
          ? (JSON.parse(row.snapshot_json) as WeatherSnapshot)
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
      },
      async fetchLunch() {
        if (!env.MEALVIEWER_MENU_URL) {
          throw Object.assign(new Error("MealViewer URL is not configured"), {
            code: "LUNCH_UPSTREAM_NETWORK"
          });
        }
        return fetchMealViewerMenu(env.MEALVIEWER_MENU_URL);
      },
      async loadLatestLunch() {
        const row = await env.DB.prepare(
          `SELECT snapshot_json FROM lunch_snapshots
           ORDER BY fetched_at DESC, id DESC LIMIT 1`
        ).first<{ snapshot_json: string }>();
        return row ? (JSON.parse(row.snapshot_json) as LunchSnapshot) : null;
      },
      async saveLunch(snapshot, fetchedAt) {
        await env.DB.prepare(
          `INSERT INTO lunch_snapshots (fetched_at, snapshot_json)
           VALUES (?, ?)`
        )
          .bind(fetchedAt, JSON.stringify(snapshot))
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
              const result = await env.AI!.run(env.LUNCH_AI_MODEL!, {
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
          `SELECT events_json FROM calendar_snapshots
           ORDER BY fetched_at DESC, id DESC LIMIT 1`
        ).first<{ events_json: string }>();
        return row ? (JSON.parse(row.events_json) as CalendarEvent[]) : [];
      },
      async saveCalendar(events, fetchedAt) {
        await env.DB.prepare(
          `INSERT INTO calendar_snapshots (fetched_at, events_json)
           VALUES (?, ?)`
        )
          .bind(fetchedAt, JSON.stringify(events))
          .run();
      },
      renderDailyBrief: (model) => renderDailyBrief(env, model),
      renderCalendarView: (model) => renderCalendarView(env, model),
      publish: (publication) => publishGeneration(env, publication),
      async recordFailure(slotKey, code, message) {
        await env.DB.prepare(
          `UPDATE scheduled_generation_slots
           SET status = 'failed', completed_at = ?, error_code = ?,
               error_message = ?
           WHERE slot_key = ?`
        )
          .bind(now.toISOString(), code, message.slice(0, 500), slotKey)
          .run();
      }
    }
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
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
      request.method === "POST" &&
      url.pathname === "/admin/fixture-generations"
    ) {
      return generateFixture(request, env);
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
    return json({ error: "Not found" }, 404);
  },
  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    await runScheduled(env, new Date(controller.scheduledTime));
  }
};
