import { afterEach, describe, expect, test, vi } from "vitest";
import {
  decryptCalendarFeedUrl,
  encryptCalendarFeedUrl,
  handleCalendarFeedAdministration,
  normalizeCalendarFeedInput,
  normalizeCalendarFeedUpdate
} from "../src/calendar-feeds";

class ActivationDatabase {
  readonly snapshots: string[] = [];
  batchCalled = false;

  private readonly row = {
    id: "feed-1",
    encrypted_url: "",
    hostname: "calendar.example.com",
    url_fingerprint: "123456789abc",
    calendar_label: "Family",
    household_label: null,
    enabled: 0,
    health_state: null,
    last_attempt_at: null,
    last_success_at: null,
    snapshot_fetched_at: "2026-10-18T11:55:00.000Z",
    snapshot_event_count: 12,
    snapshot_skipped_event_count: 1,
    updated_at: "2026-10-18T12:00:00.000Z"
  };

  prepare(query: string) {
    let parameters: unknown[] = [];
    const statement = {
      bind: (...values: unknown[]) => {
        parameters = values;
        return statement;
      },
      first: async <T>() => {
        if (query.includes("FROM dashboard_configuration")) {
          return { timezone: "America/Los_Angeles" } as T;
        }
        return this.row as T;
      },
      all: async <T>() => ({ results: [this.row as T] }),
      run: async () => {
        if (query.includes("SET enabled = 1")) this.row.enabled = 1;
        if (query.includes("INSERT INTO calendar_feed_snapshots")) {
          this.snapshots.push(String(parameters[2]));
        }
        return { success: true, meta: { changes: 1 } };
      }
    };
    return statement;
  }

  async batch(statements: Array<{ run(): Promise<unknown> }>) {
    this.batchCalled = true;
    return Promise.all(statements.map((statement) => statement.run()));
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Calendar Feed management", () => {
  test("returns privacy-safe snapshot ingestion metadata", async () => {
    const response = await handleCalendarFeedAdministration(
      new Request("https://admin.example.com/admin/calendar-feeds"),
      {
        DB: new ActivationDatabase() as unknown as D1Database
      },
      "reviewer"
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      feeds: [
        {
          snapshotFetchedAt: "2026-10-18T11:55:00.000Z",
          eventCount: 12,
          skippedEventCount: 1
        }
      ]
    });
  });

  test("accepts a direct HTTPS iCalendar URL and normalizes privacy-safe labels", () => {
    expect(
      normalizeCalendarFeedInput({
        url: " https://calendar.example.com/private/family.ics?token=secret ",
        calendarLabel: "  School   calendar ",
        householdLabel: "  Family  "
      })
    ).toEqual({
      url: "https://calendar.example.com/private/family.ics?token=secret",
      hostname: "calendar.example.com",
      calendarLabel: "School calendar",
      householdLabel: "Family"
    });
  });

  test.each([
    "https://calendar.google.com/calendar/ical/example%40group.calendar.google.com/public/basic.ics",
    "https://calendar.google.com/calendar/ical/example%40group.calendar.google.com/private-secret/basic.ics",
    "https://calendar.example.com/private/family.ics?token=secret"
  ])("accepts provider-neutral public or bearer-secret iCalendar URL %s", (url) => {
    expect(
      normalizeCalendarFeedInput({
        url,
        calendarLabel: "Family"
      })
    ).toMatchObject({ url });
  });

  test.each([
    "http://calendar.example.com/family.ics",
    "https://user:secret@calendar.example.com/family.ics",
    "https://calendar.example.com:8443/family.ics",
    "https://calendar.example.com/family.ics#events"
  ])("rejects unsafe Calendar Feed URL shape %s", (url) => {
    expect(
      normalizeCalendarFeedInput({
        url,
        calendarLabel: "Family"
      })
    ).toBeNull();
  });

  test("requires a Calendar Label and treats Household Label as optional", () => {
    expect(
      normalizeCalendarFeedInput({
        url: "https://calendar.example.com/family.ics",
        calendarLabel: "Family",
        householdLabel: ""
      })
    ).toMatchObject({ householdLabel: null });
    expect(
      normalizeCalendarFeedInput({
        url: "https://calendar.example.com/family.ics",
        calendarLabel: "family@example.com"
      })
    ).toBeNull();
  });

  test("relabels and disables feeds but does not activate an untested feed", () => {
    expect(
      normalizeCalendarFeedUpdate({
        calendarLabel: "  School ",
        householdLabel: null,
        enabled: false
      })
    ).toEqual({
      calendarLabel: "School",
      householdLabel: null,
      disable: true
    });
    expect(normalizeCalendarFeedUpdate({ enabled: true })).toBeNull();
  });

  test("uses an authenticated dedicated encryption contract for feed URLs", async () => {
    const stored = await encryptCalendarFeedUrl(
      "https://calendar.example.com/private.ics?token=secret",
      "calendar-feed-key"
    );

    expect(stored).not.toContain("calendar.example.com");
    expect(JSON.parse(stored)).toMatchObject({
      contract: "calendar-feed-url",
      version: 1
    });
    await expect(
      decryptCalendarFeedUrl(stored, "calendar-feed-key")
    ).resolves.toBe(
      "https://calendar.example.com/private.ics?token=secret"
    );
    await expect(
      decryptCalendarFeedUrl(stored, "wrong-key")
    ).rejects.toThrow();
  });

