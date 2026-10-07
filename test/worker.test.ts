import { describe, expect, test, vi } from "vitest";
import { PNG } from "pngjs";

const { launchBrowser } = vi.hoisted(() => ({ launchBrowser: vi.fn() }));

vi.mock("@cloudflare/puppeteer", () => ({
  default: { launch: launchBrowser }
}));

import worker, { type Env } from "../src/index";

class TestDatabase {
  readonly devices = new Map<
    string,
    { tokenHash: string; friendlyId: string }
  >();
  publishedGeneration:
    | { filename: string; objectKey: string; byteSize: number }
    | undefined;
  configuration = {
    latitude: 37.3382,
    longitude: -121.8863,
    timezone: "America/Los_Angeles",
    slotsJson: '["06:30","10:30","15:00","19:00"]'
  };

  prepare(query: string) {
    let parameters: unknown[] = [];
    return {
      bind: (...values: unknown[]) => {
        parameters = values;
        return this.statement(query, () => parameters);
      },
      ...this.statement(query, () => parameters)
    };
  }

  private statement(query: string, parameters: () => unknown[]) {
    return {
      first: async <T>() => {
        if (query.includes("FROM devices WHERE device_id")) {
          const device = this.devices.get(String(parameters()[0]));
          return (device
            ? {
                token_hash: device.tokenHash,
                friendly_id: device.friendlyId
              }
            : null) as T | null;
        }
        if (query.includes("FROM render_generations")) {
          const generation = this.publishedGeneration;
          if (
            query.includes("filename = ?") &&
            generation?.filename !== parameters()[0]
          ) {
            return null;
          }
          return (generation
            ? {
                filename: generation.filename,
                object_key: generation.objectKey,
                byte_size: generation.byteSize
              }
            : null) as T | null;
        }
        if (query.includes("FROM dashboard_configuration")) {
          return {
            latitude: this.configuration.latitude,
            longitude: this.configuration.longitude,
            timezone: this.configuration.timezone,
            slots_json: this.configuration.slotsJson
          } as T;
        }
        return null;
      },
      run: async () => {
        if (query.includes("INSERT INTO devices")) {
          const [deviceId, tokenHash, friendlyId] = parameters().map(String);
          this.devices.set(deviceId, { tokenHash, friendlyId });
        }
        if (query.includes("INSERT INTO render_generations")) {
          const [filename, objectKey, byteSize] = parameters();
          this.publishedGeneration = {
            filename: String(filename),
            objectKey: String(objectKey),
            byteSize: Number(byteSize)
          };
        }
        if (query.includes("UPDATE dashboard_configuration")) {
          const [latitude, longitude, slotsJson] = parameters();
          this.configuration.latitude = Number(latitude);
          this.configuration.longitude = Number(longitude);
          this.configuration.slotsJson = String(slotsJson);
        }
        return { success: true };
      }
    };
  }
}

class TestBucket {
  readonly objects = new Map<string, Uint8Array>();

  async get(key: string) {
    const value = this.objects.get(key);
    if (!value) return null;
    return {
      body: value,
      size: value.byteLength,
      httpEtag: '"test"',
      writeHttpMetadata() {}
    };
  }

  async put(key: string, value: ArrayBuffer | Uint8Array) {
    this.objects.set(
      key,
      value instanceof Uint8Array ? value : new Uint8Array(value)
    );
    return {};
  }
}

function testEnv(
  database = new TestDatabase(),
  bucket = new TestBucket()
): Env {
  return {
    DB: database as unknown as D1Database,
    IMAGES: bucket as unknown as R2Bucket,
    BROWSER: {} as Fetcher,
    GENERATION_SECRET: "generation-secret",
    DEVICE_ORIGIN: "https://dashboard-device.example.com"
  };
}

