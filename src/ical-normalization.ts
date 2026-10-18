import ICAL from "ical.js";

export interface CalendarFeedNormalizationOptions {
  timezone: string;
  calendarLabel: string;
  householdLabel: string | null;
}

export interface NormalizedCalendarFeedEvent {
  uid: string;
  occurrenceId: string;
  summary: string;
  start: string;
  end: string;
  allDay: boolean;
  location?: string;
  status: "confirmed" | "tentative";
  calendarLabel: string;
  householdLabel: string | null;
  recurrence?: {
    rule?: string;
    dates?: string[];
    excludedDates?: string[];
    recurrenceId?: string;
    sourceTimezone: string;
  };
}

export interface CalendarFeedNormalizationResult {
  events: NormalizedCalendarFeedEvent[];
  cancelledOccurrences?: Array<{ uid: string; occurrenceId: string }>;
  skippedEventCount: number;
  skipReasons: Array<{ reason: string; count: number }>;
}

export class CalendarFeedNormalizationError extends Error {
  readonly code: "invalid-calendar" | "unsafe-malformed-event";

  constructor(code: "invalid-calendar" | "unsafe-malformed-event") {
    super(code === "invalid-calendar" ? "Invalid iCalendar document" : "Unsafe malformed event");
    this.name = "CalendarFeedNormalizationError";
    this.code = code;
  }
}

function displaySafe(value: string): string {
  return value
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, "")
    .replace(/https?:\/\/\S+/giu, "")
    .replace(/\s{2,}/gu, " ")
    .trim();
}

function shortLocation(value: string | null): string | undefined {
  if (!value) return undefined;
  const location = displaySafe(value).split(",")[0]?.trim();
  return location || undefined;
}

function stringProperty(
  component: ICAL.Component,
  name: string
): string | null {
  const value = component.getFirstPropertyValue(name);
  return typeof value === "string" ? value : null;
}

function dateValue(time: ICAL.Time): string {
  return [
    time.year.toString().padStart(4, "0"),
    time.month.toString().padStart(2, "0"),
    time.day.toString().padStart(2, "0")
  ].join("-");
}

