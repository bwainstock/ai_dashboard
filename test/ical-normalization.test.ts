import { describe, expect, test } from "vitest";
import {
  CalendarFeedNormalizationError,
  normalizeICalendarFeed
} from "../src/ical-normalization";

const options = {
  timezone: "America/Los_Angeles",
  calendarLabel: "Family calendar",
  householdLabel: "Family"
};

describe("iCalendar feed normalization", () => {
  test("normalizes an all-day event through the feed boundary", () => {
    const result = normalizeICalendarFeed(
      [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Example//Calendar//EN",
        "BEGIN:VEVENT",
        "UID:all-day-1@example.test",
        "DTSTAMP:20261018T120000Z",
        "DTSTART;VALUE=DATE:20261020",
        "DTEND;VALUE=DATE:20261021",
        "SUMMARY:School holiday",
        "LOCATION:Lincoln School, 123 Main Street",
        "END:VEVENT",
        "END:VCALENDAR"
      ].join("\r\n"),
      options
    );

    expect(result).toEqual({
      events: [
        {
          uid: "all-day-1@example.test",
          occurrenceId: "2026-10-20",
          summary: "School holiday",
          start: "2026-10-20",
          end: "2026-10-21",
          allDay: true,
          location: "Lincoln School",
          status: "confirmed",
          calendarLabel: "Family calendar",
          householdLabel: "Family"
        }
      ],
      skippedEventCount: 0,
      skipReasons: []
    });
  });

  test("converts UTC date-times into the dashboard timezone", () => {
    const result = normalizeICalendarFeed(
      [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Example//Calendar//EN",
        "BEGIN:VEVENT",
        "UID:utc-1",
        "DTSTAMP:20261018T120000Z",
        "DTSTART:20261020T180000Z",
        "DTEND:20261020T190000Z",
        "SUMMARY:Dentist",
        "END:VEVENT",
        "END:VCALENDAR"
      ].join("\r\n"),
      options
    );

    expect(result.events[0]).toMatchObject({
      occurrenceId: "2026-10-20T11:00:00-07:00",
      start: "2026-10-20T11:00:00-07:00",
      end: "2026-10-20T12:00:00-07:00",
      allDay: false
    });
  });

  test("preserves chronological events across a dashboard DST fallback", () => {
    const result = normalizeICalendarFeed(
      [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Example//Calendar//EN",
        "BEGIN:VEVENT",
        "UID:dst-fallback",
        "DTSTAMP:20261018T120000Z",
        "DTSTART:20261101T084500Z",
        "DTEND:20261101T091500Z",
        "SUMMARY:Overnight support",
        "END:VEVENT",
        "END:VCALENDAR"
      ].join("\r\n"),
      options
    );

    expect(result.events[0]).toMatchObject({
      start: "2026-11-01T01:45:00-07:00",
      end: "2026-11-01T01:15:00-08:00"
    });
  });

  test("interprets floating local date-times in the dashboard timezone", () => {
    const result = normalizeICalendarFeed(
      [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Example//Calendar//EN",
        "BEGIN:VEVENT",
        "UID:local-1",
        "DTSTAMP:20261018T120000Z",
        "DTSTART:20261103T090000",
        "DTEND:20261103T100000",
        "SUMMARY:School meeting",
        "END:VEVENT",
        "END:VCALENDAR"
      ].join("\r\n"),
      options
    );

    expect(result.events[0]).toMatchObject({
      start: "2026-11-03T09:00:00-08:00",
      end: "2026-11-03T10:00:00-08:00"
    });
  });

  test("uses embedded VTIMEZONE rules before converting to the dashboard timezone", () => {
    const result = normalizeICalendarFeed(
      [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Example//Calendar//EN",
        "BEGIN:VTIMEZONE",
        "TZID:America/New_York",
        "BEGIN:DAYLIGHT",
        "DTSTART:19700308T020000",
        "TZOFFSETFROM:-0500",
        "TZOFFSETTO:-0400",
        "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU",
        "END:DAYLIGHT",
        "BEGIN:STANDARD",
        "DTSTART:19701101T020000",
        "TZOFFSETFROM:-0400",
        "TZOFFSETTO:-0500",
        "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU",
        "END:STANDARD",
        "END:VTIMEZONE",
        "BEGIN:VEVENT",
        "UID:zoned-1",
        "DTSTAMP:20261018T120000Z",
        "DTSTART;TZID=America/New_York:20261020T090000",
        "DTEND;TZID=America/New_York:20261020T100000",
        "SUMMARY:Remote appointment",
        "END:VEVENT",
        "END:VCALENDAR"
      ].join("\r\n"),
      options
    );

    expect(result.events[0]).toMatchObject({
      start: "2026-10-20T06:00:00-07:00",
      end: "2026-10-20T07:00:00-07:00"
    });
  });

  test("minimizes private events and ignores attendee RSVP state", () => {
    const result = normalizeICalendarFeed(
      [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Example//Calendar//EN",
        "BEGIN:VEVENT",
        "UID:private-1",
        "DTSTAMP:20261018T120000Z",
        "DTSTART:20261020T180000Z",
        "DTEND:20261020T190000Z",
        "SUMMARY:Sensitive medical appointment",
        "CLASS:PRIVATE",
        "STATUS:TENTATIVE",
        "LOCATION:Private Clinic, 10 Secret Street",
        "DESCRIPTION:Diagnosis and treatment details",
        "ORGANIZER:mailto:doctor@example.test",
        "ATTENDEE;PARTSTAT=DECLINED:mailto:family@example.test",
        "ATTACH:https://files.example.test/private.pdf",
        "CONFERENCE;VALUE=URI:https://meet.example.test/secret",
        "END:VEVENT",
        "END:VCALENDAR"
      ].join("\r\n"),
      options
    );

    expect(result.events).toEqual([
      {
        uid: "private-1",
        occurrenceId: "2026-10-20T11:00:00-07:00",
        summary: "Busy",
        start: "2026-10-20T11:00:00-07:00",
        end: "2026-10-20T12:00:00-07:00",
        allDay: false,
        status: "tentative",
        calendarLabel: "Family calendar",
        householdLabel: "Family"
      }
    ]);
    expect(JSON.stringify(result)).not.toMatch(
      /medical|Clinic|Diagnosis|doctor@|family@|files\.example|meet\.example/u
    );
  });

  test("excludes event-level cancellations", () => {
    const result = normalizeICalendarFeed(
      [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Example//Calendar//EN",
        "BEGIN:VEVENT",
        "UID:cancelled-1",
        "DTSTAMP:20261018T120000Z",
        "DTSTART:20261020T180000Z",
        "DTEND:20261020T190000Z",
        "SUMMARY:Cancelled appointment",
        "STATUS:CANCELLED",
        "END:VEVENT",
        "END:VCALENDAR"
      ].join("\r\n"),
      options
    );

    expect(result).toEqual({
      events: [],
      skippedEventCount: 0,
      skipReasons: []
    });
  });

  test("accepts a structurally valid empty feed as a successful snapshot", () => {
    expect(
      normalizeICalendarFeed(
        [
          "BEGIN:VCALENDAR",
          "VERSION:2.0",
          "PRODID:-//Example//Calendar//EN",
          "END:VCALENDAR"
        ].join("\r\n"),
        options
      )
    ).toEqual({
      events: [],
      skippedEventCount: 0,
      skipReasons: []
    });
  });

  test.each([
    ["not a calendar", "not iCalendar"],
    [
      "unbalanced components",
      [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "BEGIN:VEVENT",
        "UID:broken",
        "END:VCALENDAR"
      ].join("\r\n")
    ],
    [
      "wrong root component",
      ["BEGIN:VEVENT", "UID:standalone", "END:VEVENT"].join("\r\n")
    ],
    [
      "missing required product identifier",
      ["BEGIN:VCALENDAR", "VERSION:2.0", "END:VCALENDAR"].join("\r\n")
    ]
  ])("rejects structural failure: %s", (_name, document) => {
    expect(() => normalizeICalendarFeed(document, options)).toThrowError(
      expect.objectContaining<Partial<CalendarFeedNormalizationError>>({
        name: "CalendarFeedNormalizationError",
        code: "invalid-calendar"
      })
    );
  });

  test("retains only normalized recurrence inputs for later expansion", () => {
    const result = normalizeICalendarFeed(
      [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Example//Calendar//EN",
        "BEGIN:VEVENT",
        "UID:recurring-1",
        "DTSTAMP:20261018T120000Z",
        "DTSTART:20261019T160000Z",
        "DTEND:20261019T170000Z",
        "SUMMARY:Music lesson",
        "RRULE:FREQ=WEEKLY;COUNT=4;BYDAY=MO",
        "RDATE:20261120T170000Z",
        "EXDATE:20261102T170000Z",
        "END:VEVENT",
        "END:VCALENDAR"
      ].join("\r\n"),
      options
    );

    expect(result.events[0]).toMatchObject({
      uid: "recurring-1",
      occurrenceId: "2026-10-19T09:00:00-07:00",
      recurrence: {
        rule: "FREQ=WEEKLY;COUNT=4;BYDAY=MO",
        dates: ["2026-11-20T09:00:00-08:00"],
        excludedDates: ["2026-11-02T09:00:00-08:00"],
        sourceTimezone: "UTC"
      }
    });
  });

  test("uses RECURRENCE-ID as the stable occurrence identity for moved overrides", () => {
    const result = normalizeICalendarFeed(
      [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Example//Calendar//EN",
        "BEGIN:VEVENT",
        "UID:recurring-override",
        "DTSTAMP:20261018T120000Z",
        "RECURRENCE-ID:20261026T160000Z",
        "DTSTART:20261027T180000Z",
        "DTEND:20261027T190000Z",
        "SUMMARY:Moved music lesson",
        "END:VEVENT",
        "END:VCALENDAR"
      ].join("\r\n"),
      options
    );

    expect(result.events[0]).toMatchObject({
      occurrenceId: "2026-10-26T09:00:00-07:00",
      start: "2026-10-27T11:00:00-07:00",
      recurrence: {
        recurrenceId: "2026-10-26T09:00:00-07:00",
        sourceTimezone: "UTC"
      }
    });
  });

  test("retains only identity for cancelled recurrence occurrences", () => {
    const result = normalizeICalendarFeed(
      [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Example//Calendar//EN",
        "BEGIN:VEVENT",
        "UID:recurring-cancelled",
        "DTSTAMP:20261018T120000Z",
        "RECURRENCE-ID:20261026T160000Z",
        "STATUS:CANCELLED",
        "SUMMARY:Sensitive cancelled title",
        "DESCRIPTION:Sensitive cancelled details",
        "END:VEVENT",
        "END:VCALENDAR"
      ].join("\r\n"),
      options
    );

    expect(result.events).toEqual([]);
    expect(result.cancelledOccurrences).toEqual([
      {
        uid: "recurring-cancelled",
        occurrenceId: "2026-10-26T09:00:00-07:00"
      }
    ]);
    expect(JSON.stringify(result)).not.toContain("Sensitive");
  });

  test("skips an isolated malformed standalone event with content-free diagnostics", () => {
    const result = normalizeICalendarFeed(
      [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Example//Calendar//EN",
        "BEGIN:VEVENT",
        "UID:valid-1",
        "DTSTAMP:20261018T120000Z",
        "DTSTART:20261020T180000Z",
        "DTEND:20261020T190000Z",
        "SUMMARY:Visible event",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:malformed-sensitive-uid",
        "DTSTAMP:20261018T120000Z",
        "SUMMARY:Sensitive malformed title",
        "DESCRIPTION:Sensitive malformed details",
        "END:VEVENT",
        "END:VCALENDAR"
      ].join("\r\n"),
      options
    );

    expect(result.events.map((event) => event.uid)).toEqual(["valid-1"]);
    expect(result.skippedEventCount).toBe(1);
    expect(result.skipReasons).toEqual([{ reason: "invalid-event", count: 1 }]);
    expect(JSON.stringify(result)).not.toMatch(/malformed-sensitive|Sensitive/u);
  });

  test("does not guess an undefined TZID offset", () => {
    const result = normalizeICalendarFeed(
      [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Example//Calendar//EN",
        "BEGIN:VEVENT",
        "UID:undefined-zone",
        "DTSTAMP:20261018T120000Z",
        "DTSTART;TZID=Mars/Base:20261020T090000",
        "DTEND;TZID=Mars/Base:20261020T100000",
        "SUMMARY:Unknown zone",
        "END:VEVENT",
        "END:VCALENDAR"
      ].join("\r\n"),
      options
    );

    expect(result).toEqual({
      events: [],
      skippedEventCount: 1,
      skipReasons: [{ reason: "invalid-event", count: 1 }]
    });
  });

  test("rejects malformed recurrence data rather than publishing a corrupt series", () => {
    const document = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Example//Calendar//EN",
      "BEGIN:VEVENT",
      "UID:broken-series",
      "DTSTAMP:20261018T120000Z",
      "SUMMARY:Sensitive recurring title",
      "RRULE:FREQ=WEEKLY;COUNT=4",
      "END:VEVENT",
      "END:VCALENDAR"
    ].join("\r\n");

    expect(() => normalizeICalendarFeed(document, options)).toThrowError(
      expect.objectContaining<Partial<CalendarFeedNormalizationError>>({
        name: "CalendarFeedNormalizationError",
        code: "unsafe-malformed-event",
        message: "Unsafe malformed event"
      })
    );
  });
});
