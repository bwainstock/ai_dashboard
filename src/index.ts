import puppeteer from "@cloudflare/puppeteer";
import {
  authorizeAdministration,
  handleAuthorizedAdministration,
  isAdministrationHost
} from "./admin";
import { dailyBriefHtml } from "./daily-brief";
import { calendarViewHtml, type CalendarViewModel } from "./calendar-view";
import { validateRenderedPage } from "./render-validation";
import {
  captureEpaperPng,
  configureEpaperViewport
} from "./epaper-rendering";
import { effectiveMaximumImageBytes } from "./device-limits";
import { fixtureHtml } from "./fixture";
import {
  runScheduledWeatherGeneration,
  secondsUntilNextSlot,
  type DashboardConfiguration,
  type DailyBriefWeatherModel,
  type Publication,
  type ScheduledGenerationResult
} from "./generation";
import { assertFourGrayPng } from "./png-contract";
import { fetchWeather, type WeatherSnapshot } from "./weather";
import { runOperationalIncidentCheck } from "./incidents";
import { replaceWeatherConfiguration } from "./administration-configuration";
import { refreshCalendarFeedsForGeneration } from "./calendar-feeds";

export interface Env {
  DB: D1Database;
  IMAGES: R2Bucket;
  BROWSER: Fetcher;
  GENERATION_SECRET: string;
  ADMIN_ORIGIN?: string;
  CALENDAR_FEED_URL_ENCRYPTION_KEY?: string;
  CALENDAR_FEED_FETCHER?: typeof fetch;
  CALENDAR_FEED_RESOLVE_HOSTNAME?(hostname: string): Promise<string[]>;
  CALENDAR_FEED_NOW?(): Date;
  MAX_IMAGE_BYTES?: string;
  GENERATION_RETRY_MINUTES?: string;
  INCIDENT_EMAIL?: SendEmail;
  OPERATIONAL_EMAIL_FROM?: string;
  OPERATIONAL_EMAIL_TO?: string;
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

async function checkOperationalIncidents(env: Env, now: Date): Promise<void> {
  try {
    await runOperationalIncidentCheck(env, now);
  } catch (error) {
    console.error("Operational incident check failed", error);
  }
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
    await checkOperationalIncidents(env, new Date());
  }
}

interface SelectedDeviceGeneration {
  filename: string;
  objectKey: string;
  byteSize: number;
  generationId: string;
  publishedAt: string;
  viewType: "daily_brief" | "calendar";
}

async function selectDeviceGeneration(
  request: Request,
  env: Env
): Promise<SelectedDeviceGeneration | Response> {
  if (!(await isAuthenticated(request, env))) {
    return json({ error: "Invalid device credentials" }, 401);
  }

  const deviceId = request.headers.get("ID")!.trim().toUpperCase();
  await env.DB.prepare(
    `UPDATE devices SET last_check_in_at = CURRENT_TIMESTAMP,
       updated_at = CURRENT_TIMESTAMP WHERE device_id = ?`
  )
    .bind(deviceId)
    .run();
  const requestedView = request.headers.get("X-Dashboard-View");
  if (
    requestedView !== null &&
    requestedView !== "daily_brief" &&
    requestedView !== "calendar"
  ) {
    return json({ error: "Invalid dashboard view" }, 400);
  }

  let viewType: "daily_brief" | "calendar";
  if (requestedView) {
    viewType = requestedView;
  } else {
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
    viewType = ["daily_brief", "calendar"][viewCursor] as
      | "daily_brief"
      | "calendar";
    await env.DB.prepare(
      `UPDATE devices SET view_cursor = ?, updated_at = CURRENT_TIMESTAMP
       WHERE device_id = ?`
    )
      .bind(viewCursor, deviceId)
      .run();
  }

  const requestedGeneration = request.headers.get("X-Dashboard-Generation");
  const generationQuery = requestedGeneration
    ? `SELECT filename, object_key, byte_size, generation_id, published_at
       FROM render_generations
       WHERE view_type = ? AND generation_id = ?
       LIMIT 1`
    : `SELECT generation.filename, generation.object_key, generation.byte_size,
              generation.generation_id, generation.published_at
       FROM current_render_generation AS current_pointer
       JOIN render_generations AS generation
         ON generation.generation_id = current_pointer.generation_id
       WHERE current_pointer.id = 1 AND generation.view_type = ?
       LIMIT 1`;
  const generationStatement = env.DB.prepare(generationQuery);
  const generation = await (
    requestedGeneration
      ? generationStatement.bind(viewType, requestedGeneration)
      : generationStatement.bind(viewType)
  )
     .first<{
       filename: string;
       object_key: string;
       byte_size: number;
       generation_id: string;
       published_at: string;
     }>();
  if (!generation) {
     return json({ status: 503, error: "No published generation" }, 503);
  }

  return {
     filename: generation.filename,
     objectKey: generation.object_key,
     byteSize: generation.byte_size,
     generationId: generation.generation_id,
     publishedAt: generation.published_at,
     viewType
  };
}

