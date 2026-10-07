import puppeteer from "@cloudflare/puppeteer";
import { fixtureHtml } from "./fixture";

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

  return json({
    status: 0,
    image_url: `${env.DEVICE_ORIGIN.replace(/\/$/, "")}/images/${encodeURIComponent(generation.filename)}`,
    filename: generation.filename,
    refresh_rate: 900,
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

async function generateFixture(request: Request, env: Env): Promise<Response> {
  if (
    request.headers.get("Authorization") !== `Bearer ${env.GENERATION_SECRET}`
  ) {
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
    return json({ error: "Not found" }, 404);
  }
};
