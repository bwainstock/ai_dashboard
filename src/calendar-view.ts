import type { CalendarEvent } from "./calendar";
import { DISPLAY_BASE_CSS } from "./display-style";

export interface CalendarViewModel {
  calendar: CalendarEvent[];
  timezone: string;
  updatedAt: string;
  weather?: {
    temperature: number;
    condition: string;
    high: number;
  };
  lunch?: {
    entrees: Array<{ name: string }>;
  };
  stale?: boolean;
  staleAgeMinutes?: number;
  unavailable?: boolean;
}

function ageLabel(minutes: number): string {
  if (minutes < 60) return `${minutes}m old`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m old`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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

function eventDate(event: CalendarEvent, timezone: string): string {
  return event.allDay
    ? event.start.slice(0, 10)
    : localDate(new Date(event.start), timezone);
}

function compactTime(event: CalendarEvent, timezone: string): string {
  if (event.allDay) return "All day";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit"
  })
    .format(new Date(event.start))
    .replace(":00", "");
}

function dayHeading(date: string, offset: number, timezone: string): string {
  if (offset === 0) return "Today";
  if (offset === 1) return "Tomorrow";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long"
  }).format(new Date(`${date}T12:00:00Z`));
}

function compactDateLabel(date: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    month: "short",
    day: "numeric"
  }).format(new Date(`${date}T12:00:00Z`));
}

function eventPattern(event: CalendarEvent): string {
  const owner = event.ownerLabels.join("|");
  let total = 0;
  for (const character of owner) total += character.charCodeAt(0);
  return ["solid", "hatch", "dots"][total % 3];
}

function eventItem(
  event: CalendarEvent,
  timezone: string,
  featured: boolean
): string {
  const location =
    event.location && !event.private
      ? `<span class="location">${escapeHtml(event.location)}</span>`
      : "";
  const owner = escapeHtml(event.ownerLabels.join(" & "));
  const tentative = event.tentative ? "Tentative · " : "";
  return `<li class="${eventPattern(event)}${featured ? " featured" : ""}">
    <span class="time">${compactTime(event, timezone)}</span>
    <strong>${escapeHtml(event.title)}</strong>
    <span class="meta">${tentative}${owner}</span>
    ${location}
  </li>`;
}

export function calendarViewHtml(model: CalendarViewModel): string {
  const firstDay = localDate(new Date(model.updatedAt), model.timezone);
  const lastDay = addDays(firstDay, 2);
  const inWindow = model.calendar.filter((event) => {
    const date = eventDate(event, model.timezone);
    return date >= firstDay && date <= lastDay;
  });
  const visible = inWindow.slice(0, 12);
  const overflow = Math.max(0, inWindow.length - visible.length);
  const days = [0, 1, 2].map((offset) => {
    const date = addDays(firstDay, offset);
    const events = visible
      .filter((event) => eventDate(event, model.timezone) === date)
      .sort((left, right) => {
        if (left.allDay !== right.allDay) return left.allDay ? -1 : 1;
        return left.start.localeCompare(right.start);
      });
    const lunch =
      offset === 0 && events.length <= 3 && model.lunch
        ? `<div class="lunch-summary"><strong>Lunch today</strong>${model.lunch.entrees
            .slice(0, 2)
            .map(({ name }) => `<span>${escapeHtml(name)}</span>`)
            .join("")}</div>`
        : "";
    return `<section>
      <h2>${dayHeading(date, offset, model.timezone)}<small>${escapeHtml(compactDateLabel(date, model.timezone))}</small></h2>
      <ul>${
        model.unavailable
          ? '<li class="empty" data-missing-state>Calendar unavailable</li>'
          : events
              .map((event, index) =>
                eventItem(event, model.timezone, offset === 0 && index === 0)
              )
              .join("") ||
            '<li class="empty" data-missing-state>No events</li>'
      }</ul>${lunch}
    </section>`;
  });
  const updatedParts = new Intl.DateTimeFormat("en-US", {
    timeZone: model.timezone,
    hour: "numeric",
    minute: "2-digit"
  }).formatToParts(new Date(model.updatedAt));
  const updatedPart = (type: Intl.DateTimeFormatPartTypes) =>
    updatedParts.find((part) => part.type === type)?.value ?? "";
  const updated = updatedParts.map((part) => part.value).join("");
  const renderedAt = new Date(model.updatedAt);
  const railWeekday = new Intl.DateTimeFormat("en-US", {
    timeZone: model.timezone,
    weekday: "short"
  }).format(renderedAt);
  const railMonth = new Intl.DateTimeFormat("en-US", {
    timeZone: model.timezone,
    month: "short"
  }).format(renderedAt);
  const railDay = new Intl.DateTimeFormat("en-US", {
    timeZone: model.timezone,
    day: "numeric"
  }).format(renderedAt);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=800,height=480,initial-scale=1">
  <style>
    ${DISPLAY_BASE_CSS}
    body { display: grid; grid-template-columns: 128px 1fr; }
    .rail { padding: 18px 13px; color: var(--paper); background: var(--ink); display: flex; flex-direction: column; }
    .rail .clock { font-size: 53px; line-height: 1; white-space: nowrap; }
    .rail .date { margin-top: 10px; font-size: 16px; font-weight: 900; line-height: 1.15; text-transform: uppercase; }
    .rail .weather { margin-top: 24px; padding-top: 14px; border-top: 2px solid var(--paper); }
    .rail .weather svg { width: 38px; height: 38px; margin-bottom: 5px; }
    .rail .weather strong { display: block; font-size: 34px; line-height: 1; }
    .rail .weather span { display: block; margin-top: 5px; font-size: 12px; font-weight: 800; line-height: 1.25; }
    .rail .updated { margin-top: auto; font-size: 12px; font-weight: 900; letter-spacing: .07em; line-height: 1.35; text-transform: uppercase; }
    .content { min-width: 0; padding: 15px 18px 12px; }
    header { display: flex; justify-content: space-between; align-items: baseline; padding-bottom: 9px; border-bottom: 4px solid var(--ink); }
    h1 { margin: 0; font-size: 35px; line-height: 1; }
    header span { font-size: 12px; font-weight: 900; letter-spacing: .09em; text-transform: uppercase; }
    main { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; height: 352px; padding-top: 11px; }
    main section { min-width: 0; padding-right: 9px; border-right: 2px solid var(--ink); overflow: hidden; }
    main section:last-child { padding-right: 0; border-right: 0; }
    h2 { display: flex; justify-content: space-between; align-items: baseline; margin: 0 0 8px; font-size: 20px; }
    h2 small { font-size: 12px; text-transform: uppercase; }
    ul { list-style: none; padding: 0; margin: 0; }
    li { position: relative; min-width: 0; height: 70px; margin-bottom: 7px; padding: 4px 7px 4px 13px; border: 2px solid var(--ink); border-radius: 10px; line-height: 1; overflow: hidden; }
    li::before { content: ""; position: absolute; inset: 0 auto 0 0; width: 6px; background: var(--ink); }
    li.hatch::before { background: repeating-linear-gradient(135deg, var(--ink) 0 2px, var(--paper) 2px 4px); border-right: 1px solid var(--ink); }
    li.dots::before { background-color: var(--paper); background-image: radial-gradient(var(--ink) 1.4px, transparent 1.4px); background-size: 5px 5px; border-right: 1px solid var(--ink); }
    li.featured { height: 88px; color: var(--paper); background: var(--ink); }
    li.featured::before { background: var(--paper); }
    .time { display: block; font-size: 12px; font-weight: 900; text-transform: uppercase; white-space: nowrap; }
    li strong { display: -webkit-box; margin-top: 1px; font-family: Georgia, "Times New Roman", serif; font-size: 18px; font-style: italic; line-height: 1; overflow: hidden; overflow-wrap: anywhere; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
    .meta, .location { display: block; margin-top: 1px; font-size: 12px; font-weight: 700; line-height: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .location::before { content: "⌖ "; }
    .empty { display: block; min-height: 58px; padding: 12px; font-size: 15px; font-weight: 900; }
    .lunch-summary { margin-top: 10px; padding-top: 8px; border-top: 3px solid var(--ink); font-size: 12px; line-height: 1.25; }
    .lunch-summary strong { display: block; margin-bottom: 3px; font-size: 13px; letter-spacing: .08em; text-transform: uppercase; }
    .lunch-summary span { display: block; }
    footer { display: flex; justify-content: space-between; border-top: 3px solid var(--ink); padding-top: 5px; font-size: 12px; font-weight: 900; text-transform: uppercase; }
    .stale { border: 2px solid var(--ink); padding: 1px 5px; }
  </style>
</head>
<body>
  <aside class="rail">
    <span class="number clock">${escapeHtml(updatedPart("hour"))}:${escapeHtml(updatedPart("minute"))}</span>
    <span class="date">${escapeHtml(updatedPart("dayPeriod"))} · ${escapeHtml(railWeekday)}<br>${escapeHtml(railMonth)} ${escapeHtml(railDay)}</span>
    <div class="weather"><svg viewBox="0 0 48 48" role="img" aria-label="Calendar icon"><rect x="6" y="9" width="36" height="33" rx="3" fill="none" stroke="currentColor" stroke-width="4"/><path d="M6 19h36M15 5v9m18-9v9" stroke="currentColor" stroke-width="4"/></svg>${
      model.weather
        ? `<strong class="number">${Math.round(model.weather.temperature)}°</strong><span>${escapeHtml(model.weather.condition)}<br>High ${Math.round(model.weather.high)}°</span>`
        : `<strong class="number">${visible.length}</strong><span>events across<br>three days</span>`
    }</div>
    <div class="updated">Family calendar<br>Updated ${updated}</div>
  </aside>
  <div class="content">
    <header><h1 class="serif">What’s happening</h1><span>Today + next 2 days</span></header>
    <main>${days.join("")}</main>
    <footer>
      <span>${
        model.stale
          ? `<span class="stale">⚠ Calendar ${ageLabel(model.staleAgeMinutes ?? 0)}</span>`
          : model.unavailable
            ? '<span class="stale">⚠ Calendar unavailable</span>'
            : "Family schedule"
      }</span>
      <span>${overflow > 0 ? `+${overflow} more` : "All visible"}</span>
    </footer>
  </div>
</body>
</html>`;
}
