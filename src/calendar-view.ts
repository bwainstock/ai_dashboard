import type { CalendarEvent } from "./calendar";
import type { ForecastDay } from "./weather";
import { DISPLAY_BASE_CSS } from "./display-style";

export interface CalendarViewModel {
  calendar: CalendarEvent[];
  timezone: string;
  updatedAt: string;
  weather?: {
    today: ForecastDay;
    tomorrow: ForecastDay;
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
  const owner = (event.calendarLabels ?? event.ownerLabels).join("|");
  let total = 0;
  for (const character of owner) total += character.charCodeAt(0);
  return ["solid", "hatch", "dots"][total % 3];
}

function eventItem(event: CalendarEvent, timezone: string): string {
  const location =
    event.location && !event.private
      ? `<span class="location">${escapeHtml(event.location)}</span>`
      : "";
  const owner = escapeHtml(event.ownerLabels.join(" & "));
  const tentative = event.tentative ? "Tentative · " : "";
  return `<li class="${eventPattern(event)}">
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
    return `<section>
      <h2>${dayHeading(date, offset, model.timezone)}<small>${escapeHtml(compactDateLabel(date, model.timezone))}</small></h2>
      <ul>${
        model.unavailable
          ? '<li class="empty" data-missing-state>Calendar unavailable</li>'
          : events
              .map((event) => eventItem(event, model.timezone))
              .join("") ||
            '<li class="empty" data-missing-state>No events</li>'
      }</ul>
    </section>`;
  });
  const updated = new Intl.DateTimeFormat("en-US", {
    timeZone: model.timezone,
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(model.updatedAt));
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
    .rail .weekday { font-size: 31px; line-height: 1; }
    .rail .date { margin-top: 8px; font-size: 16px; font-weight: 900; line-height: 1.15; text-transform: uppercase; }
    .rail .weather { margin-top: 24px; padding-top: 14px; border-top: 2px solid var(--paper); }
    .rail .weather svg { width: 38px; height: 38px; margin-bottom: 5px; }
    .rail .weather strong { display: block; font-size: 24px; line-height: 1; }
    .rail .weather span { display: block; margin-top: 5px; font-size: 14px; font-weight: 800; line-height: 1.2; }
    .rail .tomorrow { margin-top: 18px; padding-top: 13px; border-top: 2px solid var(--paper); font-size: 14px; font-weight: 900; line-height: 1.2; text-transform: uppercase; }
    .rail .tomorrow strong { display: block; margin: 5px 0; font-size: 23px; line-height: 1; }
    .rail .updated { margin-top: auto; font-size: 14px; font-weight: 900; letter-spacing: .04em; line-height: 1.25; text-transform: uppercase; }
    .content { min-width: 0; padding: 15px 18px 12px; }
    header { display: flex; justify-content: space-between; align-items: baseline; padding-bottom: 9px; border-bottom: 4px solid var(--ink); }
    h1 { margin: 0; font-size: 35px; line-height: 1; }
    header span { font-size: 14px; font-weight: 900; letter-spacing: .06em; text-transform: uppercase; }
    main { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; height: 352px; padding-top: 11px; }
    main section { min-width: 0; padding-right: 9px; border-right: 2px solid var(--ink); overflow: hidden; }
    main section:last-child { padding-right: 0; border-right: 0; }
    h2 { display: flex; justify-content: space-between; align-items: baseline; margin: 0 0 8px; font-size: 20px; }
    h2 small { font-size: 14px; text-transform: uppercase; }
    ul { list-style: none; padding: 0; margin: 0; }
    li { position: relative; min-width: 0; height: 70px; margin-bottom: 7px; padding: 4px 7px 4px 13px; border: 2px solid var(--ink); border-radius: 10px; line-height: 1; overflow: hidden; }
    li::before { content: ""; position: absolute; inset: 0 auto 0 0; width: 6px; background: var(--ink); }
    li.hatch::before { background: repeating-linear-gradient(135deg, var(--ink) 0 2px, var(--paper) 2px 4px); border-right: 1px solid var(--ink); }
    li.dots::before { background-color: var(--paper); background-image: radial-gradient(var(--ink) 1.4px, transparent 1.4px); background-size: 5px 5px; border-right: 1px solid var(--ink); }
    .time { display: block; font-size: 14px; font-weight: 900; text-transform: uppercase; white-space: nowrap; }
    li strong { display: -webkit-box; margin-top: 1px; font-family: Arial, Helvetica, sans-serif; font-size: 18px; font-weight: 900; line-height: 1; overflow: hidden; overflow-wrap: anywhere; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
    .meta, .location { display: block; margin-top: 1px; font-size: 14px; font-weight: 700; line-height: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .location::before { content: "⌖ "; }
    .empty { display: block; min-height: 58px; padding: 12px; font-size: 15px; font-weight: 900; }
    footer { display: flex; justify-content: space-between; border-top: 3px solid var(--ink); padding-top: 5px; font-size: 14px; font-weight: 900; text-transform: uppercase; }
    .stale { border: 2px solid var(--ink); padding: 1px 5px; }
  </style>
</head>
<body>
  <aside class="rail">
    <span class="serif weekday">${escapeHtml(railWeekday)}</span>
    <span class="date">${escapeHtml(railMonth)} ${escapeHtml(railDay)}</span>
    <div class="weather"><svg viewBox="0 0 48 48" role="img" aria-label="Forecast icon"><circle cx="24" cy="24" r="10" fill="none" stroke="currentColor" stroke-width="4"/><path d="M24 3v7m0 28v7M3 24h7m28 0h7M9 9l5 5m20 20 5 5m0-30-5 5M14 34l-5 5" stroke="currentColor" stroke-width="4" stroke-linecap="round"/></svg>${
      model.weather
        ? `<strong class="number">${Math.round(model.weather.today.high)}° / ${Math.round(model.weather.today.low)}°</strong><span>Today's forecast<br>${escapeHtml(model.weather.today.condition)} · Rain ${Math.round(model.weather.today.precipitationProbability)}%</span>`
        : `<strong class="number">${visible.length}</strong><span>events across<br>three days</span>`
    }</div>
    ${
      model.weather
        ? `<div class="tomorrow">Tomorrow<strong class="number">${Math.round(model.weather.tomorrow.high)}° / ${Math.round(model.weather.tomorrow.low)}°</strong><span>${escapeHtml(model.weather.tomorrow.condition)} · Rain ${Math.round(model.weather.tomorrow.precipitationProbability)}%</span></div>`
        : ""
    }
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