  test("does not activate a feed whose wrapper is present but calendar structure is invalid", async () => {
    const database = new ActivationDatabase();
    const response = await handleCalendarFeedAdministration(
      new Request("https://admin.example.com/admin/calendar-feeds/feed-1/test", {
        method: "POST",
        body: JSON.stringify({
          url: "https://calendar.example.com/replacement.ics"
        })
      }),
      {
        DB: database as unknown as D1Database,
        CALENDAR_FEED_URL_ENCRYPTION_KEY: "feed-key",
        CALENDAR_FEED_FETCHER: async () =>
          new Response(
            "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n"
          ),
        CALENDAR_FEED_RESOLVE_HOSTNAME: async () => ["93.184.216.34"]
      },
      "administrator"
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      error: "Calendar Feed test failed",
      code: "invalid_response"
    });
    expect(database.batchCalled).toBe(false);
  });

  test("activates and stores a production-normalized valid empty feed", async () => {
    const database = new ActivationDatabase();
    const response = await handleCalendarFeedAdministration(
      new Request("https://admin.example.com/admin/calendar-feeds/feed-1/test", {
        method: "POST",
        body: JSON.stringify({
          url: "https://calendar.example.com/replacement.ics"
        })
      }),
      {
        DB: database as unknown as D1Database,
        CALENDAR_FEED_URL_ENCRYPTION_KEY: "feed-key",
        CALENDAR_FEED_FETCHER: async () =>
          new Response(
            [
              "BEGIN:VCALENDAR",
              "VERSION:2.0",
              "PRODID:-//Example//Calendar//EN",
              "END:VCALENDAR"
            ].join("\r\n")
          ),
        CALENDAR_FEED_RESOLVE_HOSTNAME: async () => ["93.184.216.34"]
      },
      "administrator"
    );

    expect(response.status).toBe(200);
    expect(database.snapshots.map((snapshot) => JSON.parse(snapshot))).toEqual([
      { events: [], skippedEventCount: 0, skipReasons: [] }
    ]);
  });

  test("uses Cloudflare-compatible redirect handling for DNS resolution", async () => {
    const dnsFetch = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        if (init?.redirect === "error") {
          throw new TypeError(
            'Invalid redirect value, must be one of "follow" or "manual"'
          );
        }
        return Response.json({
          Answer: [{ type: 1, data: "142.250.191.142" }]
        });
      }
    );
    vi.stubGlobal("fetch", dnsFetch);
    const database = new ActivationDatabase();
    const response = await handleCalendarFeedAdministration(
      new Request("https://admin.example.com/admin/calendar-feeds/feed-1/test", {
        method: "POST",
        body: JSON.stringify({
          url: "https://calendar.example.com/replacement.ics"
        })
      }),
      {
        DB: database as unknown as D1Database,
        CALENDAR_FEED_URL_ENCRYPTION_KEY: "feed-key",
        CALENDAR_FEED_FETCHER: async () =>
          new Response(
            [
              "BEGIN:VCALENDAR",
              "VERSION:2.0",
              "PRODID:-//Example//Calendar//EN",
              "END:VCALENDAR"
            ].join("\r\n")
          )
      },
      "administrator"
    );

    expect(response.status).toBe(200);
    expect(dnsFetch).toHaveBeenCalledTimes(2);
    expect(dnsFetch.mock.calls.map((call) => call[1]?.redirect)).toEqual([
      "manual",
      "manual"
    ]);
  });

  test("invokes the default fetch with the Worker global receiver", async () => {
    const workerFetch = vi.fn(async function (
      this: typeof globalThis,
      input: string | URL | Request
    ) {
      if (this !== undefined && this !== globalThis) {
        throw new TypeError("Illegal invocation");
      }
      const url = String(input);
      if (url.startsWith("https://cloudflare-dns.com/")) {
        return Response.json({
          Answer: [{ type: 1, data: "142.250.191.142" }]
        });
      }
      return new Response(
        [
          "BEGIN:VCALENDAR",
          "VERSION:2.0",
          "PRODID:-//Example//Calendar//EN",
          "END:VCALENDAR"
        ].join("\r\n")
      );
    });
    vi.stubGlobal("fetch", workerFetch);
    const database = new ActivationDatabase();
    const response = await handleCalendarFeedAdministration(
      new Request("https://admin.example.com/admin/calendar-feeds/feed-1/test", {
        method: "POST",
        body: JSON.stringify({
          url: "https://calendar.example.com/replacement.ics"
        })
      }),
      {
        DB: database as unknown as D1Database,
        CALENDAR_FEED_URL_ENCRYPTION_KEY: "feed-key"
      },
      "administrator"
    );

    expect(response.status).toBe(200);
    expect(
      workerFetch.mock.contexts.every(
        (context) => context === undefined || context === globalThis
      )
    ).toBe(true);
  });
});
