import type {
  CalendarResponseStatus,
  CalendarSourceEvent
} from "./calendar";

type Fetch = typeof fetch;

interface GoogleEvent {
  summary?: string;
  location?: string;
  iCalUID?: string;
  recurringEventId?: string;
  visibility?: "default" | "public" | "private" | "confidential";
  status?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
  attendees?: Array<{
    self?: boolean;
    responseStatus?: CalendarResponseStatus;
  }>;
}

interface GoogleEventsPage {
  items?: GoogleEvent[];
  nextPageToken?: string;
}

export interface GoogleCalendarFetchInput {
  accessToken: string;
  accountId: string;
  ownerLabel: string;
  calendarIds: string[];
  timeMin: string;
  timeMax: string;
}

function responseStatus(event: GoogleEvent): CalendarResponseStatus {
  return (
    event.attendees?.find(({ self }) => self)?.responseStatus ?? "accepted"
  );
}

export async function fetchGoogleCalendarEvents(
  input: GoogleCalendarFetchInput,
  request: Fetch = fetch
): Promise<CalendarSourceEvent[]> {
  const normalized: CalendarSourceEvent[] = [];
  for (const calendarId of input.calendarIds) {
    let pageToken: string | undefined;
    do {
      const url = new URL(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`
      );
      url.search = new URLSearchParams({
        timeMin: input.timeMin,
        timeMax: input.timeMax,
        singleEvents: "true",
        orderBy: "startTime",
        maxResults: "250",
        fields:
          "items(summary,location,iCalUID,recurringEventId,visibility,status,start,end,attendees(self,responseStatus)),nextPageToken",
        ...(pageToken ? { pageToken } : {})
      }).toString();
      const response = await request(url.toString(), {
        headers: { Authorization: `Bearer ${input.accessToken}` }
      });
      if (!response.ok) {
        throw Object.assign(
          new Error(`Google Calendar returned HTTP ${response.status}`),
          { code: response.status === 401 ? "CALENDAR_OAUTH_REVOKED" : "CALENDAR_UPSTREAM_HTTP" }
        );
      }
      const page = await response.json<GoogleEventsPage>();
      for (const event of page.items ?? []) {
        if (event.status === "cancelled") continue;
        const start = event.start?.dateTime ?? event.start?.date;
        const end = event.end?.dateTime ?? event.end?.date;
        if (!start || !end) continue;
        normalized.push({
          accountId: input.accountId,
          ownerLabel: input.ownerLabel,
          calendarId,
          calendarSelected: true,
          title: event.summary ?? "Busy",
          start,
          end,
          allDay: Boolean(event.start?.date),
          responseStatus: responseStatus(event),
          visibility: event.visibility ?? "default",
          ...(event.iCalUID ? { iCalUid: event.iCalUID } : {}),
          ...(event.recurringEventId
            ? { recurringEventId: event.recurringEventId }
            : {}),
          ...(event.location ? { location: event.location } : {})
        });
      }
      pageToken = page.nextPageToken;
    } while (pageToken);
  }
  return normalized;
}

export async function exchangeCalendarAuthorizationCode(
  input: {
    clientId: string;
    clientSecret: string;
    code: string;
    redirectUri: string;
  },
  request: Fetch = fetch
): Promise<{ refreshToken: string; accessToken: string; expiresIn: number }> {
  const response = await request("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      code: input.code,
      redirect_uri: input.redirectUri,
      grant_type: "authorization_code"
    })
  });
  const result = await response.json<{
    refresh_token?: string;
    access_token?: string;
    expires_in?: number;
  }>();
  if (!response.ok || !result.refresh_token || !result.access_token) {
    throw new Error("Google Calendar authorization failed");
  }
  return {
    refreshToken: result.refresh_token,
    accessToken: result.access_token,
    expiresIn: result.expires_in ?? 3600
  };
}

export async function refreshCalendarAccessToken(
  input: { clientId: string; clientSecret: string; refreshToken: string },
  request: Fetch = fetch
): Promise<string> {
  const response = await request("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      refresh_token: input.refreshToken,
      grant_type: "refresh_token"
    })
  });
  const result = await response.json<{ access_token?: string }>();
  if (!response.ok || !result.access_token) {
    throw Object.assign(new Error("Google Calendar access was revoked"), {
      code: "CALENDAR_OAUTH_REVOKED"
    });
  }
  return result.access_token;
}

export async function listGoogleCalendars(
  accessToken: string,
  request: Fetch = fetch
): Promise<Array<{ id: string; label: string }>> {
  const response = await request(
    "https://www.googleapis.com/calendar/v3/users/me/calendarList?fields=items(id,summary,deleted)",
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!response.ok) throw new Error("Unable to list Google calendars");
  const result = await response.json<{
    items?: Array<{ id: string; summary?: string; deleted?: boolean }>;
  }>();
  return (result.items ?? [])
    .filter(({ deleted }) => !deleted)
    .map(({ id, summary }) => ({ id, label: summary ?? "Calendar" }));
}