async function display(request: Request, env: Env): Promise<Response> {
  const generation = await selectDeviceGeneration(request, env);
  if (generation instanceof Response) {
     if (generation.status !== 401) return generation;
     return json(
       {
         status: 401,
         error: "Invalid device credentials",
         reset_firmware: false
       },
       401
     );
  }
  const configuration = await loadConfiguration(env);

  return json({
    status: 0,
    image_url: `${new URL(request.url).origin}/images/${encodeURIComponent(generation.filename)}`,
    filename: generation.filename,
    refresh_rate: secondsUntilNextSlot(new Date(), configuration),
    reset_firmware: false,
    update_firmware: false,
    firmware_url: "",
    special_function: "sleep"
  });
}

function generationImageHeaders(
  generation: SelectedDeviceGeneration,
  object: R2ObjectBody
): Headers {
  return new Headers({
    "cache-control": "private, no-cache",
    "content-length": String(object.size),
    "content-type": "image/png",
    etag: object.httpEtag,
    "last-modified": new Date(generation.publishedAt).toUTCString(),
    vary: "ID, Update-Source, X-Dashboard-View, X-Dashboard-Generation",
    "x-content-type-options": "nosniff",
    "x-dashboard-filename": generation.filename,
    "x-dashboard-generation": generation.generationId,
    "x-dashboard-view": generation.viewType
  });
}

