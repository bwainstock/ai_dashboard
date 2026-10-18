import ICAL from "ical.js";
import type {
  CalendarFeedNormalizationResult,
  NormalizedCalendarFeedEvent
} from "./ical-normalization";

const MAX_RULE_ITERATIONS = 10_000;

export interface CalendarFeedDashboardWindow {
  now: Date;
  timezone: string;
  days: number;
}

export interface ExpandedCalendarFeedEvent
  extends Omit<
    NormalizedCalendarFeedEvent,
    "calendarLabel" | "householdLabel" | "recurrence"
  > {
  calendarLabels: string[];
  householdLabels: string[];
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
  return new Date(Date.UTC(year, month - 1, day + days))
    .toISOString()
    .slice(0, 10);
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
  if (!match) throw new RangeError(`Unsupported recurrence timezone: ${timezone}`);
  const direction = match[1] === "+" ? 1 : -1;
  return direction * (Number(match[2]) * 60 + Number(match[3])) * 60_000;
}

function wallTimeToDate(time: ICAL.Time, timezone: string): Date {
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

function occurrenceValue(
  time: ICAL.Time,
  sourceTimezone: string,
  dashboardTimezone: string,
  sourceZone?: ICAL.Timezone
): string {
  if (time.isDate) {
    return [
      time.year.toString().padStart(4, "0"),
      time.month.toString().padStart(2, "0"),
      time.day.toString().padStart(2, "0")
    ].join("-");
  }
  const instant =
    sourceTimezone === "UTC" || sourceTimezone === "GMT"
      ? time.toJSDate()
      : sourceZone
        ? (() => {
            const zoned = time.clone();
            zoned.zone = sourceZone;
            return zoned.toJSDate();
          })()
      : wallTimeToDate(time, sourceTimezone);
  return zonedDateTime(instant, dashboardTimezone);
}

function occurrenceEnd(
  event: NormalizedCalendarFeedEvent,
  occurrenceId: string,
  dashboardTimezone: string
): string {
  if (event.allDay) {
    const duration =
      (Date.parse(`${event.end}T00:00:00Z`) -
        Date.parse(`${event.start}T00:00:00Z`)) /
      86_400_000;
    return addDays(occurrenceId, duration);
  }
  const duration = Date.parse(event.end) - Date.parse(event.start);
  return zonedDateTime(
    new Date(Date.parse(occurrenceId) + duration),
    dashboardTimezone
  );
}

function expandMaster(
  event: NormalizedCalendarFeedEvent,
  window: CalendarFeedDashboardWindow
): NormalizedCalendarFeedEvent[] {
  const recurrence = event.recurrence;
  if (!recurrence || recurrence.recurrenceId) return [event];
  const occurrenceIds = new Set<string>([event.occurrenceId, ...(recurrence.dates ?? [])]);
  if (recurrence.rule) {
    const start = recurrence.sourceStart.includes("T")
      ? ICAL.Time.fromDateTimeString(recurrence.sourceStart)
      : ICAL.Time.fromDateString(recurrence.sourceStart);
    const rule = ICAL.Recur.fromString(recurrence.rule);
    const sourceZone = recurrence.sourceTimezoneDefinition
      ? ICAL.Timezone.fromData({
          component: new ICAL.Component(recurrence.sourceTimezoneDefinition),
          tzid: recurrence.sourceTimezone
        })
      : undefined;
    const secondsByFrequency: Partial<Record<string, number>> = {
      SECONDLY: 1,
      MINUTELY: 60,
      HOURLY: 3_600,
      DAILY: 86_400,
      WEEKLY: 604_800
    };
    const frequencySeconds = rule.freq
      ? secondsByFrequency[rule.freq]
      : undefined;
    const approximateIterations =
      frequencySeconds && Date.parse(event.start) < window.now.getTime()
        ? (window.now.getTime() - Date.parse(event.start)) /
          (frequencySeconds * rule.interval * 1_000)
        : 0;
    if (
      approximateIterations > MAX_RULE_ITERATIONS &&
      (!rule.count || rule.count > MAX_RULE_ITERATIONS)
    ) {
      throw new Error("Recurrence expansion exceeded the fixed work limit");
    }
    const iterator = rule.iterator(start);
    const dayAfterWindow = addDays(
      localDate(window.now, window.timezone),
      window.days
    );
    let completed = false;
    for (let count = 0; count < MAX_RULE_ITERATIONS; count += 1) {
      const next = iterator.next();
      if (!next) {
        completed = true;
        break;
      }
      const occurrenceId = occurrenceValue(
        next,
        recurrence.sourceTimezone,
        window.timezone,
        sourceZone
      );
      const occurrenceDay = next.isDate
        ? occurrenceId
        : localDate(new Date(occurrenceId), window.timezone);
      if (occurrenceDay >= dayAfterWindow) {
        completed = true;
        break;
      }
      occurrenceIds.add(occurrenceId);
    }
    if (!completed) {
      throw new Error("Recurrence expansion exceeded the fixed work limit");
    }
  }
  for (const excluded of recurrence.excludedDates ?? []) {
    occurrenceIds.delete(excluded);
  }
  return [...occurrenceIds].map((occurrenceId) => ({
    ...event,
    occurrenceId,
    start: occurrenceId,
    end: occurrenceEnd(event, occurrenceId, window.timezone)
  }));
}

function inWindow(
  event: NormalizedCalendarFeedEvent,
  window: CalendarFeedDashboardWindow
): boolean {
  const firstDay = localDate(window.now, window.timezone);
  const dayAfterWindow = addDays(firstDay, window.days);
  const day = event.allDay
    ? event.start.slice(0, 10)
    : localDate(new Date(event.start), window.timezone);
  return (
    day >= firstDay &&
    day < dayAfterWindow &&
    (event.allDay || new Date(event.end) > window.now)
  );
}

function normalizedUid(uid: string): string {
  return uid.trim().normalize("NFC");
}

function appendDistinct(values: string[], value: string | null): void {
  if (value && !values.includes(value)) values.push(value);
}

function expandedEvent(
  event: NormalizedCalendarFeedEvent,
  calendarLabels: string[],
  householdLabels: string[]
): ExpandedCalendarFeedEvent {
  return {
    uid: event.uid,
    occurrenceId: event.occurrenceId,
    summary: event.summary,
    start: event.start,
    end: event.end,
    allDay: event.allDay,
    ...(event.location ? { location: event.location } : {}),
    status: event.status,
    calendarLabels,
    householdLabels
  };
}

export function expandAndMergeCalendarFeedEvents(
  feeds: CalendarFeedNormalizationResult[],
  window: CalendarFeedDashboardWindow
): ExpandedCalendarFeedEvent[] {
  const cancelled = new Set(
    feeds.flatMap((feed) =>
      (feed.cancelledOccurrences ?? []).map(
        ({ uid, occurrenceId }) => `${normalizedUid(uid)}|${occurrenceId}`
      )
    )
  );
  const merged = new Map<
    string,
    { event: ExpandedCalendarFeedEvent; explicitOverride: boolean }
  >();

  for (const feed of feeds) {
    const overrides = new Map(
      feed.events
        .filter((event) => event.recurrence?.recurrenceId)
        .map((event) => [
          `${normalizedUid(event.uid)}|${event.occurrenceId}`,
          event
        ])
    );
    const candidates = feed.events.flatMap((event) =>
      event.recurrence?.recurrenceId
        ? []
        : expandMaster(event, window).map((occurrence) => {
            const key = `${normalizedUid(occurrence.uid)}|${occurrence.occurrenceId}`;
            const override = overrides.get(key);
            return {
              event: override ?? occurrence,
              explicitOverride: Boolean(override)
            };
          })
    );
    for (const override of overrides.values()) {
      if (
        !candidates.some(
          ({ event }) =>
            normalizedUid(event.uid) === normalizedUid(override.uid) &&
            event.occurrenceId === override.occurrenceId
        )
      ) {
        candidates.push({ event: override, explicitOverride: true });
      }
    }

    for (const { event, explicitOverride } of candidates) {
      const key = `${normalizedUid(event.uid)}|${event.occurrenceId}`;
      if (cancelled.has(key) || !inWindow(event, window)) continue;
      const existing = merged.get(key);
      if (existing) {
        if (explicitOverride && !existing.explicitOverride) {
          const calendarLabels = [...existing.event.calendarLabels];
          const householdLabels = [...existing.event.householdLabels];
          appendDistinct(calendarLabels, event.calendarLabel);
          appendDistinct(householdLabels, event.householdLabel);
          merged.set(key, {
            event: expandedEvent(event, calendarLabels, householdLabels),
            explicitOverride: true
          });
        } else {
          appendDistinct(existing.event.calendarLabels, event.calendarLabel);
          appendDistinct(existing.event.householdLabels, event.householdLabel);
        }
        continue;
      }
      merged.set(key, {
        event: expandedEvent(
          event,
          [event.calendarLabel],
          event.householdLabel ? [event.householdLabel] : []
        ),
        explicitOverride
      });
    }
  }

  return [...merged.values()].map(({ event }) => event).sort(
    (left, right) =>
      left.start.localeCompare(right.start) ||
      left.summary.localeCompare(right.summary) ||
      left.occurrenceId.localeCompare(right.occurrenceId)
  );
}
