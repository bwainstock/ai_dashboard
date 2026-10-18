import { describe, expect, test } from "vitest";
import { expandAndMergeCalendarFeedEvents } from "../src/ical-recurrence";
import { normalizeICalendarFeed } from "../src/ical-normalization";

const options = {
  timezone: "America/Los_Angeles",
  calendarLabel: "Family calendar",
  householdLabel: "Family"
};

function calendar(...events: string[][]): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Example//Calendar//EN",
    ...events.flat(),
    "END:VCALENDAR"
  ].join("\r\n");
}

function event(...properties: string[]): string[] {
  return ["BEGIN:VEVENT", ...properties, "END:VEVENT"];
}

describe("iCalendar recurrence expansion and feed merging", () => {
  test("expands RRULE and RDATE while applying EXDATE only inside the dashboard window", () => {
    const snapshot = normalizeICalendarFeed(
      calendar(
        event(
          "UID:lesson-1",
          "DTSTAMP:20261018T120000Z",
          "DTSTART:20261019T160000Z",
          "DTEND:20261019T170000Z",
          "SUMMARY:Music lesson",
          "RRULE:FREQ=WEEKLY;COUNT=5",
          "RDATE:20261021T160000Z",
          "EXDATE:20261020T160000Z,20261026T160000Z"
        )
      ),
      options
    );

    const result = expandAndMergeCalendarFeedEvents([snapshot], {
      now: new Date("2026-10-19T07:00:00Z"),
      timezone: options.timezone,
      days: 10
    });

    expect(result.map(({ occurrenceId, start, end }) => ({ occurrenceId, start, end }))).toEqual([
      {
        occurrenceId: "2026-10-19T09:00:00-07:00",
        start: "2026-10-19T09:00:00-07:00",
        end: "2026-10-19T10:00:00-07:00"
      },
      {
        occurrenceId: "2026-10-21T09:00:00-07:00",
        start: "2026-10-21T09:00:00-07:00",
        end: "2026-10-21T10:00:00-07:00"
      }
    ]);
  });

  test("replaces exactly one recurring occurrence with a moved RECURRENCE-ID override", () => {
    const snapshot = normalizeICalendarFeed(
      calendar(
        event(
          "UID:lesson-override",
          "DTSTAMP:20261018T120000Z",
          "DTSTART:20261019T160000Z",
          "DTEND:20261019T170000Z",
          "SUMMARY:Music lesson",
          "RRULE:FREQ=DAILY;COUNT=3"
        ),
        event(
          "UID:lesson-override",
          "DTSTAMP:20261018T120000Z",
          "RECURRENCE-ID:20261020T160000Z",
          "DTSTART:20261020T180000Z",
          "DTEND:20261020T193000Z",
          "SUMMARY:Moved music lesson"
        )
      ),
      options
    );

    const result = expandAndMergeCalendarFeedEvents([snapshot], {
      now: new Date("2026-10-19T07:00:00Z"),
      timezone: options.timezone,
      days: 3
    });

    expect(result.map(({ occurrenceId, summary, start, end }) => ({
      occurrenceId,
      summary,
      start,
      end
    }))).toEqual([
      {
        occurrenceId: "2026-10-19T09:00:00-07:00",
        summary: "Music lesson",
        start: "2026-10-19T09:00:00-07:00",
        end: "2026-10-19T10:00:00-07:00"
      },
      {
        occurrenceId: "2026-10-20T09:00:00-07:00",
        summary: "Moved music lesson",
        start: "2026-10-20T11:00:00-07:00",
        end: "2026-10-20T12:30:00-07:00"
      },
      {
        occurrenceId: "2026-10-21T09:00:00-07:00",
        summary: "Music lesson",
        start: "2026-10-21T09:00:00-07:00",
        end: "2026-10-21T10:00:00-07:00"
      }
    ]);
  });

  test("removes exactly the occurrence named by a recurrence cancellation", () => {
    const snapshot = normalizeICalendarFeed(
      calendar(
        event(
          "UID:lesson-cancelled",
          "DTSTAMP:20261018T120000Z",
          "DTSTART:20261019T160000Z",
          "DTEND:20261019T170000Z",
          "SUMMARY:Music lesson",
          "RRULE:FREQ=DAILY;COUNT=3"
        ),
        event(
          "UID:lesson-cancelled",
          "DTSTAMP:20261018T120000Z",
          "RECURRENCE-ID:20261020T160000Z",
          "STATUS:CANCELLED"
        )
      ),
      options
    );

    const result = expandAndMergeCalendarFeedEvents([snapshot], {
      now: new Date("2026-10-19T07:00:00Z"),
      timezone: options.timezone,
      days: 3
    });

    expect(result.map((occurrence) => occurrence.occurrenceId)).toEqual([
      "2026-10-19T09:00:00-07:00",
      "2026-10-21T09:00:00-07:00"
    ]);
  });

  test("keeps stable distinct occurrence identities across refreshes", () => {
    const document = calendar(
      event(
        "UID:stable-series",
        "DTSTAMP:20261018T120000Z",
        "DTSTART:20261019T160000Z",
        "DTEND:20261019T170000Z",
        "SUMMARY:Music lesson",
        "RRULE:FREQ=DAILY;COUNT=2"
      )
    );
    const window = {
      now: new Date("2026-10-19T07:00:00Z"),
      timezone: options.timezone,
      days: 2
    };

    const first = expandAndMergeCalendarFeedEvents(
      [normalizeICalendarFeed(document, options)],
      window
    );
    const refreshed = expandAndMergeCalendarFeedEvents(
      [normalizeICalendarFeed(document, options)],
      window
    );

    expect(first.map((occurrence) => occurrence.occurrenceId)).toEqual([
      "2026-10-19T09:00:00-07:00",
      "2026-10-20T09:00:00-07:00"
    ]);
    expect(refreshed.map((occurrence) => occurrence.occurrenceId)).toEqual(
      first.map((occurrence) => occurrence.occurrenceId)
    );
  });

  test("expands all-day occurrences with their exclusive end dates", () => {
    const snapshot = normalizeICalendarFeed(
      calendar(
        event(
          "UID:all-day-series",
          "DTSTAMP:20261018T120000Z",
          "DTSTART;VALUE=DATE:20261019",
          "DTEND;VALUE=DATE:20261021",
          "SUMMARY:School break",
          "RRULE:FREQ=WEEKLY;COUNT=2"
        )
      ),
      options
    );

    const result = expandAndMergeCalendarFeedEvents([snapshot], {
      now: new Date("2026-10-19T07:00:00Z"),
      timezone: options.timezone,
      days: 10
    });

    expect(result.map(({ occurrenceId, start, end, allDay }) => ({
      occurrenceId,
      start,
      end,
      allDay
    }))).toEqual([
      {
        occurrenceId: "2026-10-19",
        start: "2026-10-19",
        end: "2026-10-21",
        allDay: true
      },
      {
        occurrenceId: "2026-10-26",
        start: "2026-10-26",
        end: "2026-10-28",
        allDay: true
      }
    ]);
  });

  test("deduplicates by normalized UID and occurrence while preferring an override and merging labels in feed order", () => {
    const masterDocument = calendar(
      event(
        "UID:shared-e\u0301vent",
        "DTSTAMP:20261018T120000Z",
        "DTSTART:20261019T160000Z",
        "DTEND:20261019T170000Z",
        "SUMMARY:Original title",
        "RRULE:FREQ=DAILY;COUNT=2"
      )
    );
    const overrideDocument = calendar(
      event(
        "UID:shared-évent",
        "DTSTAMP:20261018T120000Z",
        "RECURRENCE-ID:20261020T160000Z",
        "DTSTART:20261020T180000Z",
        "DTEND:20261020T190000Z",
        "SUMMARY:Updated title"
      )
    );
    const feeds = [
      normalizeICalendarFeed(masterDocument, {
        ...options,
        calendarLabel: "School",
        householdLabel: "Family"
      }),
      normalizeICalendarFeed(overrideDocument, {
        ...options,
        calendarLabel: "Activities",
        householdLabel: "Mom"
      }),
      normalizeICalendarFeed(masterDocument, {
        ...options,
        calendarLabel: "School",
        householdLabel: "Family"
      })
    ];

    const result = expandAndMergeCalendarFeedEvents(feeds, {
      now: new Date("2026-10-20T07:00:00Z"),
      timezone: options.timezone,
      days: 1
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      occurrenceId: "2026-10-20T09:00:00-07:00",
      summary: "Updated title",
      start: "2026-10-20T11:00:00-07:00",
      calendarLabels: ["School", "Activities"],
      householdLabels: ["Family", "Mom"]
    });
  });

  test("keeps source wall time across a dashboard timezone boundary", () => {
    const snapshot = normalizeICalendarFeed(
      calendar(
        [
          "BEGIN:VTIMEZONE",
          "TZID:Custom/Phoenix",
          "BEGIN:STANDARD",
          "DTSTART:19700101T000000",
          "TZOFFSETFROM:-0700",
          "TZOFFSETTO:-0700",
          "END:STANDARD",
          "END:VTIMEZONE"
        ],
        event(
          "UID:timezone-series",
          "DTSTAMP:20261018T120000Z",
          "DTSTART;TZID=Custom/Phoenix:20261026T090000",
          "DTEND;TZID=Custom/Phoenix:20261026T100000",
          "SUMMARY:Remote lesson",
          "RRULE:FREQ=WEEKLY;COUNT=2"
        )
      ),
      options
    );

    const result = expandAndMergeCalendarFeedEvents([snapshot], {
      now: new Date("2026-10-26T07:00:00Z"),
      timezone: options.timezone,
      days: 8
    });

    expect(result.map(({ start, end }) => ({ start, end }))).toEqual([
      {
        start: "2026-10-26T09:00:00-07:00",
        end: "2026-10-26T10:00:00-07:00"
      },
      {
        start: "2026-11-02T08:00:00-08:00",
        end: "2026-11-02T09:00:00-08:00"
      }
    ]);
  });

  test("rejects recurrence work that cannot reach the dashboard window within the fixed expansion budget", () => {
    const snapshot = normalizeICalendarFeed(
      calendar(
        event(
          "UID:unbounded-series",
          "DTSTAMP:20000101T000000Z",
          "DTSTART:20000101T000000Z",
          "DTEND:20000101T000100Z",
          "SUMMARY:Too frequent",
          "RRULE:FREQ=SECONDLY"
        )
      ),
      options
    );

    expect(() =>
      expandAndMergeCalendarFeedEvents([snapshot], {
        now: new Date("2026-10-19T07:00:00Z"),
        timezone: options.timezone,
        days: 3
      })
    ).toThrowError("Recurrence expansion exceeded the fixed work limit");
  });
});