async function directImage(request: Request, env: Env): Promise<Response> {
  const generation = await selectDeviceGeneration(request, env);
  if (generation instanceof Response) return generation;

  const object = await env.IMAGES.get(generation.objectKey);
  if (!object || object.size !== generation.byteSize) {
    return json({ error: "Image unavailable" }, 503);
  }

  const headers = generationImageHeaders(generation, object);
  if (request.headers.get("If-None-Match") === object.httpEtag) {
    headers.delete("content-length");
    headers.delete("content-type");
    return new Response(null, { status: 304, headers });
  }
  if (request.headers.get("X-Dashboard-Metadata") === "true") {
    headers.delete("content-length");
    headers.delete("content-type");
    return new Response(null, { headers });
  }
  try {
    const bytes = new Uint8Array(await object.arrayBuffer());
    await assertFourGrayPng(
      bytes,
      effectiveMaximumImageBytes(env.MAX_IMAGE_BYTES)
    );
    return new Response(bytes, { headers });
  } catch {
    return json({ error: "Image unavailable" }, 503);
  }
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

  try {
    const bytes = new Uint8Array(await object.arrayBuffer());
    await assertFourGrayPng(
      bytes,
      effectiveMaximumImageBytes(env.MAX_IMAGE_BYTES)
    );
    return new Response(bytes, {
      headers: {
        "cache-control": "private, no-store",
        "content-length": String(object.size),
        "content-type": "image/png",
        etag: object.httpEtag,
        "x-content-type-options": "nosniff"
      }
    });
  } catch {
    return json({ error: "Image unavailable" }, 503);
  }
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
    await configureEpaperViewport(page);
    await page.setContent(fixtureHtml(), { waitUntil: "networkidle0" });
    screenshot = await captureEpaperPng(page);
  } finally {
    await browser.close();
  }

  const maximumSize = effectiveMaximumImageBytes(env.MAX_IMAGE_BYTES);
  try {
    await assertFourGrayPng(screenshot, maximumSize);
  } catch (error) {
    return json(
      {
        error: "Rendered fixture failed PNG validation",
        detail: error instanceof Error ? error.message : "Invalid PNG",
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

async function renderDashboardView(
  browser: Awaited<ReturnType<typeof puppeteer.launch>>,
  html: string,
  view: "Daily Brief" | "Calendar View"
): Promise<Uint8Array> {
  let stage = "opening page";
  try {
    const page = await browser.newPage();
    stage = "configuring viewport";
    await configureEpaperViewport(page);
    stage = "loading HTML";
    await page.setContent(html, { waitUntil: "networkidle0" });
    stage = "validating layout";
    await validateRenderedPage(page, view);
    stage = "capturing e-paper PNG";
    return await captureEpaperPng(page);
  } catch (error) {
    console.error("Dashboard render failed", {
      view,
      stage,
      message:
        error instanceof Error ? error.message : "unknown render error"
    });
    throw error;
  }
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
      assertFourGrayPng(
        view.image,
        effectiveMaximumImageBytes(env.MAX_IMAGE_BYTES)
      )
    )
  );
  await Promise.all(
    publication.views.map((view) =>
      env.IMAGES.put(view.objectKey, view.image, {
        httpMetadata: { contentType: "image/png" },
        customMetadata: { width: "800", height: "480", palette: "four-gray" }
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

async function runScheduled(
  env: Env,
  now: Date,
  forcedSlotKey?: string
): Promise<ScheduledGenerationResult> {
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
    return await runScheduledWeatherGeneration(
      {
        now,
        configuration,
        maximumImageBytes: effectiveMaximumImageBytes(env.MAX_IMAGE_BYTES),
        retryDelayMinutes:
          Number.isInteger(configuredRetryDelay) && configuredRetryDelay > 0
            ? configuredRetryDelay
            : 15,
        ...(forcedSlotKey ? { forcedSlotKey } : {})
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
      refreshCalendarFeeds: () =>
        refreshCalendarFeedsForGeneration(
          env,
          now,
          configuration.timezone
        ),
      renderDailyBrief: async (model) =>
        renderDailyBrief(await scheduledBrowser(), model),
      renderCalendarView: async (model) =>
        renderCalendarView(await scheduledBrowser(), model),
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

async function forceGeneration(request: Request, env: Env): Promise<Response> {
  if (!isAdministrator(request, env)) {
    return json({ error: "Unauthorized" }, 401);
  }
  const now = new Date();
  const slotKey = `manual-${now.toISOString()}-${randomToken(5)}`;
  let result: ScheduledGenerationResult;
  try {
    result = await runScheduled(env, now, slotKey);
  } finally {
    await checkOperationalIncidents(env, now);
  }
  return json(result, result.status === "published" ? 201 : 422);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (
      request.method === "GET" &&
      url.pathname === "/" &&
      isAdministrationHost(request, env)
    ) {
      return Response.redirect(new URL("/admin", url), 302);
    }
    if (
      request.method === "POST" &&
      url.pathname === "/admin/generations" &&
      !isAdministrationHost(request, env)
    ) {
      return forceGeneration(request, env);
    }
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
        request.method === "POST" &&
        url.pathname === "/admin/generations"
      ) {
        if (identity.role !== "administrator") {
          return json({ error: "Administrator role required" }, 403);
        }
        const headers = new Headers(request.headers);
        headers.set("X-Administration-Role", identity.role);
        return forceGeneration(new Request(request, { headers }), env);
      }
      if (
        url.pathname === "/admin" ||
        url.pathname === "/admin/app.js" ||
        url.pathname === "/admin/status" ||
        url.pathname === "/admin/calendar-feeds" ||
        url.pathname.startsWith("/admin/calendar-feeds/")
      ) {
        return handleAuthorizedAdministration(request, env, identity);
      }
      const headers = new Headers(request.headers);
      headers.set("X-Administration-Role", identity.role);
      request = new Request(request, { headers });
      const reviewerReadable =
        request.method === "GET" &&
        url.pathname === "/admin/weather-configuration";
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
    if (request.method === "GET" && url.pathname === "/api/image") {
      return directImage(request, env);
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
    return json({ error: "Not found" }, 404);
  },
  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    const now = new Date(controller.scheduledTime);
    try {
      await runScheduled(env, now);
    } finally {
      await checkOperationalIncidents(env, now);
    }
  }
};
