import { describe, expect, test } from "vitest";
import {
  normalizeCalendarEvents,
  selectDailyBriefEvents,
  type CalendarSourceEvent
} from "../src/calendar";

const base = {
  accountId: "mom",
  ownerLabel: "Mom",
  calendarId: "family",
  calendarSelected: true,
  responseStatus: "accepted" as const,
  visibility: "default" as const,
  end: "2026-10-07T18:00:00-07:00",
  allDay: false
};

function event(
  values: Partial<CalendarSourceEvent> & Pick<CalendarSourceEvent, "title" | "start">
): CalendarSourceEvent {
  return { ...base, ...values };
}

describe("Calendar normalization", () => {
  test("keeps only selected accepted or tentative events and stores display-safe fields", () => {
    const events = normalizeCalendarEvents(
      [
        event({
          title: "Dentist with parent@example.com",
          start: "2026-10-07T17:00:00-07:00",
          location: "123 Main Street, San Jose, CA 95112",
          iCalUid: "public",
          description: "medical details",
          attendees: ["child@example.com"],
          organizerEmail: "parent@example.com",
          meetingUrl: "https://meet.google.com/secret"
        }),
        event({
          title: "Maybe soccer",
          start: "2026-10-07T19:00:00-07:00",
          end: "2026-10-07T20:00:00-07:00",
          responseStatus: "tentative",
          iCalUid: "tentative"
        }),
        event({
          title: "Declined",
          start: "2026-10-07T20:00:00-07:00",
          responseStatus: "declined",
          iCalUid: "declined"
        }),
        event({
          title: "Unselected",
          start: "2026-10-07T21:00:00-07:00",
          calendarSelected: false,
          iCalUid: "unselected"
        })
      ],
      {
        now: new Date("2026-10-07T16:00:00-07:00"),
        timezone: "America/Los_Angeles",
        days: 3
      }
    );

    expect(events).toEqual([
      {
        occurrenceId: "occ-cc909380|2026-10-08T00:00:00.000Z",
        title: "Dentist with",
        start: "2026-10-08T00:00:00.000Z",
        end: "2026-10-08T01:00:00.000Z",
        allDay: false,
        tentative: false,
        private: false,
        ownerLabels: ["Mom"],
        location: "123 Main Street"
      },
      {
        occurrenceId: "occ-251a4509|2026-10-08T02:00:00.000Z",
        title: "Maybe soccer",
        start: "2026-10-08T02:00:00.000Z",
        end: "2026-10-08T03:00:00.000Z",
        allDay: false,
        tentative: true,
        private: false,
        ownerLabels: ["Mom"]
      }
    ]);
    expect(JSON.stringify(events)).not.toMatch(
      /description|attendees|organizer|meeting|@|example\.com/
    );
  });

  test("renders private events as Busy and deduplicates matching occurrences across owners", () => {
    const duplicate = event({
      title: "Secret appointment",
      start: "2026-10-08T10:00:00-07:00",
      end: "2026-10-08T11:00:00-07:00",
      visibility: "private",
      iCalUid: "shared"
    });
    const events = normalizeCalendarEvents(
      [
        duplicate,
        { ...duplicate, accountId: "dad", ownerLabel: "Dad" }
      ],
      {
        now: new Date("2026-10-07T08:00:00-07:00"),
        timezone: "America/Los_Angeles",
        days: 3
      }
    );

    expect(events).toEqual([
      expect.objectContaining({
        title: "Busy",
        private: true,
        ownerLabels: ["Dad", "Mom"]
      })
    ]);
  });

  test("orders useful all-day events before timed events and excludes ended and out-of-window events", () => {
    const events = normalizeCalendarEvents(
      [
        event({
          title: "Timed",
          start: "2026-10-08T09:00:00-07:00",
          end: "2026-10-08T10:00:00-07:00",
          iCalUid: "timed"
        }),
        event({
          title: "School holiday",
          start: "2026-10-08",
          end: "2026-10-09",
          allDay: true,
          iCalUid: "all-day"
        }),
        event({
          title: "Already ended",
          start: "2026-10-07T07:00:00-07:00",
          end: "2026-10-07T08:00:00-07:00",
          iCalUid: "ended"
        }),
        event({
          title: "Too late",
          start: "2026-10-10T09:00:00-07:00",
          end: "2026-10-10T10:00:00-07:00",
          iCalUid: "late"
        })
      ],
      {
        now: new Date("2026-10-07T08:30:00-07:00"),
        timezone: "America/Los_Angeles",
        days: 3
      }
    );

    expect(events.map(({ title }) => title)).toEqual([
      "School holiday",
      "Timed"
    ]);
  });

  test("Daily Brief returns only the next three relevant occurrences", () => {
    const events = normalizeCalendarEvents(
      ["09", "10", "11", "12"].map((hour, index) =>
        event({
          title: `Event ${index + 1}`,
          start: `2026-10-08T${hour}:00:00-07:00`,
          end: `2026-10-08T${hour}:30:00-07:00`,
          iCalUid: `event-${index + 1}`
        })
      ),
      {
        now: new Date("2026-10-07T08:00:00-07:00"),
        timezone: "America/Los_Angeles",
        days: 3
      }
    );

    expect(selectDailyBriefEvents(events).map(({ title }) => title)).toEqual([
      "Event 1",
      "Event 2",
      "Event 3"
    ]);
  });
});
