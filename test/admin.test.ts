import { describe, expect, test } from "vitest";
import worker, { type Env } from "../src/index";

type Role = "administrator" | "reviewer";

class AdminDatabase {
  configuration = {
    latitude: 37.3382,
    longitude: -121.8863,
    timezone: "America/Los_Angeles",
    slotsJson: '["06:30","10:30","15:00","19:00"]'
  };
  readonly roles = new Map<string, Role>([
    ["admin@example.com", "administrator"],
    ["reviewer@example.com", "reviewer"]
  ]);

  prepare(query: string) {
    let parameters: unknown[] = [];
    const statement = {
      bind: (...values: unknown[]) => {
        parameters = values;
        return statement;
      },
      first: async <T>() => {
        if (query.includes("FROM administration_users")) {
          const role = this.roles.get(String(parameters[0]).toLowerCase());
          return (role ? { role } : null) as T | null;
        }
        if (query.includes("FROM dashboard_configuration")) {
          return {
            latitude: this.configuration.latitude,
            longitude: this.configuration.longitude,
            timezone: this.configuration.timezone,
            slots_json: this.configuration.slotsJson
          } as T;
        }
        if (query.includes("MAX(last_check_in_at)")) {
          return { last_check_in_at: "2026-10-07T16:00:00.000Z" } as T;
        }
        if (query.includes("FROM current_render_generation")) {
          return {
            generation_id: "generation-20261007T150000Z",
            published_at: "2026-10-07T15:00:00.000Z"
          } as T;
        }
        if (query.includes("FROM scheduled_generation_slots")) {
          return {
            slot_key: "2026-10-07T19:00",
            status: "failed",
            attempt_count: 1,
            retry_at: "2026-10-07T19:15:00.000Z",
            error_code: "DAILY_BRIEF_RENDER_FAILED"
          } as T;
        }
        return null;
      },
      all: async <T>() => {
        if (query.includes("FROM calendar_accounts")) {
          return {
            results: [
              {
                account_id: "dad",
                display_label: "Dad",
                oauth_status: "connected"
              },
              {
                account_id: "mom",
                display_label: "Mom",
                oauth_status: "revoked"
              }
            ]
          } as D1Result<T>;
        }
        if (query.includes("FROM selected_calendars")) {
          return {
            results: [
              {
                account_id: "mom",
                calendar_id: "family",
                display_label: "Family"
              }
            ]
          } as D1Result<T>;
        }
        if (query.includes("FROM source_status")) {
          return {
            results: [
              {
                source: "weather",
                state: "fresh",
                last_success_at: "2026-10-07T15:00:00.000Z",
                error_code: null
              },
              {
                source: "calendar",
                state: "error",
                last_success_at: "2026-10-07T10:30:00.000Z",
                error_code: "CALENDAR_OAUTH_REVOKED"
              }
            ]
          } as D1Result<T>;
        }
        if (query.includes("FROM operational_status")) {
          return {
            results: [{ status_key: "ai_quota", status_value: "available" }]
          } as D1Result<T>;
        }
        if (query.includes("FROM operational_incidents")) {
          return {
            results: [
              {
                error_code: "CALENDAR_OAUTH_REVOKED",
                occurred_at: "2026-10-07T16:30:00.000Z"
              }
            ]
          } as D1Result<T>;
        }
        return { results: [] } as unknown as D1Result<T>;
      },
      run: async () => {
        if (query.includes("UPDATE dashboard_configuration")) {
          this.configuration.latitude = Number(parameters[0]);
          this.configuration.longitude = Number(parameters[1]);
          this.configuration.slotsJson = String(parameters[2]);
        }
        return { success: true };
      }
    };
    return statement;
  }

  async batch(statements: D1PreparedStatement[]) {
    return Promise.all(
      statements.map((statement) =>
        (statement as unknown as { run(): Promise<unknown> }).run()
      )
    );
  }
}

function env(database = new AdminDatabase()): Env {
  return {
    DB: database as unknown as D1Database,
    IMAGES: {} as R2Bucket,
    BROWSER: {} as Fetcher,
    GENERATION_SECRET: "generation-secret",
    DEVICE_ORIGIN: "https://dashboard-device.example.com",
    ADMIN_ORIGIN: "https://dashboard-admin.example.com"
  };
}

function accessHeaders(email: string) {
  return {
    "Cf-Access-Authenticated-User-Email": email,
    "Cf-Access-Jwt-Assertion": "validated-by-cloudflare-access"
  };
}

