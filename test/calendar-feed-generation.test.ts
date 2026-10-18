import { describe, expect, test, vi } from "vitest";
import {
  encryptCalendarFeedUrl,
  refreshCalendarFeedsForGeneration
} from "../src/calendar-feeds";
import { normalizeICalendarFeed } from "../src/ical-normalization";

interface FeedRow {
  id: string;
  encrypted_url: string;
  calendar_label: string;
  household_label: string | null;
  enabled: number;
  created_at: string;
  fetched_at: string | null;
  events_json: string | null;
  etag: string | null;
  last_modified: string | null;
  last_success_at: string | null;
}

class GenerationFeedDatabase {
  readonly health = new Map<
    string,
    { state: string; lastSuccessAt: string | null; failureCode: string | null }
  >();

  constructor(readonly feeds: FeedRow[]) {}

  prepare(query: string) {
    let parameters: unknown[] = [];
    const statement = {
      bind: (...values: unknown[]) => {
        parameters = values;
        return statement;
      },
      all: async <T>() => ({
        results: this.feeds
          .filter(({ enabled }) => enabled === 1)
          .sort(
            (left, right) =>
              left.created_at.localeCompare(right.created_at) ||
              left.id.localeCompare(right.id)
          ) as unknown as T[]
      }),
      run: async () => {
        if (query.includes("INSERT INTO calendar_feed_snapshots")) {
          const feed = this.feeds.find(({ id }) => id === parameters[0])!;
          feed.fetched_at = String(parameters[1]);
          feed.events_json = String(parameters[2]);
          feed.etag = parameters[3] as string | null;
          feed.last_modified = parameters[4] as string | null;
        }
        if (query.includes("INSERT INTO calendar_feed_health\n")) {
          const [id, stateOrAttempt, attemptOrSuccess, successOrCode, code] =
            parameters;
          if (parameters.length === 3) {
            this.health.set(String(id), {
              state: "healthy",
              lastSuccessAt: String(attemptOrSuccess),
              failureCode: null
            });
          } else {
            this.health.set(String(id), {
              state: String(stateOrAttempt),
              lastSuccessAt:
                successOrCode === null ? null : String(successOrCode),
              failureCode: code === null ? null : String(code)
            });
          }
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

function calendar(uid: string, summary: string, day: string): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Family Dashboard//EN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTART;VALUE=DATE:${day.replaceAll("-", "")}`,
    `DTEND;VALUE=DATE:${day.replaceAll("-", "").replace(/(\d{2})$/, (value) => String(Number(value) + 1).padStart(2, "0"))}`,
    `SUMMARY:${summary}`,
    "END:VEVENT",
    "END:VCALENDAR"
  ].join("\r\n");
}

async function feed(
  id: string,
  url: string,
  overrides: Partial<FeedRow> = {}
): Promise<FeedRow> {
  return {
    id,
    encrypted_url: await encryptCalendarFeedUrl(url, "feed-key"),
    calendar_label: id,
    household_label: "Family",
    enabled: 1,
    created_at: `2026-10-18T1${id.length}:00:00.000Z`,
    fetched_at: null,
    events_json: null,
    etag: null,
    last_modified: null,
    last_success_at: null,
    ...overrides
  };
}

function snapshot(
  uid: string,
  summary: string,
  calendarLabel: string
): string {
  return JSON.stringify(
    normalizeICalendarFeed(calendar(uid, summary, "2026-10-18"), {
      timezone: "America/Los_Angeles",
      calendarLabel,
      householdLabel: "Family"
    })
  );
}

describe("Calendar Feed generation refresh", () => {
  test("a valid empty enabled feed remains usable", async () => {
    const database = new GenerationFeedDatabase([
      await feed("empty", "https://calendar.example.com/empty.ics")
    ]);

    const result = await refreshCalendarFeedsForGeneration(
      {
        DB: database as unknown as D1Database,
        CALENDAR_FEED_URL_ENCRYPTION_KEY: "feed-key",
        CALENDAR_FEED_FETCHER: async () =>
          new Response(
            [
              "BEGIN:VCALENDAR",
              "VERSION:2.0",
              "PRODID:-//Family Dashboard//EN",
              "END:VCALENDAR"
            ].join("\r\n")
          ),
        CALENDAR_FEED_RESOLVE_HOSTNAME: async () => ["93.184.216.34"]
      },
      new Date("2026-10-18T17:00:00.000Z"),
      "America/Los_Angeles"
    );

    expect(result).toEqual({
      calendar: [],
      unavailable: false,
      failures: []
    });
    expect(database.health.get("empty")?.state).toBe("healthy");
  });

  test("healthy and stale feeds contribute independently with conditional refresh state", async () => {
    const database = new GenerationFeedDatabase([
      await feed("school", "https://calendar.example.com/school.ics", {
        etag: '"school-v1"',
        last_modified: "Sun, 18 Oct 2026 15:00:00 GMT"
      }),
      await feed("activities", "https://calendar.example.com/activities.ics", {
        fetched_at: "2026-10-18T14:00:00.000Z",
        last_success_at: "2026-10-18T14:00:00.000Z",
        events_json: snapshot("activity-1", "Piano lesson", "activities"),
        etag: '"activities-v1"'
      })
    ]);
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.includes("activities")) throw new Error("network failure");
      const headers = new Headers(init?.headers);
      expect(headers.get("if-none-match")).toBe('"school-v1"');
      expect(headers.get("if-modified-since")).toBe(
        "Sun, 18 Oct 2026 15:00:00 GMT"
      );
      return new Response(calendar("school-1", "School holiday", "2026-10-18"), {
        headers: { etag: '"school-v2"' }
      });
    });

    const result = await refreshCalendarFeedsForGeneration(
      {
        DB: database as unknown as D1Database,
        CALENDAR_FEED_URL_ENCRYPTION_KEY: "feed-key",
        CALENDAR_FEED_FETCHER: fetcher,
        CALENDAR_FEED_RESOLVE_HOSTNAME: async () => ["93.184.216.34"]
      },
      new Date("2026-10-18T17:00:00.000Z"),
      "America/Los_Angeles"
    );

    expect(result).toMatchObject({
      unavailable: false,
      staleAgeMinutes: 180,
      failures: [{ id: "activities", code: "invalid_response" }]
    });
    expect(result.calendar.map(({ title }) => title)).toEqual([
      "Piano lesson",
      "School holiday"
    ]);
    expect(database.health.get("school")?.state).toBe("healthy");
    expect(database.health.get("activities")?.state).toBe("stale");
  });

  test("a failed snapshot is usable through 72 hours and unavailable immediately after", async () => {
    const stored = await feed(
      "school",
      "https://calendar.example.com/school.ics",
      {
        fetched_at: "2026-10-15T17:00:00.000Z",
        last_success_at: "2026-10-15T17:00:00.000Z",
        events_json: snapshot("school-1", "School holiday", "school")
      }
    );
    const database = new GenerationFeedDatabase([stored]);
    const environment = {
      DB: database as unknown as D1Database,
      CALENDAR_FEED_URL_ENCRYPTION_KEY: "feed-key",
      CALENDAR_FEED_FETCHER: vi.fn<typeof fetch>(async () => {
        throw new Error("offline");
      }),
      CALENDAR_FEED_RESOLVE_HOSTNAME: async () => ["93.184.216.34"]
    };

    const atLimit = await refreshCalendarFeedsForGeneration(
      environment,
      new Date("2026-10-18T17:00:00.000Z"),
      "America/Los_Angeles"
    );
    expect(atLimit).toMatchObject({
      unavailable: false,
      staleAgeMinutes: 4_320
    });
    expect(atLimit.calendar).toHaveLength(1);
    expect(database.health.get("school")?.state).toBe("stale");

    const afterLimit = await refreshCalendarFeedsForGeneration(
      environment,
      new Date("2026-10-18T17:01:00.000Z"),
      "America/Los_Angeles"
    );
    expect(afterLimit).toMatchObject({
      calendar: [],
      unavailable: true
    });
    expect(database.health.get("school")?.state).toBe("unavailable");
  });

  test("an incompatible stored snapshot is omitted without blocking a healthy feed", async () => {
    const database = new GenerationFeedDatabase([
      await feed("school", "https://calendar.example.com/school.ics"),
      await feed("legacy", "https://calendar.example.com/legacy.ics", {
        fetched_at: "2026-10-18T16:00:00.000Z",
        last_success_at: "2026-10-18T16:00:00.000Z",
        events_json: "[]"
      })
    ]);

    const result = await refreshCalendarFeedsForGeneration(
      {
        DB: database as unknown as D1Database,
        CALENDAR_FEED_URL_ENCRYPTION_KEY: "feed-key",
        CALENDAR_FEED_FETCHER: async (input) => {
          if (String(input).includes("legacy")) {
            throw new Error("offline");
          }
          return new Response(
            calendar("school-1", "School holiday", "2026-10-18")
          );
        },
        CALENDAR_FEED_RESOLVE_HOSTNAME: async () => ["93.184.216.34"]
      },
      new Date("2026-10-18T17:00:00.000Z"),
      "America/Los_Angeles"
    );

    expect(result.calendar.map(({ title }) => title)).toEqual([
      "School holiday"
    ]);
    expect(result.unavailable).toBe(false);
    expect(database.health.get("legacy")?.state).toBe("unavailable");
  });

  test("disabled feeds retain stored snapshots but are excluded from the next generation", async () => {
    const disabled = await feed(
      "disabled",
      "https://calendar.example.com/disabled.ics",
      {
        enabled: 0,
        fetched_at: "2026-10-18T16:00:00.000Z",
        events_json: snapshot("kept", "Retained event", "disabled")
      }
    );
    const database = new GenerationFeedDatabase([disabled]);
    const fetcher = vi.fn<typeof fetch>();

    const result = await refreshCalendarFeedsForGeneration(
      {
        DB: database as unknown as D1Database,
        CALENDAR_FEED_URL_ENCRYPTION_KEY: "feed-key",
        CALENDAR_FEED_FETCHER: fetcher,
        CALENDAR_FEED_RESOLVE_HOSTNAME: async () => ["93.184.216.34"]
      },
      new Date("2026-10-18T17:00:00.000Z"),
      "America/Los_Angeles"
    );

    expect(result).toEqual({
      calendar: [],
      unavailable: true,
      failures: []
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect(disabled.events_json).toContain("Retained event");
  });
});
