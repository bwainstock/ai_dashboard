export type CalendarResponseStatus =
  | "accepted"
  | "tentative"
  | "declined"
  | "needsAction";

export interface CalendarSourceEvent {
  accountId: string;
  ownerLabel: string;
  calendarId: string;
  calendarSelected: boolean;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  responseStatus: CalendarResponseStatus;
  visibility: "default" | "public" | "private" | "confidential";
  iCalUid?: string;
  recurringEventId?: string;
  location?: string;
  description?: string;
  attendees?: string[];
  organizerEmail?: string;
  meetingUrl?: string;
}

export interface CalendarEvent {
  occurrenceId: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  tentative: boolean;
  private: boolean;
  ownerLabels: string[];
  location?: string;
}

export interface CalendarWindow {
  now: Date;
  timezone: string;
  days: number;
}

function localDate(value: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(value);
}

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day + days));
  return value.toISOString().slice(0, 10);
}

function displaySafe(value: string): string {
  return value
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function shortLocation(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const shortened = displaySafe(value).split(",")[0]?.trim();
  return shortened || undefined;
}

function normalizedInstant(value: string, allDay: boolean): string {
  return allDay ? value.slice(0, 10) : new Date(value).toISOString();
}

function occurrenceIdentity(value: string): string {
  let hash = 2_166_136_261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16_777_619);
  }
  return `occ-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function eventDate(event: CalendarSourceEvent, timezone: string): string {
  return event.allDay
    ? event.start.slice(0, 10)
    : localDate(new Date(event.start), timezone);
}

function compareEvents(left: CalendarEvent, right: CalendarEvent): number {
  const leftDay = left.start.slice(0, 10);
  const rightDay = right.start.slice(0, 10);
  if (leftDay !== rightDay) return leftDay.localeCompare(rightDay);
  if (left.allDay !== right.allDay) return left.allDay ? -1 : 1;
  return left.start.localeCompare(right.start) || left.title.localeCompare(right.title);
}

export function normalizeCalendarEvents(
  source: CalendarSourceEvent[],
  window: CalendarWindow
): CalendarEvent[] {
  const firstDay = localDate(window.now, window.timezone);
  const dayAfterWindow = addDays(firstDay, window.days);
  const deduplicated = new Map<string, CalendarEvent>();

  for (const event of source) {
    if (
      !event.calendarSelected ||
      !["accepted", "tentative"].includes(event.responseStatus)
    ) {
      continue;
    }
    const date = eventDate(event, window.timezone);
    if (date < firstDay || date >= dayAfterWindow) continue;
    if (!event.allDay && new Date(event.end) <= window.now) continue;

    const start = normalizedInstant(event.start, event.allDay);
    const identity = event.iCalUid ?? event.recurringEventId ?? `${event.calendarId}:${event.title}`;
    const deduplicationKey = `${identity}|${start}`;
    const existing = deduplicated.get(deduplicationKey);
    if (existing) {
      existing.ownerLabels = [...new Set([...existing.ownerLabels, event.ownerLabel])].sort();
      existing.tentative &&= event.responseStatus === "tentative";
      continue;
    }

    const privateEvent =
      event.visibility === "private" || event.visibility === "confidential";
    const location = privateEvent ? undefined : shortLocation(event.location);
    deduplicated.set(deduplicationKey, {
      occurrenceId: `${occurrenceIdentity(identity)}|${start}`,
      title: privateEvent ? "Busy" : displaySafe(event.title) || "Busy",
      start,
      end: normalizedInstant(event.end, event.allDay),
      allDay: event.allDay,
      tentative: event.responseStatus === "tentative",
      private: privateEvent,
      ownerLabels: [displaySafe(event.ownerLabel) || "Family"],
      ...(location ? { location } : {})
    });
  }

  return [...deduplicated.values()].sort(compareEvents);
}

export function selectDailyBriefEvents(events: CalendarEvent[]): CalendarEvent[] {
  return events.slice(0, 3);
}
