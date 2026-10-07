import type { CalendarEvent } from "./calendar";

export interface CalendarViewModel {
  calendar: CalendarEvent[];
  timezone: string;
  updatedAt: string;
  stale?: boolean;
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

function eventItem(event: CalendarEvent, timezone: string): string {
  const location =
    event.location && !event.private
      ? `<span class="location">${escapeHtml(event.location)}</span>`
      : "";
  const owner = escapeHtml(event.ownerLabels.join(" & "));
  const tentative = event.tentative ? "Tentative · " : "";
  return `<li>
    <span class="time">${compactTime(event, timezone)}</span>
    <strong>${escapeHtml(event.title)}</strong>
    <span class="meta">${tentative}${owner}</span>
    ${location}
  </li>`;
}

export function calendarViewHtml(model: CalendarViewModel): string {
  const firstDay = localDate(new Date(model.updatedAt), model.timezone);
  const visible = model.calendar.slice(0, 12);
  const overflow = Math.max(0, model.calendar.length - visible.length);
  const days = [0, 1, 2].map((offset) => {
    const date = addDays(firstDay, offset);
    const events = visible
      .filter((event) => eventDate(event, model.timezone) === date)
      .sort((left, right) => {
        if (left.allDay !== right.allDay) return left.allDay ? -1 : 1;
        return left.start.localeCompare(right.start);
      });
    return `<section>
      <h2>${dayHeading(date, offset, model.timezone)}<small>${escapeHtml(date)}</small></h2>
      <ul>${events.map((event) => eventItem(event, model.timezone)).join("") || '<li class="empty">No events</li>'}</ul>
    </section>`;
  });
  const updated = new Intl.DateTimeFormat("en-US", {
    timeZone: model.timezone,
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(model.updatedAt));

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=800,height=480,initial-scale=1">
  <style>
    * { box-sizing: border-box; }
    html, body { width: 800px; height: 480px; margin: 0; overflow: hidden; }
    body { color: #000; background: #fff; font-family: Arial, Helvetica, sans-serif; padding: 17px 24px 12px; }
    header { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 4px solid #000; padding-bottom: 8px; }
    h1 { font-size: 32px; margin: 0; }
    header span { font-size: 16px; font-weight: 700; }
    main { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; height: 375px; padding-top: 11px; }
    section { border-right: 2px solid #000; padding-right: 10px; }
    section:last-child { border-right: 0; padding-right: 0; }
    h2 { display: flex; justify-content: space-between; align-items: baseline; font-size: 23px; margin: 0 0 5px; }
    h2 small { font-size: 12px; }
    ul { list-style: none; padding: 0; margin: 0; }
    li { display: grid; grid-template-columns: 63px 1fr; column-gap: 6px; border-top: 1px solid #000; padding: 5px 0; line-height: 1.05; }
    li:first-child { border-top: 2px solid #000; }
    .time { grid-row: 1 / 4; font-size: 13px; font-weight: 700; white-space: nowrap; }
    li strong { font-size: 16px; }
    .meta, .location { font-size: 12px; }
    .location::before { content: "⌖ "; }
    .empty { display: block; border-top: 2px solid #000; font-size: 15px; }
    footer { display: flex; justify-content: space-between; border-top: 3px solid #000; padding-top: 6px; font-size: 14px; font-weight: 700; }
    .stale { border: 2px solid #000; padding: 1px 5px; }
  </style>
</head>
<body>
  <header><h1>Calendar View</h1><span>Today + next 2 days</span></header>
  <main>${days.join("")}</main>
  <footer>
    <span>${model.stale ? '<span class="stale">⚠ Last available calendar</span>' : ""}</span>
    <span>${overflow > 0 ? `+${overflow} more · ` : ""}Updated ${updated}</span>
  </footer>
</body>
</html>`;
}