function zonedDateTime(value: Date, timezone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
      timeZoneName: "longOffset"
    })
      .formatToParts(value)
      .map((part) => [part.type, part.value])
  );
  const offset =
    parts.timeZoneName === "GMT" ? "+00:00" : parts.timeZoneName.slice(3);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${offset}`;
}

function timezoneOffsetMilliseconds(value: Date, timezone: string): number {
  const name = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    timeZoneName: "longOffset"
  })
    .formatToParts(value)
    .find((part) => part.type === "timeZoneName")?.value;
  if (!name || name === "GMT") return 0;
  const match = name.match(/^GMT([+-])(\d{2}):(\d{2})$/u);
  if (!match) throw new RangeError(`Unsupported dashboard timezone: ${timezone}`);
  const direction = match[1] === "+" ? 1 : -1;
  return direction * (Number(match[2]) * 60 + Number(match[3])) * 60_000;
}

function floatingTimeToDate(time: ICAL.Time, timezone: string): Date {
  const wallTime = Date.UTC(
    time.year,
    time.month - 1,
    time.day,
    time.hour,
    time.minute,
    time.second
  );
  let instant = wallTime - timezoneOffsetMilliseconds(new Date(wallTime), timezone);
  instant = wallTime - timezoneOffsetMilliseconds(new Date(instant), timezone);
  return new Date(instant);
}

function timeToDate(time: ICAL.Time, timezone: string): Date {
  return time.zone.tzid === "floating"
    ? floatingTimeToDate(time, timezone)
    : time.toJSDate();
}

function timedValue(time: ICAL.Time, timezone: string): string {
  return zonedDateTime(timeToDate(time, timezone), timezone);
}

function normalizedTime(time: ICAL.Time, timezone: string): string {
  return time.isDate ? dateValue(time) : timedValue(time, timezone);
}

function recurrenceTimes(
  component: ICAL.Component,
  propertyName: "rdate" | "exdate",
  timezone: string
): string[] {
  return component
    .getAllProperties(propertyName)
    .flatMap((property) => property.getValues())
    .map((value) => {
      if (!(value instanceof ICAL.Time)) {
        throw new CalendarFeedNormalizationError("unsafe-malformed-event");
      }
      return normalizedTime(value, timezone);
    });
}

function normalizedRecurrence(
  component: ICAL.Component,
  start: ICAL.Time,
  timezone: string
): NormalizedCalendarFeedEvent["recurrence"] {
  const ruleValue = component.getFirstProperty("rrule")?.getFirstValue();
  const dates = recurrenceTimes(component, "rdate", timezone);
  const excludedDates = recurrenceTimes(component, "exdate", timezone);
  const recurrenceId = component.getFirstPropertyValue("recurrence-id");
  if (
    !ruleValue &&
    dates.length === 0 &&
    excludedDates.length === 0 &&
    !recurrenceId
  ) {
    return undefined;
  }
  if (
    recurrenceId !== null &&
    recurrenceId !== undefined &&
    !(recurrenceId instanceof ICAL.Time)
  ) {
    throw new CalendarFeedNormalizationError("unsafe-malformed-event");
  }
  return {
    ...(ruleValue ? { rule: ruleValue.toString() } : {}),
    ...(dates.length ? { dates } : {}),
    ...(excludedDates.length ? { excludedDates } : {}),
    ...(recurrenceId
      ? { recurrenceId: normalizedTime(recurrenceId, timezone) }
      : {}),
    sourceTimezone:
      start.zone.tzid === "floating" ? timezone : start.zone.tzid
  };
}

function assertKnownTimezones(component: ICAL.Component): void {
  for (const name of ["dtstart", "dtend", "recurrence-id", "rdate", "exdate"]) {
    for (const property of component.getAllProperties(name)) {
      const tzid = property.getFirstParameter("tzid");
      if (
        tzid &&
        tzid.toUpperCase() !== "UTC" &&
        tzid.toUpperCase() !== "GMT" &&
        !component.parent.getTimeZoneByID(tzid)
      ) {
        throw new Error("invalid event");
      }
    }
  }
}

function normalizeEventComponent(
  component: ICAL.Component,
  options: CalendarFeedNormalizationOptions
): NormalizedCalendarFeedEvent {
  if (
    component.getAllProperties("uid").length !== 1 ||
    component.getAllProperties("dtstart").length !== 1 ||
    component.getAllProperties("dtend").length > 1 ||
    component.getAllProperties("duration").length > 1 ||
    component.getAllProperties("rrule").length > 1 ||
    component.getAllProperties("recurrence-id").length > 1
  ) {
    throw new Error("invalid event");
  }
  assertKnownTimezones(component);
  const event = new ICAL.Event(component);
  const start = event.startDate;
  const end = event.endDate;
  if (!event.uid || !start || !end || start.isDate !== end.isDate) {
    throw new Error("invalid event");
  }
  const allDay = start.isDate;
  const classification = stringProperty(component, "class")?.toLowerCase() ?? "";
  const privateEvent =
    classification === "private" || classification === "confidential";
  const location = privateEvent ? undefined : shortLocation(event.location);
  const normalizedStart = normalizedTime(start, options.timezone);
  const normalizedEnd = normalizedTime(end, options.timezone);
  const endsBeforeStart = allDay
    ? normalizedEnd < normalizedStart
    : timeToDate(end, options.timezone) < timeToDate(start, options.timezone);
  if (endsBeforeStart) throw new Error("invalid event");
  const recurrence = normalizedRecurrence(component, start, options.timezone);
  const summary = typeof event.summary === "string" ? event.summary : "";

  return {
    uid: event.uid,
    occurrenceId: recurrence?.recurrenceId ?? normalizedStart,
    summary: privateEvent ? "Busy" : displaySafe(summary) || "Busy",
    start: normalizedStart,
    end: normalizedEnd,
    allDay,
    ...(location ? { location } : {}),
    status:
      stringProperty(component, "status")?.toLowerCase() === "tentative"
        ? "tentative"
        : "confirmed",
    calendarLabel: options.calendarLabel,
    householdLabel: options.householdLabel,
    ...(recurrence ? { recurrence } : {})
  };
}

function safeToSkip(component: ICAL.Component, uidCounts: Map<string, number>) {
  const uid = stringProperty(component, "uid");
  return (
    Boolean(uid) &&
    uidCounts.get(uid!) === 1 &&
    !["rrule", "rdate", "exdate", "recurrence-id"].some((name) =>
      component.hasProperty(name)
    )
  );
}

export function normalizeICalendarFeed(
  document: string,
  options: CalendarFeedNormalizationOptions
): CalendarFeedNormalizationResult {
  let calendar: ICAL.Component;
  try {
    calendar = new ICAL.Component(ICAL.parse(document));
  } catch {
    throw new CalendarFeedNormalizationError("invalid-calendar");
  }
  if (
    calendar.name !== "vcalendar" ||
    calendar.getAllProperties("version").length !== 1 ||
    stringProperty(calendar, "version") !== "2.0" ||
    calendar.getAllProperties("prodid").length !== 1 ||
    !stringProperty(calendar, "prodid")?.trim()
  ) {
    throw new CalendarFeedNormalizationError("invalid-calendar");
  }
  const components = calendar.getAllSubcomponents("vevent");
  const uidCounts = new Map<string, number>();
  for (const component of components) {
    const uid = stringProperty(component, "uid");
    if (uid) uidCounts.set(uid, (uidCounts.get(uid) ?? 0) + 1);
  }
  const cancelledOccurrences = components.flatMap((component) => {
    if (
      stringProperty(component, "status")?.toLowerCase() !== "cancelled"
    ) {
      return [];
    }
    const recurrenceId = component.getFirstPropertyValue("recurrence-id");
    if (!recurrenceId) return [];
    const uid = stringProperty(component, "uid");
    try {
      assertKnownTimezones(component);
    } catch {
      throw new CalendarFeedNormalizationError("unsafe-malformed-event");
    }
    if (!uid || !(recurrenceId instanceof ICAL.Time)) {
      throw new CalendarFeedNormalizationError("unsafe-malformed-event");
    }
    return [
      {
        uid,
        occurrenceId: normalizedTime(recurrenceId, options.timezone)
      }
    ];
  });
  const events: NormalizedCalendarFeedEvent[] = [];
  let skippedEventCount = 0;
  for (const component of components) {
    if (
      stringProperty(component, "status")?.toLowerCase() === "cancelled"
    ) {
      continue;
    }
    try {
      events.push(normalizeEventComponent(component, options));
    } catch (error) {
      if (
        error instanceof CalendarFeedNormalizationError ||
        !safeToSkip(component, uidCounts)
      ) {
        throw new CalendarFeedNormalizationError("unsafe-malformed-event");
      }
      skippedEventCount += 1;
    }
  }

  return {
    events,
    ...(cancelledOccurrences.length ? { cancelledOccurrences } : {}),
    skippedEventCount,
    skipReasons: skippedEventCount
      ? [{ reason: "invalid-event", count: skippedEventCount }]
      : []
  };
}
