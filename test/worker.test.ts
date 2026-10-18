import { afterEach, describe, expect, test, vi } from "vitest";
import { PNG } from "pngjs";

const { launchBrowser } = vi.hoisted(() => ({ launchBrowser: vi.fn() }));

vi.mock("@cloudflare/puppeteer", () => ({
  default: { launch: launchBrowser }
}));

import worker, { type Env } from "../src/index";

function fourGrayPng(
  colors: Array<[number, number, number, number]> = [
    [0, 0, 0, 255],
    [85, 85, 85, 255],
    [170, 170, 170, 255],
    [255, 255, 255, 255]
  ]
): Uint8Array {
  const image = new PNG({ width: 800, height: 480 });
  for (let offset = 0; offset < image.data.length; offset += 4) {
    const color = colors[(offset / 4) % colors.length];
    image.data[offset] = color[0];
    image.data[offset + 1] = color[1];
    image.data[offset + 2] = color[2];
    image.data[offset + 3] = color[3];
  }
  return PNG.sync.write(image);
}

const VALID_FOUR_GRAY_PNG = fourGrayPng([[0, 0, 0, 255]]);
const DARK_GRAY_PNG = fourGrayPng([[85, 85, 85, 255]]);

class TestDatabase {
  readonly preparedQueries: string[] = [];
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
  incompleteDailyGeneration:
    | {
        filename: string;
        objectKey: string;
        byteSize: number;
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
  readonly historicalGenerations = new Map<
    string,
    {
      filename: string;
      objectKey: string;
      byteSize: number;
      viewType: "daily_brief" | "calendar";
    }
  >();
  configuration = {
    latitude: 37.3382,
    longitude: -121.8863,
    timezone: "America/Los_Angeles",
    slotsJson: '["06:30","10:30","15:00","19:00"]'
  };

  prepare(query: string) {
    this.preparedQueries.push(query);
    let parameters: unknown[] = [];
    return {
      bind: (...values: unknown[]) => {
        parameters = values;
        return this.statement(query, () => parameters);
      },
      ...this.statement(query, () => parameters)
    };
  }

  async batch(statements: Array<{ run(): Promise<unknown> }>) {
    return Promise.all(statements.map((statement) => statement.run()));
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
        if (query.includes("render_generations")) {
          const requestedView = query.includes("view_type = ?")
            ? String(parameters()[0])
            : "daily_brief";
          const requestedGeneration = query.includes("generation_id = ?")
            ? String(parameters()[1])
            : undefined;
          const pointedGeneration =
            requestedGeneration
              ? this.historicalGenerations.get(
                  `${requestedGeneration}:${requestedView}`
                )
              : requestedView === "calendar"
              ? this.calendarGeneration
              : requestedView === "lunch"
                ? this.lunchGeneration
                : this.publishedGeneration;
          const generation =
            requestedView === "daily_brief" &&
            !query.includes("current_render_generation")
              ? (this.incompleteDailyGeneration ?? pointedGeneration)
              : pointedGeneration;
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
                byte_size: generation.byteSize,
                generation_id:
                  generation.objectKey.split("/")[1] ?? "test-generation",
                published_at: "2026-10-07T17:00:00.000Z"
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
  readonly metadata = new Map<string, Record<string, string>>();

  async get(key: string) {
    const value = this.objects.get(key);
    if (!value) return null;
    return {
      body: value,
      size: value.byteLength,
      httpEtag: '"test"',
      arrayBuffer: async () => Uint8Array.from(value).buffer,
      writeHttpMetadata() {}
    };
  }

  async put(
    key: string,
    value: ArrayBuffer | Uint8Array,
    options?: { customMetadata?: Record<string, string> }
  ) {
    this.objects.set(
      key,
      value instanceof Uint8Array ? value : new Uint8Array(value)
    );
    if (options?.customMetadata) {
      this.metadata.set(key, options.customMetadata);
    }
    return {};
  }
}

class ScheduledTestDatabase {
  readonly publishedViewTypes: string[] = [];
  calendarFeedGenerationQueries = 0;

  constructor(private readonly hasSourceIncident = false) {}

  prepare(query: string) {
    let parameters: unknown[] = [];
    const statement = {
      bind: (...values: unknown[]) => {
        parameters = values;
        return statement;
      },
      first: async <T>() => {
        if (query.includes("FROM dashboard_configuration")) {
          return {
            latitude: 37.3382,
            longitude: -121.8863,
            timezone: "America/Los_Angeles",
            slots_json: '["10:30"]'
          } as T;
        }
        if (query.includes("FROM devices")) {
          return {
            provisioned_count: 0,
            provisioned_at: null,
            last_check_in_at: null
          } as T;
        }
        return null;
      },
      all: async <T>() => {
        if (
          query.includes("FROM calendar_feeds AS feed") &&
          query.includes("WHERE feed.enabled = 1")
        ) {
          this.calendarFeedGenerationQueries += 1;
          return { results: [] as T[] };
        }
        if (query.includes("FROM source_status")) {
          return {
            results: [
              {
                source: "weather",
                consecutive_failures: this.hasSourceIncident ? 2 : 0
              },
              { source: "calendar", consecutive_failures: 0 },
              { source: "lunch", consecutive_failures: 0 }
            ]
          } as { results: T[] };
        }
        return { results: [] as T[] };
      },
      run: async () => {
        if (query.includes("INSERT OR IGNORE INTO scheduled_generation_slots")) {
          return { success: true, meta: { changes: 1 } };
        }
        if (query.includes("INSERT INTO render_generations")) {
          this.publishedViewTypes.push(String(parameters[4]));
        }
        return { success: true, meta: { changes: 1 } };
      }
    };
    return statement;
  }

  async batch(statements: Array<{ run(): Promise<unknown> }>) {
    return Promise.all(statements.map((statement) => statement.run()));
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
    ADMIN_ORIGIN: "https://dashboard-admin.example.com"
  };
}

function scheduledEnv(database = new ScheduledTestDatabase()): Env {
  return testEnv(
    database as unknown as TestDatabase,
    new TestBucket()
  );
}

const NAVIGATION_GENERATION = "20261007T173000Z";
const DAILY_BRIEF_FILENAME = `daily-brief-${NAVIGATION_GENERATION}.png`;
const CALENDAR_FILENAME = `calendar-view-${NAVIGATION_GENERATION}.png`;
const DEVICE_ID = "AA:BB:CC:DD:EE:FF";

async function navigationFixture({
  incompleteDailyFilename
}: { incompleteDailyFilename?: string } = {}) {
  const database = new TestDatabase();
  database.publishedGeneration = {
    filename: DAILY_BRIEF_FILENAME,
    objectKey: `generations/${NAVIGATION_GENERATION}/daily-brief.png`,
    byteSize: 12_345,
    viewType: "daily_brief"
  };
  database.calendarGeneration = {
    filename: CALENDAR_FILENAME,
    objectKey: `generations/${NAVIGATION_GENERATION}/calendar-view.png`,
    byteSize: 12_346,
    viewType: "calendar"
  };
  if (incompleteDailyFilename) {
    database.incompleteDailyGeneration = {
      filename: incompleteDailyFilename,
      objectKey: "generations/incomplete/daily-brief.png",
      byteSize: 12_999
    };
  }
  const env = testEnv(database);
  const setupResponse = await worker.fetch(
    new Request("https://device.test/api/setup", {
      headers: { ID: DEVICE_ID }
    }),
    env
  );
  const { api_key: token } = await setupResponse.json<{ api_key: string }>();

  return {
    database,
    async request(updateSource: string) {
      const response = await worker.fetch(
        new Request("https://device.test/api/display", {
          headers: {
            ID: DEVICE_ID,
            "Access-Token": token,
            "Update-Source": updateSource
          }
        }),
        env
      );
      return response.json<{ filename: string }>();
    }
  };
}

function validRenderInspection() {
  return {
    viewport: { width: 800, height: 480 },
    document: { width: 800, height: 480 },
    overflowingElements: 0,
    iconCount: 1,
    textLength: 20,
    minimumVisibleTextSize: 16,
    nonMonochromeValues: [],
    missingStates: []
  };
}

function scheduledFetch(input: string | URL | Request): Promise<Response> {
  const url =
    input instanceof Request ? input.url : input instanceof URL ? input.href : input;
  if (url.startsWith("https://api.open-meteo.com/")) {
    return Promise.resolve(
      Response.json({
        current: {
          time: "2026-10-07T10:30",
          temperature_2m: 68,
          weather_code: 1
        },
        daily: {
          time: ["2026-10-07", "2026-10-08"],
          weather_code: [2, 61],
          temperature_2m_max: [75, 64],
          temperature_2m_min: [55, 51],
          precipitation_probability_max: [10, 70]
        }
      })
    );
  }
  return Promise.resolve(
    Response.json({
      menuSchedules: [
        {
          date: "2026-10-07",
          isClosed: false,
          menuBlocks: [
            {
              type: "Lunch",
              menuItems: [
                { category: "Entree", name: "Cheese Pizza" }
              ]
            }
          ]
        }
      ]
    })
  );
}

afterEach(() => {
  launchBrowser.mockReset();
  vi.unstubAllGlobals();
});

describe("TRMNL BYOS device service", () => {
  test("a complete due scheduled generation uses one browser for both views and closes it once", async () => {
    vi.stubGlobal("fetch", vi.fn(scheduledFetch));
    const database = new ScheduledTestDatabase();
    const close = vi.fn();
    const renderedHtml: string[] = [];
    launchBrowser.mockResolvedValue({
      newPage: vi.fn(async () => ({
        setViewport: vi.fn(),
        setContent: vi.fn(async (html: string) => {
          renderedHtml.push(html);
        }),
        evaluate: vi.fn(async () => validRenderInspection()),
        screenshot: vi.fn(async () => VALID_FOUR_GRAY_PNG)
      })),
      close
    });

    await worker.scheduled(
      { scheduledTime: Date.parse("2026-10-07T17:30:00Z") } as ScheduledController,
      scheduledEnv(database)
    );

    expect(launchBrowser).toHaveBeenCalledOnce();
    expect(renderedHtml).toHaveLength(2);
    expect(new Set(renderedHtml)).toHaveLength(2);
    expect(database.publishedViewTypes).toEqual([
      "daily_brief",
      "calendar"
    ]);
    expect(database.calendarFeedGenerationQueries).toBe(1);
    expect(close).toHaveBeenCalledOnce();
  });

  test("a due scheduled generation closes its single browser when a view render fails", async () => {
    vi.stubGlobal("fetch", vi.fn(scheduledFetch));
    const close = vi.fn();
    let pageNumber = 0;
    launchBrowser.mockResolvedValue({
      newPage: vi.fn(async () => {
        pageNumber += 1;
        return {
          setViewport: vi.fn(),
          setContent: vi.fn(async () => {
            if (pageNumber === 2) throw new Error("Calendar render failed");
          }),
          evaluate: vi.fn(async () => validRenderInspection()),
          screenshot: vi.fn(async () => new Uint8Array())
        };
      }),
      close
    });

    await worker.scheduled(
      { scheduledTime: Date.parse("2026-10-07T17:30:00Z") } as ScheduledController,
      scheduledEnv()
    );

    expect(launchBrowser).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  test("a non-due scheduled invocation does not launch a browser", async () => {
    await worker.scheduled(
      { scheduledTime: Date.parse("2026-10-07T17:31:00Z") } as ScheduledController,
      scheduledEnv()
    );

    expect(launchBrowser).not.toHaveBeenCalled();
  });

  test("an authenticated administrator can force a two-view generation", async () => {
    vi.stubGlobal("fetch", vi.fn(scheduledFetch));
    const database = new ScheduledTestDatabase();
    launchBrowser.mockResolvedValue({
      newPage: vi.fn(async () => ({
        setViewport: vi.fn(),
        setContent: vi.fn(),
        evaluate: vi.fn(async () => validRenderInspection()),
        screenshot: vi.fn(async () => VALID_FOUR_GRAY_PNG)
      })),
      close: vi.fn()
    });

    const response = await worker.fetch(
      new Request("https://device.test/admin/generations", {
        method: "POST",
        headers: { Authorization: "generation-secret" }
      }),
      scheduledEnv(database)
    );

    expect(response.status).toBe(201);
    expect(await response.json<{ status: string }>()).toMatchObject({
      status: "published"
    });
    expect(database.publishedViewTypes).toEqual(["daily_brief", "calendar"]);
    expect(database.calendarFeedGenerationQueries).toBe(1);
  });

  test("incident email failure does not mask a forced generation result", async () => {
    vi.stubGlobal("fetch", vi.fn(scheduledFetch));
    const database = new ScheduledTestDatabase(true);
    const send = vi.fn(async () => {
      throw new Error("Incident email delivery failed");
    });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    launchBrowser.mockResolvedValue({
      newPage: vi.fn(async () => ({
        setViewport: vi.fn(),
        setContent: vi.fn(),
        evaluate: vi.fn(async () => validRenderInspection()),
        screenshot: vi.fn(async () => VALID_FOUR_GRAY_PNG)
      })),
      close: vi.fn()
    });
    const env = {
      ...scheduledEnv(database),
      INCIDENT_EMAIL: { send } as unknown as SendEmail,
      OPERATIONAL_EMAIL_FROM: "dashboard@example.com",
      OPERATIONAL_EMAIL_TO: "operator@example.com"
    };

    const response = await worker.fetch(
      new Request("https://device.test/admin/generations", {
        method: "POST",
        headers: { Authorization: "generation-secret" }
      }),
      env
    );

    expect(response.status).toBe(201);
    expect(await response.json<{ status: string }>()).toMatchObject({
      status: "published"
    });
    expect(send).toHaveBeenCalledOnce();
    expect(consoleError).toHaveBeenCalledWith(
      "Operational incident check failed",
      expect.any(Error)
    );
  });

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
        "https://device.test/images/daily-brief-20261007T170000Z.png",
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

  test("direct image delivery selects and serves the current Daily Brief in one request", async () => {
    const database = new TestDatabase();
    database.publishedGeneration = {
      filename: "daily-brief-20261007T170000Z.png",
      objectKey: "generations/20261007T170000Z/daily-brief.png",
      byteSize: VALID_FOUR_GRAY_PNG.byteLength,
      viewType: "daily_brief"
    };
    const bucket = new TestBucket();
    bucket.objects.set(
      "generations/20261007T170000Z/daily-brief.png",
      VALID_FOUR_GRAY_PNG
    );
    const env = testEnv(database, bucket);
    const setupResponse = await worker.fetch(
      new Request("https://device.test/api/setup", {
        headers: { ID: DEVICE_ID }
      }),
      env
    );
    const { api_key: token } = await setupResponse.json<{ api_key: string }>();

    const response = await worker.fetch(
      new Request("https://device.test/api/image", {
        headers: {
          ID: DEVICE_ID,
          "Access-Token": token,
          "Update-Source": "timer"
        }
      }),
      env
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("private, no-cache");
    expect(response.headers.get("etag")).toBe('"test"');
    expect(response.headers.get("x-dashboard-filename")).toBe(
      "daily-brief-20261007T170000Z.png"
    );
    expect(response.headers.get("x-dashboard-view")).toBe("daily_brief");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      Uint8Array.from(VALID_FOUR_GRAY_PNG)
    );
    expect(database.devices.get(DEVICE_ID)?.viewCursor).toBe(0);
  });

  test("explicit view downloads stay pinned when publication advances between requests", async () => {
    const database = new TestDatabase();
    const oldDaily = {
      filename: DAILY_BRIEF_FILENAME,
      objectKey: `generations/${NAVIGATION_GENERATION}/daily-brief.png`,
      byteSize: VALID_FOUR_GRAY_PNG.byteLength,
      viewType: "daily_brief" as const
    };
    const oldCalendar = {
      filename: CALENDAR_FILENAME,
      objectKey: `generations/${NAVIGATION_GENERATION}/calendar-view.png`,
      byteSize: DARK_GRAY_PNG.byteLength,
      viewType: "calendar" as const
    };
    database.publishedGeneration = oldDaily;
    database.calendarGeneration = oldCalendar;
    database.historicalGenerations.set(
      `${NAVIGATION_GENERATION}:daily_brief`,
      oldDaily
    );
    database.historicalGenerations.set(
      `${NAVIGATION_GENERATION}:calendar`,
      oldCalendar
    );
    const bucket = new TestBucket();
    bucket.objects.set(oldDaily.objectKey, VALID_FOUR_GRAY_PNG);
    bucket.objects.set(oldCalendar.objectKey, DARK_GRAY_PNG);
    const env = testEnv(database, bucket);
    const setupResponse = await worker.fetch(
      new Request("https://device.test/api/setup", {
        headers: { ID: DEVICE_ID }
      }),
      env
    );
    const { api_key: token } = await setupResponse.json<{ api_key: string }>();
    database.publishedGeneration = {
      filename: "daily-brief-new.png",
      objectKey: "generations/new/daily-brief.png",
      byteSize: 4,
      viewType: "daily_brief"
    };
    database.calendarGeneration = {
      filename: "calendar-view-new.png",
      objectKey: "generations/new/calendar-view.png",
      byteSize: 4,
      viewType: "calendar"
    };

    const response = await worker.fetch(
      new Request("https://device.test/api/image", {
        headers: {
          ID: DEVICE_ID,
          "Access-Token": token,
          "X-Dashboard-View": "calendar",
          "X-Dashboard-Generation": NAVIGATION_GENERATION
        }
      }),
      env
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-dashboard-filename")).toBe(
      CALENDAR_FILENAME
    );
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      Uint8Array.from(DARK_GRAY_PNG)
    );
  });

  test("direct image metadata explicitly selects both views from one published generation", async () => {
    const database = new TestDatabase();
    database.publishedGeneration = {
      filename: DAILY_BRIEF_FILENAME,
      objectKey: `generations/${NAVIGATION_GENERATION}/daily-brief.png`,
      byteSize: VALID_FOUR_GRAY_PNG.byteLength,
      viewType: "daily_brief"
    };
    database.calendarGeneration = {
      filename: CALENDAR_FILENAME,
      objectKey: `generations/${NAVIGATION_GENERATION}/calendar-view.png`,
      byteSize: VALID_FOUR_GRAY_PNG.byteLength,
      viewType: "calendar"
    };
    const bucket = new TestBucket();
    bucket.objects.set(
      database.publishedGeneration.objectKey,
      VALID_FOUR_GRAY_PNG
    );
    bucket.objects.set(
      database.calendarGeneration.objectKey,
      VALID_FOUR_GRAY_PNG
    );
    const env = testEnv(database, bucket);
    const setupResponse = await worker.fetch(
      new Request("https://device.test/api/setup", {
        headers: { ID: DEVICE_ID }
      }),
      env
    );
    const { api_key: token } = await setupResponse.json<{ api_key: string }>();
    const metadata = (view: "daily_brief" | "calendar") =>
      worker.fetch(
        new Request("https://device.test/api/image", {
          headers: {
            ID: DEVICE_ID,
            "Access-Token": token,
            "X-Dashboard-View": view,
            "X-Dashboard-Metadata": "true"
          }
        }),
        env
      );

    const dailyBrief = await metadata("daily_brief");
    const calendar = await metadata("calendar");

    expect(dailyBrief.status).toBe(200);
    expect(calendar.status).toBe(200);
    expect(dailyBrief.headers.get("x-dashboard-view")).toBe("daily_brief");
    expect(calendar.headers.get("x-dashboard-view")).toBe("calendar");
    expect(dailyBrief.headers.get("x-dashboard-generation")).toBe(
      NAVIGATION_GENERATION
    );
    expect(calendar.headers.get("x-dashboard-generation")).toBe(
      NAVIGATION_GENERATION
    );
    expect((await dailyBrief.arrayBuffer()).byteLength).toBe(0);
    expect((await calendar.arrayBuffer()).byteLength).toBe(0);
    expect(database.devices.get(DEVICE_ID)?.viewCursor).toBe(0);
  });

  test("direct image delivery rejects missing credentials", async () => {
    const response = await worker.fetch(
      new Request("https://device.test/api/image", {
        headers: { ID: DEVICE_ID, "Update-Source": "timer" }
      }),
      testEnv()
    );

    expect(response.status).toBe(401);
  });

  test("direct image delivery advances on a button wake and resets on a timer wake", async () => {
    const database = new TestDatabase();
    database.publishedGeneration = {
      filename: DAILY_BRIEF_FILENAME,
      objectKey: `generations/${NAVIGATION_GENERATION}/daily-brief.png`,
      byteSize: VALID_FOUR_GRAY_PNG.byteLength,
      viewType: "daily_brief"
    };
    database.calendarGeneration = {
      filename: CALENDAR_FILENAME,
      objectKey: `generations/${NAVIGATION_GENERATION}/calendar-view.png`,
      byteSize: VALID_FOUR_GRAY_PNG.byteLength,
      viewType: "calendar"
    };
    const bucket = new TestBucket();
    bucket.objects.set(
      database.publishedGeneration.objectKey,
      VALID_FOUR_GRAY_PNG
    );
    bucket.objects.set(
      database.calendarGeneration.objectKey,
      VALID_FOUR_GRAY_PNG
    );
    const env = testEnv(database, bucket);
    const setupResponse = await worker.fetch(
      new Request("https://device.test/api/setup", {
        headers: { ID: DEVICE_ID }
      }),
      env
    );
    const { api_key: token } = await setupResponse.json<{ api_key: string }>();
    const request = (source: string) =>
      worker.fetch(
        new Request("https://device.test/api/image", {
          headers: {
            ID: DEVICE_ID,
            "Access-Token": token,
            "Update-Source": source
          }
        }),
        env
      );

    const button = await request("button");
    const timer = await request("timer");

    expect(button.headers.get("x-dashboard-view")).toBe("calendar");
    expect(timer.headers.get("x-dashboard-view")).toBe("daily_brief");
    expect(database.devices.get(DEVICE_ID)?.viewCursor).toBe(0);
  });

  test("direct image delivery supports ETag revalidation without refreshing unchanged pixels", async () => {
    const database = new TestDatabase();
    database.publishedGeneration = {
      filename: DAILY_BRIEF_FILENAME,
      objectKey: `generations/${NAVIGATION_GENERATION}/daily-brief.png`,
      byteSize: 4,
      viewType: "daily_brief"
    };
    const bucket = new TestBucket();
    bucket.objects.set(
      database.publishedGeneration.objectKey,
      new Uint8Array([137, 80, 78, 71])
    );
    const env = testEnv(database, bucket);
    const setupResponse = await worker.fetch(
      new Request("https://device.test/api/setup", {
        headers: { ID: DEVICE_ID }
      }),
      env
    );
    const { api_key: token } = await setupResponse.json<{ api_key: string }>();

    const response = await worker.fetch(
      new Request("https://device.test/api/image", {
        headers: {
          ID: DEVICE_ID,
          "Access-Token": token,
          "Update-Source": "timer",
          "If-None-Match": '"test"'
        }
      }),
      env
    );

    expect(response.status).toBe(304);
    expect(response.headers.get("etag")).toBe('"test"');
    expect((await response.arrayBuffer()).byteLength).toBe(0);
  });

  test("direct image delivery rejects a stored image outside the four-gray contract", async () => {
    const image = fourGrayPng([[128, 128, 128, 255]]);
    const database = new TestDatabase();
    database.publishedGeneration = {
      filename: DAILY_BRIEF_FILENAME,
      objectKey: `generations/${NAVIGATION_GENERATION}/daily-brief.png`,
      byteSize: image.byteLength,
      viewType: "daily_brief"
    };
    const bucket = new TestBucket();
    bucket.objects.set(database.publishedGeneration.objectKey, image);
    const env = testEnv(database, bucket);
    const setupResponse = await worker.fetch(
      new Request("https://device.test/api/setup", {
        headers: { ID: DEVICE_ID }
      }),
      env
    );
    const { api_key: token } = await setupResponse.json<{ api_key: string }>();

    const response = await worker.fetch(
      new Request("https://device.test/api/image", {
        headers: {
          ID: DEVICE_ID,
          "Access-Token": token,
          "Update-Source": "timer"
        }
      }),
      env
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Image unavailable" });
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
    const fixture = await navigationFixture();
    const button = await fixture.request("button");
    const timer = await fixture.request("timer");

    expect(button.filename).toBe(CALENDAR_FILENAME);
    expect(timer.filename).toBe(DAILY_BRIEF_FILENAME);
    expect(fixture.database.devices.get(DEVICE_ID)?.viewCursor).toBe(0);
  });

  test.each(["timer", "scheduled", "powercycle", "unknown"])(
    "%s wake selects Daily Brief without advancing the device cursor",
    async (updateSource) => {
      const fixture = await navigationFixture();
      const response = await fixture.request(updateSource);

      expect(response.filename).toBe(DAILY_BRIEF_FILENAME);
      expect(fixture.database.devices.get(DEVICE_ID)?.viewCursor).toBe(0);
    }
  );

  test("one manual button request advances the server-managed cursor exactly once", async () => {
    const fixture = await navigationFixture();
    const response = await fixture.request("button");

    expect(response.filename).toBe(CALENDAR_FILENAME);
    expect(fixture.database.devices.get(DEVICE_ID)?.viewCursor).toBe(1);
  });

  test("view cache filenames are distinct and remain stable until the next generation", async () => {
    const fixture = await navigationFixture();
    const first = await fixture.request("timer");
    const second = await fixture.request("timer");
    const button = await fixture.request("button");

    expect(second.filename).toBe(first.filename);
    expect(button.filename).not.toBe(first.filename);
  });

  test("display ignores a newer incomplete view set until the all-view pointer advances", async () => {
    const fixture = await navigationFixture({
      incompleteDailyFilename: "daily-brief-20261007T220000Z.png"
    });
    const response = await fixture.request("timer");

    expect(response.filename).toBe(DAILY_BRIEF_FILENAME);
  });

  test("short presses alternate Calendar View and Daily Brief", async () => {
    const fixture = await navigationFixture();

    const filenames = [];
    for (let press = 0; press < 2; press += 1) {
      filenames.push((await fixture.request("button")).filename);
    }

    expect(filenames).toEqual([CALENDAR_FILENAME, DAILY_BRIEF_FILENAME]);
    expect(new Set(filenames).size).toBe(2);
  });

  test("authenticated image delivery serves the published private R2 object as PNG", async () => {
    const database = new TestDatabase();
    database.publishedGeneration = {
      filename: "daily-brief-20261007T170000Z.png",
      objectKey: "generations/20261007T170000Z/daily-brief.png",
      byteSize: VALID_FOUR_GRAY_PNG.byteLength
    };
    const bucket = new TestBucket();
    bucket.objects.set(
      "generations/20261007T170000Z/daily-brief.png",
      VALID_FOUR_GRAY_PNG
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
      Uint8Array.from(VALID_FOUR_GRAY_PNG)
    );
  });

  test("private image delivery rejects an invalid device token", async () => {
    const response = await worker.fetch(
      new Request(
        "https://device.test/images/daily-brief-20261007T170000Z.png",
        {
          headers: {
            ID: "AA:BB:CC:DD:EE:FF",
            "Access-Token": "not-the-issued-token"
          }
        }
      ),
      testEnv()
    );

    expect(response.status).toBe(401);
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

  test("fixture generation publishes a decodable 800x480 four-gray PNG", async () => {
    const screenshot = fourGrayPng();
    const screenshotBase64 = Buffer.from(screenshot).toString("base64");
    const close = vi.fn();
    const setViewport = vi.fn();
    launchBrowser.mockResolvedValueOnce({
      newPage: async () => ({
        setViewport,
        setContent: vi.fn(),
        evaluate: vi.fn(),
        screenshot: vi
          .fn()
          .mockResolvedValueOnce(screenshotBase64)
          .mockResolvedValueOnce(screenshot)
      }),
      close
    });
    const database = new TestDatabase();
    const bucket = new TestBucket();
    const env = testEnv(database, bucket);

    const generationResponse = await worker.fetch(
      new Request("https://dashboard-device.example.com/admin/fixture-generations", {
        method: "POST",
        headers: { Authorization: "Bearer generation-secret" }
      }),
      env
    );

    expect(generationResponse.status).toBe(201);
    expect(close).toHaveBeenCalled();
    expect(setViewport).toHaveBeenNthCalledWith(1, {
      width: 800,
      height: 480,
      deviceScaleFactor: 1
    });
    expect(setViewport).toHaveBeenNthCalledWith(2, {
      width: 800,
      height: 480,
      deviceScaleFactor: 1
    });
    expect(
      database.preparedQueries.some((query) =>
        query.includes("INSERT INTO current_render_generation")
      )
    ).toBe(true);
    const generation = database.publishedGeneration;
    expect(generation).toBeDefined();
    const stored = bucket.objects.get(generation!.objectKey);
    expect(stored).toBeDefined();
    expect(bucket.metadata.get(generation!.objectKey)).toEqual({
      width: "800",
      height: "480",
      palette: "four-gray"
    });
    const decoded = PNG.sync.read(Buffer.from(stored!));
    expect([decoded.width, decoded.height]).toEqual([800, 480]);
    const luminanceLevels = new Set<number>();
    for (let offset = 0; offset < decoded.data.length; offset += 4) {
      const red = decoded.data[offset];
      expect(
        red === decoded.data[offset + 1] &&
        red === decoded.data[offset + 2] &&
        decoded.data[offset + 3] === 255
      ).toBe(true);
      luminanceLevels.add(red);
    }
    expect([...luminanceLevels].sort((left, right) => left - right)).toEqual([
      0, 85, 170, 255
    ]);
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
