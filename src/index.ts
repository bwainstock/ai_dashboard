import puppeteer from "@cloudflare/puppeteer";
import { dailyBriefHtml } from "./daily-brief";
import { fixtureHtml } from "./fixture";
import {
  runScheduledWeatherGeneration,
  secondsUntilNextSlot,
  type DashboardConfiguration,
  type DailyBriefWeatherModel,
  type Publication
} from "./generation";
import { fetchWeather, type WeatherSnapshot } from "./weather";

export interface Env {
  DB: D1Database;
  IMAGES: R2Bucket;
  BROWSER: Fetcher;
  GENERATION_SECRET: string;
  DEVICE_ORIGIN: string;
  MAX_IMAGE_BYTES?: string;
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

  const generation = await env.DB.prepare(
    `SELECT filename, object_key, byte_size
     FROM render_generations
     WHERE published_at IS NOT NULL
     ORDER BY published_at DESC, id DESC
     LIMIT 1`
  ).first<{ filename: string; object_key: string; byte_size: number }>();
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

async function publishGeneration(env: Env, publication: Publication) {
  await env.IMAGES.put(publication.objectKey, publication.image, {
    httpMetadata: { contentType: "image/png" },
    customMetadata: { width: "800", height: "480", palette: "monochrome" }
  });
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO render_generations
         (filename, object_key, byte_size, width, height, slot_key, published_at)
       VALUES (?, ?, ?, 800, 480, ?, ?)`
    ).bind(
      publication.filename,
      publication.objectKey,
      publication.image.byteLength,
      publication.slotKey,
      publication.generatedAt
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
      renderDailyBrief: (model) => renderDailyBrief(env, model),
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
    return json({ error: "Not found" }, 404);
  },
  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    await runScheduled(env, new Date(controller.scheduledTime));
  }
};
