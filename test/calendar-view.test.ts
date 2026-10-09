import { describe, expect, test } from "vitest";
import { calendarViewHtml } from "../src/calendar-view";
import type { CalendarEvent } from "../src/calendar";

function event(
  title: string,
  start: string,
  values: Partial<CalendarEvent> = {}
): CalendarEvent {
  return {
    occurrenceId: `${title}|${start}`,
    title,
    start,
    end: start,
    allDay: false,
    tentative: false,
    private: false,
    ownerLabels: ["Mom"],
    ...values
  };
}

describe("Calendar View", () => {
  test("groups three local days with all-day events first and compact times", () => {
    const html = calendarViewHtml({
      calendar: [
        event("Morning practice", "2026-10-07T16:00:00.000Z", {
          location: "School gym"
        }),
        event("School holiday", "2026-10-07", { allDay: true }),
        event("Piano", "2026-10-08T19:30:00.000Z"),
        event("Family dinner", "2026-10-09T01:00:00.000Z")
      ],
      timezone: "America/Los_Angeles",
      updatedAt: "2026-10-07T17:30:00.000Z"
    });

    expect(html).toContain("Today");
    expect(html).toContain('aria-label="Calendar icon"');
    expect(html).toContain("Tomorrow");
    expect(html).toContain("Friday");
    expect(html.indexOf("School holiday")).toBeLessThan(
      html.indexOf("Morning practice")
    );
    expect(html).toContain("All day");
    expect(html).toContain("9 AM");
    expect(html).toContain("12:30 PM");
    expect(html).toContain("6 PM");
    expect(html).toContain("School gym");
    expect(html).not.toContain("9:00 AM");
  });

  test("renders readable missing-day states", () => {
    const html = calendarViewHtml({
      calendar: [],
      timezone: "America/Los_Angeles",
      updatedAt: "2026-10-07T17:30:00.000Z"
    });

    expect(html).toContain('data-missing-state>No events');
  });

  test("distinguishes an unavailable source from an empty valid calendar", () => {
    const html = calendarViewHtml({
      calendar: [],
      timezone: "America/Los_Angeles",
      unavailable: true,
      updatedAt: "2026-10-07T17:30:00.000Z"
    });

    expect(html).toContain("Calendar unavailable");
    expect(html).not.toContain(">No events<");
  });

  test("shows twelve events and reports overflow without leaking unsafe fields", () => {
    const calendar = Array.from({ length: 14 }, (_, index) =>
      event(
        `Event ${index + 1}${index === 0 ? " parent@example.com" : ""}`,
        `2026-10-07T${String(15 + Math.floor(index / 2)).padStart(2, "0")}:${index % 2 ? "30" : "00"}:00.000Z`,
        index === 0
          ? {
              title: "Busy",
              private: true,
              location: undefined
            }
          : {}
      )
    );

    const html = calendarViewHtml({
      calendar,
      timezone: "America/Los_Angeles",
      updatedAt: "2026-10-07T17:30:00.000Z"
    });

    expect(html).toContain("+2 more");
    expect(html).toContain("Event 12");
    expect(html).not.toContain("Event 13");
    expect(html).not.toContain("Event 14");
    expect(html).not.toMatch(/@|description|attendee|organizer|https?:\/\//i);
  });
});
