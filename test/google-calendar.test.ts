import { expect, test, vi } from "vitest";
import { fetchGoogleCalendarEvents } from "../src/google-calendar";

test("Google Calendar adapter requests selected calendars read-only and drops raw payload fields", async () => {
  const request = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        items: [
          {
            summary: "Practice",
            description: "do not retain",
            location: "Community Center, San Jose",
            iCalUID: "practice@example.google.com",
            visibility: "default",
            start: { dateTime: "2026-10-08T17:00:00-07:00" },
            end: { dateTime: "2026-10-08T18:00:00-07:00" },
            attendees: [
              { email: "mom@example.com", self: true, responseStatus: "accepted" }
            ],
            organizer: { email: "coach@example.com" },
            conferenceData: { entryPoints: [{ uri: "https://meet.google.com/x" }] }
          }
        ]
      }),
      { headers: { "content-type": "application/json" } }
    )
  );

  const events = await fetchGoogleCalendarEvents(
    {
      accessToken: "access-token",
      accountId: "mom",
      ownerLabel: "Mom",
      calendarIds: ["family/calendar"],
      timeMin: "2026-10-07T15:00:00.000Z",
      timeMax: "2026-10-10T15:00:00.000Z"
    },
    request
  );

  expect(request).toHaveBeenCalledOnce();
  const url = new URL(request.mock.calls[0][0]);
  expect(decodeURIComponent(url.pathname)).toContain("family/calendar/events");
  expect(url.searchParams.get("singleEvents")).toBe("true");
  expect(events).toEqual([
    {
      accountId: "mom",
      ownerLabel: "Mom",
      calendarId: "family/calendar",
      calendarSelected: true,
      title: "Practice",
      start: "2026-10-08T17:00:00-07:00",
      end: "2026-10-08T18:00:00-07:00",
      allDay: false,
      responseStatus: "accepted",
      visibility: "default",
      iCalUid: "practice@example.google.com",
      location: "Community Center, San Jose"
    }
  ]);
  expect(JSON.stringify(events)).not.toMatch(
    /description|attendees|organizer|conference|mom@example|coach@example|meet\.google/
  );
});