describe("TRMNL BYOS device service", () => {
  test("setup exchanges a device MAC address for a high-entropy per-device token", async () => {
    const response = await worker.fetch(
      new Request("https://device.test/api/setup", {
        headers: { ID: "AA:BB:CC:DD:EE:FF" }
      }),
      testEnv()
    );

    expect(response.status).toBe(200);
    const body = await response.json<{
      status: number;
      api_key: string;
      friendly_id: string;
    }>();
    expect(body.status).toBe(200);
    expect(body.api_key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(body.friendly_id).toMatch(/^[A-Z0-9]{6}$/);
  });

  test("display rejects a request without device credentials", async () => {
    const response = await worker.fetch(
      new Request("https://device.test/api/display", {
        headers: { ID: "AA:BB:CC:DD:EE:FF" }
      }),
      testEnv()
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      status: 401,
      error: "Invalid device credentials",
      reset_firmware: false
    });
  });

  test("an authenticated display request returns the published named PNG", async () => {
    const database = new TestDatabase();
    database.publishedGeneration = {
      filename: "daily-brief-20261007T170000Z.png",
      objectKey: "generations/20261007T170000Z/daily-brief.png",
      byteSize: 12_345
    };
    const env = testEnv(database);
    const setupResponse = await worker.fetch(
      new Request("https://device.test/api/setup", {
        headers: { ID: "AA:BB:CC:DD:EE:FF" }
      }),
      env
    );
    const { api_key: token } = await setupResponse.json<{ api_key: string }>();

    const response = await worker.fetch(
      new Request("https://device.test/api/display", {
        headers: {
          ID: "AA:BB:CC:DD:EE:FF",
          "Access-Token": token
        }
      }),
      env
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 0,
      image_url:
        "https://dashboard-device.example.com/images/daily-brief-20261007T170000Z.png",
      filename: "daily-brief-20261007T170000Z.png",
      refresh_rate: expect.any(Number),
      reset_firmware: false,
      update_firmware: false,
      firmware_url: "",
      special_function: "sleep"
    });
  });

  test("private image delivery rejects a request without device credentials", async () => {
    const response = await worker.fetch(
      new Request(
        "https://device.test/images/daily-brief-20261007T170000Z.png",
        { headers: { ID: "AA:BB:CC:DD:EE:FF" } }
      ),
      testEnv()
    );

    expect(response.status).toBe(401);
  });

  test("display schedules the next wake for the next Los Angeles slot", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-07T17:30:00Z"));
    const database = new TestDatabase();
    database.publishedGeneration = {
      filename: "daily-brief-20261007T173000Z.png",
      objectKey: "generations/20261007T173000Z/daily-brief.png",
      byteSize: 12_345
    };
    const env = testEnv(database);
    const setupResponse = await worker.fetch(
      new Request("https://device.test/api/setup", {
        headers: { ID: "AA:BB:CC:DD:EE:FF" }
      }),
      env
    );
    const { api_key: token } = await setupResponse.json<{ api_key: string }>();

    const response = await worker.fetch(
      new Request("https://device.test/api/display", {
        headers: {
          ID: "AA:BB:CC:DD:EE:FF",
          "Access-Token": token
        }
      }),
      env
    );

    expect((await response.json<{ refresh_rate: number }>()).refresh_rate).toBe(
      16_200
    );
    vi.useRealTimers();
  });

  test("display rejects an invalid device token", async () => {
    const response = await worker.fetch(
      new Request("https://device.test/api/display", {
        headers: {
          ID: "AA:BB:CC:DD:EE:FF",
          "Access-Token": "not-the-issued-token"
        }
      }),
      testEnv()
    );

    expect(response.status).toBe(401);
  });

  test("authenticated image delivery serves the published private R2 object as PNG", async () => {
    const database = new TestDatabase();
    database.publishedGeneration = {
      filename: "daily-brief-20261007T170000Z.png",
      objectKey: "generations/20261007T170000Z/daily-brief.png",
      byteSize: 4
    };
    const bucket = new TestBucket();
    bucket.objects.set(
      "generations/20261007T170000Z/daily-brief.png",
      new Uint8Array([137, 80, 78, 71])
    );
    const env = testEnv(database, bucket);
    const setupResponse = await worker.fetch(
      new Request("https://device.test/api/setup", {
        headers: { ID: "AA:BB:CC:DD:EE:FF" }
      }),
      env
    );
    const { api_key: token } = await setupResponse.json<{ api_key: string }>();

    const response = await worker.fetch(
      new Request(
        "https://device.test/images/daily-brief-20261007T170000Z.png",
        {
          headers: {
            ID: "AA:BB:CC:DD:EE:FF",
            "Access-Token": token
          }
        }
      ),
      env
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      new Uint8Array([137, 80, 78, 71])
    );
  });

  test("an R2 object is not available until its generation is published", async () => {
    const database = new TestDatabase();
    const bucket = new TestBucket();
    bucket.objects.set(
      "generations/unpublished/daily-brief.png",
      new Uint8Array([137, 80, 78, 71])
    );
    const env = testEnv(database, bucket);
    const setupResponse = await worker.fetch(
      new Request("https://device.test/api/setup", {
        headers: { ID: "AA:BB:CC:DD:EE:FF" }
      }),
      env
    );
    const { api_key: token } = await setupResponse.json<{ api_key: string }>();

    const response = await worker.fetch(
      new Request("https://device.test/images/unpublished.png", {
        headers: {
          ID: "AA:BB:CC:DD:EE:FF",
          "Access-Token": token
        }
      }),
      env
    );

    expect(response.status).toBe(404);
  });

  test("fixture generation publishes a decodable 800x480 monochrome PNG", async () => {
    const png = new PNG({ width: 800, height: 480 });
    for (let offset = 0; offset < png.data.length; offset += 4) {
      const black = offset < 800 * 4 * 80;
      png.data[offset] = black ? 0 : 255;
      png.data[offset + 1] = black ? 0 : 255;
      png.data[offset + 2] = black ? 0 : 255;
      png.data[offset + 3] = 255;
    }
    const screenshot = PNG.sync.write(png);
    const close = vi.fn();
    launchBrowser.mockResolvedValueOnce({
      newPage: async () => ({
        setViewport: vi.fn(),
        setContent: vi.fn(),
        screenshot: async () => screenshot
      }),
      close
    });
    const database = new TestDatabase();
    const bucket = new TestBucket();
    const env = testEnv(database, bucket);

    const generationResponse = await worker.fetch(
      new Request("https://device.test/admin/fixture-generations", {
        method: "POST",
        headers: { Authorization: "Bearer generation-secret" }
      }),
      env
    );

    expect(generationResponse.status).toBe(201);
    expect(close).toHaveBeenCalled();
    const generation = database.publishedGeneration;
    expect(generation).toBeDefined();
    const stored = bucket.objects.get(generation!.objectKey);
    expect(stored).toBeDefined();
    const decoded = PNG.sync.read(Buffer.from(stored!));
    expect([decoded.width, decoded.height]).toEqual([800, 480]);
    let isMonochrome = true;
    for (let offset = 0; offset < decoded.data.length; offset += 4) {
      const red = decoded.data[offset];
      isMonochrome &&=
        red === decoded.data[offset + 1] &&
        red === decoded.data[offset + 2] &&
        (red === 0 || red === 255) &&
        decoded.data[offset + 3] === 255;
    }
    expect(isMonochrome).toBe(true);
  });

  test("an administrator can manage weather coordinates without changing deployment secrets", async () => {
    const database = new TestDatabase();
    const env = testEnv(database);

    const update = await worker.fetch(
      new Request("https://device.test/admin/weather-configuration", {
        method: "PUT",
        headers: {
          Authorization: "******",
          "Content-Type": "application/json",
          "X-Admin-Token": env.GENERATION_SECRET
        },
        body: JSON.stringify({
          latitude: 37.7749,
          longitude: -122.4194,
          slots: ["06:30", "10:30", "15:00", "19:00"]
        })
      }),
      env
    );
    const unauthorizedRead = await worker.fetch(
      new Request("https://device.test/admin/weather-configuration", {
        headers: { Authorization: "******" }
      }),
      env
    );

    const authenticatedRead = await worker.fetch(
      new Request("https://device.test/admin/weather-configuration", {
        headers: { "X-Admin-Token": env.GENERATION_SECRET }
      }),
      env
    );

    expect(update.status).toBe(200);
    expect(unauthorizedRead.status).toBe(401);
    expect(authenticatedRead.status).toBe(200);
    expect(await authenticatedRead.json()).toEqual({
      latitude: 37.7749,
      longitude: -122.4194,
      timezone: "America/Los_Angeles",
      slots: ["06:30", "10:30", "15:00", "19:00"]
    });
  });
});