describe("Access-protected browser administration", () => {
  test("authorized users receive a browser administration surface", async () => {
    const response = await worker.fetch(
      new Request("https://dashboard-admin.example.com/admin", {
        headers: accessHeaders("admin@example.com")
      }),
      env()
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toContain("Configuration");
    expect(
      (
        await worker.fetch(
          new Request("https://dashboard-admin.example.com/admin/app.js", {
            headers: accessHeaders("admin@example.com")
          }),
          env()
        )
      ).status
    ).toBe(200);
  });

  test("anonymous and device-token requests are denied on the admin hostname", async () => {
    const environment = env();
    const anonymous = await worker.fetch(
      new Request("https://dashboard-admin.example.com/admin/status"),
      environment
    );
    const deviceToken = await worker.fetch(
      new Request("https://dashboard-admin.example.com/admin/status", {
        headers: {
          ID: "AA:BB:CC:DD:EE:FF",
          "Access-Token": "device-token"
        }
      }),
      environment
    );

    expect(anonymous.status).toBe(401);
    expect(deviceToken.status).toBe(401);
  });

  test("reviewers can read safe configuration and status but cannot mutate", async () => {
    const environment = env();
    const headers = accessHeaders("reviewer@example.com");
    const configuration = await worker.fetch(
      new Request("https://dashboard-admin.example.com/admin/configuration", {
        headers
      }),
      environment
    );
    const status = await worker.fetch(
      new Request("https://dashboard-admin.example.com/admin/status", {
        headers
      }),
      environment
    );
    const mutation = await worker.fetch(
      new Request("https://dashboard-admin.example.com/admin/configuration", {
        method: "PUT",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          weather: {
            latitude: 37.7749,
            longitude: -122.4194,
            slots: ["06:30", "10:30", "15:00", "19:00"]
          }
        })
      }),
      environment
    );

    expect(configuration.status).toBe(200);
    const configurationBody = await configuration.json();
    expect(configurationBody).toEqual({
      weather: {
        latitude: 37.3382,
        longitude: -121.8863,
        timezone: "America/Los_Angeles",
        slots: ["06:30", "10:30", "15:00", "19:00"]
      },
      google: {
        accounts: [
          {
            accountId: "dad",
            displayLabel: "Dad",
            connected: true,
            calendars: []
          },
          {
            accountId: "mom",
            displayLabel: "Mom",
            connected: false,
            calendars: [{ id: "family", label: "Family" }]
          }
        ]
      }
    });
    expect(status.status).toBe(200);
    const statusBody = await status.json();
    expect(statusBody).toEqual({
      device: { lastCheckInAt: "2026-10-07T16:00:00.000Z" },
      rendering: {
        currentGenerationId: "generation-20261007T150000Z",
        lastSuccessfulAt: "2026-10-07T15:00:00.000Z",
        latestAttempt: {
          slotKey: "2026-10-07T19:00",
          state: "failed",
          attempt: 1,
          retryAt: "2026-10-07T19:15:00.000Z",
          errorCode: "DAILY_BRIEF_RENDER_FAILED"
        }
      },
      sources: [
        {
          source: "weather",
          state: "fresh",
          lastSuccessfulAt: "2026-10-07T15:00:00.000Z",
          errorCode: null
        },
        {
          source: "calendar",
          state: "error",
          lastSuccessfulAt: "2026-10-07T10:30:00.000Z",
          errorCode: "CALENDAR_OAUTH_REVOKED"
        }
      ],
      oauth: [
        { accountId: "dad", state: "connected" },
        { accountId: "mom", state: "revoked" }
      ],
      aiQuota: "available",
      incidents: [
        {
          errorCode: "CALENDAR_OAUTH_REVOKED",
          occurredAt: "2026-10-07T16:30:00.000Z"
        }
      ]
    });
    expect(JSON.stringify({ configurationBody, statusBody })).not.toMatch(
      /refresh.token|payload|content|message/i
    );
    expect(mutation.status).toBe(403);
  });

  test("administrators can update weather, slots, calendars, and household labels", async () => {
    const database = new AdminDatabase();
    const response = await worker.fetch(
      new Request("https://dashboard-admin.example.com/admin/configuration", {
        method: "PUT",
        headers: {
          ...accessHeaders("admin@example.com"),
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          weather: {
            latitude: 37.7749,
            longitude: -122.4194,
            slots: ["19:00", "06:30", "15:00", "10:30"]
          },
          google: {
            accounts: [
              {
                accountId: "mom",
                displayLabel: "Mama",
                calendars: [{ id: "family", label: "Family" }]
              },
              {
                accountId: "dad",
                displayLabel: "Papa",
                calendars: []
              }
            ]
          }
        })
      }),
      env(database)
    );

    expect(response.status).toBe(200);
    expect(database.configuration).toEqual({
      latitude: 37.7749,
      longitude: -122.4194,
      timezone: "America/Los_Angeles",
      slotsJson: '["06:30","10:30","15:00","19:00"]'
    });
  });

  test("admin routes are unavailable from the device hostname", async () => {
    const response = await worker.fetch(
      new Request("https://dashboard-device.example.com/admin/status", {
        headers: accessHeaders("admin@example.com")
      }),
      env()
    );

    expect(response.status).toBe(404);
  });
});
