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
    { tokenHash: string; friendlyId: string; viewCursor: number }
  >();
  publishedGeneration:
    | {
        filename: string;
        objectKey: string;
        byteSize: number;
        viewType?: "daily_brief" | "calendar" | "lunch";
      }
    | undefined;
  calendarGeneration:
    | {
        filename: string;
        objectKey: string;
        byteSize: number;
        viewType: "calendar";
      }
    | undefined;
  lunchGeneration:
    | {
        filename: string;
        objectKey: string;
        byteSize: number;
        viewType: "lunch";
      }
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
        if (query.includes("FROM administration_users")) {
          return (parameters()[0] === "admin@example.com"
            ? { role: "administrator" }
            : null) as T | null;
        }
        if (query.includes("FROM devices WHERE device_id")) {
          const device = this.devices.get(String(parameters()[0]));
          return (device
            ? {
                token_hash: device.tokenHash,
                friendly_id: device.friendlyId,
                view_cursor: device.viewCursor
              }
            : null) as T | null;
        }
        if (query.includes("FROM render_generations")) {
          const requestedView = query.includes("view_type = ?")
            ? String(parameters()[0])
            : "daily_brief";
          const generation =
            requestedView === "calendar"
              ? this.calendarGeneration
              : requestedView === "lunch"
                ? this.lunchGeneration
                : this.publishedGeneration;
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
          this.devices.set(deviceId, {
            tokenHash,
            friendlyId,
            viewCursor: this.devices.get(deviceId)?.viewCursor ?? 0
          });
        }
        if (query.includes("UPDATE devices") && query.includes("view_cursor")) {
          const [viewCursor, deviceId] = parameters();
          const device = this.devices.get(String(deviceId));
          if (device) device.viewCursor = Number(viewCursor);
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
    DEVICE_ORIGIN: "https://dashboard-device.example.com",
    ADMIN_ORIGIN: "https://dashboard-admin.example.com"
  };
}

