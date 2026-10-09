import { expect, test, vi } from "vitest";
import {
  fetchGoogleCalendarEvents,
  listGoogleCalendars
} from "../src/google-calendar";

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

test("calendar discovery returns every page up to the twenty-page account cap", async () => {
  const request = vi.fn(async (input: URL | RequestInfo) => {
    const page = Number(
      new URL(String(input)).searchParams.get("pageToken") ?? "0"
    );
    return Response.json({
      items: [{ id: `calendar-${page}`, summary: `Calendar ${page}` }],
      ...(page < 19 ? { nextPageToken: String(page + 1) } : {})
    });
  });

  await expect(listGoogleCalendars("access-token", request)).resolves.toHaveLength(
    20
  );
  expect(request).toHaveBeenCalledTimes(20);
  expect(
    new URL(String(request.mock.calls[19][0])).searchParams.get("pageToken")
  ).toBe("19");
});

test("calendar discovery sanitizes provider names only as editable label prefills", async () => {
  const request = vi.fn().mockResolvedValue(
    Response.json({
      items: [{ id: "school", summary: "  School 📅 / person@example.com  " }]
    })
  );

  await expect(listGoogleCalendars("access-token", request)).resolves.toEqual([
    { id: "school", label: "School person example.com" }
  ]);
});

test("calendar discovery fails without publishing a partial list beyond twenty pages", async () => {
  const request = vi.fn(async () =>
    Response.json({
      items: [{ id: "calendar", summary: "Calendar" }],
      nextPageToken: "more"
    })
  );

  await expect(listGoogleCalendars("access-token", request)).rejects.toMatchObject({
    code: "CALENDAR_DISCOVERY_PAGE_LIMIT"
  });
  expect(request).toHaveBeenCalledTimes(20);
});

test("event retrieval shares a one-hundred-page budget across calendar requests", async () => {
  const pageBudget = { remaining: 100 };
  let page = 0;
  const request = vi.fn(async () => {
    page += 1;
    return Response.json({
      items: [],
      ...(page < 101 ? { nextPageToken: String(page) } : {})
    });
  });

  await expect(
    fetchGoogleCalendarEvents(
      {
        accessToken: "access-token",
        accountId: "mom",
        ownerLabel: "Mom",
        calendarIds: ["one"],
        timeMin: "2026-10-07T15:00:00.000Z",
        timeMax: "2026-10-10T15:00:00.000Z",
        pageBudget
      },
      request
    )
  ).rejects.toMatchObject({ code: "CALENDAR_PAGE_BUDGET_EXCEEDED" });
  expect(request).toHaveBeenCalledTimes(100);
  expect(pageBudget.remaining).toBe(0);
});
