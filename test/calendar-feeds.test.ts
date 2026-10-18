import { describe, expect, test } from "vitest";
import {
  decryptCalendarFeedUrl,
  encryptCalendarFeedUrl,
  normalizeCalendarFeedInput,
  normalizeCalendarFeedUpdate
} from "../src/calendar-feeds";

describe("Calendar Feed management", () => {
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
});