function withAdministratorAccess(request: Request): Request {
  const headers = new Headers(request.headers);
  headers.set("Cf-Access-Authenticated-User-Email", "admin@example.com");
  headers.set("Cf-Access-Jwt-Assertion", "validated-by-cloudflare-access");
  return new Request(request, { headers });
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

  test("a short-button wake advances to Calendar View and a timer wake resets to Daily Brief", async () => {
    const database = new TestDatabase();
    database.publishedGeneration = {
      filename: "daily-brief-20261007T173000Z.png",
      objectKey: "generations/20261007T173000Z/daily-brief.png",
      byteSize: 12_345,
      viewType: "daily_brief"
    };
    database.calendarGeneration = {
      filename: "calendar-view-20261007T173000Z.png",
      objectKey: "generations/20261007T173000Z/calendar-view.png",
      byteSize: 12_346,
      viewType: "calendar"
    };
    const env = testEnv(database);
    const setupResponse = await worker.fetch(
      new Request("https://device.test/api/setup", {
        headers: { ID: "AA:BB:CC:DD:EE:FF" }
      }),
      env
    );
    const { api_key: token } = await setupResponse.json<{ api_key: string }>();
    const headers = {
      ID: "AA:BB:CC:DD:EE:FF",
      "Access-Token": token
    };

    const button = await worker.fetch(
      new Request("https://device.test/api/display", {
        headers: { ...headers, "Update-Source": "button" }
      }),
      env
    );
    const timer = await worker.fetch(
      new Request("https://device.test/api/display", {
        headers: { ...headers, "Update-Source": "timer" }
      }),
      env
    );

    expect((await button.json<{ filename: string }>()).filename).toBe(
      "calendar-view-20261007T173000Z.png"
    );
    expect((await timer.json<{ filename: string }>()).filename).toBe(
      "daily-brief-20261007T173000Z.png"
    );
    expect(database.devices.get("AA:BB:CC:DD:EE:FF")?.viewCursor).toBe(0);
  });

  test("view cache filenames are distinct and remain stable until the next generation", async () => {
    const database = new TestDatabase();
    database.publishedGeneration = {
      filename: "daily-brief-20261007T173000Z.png",
      objectKey: "generations/20261007T173000Z/daily-brief.png",
      byteSize: 12_345,
      viewType: "daily_brief"
    };
    database.calendarGeneration = {
      filename: "calendar-view-20261007T173000Z.png",
      objectKey: "generations/20261007T173000Z/calendar-view.png",
      byteSize: 12_346,
      viewType: "calendar"
    };
    const env = testEnv(database);
    const setupResponse = await worker.fetch(
      new Request("https://device.test/api/setup", {
        headers: { ID: "AA:BB:CC:DD:EE:FF" }
      }),
      env
    );
    const { api_key: token } = await setupResponse.json<{ api_key: string }>();
    const credentials = {
      ID: "AA:BB:CC:DD:EE:FF",
      "Access-Token": token
    };

    const first = await worker.fetch(
      new Request("https://device.test/api/display", {
        headers: { ...credentials, "Update-Source": "timer" }
      }),
      env
    );
    const second = await worker.fetch(
      new Request("https://device.test/api/display", {
        headers: { ...credentials, "Update-Source": "timer" }
      }),
      env
    );
    const button = await worker.fetch(
      new Request("https://device.test/api/display", {
        headers: { ...credentials, "Update-Source": "button" }
      }),
      env
    );

    const firstFilename = (await first.json<{ filename: string }>()).filename;
    expect((await second.json<{ filename: string }>()).filename).toBe(
      firstFilename
    );
    expect((await button.json<{ filename: string }>()).filename).not.toBe(
      firstFilename
    );
  });

  test("short presses complete the Daily Brief to Calendar View to Lunch View cycle", async () => {
    const database = new TestDatabase();
    database.publishedGeneration = {
      filename: "daily-brief-20261007T173000Z.png",
      objectKey: "generations/20261007T173000Z/daily-brief.png",
      byteSize: 12_345,
      viewType: "daily_brief"
    };
    database.calendarGeneration = {
      filename: "calendar-view-20261007T173000Z.png",
      objectKey: "generations/20261007T173000Z/calendar-view.png",
      byteSize: 12_346,
      viewType: "calendar"
    };
    database.lunchGeneration = {
      filename: "lunch-view-20261007T173000Z.png",
      objectKey: "generations/20261007T173000Z/lunch-view.png",
      byteSize: 12_347,
      viewType: "lunch"
    };
    const env = testEnv(database);
    const setupResponse = await worker.fetch(
      new Request("https://device.test/api/setup", {
        headers: { ID: "AA:BB:CC:DD:EE:FF" }
      }),
      env
    );
    const { api_key: token } = await setupResponse.json<{ api_key: string }>();
    const headers = {
      ID: "AA:BB:CC:DD:EE:FF",
      "Access-Token": token,
      "Update-Source": "button"
    };

    const filenames = [];
    for (let press = 0; press < 3; press += 1) {
      const response = await worker.fetch(
        new Request("https://device.test/api/display", { headers }),
        env
      );
      filenames.push((await response.json<{ filename: string }>()).filename);
    }

    expect(filenames).toEqual([
      "calendar-view-20261007T173000Z.png",
      "lunch-view-20261007T173000Z.png",
      "daily-brief-20261007T173000Z.png"
    ]);
    expect(new Set(filenames).size).toBe(3);
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
      withAdministratorAccess(new Request("https://dashboard-admin.example.com/admin/fixture-generations", {
        method: "POST",
        headers: { Authorization: "Bearer generation-secret" }
      })),
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
      new Request("https://dashboard-admin.example.com/admin/weather-configuration", {
        method: "PUT",
        headers: {
          "Cf-Access-Authenticated-User-Email": "admin@example.com",
          "Cf-Access-Jwt-Assertion": "validated-by-cloudflare-access",
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
      new Request("https://dashboard-admin.example.com/admin/weather-configuration", {
        headers: { Authorization: "******" }
      }),
      env
    );

    const authenticatedRead = await worker.fetch(
      new Request("https://dashboard-admin.example.com/admin/weather-configuration", {
        headers: {
          "Cf-Access-Authenticated-User-Email": "admin@example.com",
          "Cf-Access-Jwt-Assertion": "validated-by-cloudflare-access",
          "X-Admin-Token": env.GENERATION_SECRET
        }
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
