import type { CalendarEvent } from "./calendar";
import type { DailyBriefWeatherModel } from "./generation";
import { DISPLAY_BASE_CSS } from "./display-style";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function weatherIcon(condition: string): string {
  const label = escapeHtml(condition);
  const lowered = condition.toLowerCase();
  if (lowered.includes("rain") || lowered.includes("drizzle")) {
    return `<svg viewBox="0 0 96 96" role="img" aria-label="${label} forecast icon"><path d="M27 58h45a18 18 0 0 0 0-36 26 26 0 0 0-49 9 14 14 0 0 0 4 27Z" fill="none" stroke="currentColor" stroke-width="7"/><path d="m30 68-7 17m28-17-7 17m28-17-7 17" stroke="currentColor" stroke-width="7" stroke-linecap="round"/></svg>`;
  }
  if (lowered.includes("cloud")) {
    return `<svg viewBox="0 0 96 96" role="img" aria-label="${label} forecast icon"><circle cx="31" cy="30" r="17" fill="none" stroke="currentColor" stroke-width="7"/><path d="M25 69h50a17 17 0 0 0-3-34 25 25 0 0 0-45 9 13 13 0 0 0-2 25Z" fill="#fff" stroke="currentColor" stroke-width="7"/></svg>`;
  }
  return `<svg viewBox="0 0 96 96" role="img" aria-label="${label} forecast icon"><circle cx="48" cy="48" r="22" fill="none" stroke="currentColor" stroke-width="7"/><path d="M48 6v13m0 58v13M6 48h13m58 0h13M18 18l10 10m40 40 10 10m0-60L68 28M28 68 18 78" stroke="currentColor" stroke-width="7" stroke-linecap="round"/></svg>`;
}

function temperature(value: number): string {
  return `${Math.round(value)}°`;
}

function staleAge(minutes?: number): string {
  if (minutes === undefined) return "age unavailable";
  if (minutes < 60) return `${minutes}m old`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m old`;
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

function eventDayLabel(
  event: CalendarEvent,
  firstDay: string,
  timezone: string
): string {
  const date = eventDate(event, timezone);
  if (date === firstDay) return "Today";
  if (date === addDays(firstDay, 1)) return "Tomorrow";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short"
  }).format(new Date(`${date}T12:00:00Z`));
}

function eventTime(event: CalendarEvent, timezone: string): string {
  if (event.allDay) return "All day";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit"
  })
    .format(new Date(event.start))
    .replace(":00", "");
}

export function dailyBriefHtml(model: DailyBriefWeatherModel): string {
  const renderedAt = new Date(model.updatedAt);
  const dateParts = new Intl.DateTimeFormat("en-US", {
    timeZone: model.timezone,
    weekday: "long",
    month: "long",
    day: "numeric"
  }).formatToParts(renderedAt);
  const datePart = (type: Intl.DateTimeFormatPartTypes) =>
    dateParts.find((part) => part.type === type)?.value ?? "";
  const updated = new Intl.DateTimeFormat("en-US", {
    timeZone: model.timezone,
    hour: "numeric",
    minute: "2-digit"
  }).format(renderedAt);
  const firstDay = localDate(renderedAt, model.timezone);
  const events = (model.calendar ?? []).slice(0, 6);
  const agenda = model.calendarUnavailable
    ? `<div class="agenda-empty" data-missing-state>Calendar unavailable</div>`
    : events.length === 0
      ? `<div class="agenda-empty" data-missing-state>No events today or tomorrow</div>`
      : events
          .map(
            (event) => `<article class="agenda-item">
              <time><small>${eventDayLabel(event, firstDay, model.timezone)}</small>${eventTime(event, model.timezone)}</time>
              <div><strong class="serif">${escapeHtml(event.title)}</strong><span>${event.tentative ? "Tentative · " : ""}${escapeHtml(event.ownerLabels.join(" & "))}</span></div>
            </article>`
          )
          .join("");
  const warnings = [
    model.stale
      ? `<strong class="stale">Weather ${staleAge(model.staleAgeMinutes)}</strong>`
      : "",
    model.calendarStaleAgeMinutes === undefined
      ? ""
      : `<strong class="stale">Calendar ${staleAge(model.calendarStaleAgeMinutes)}</strong>`
  ].filter(Boolean);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=800,height=480,initial-scale=1">
  <style>
    ${DISPLAY_BASE_CSS}
    body { display: grid; grid-template-rows: 72px 112px 256px 40px; }
    header { display: grid; grid-template-columns: 235px 1fr 190px; align-items: center; margin: 0 18px; border-bottom: 4px solid var(--ink); }
    .date strong { font-size: 28px; line-height: 1; }
    .date span { margin-left: 8px; font-family: Arial, Helvetica, sans-serif; font-size: 15px; font-style: normal; font-weight: 900; letter-spacing: .05em; text-transform: uppercase; }
    h1 { margin: 0; font-size: 25px; text-align: center; }
    .brand { text-align: right; }
    .brand strong { display: block; font-size: 19px; }
    .brand span { display: block; margin-top: 3px; font-size: 14px; font-weight: 900; letter-spacing: .04em; text-transform: uppercase; }
    .weather-band { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; padding: 10px 18px; }
    .forecast { min-width: 0; display: grid; grid-template-columns: 54px 1fr; align-items: center; gap: 8px; border: 2px solid var(--ink); border-radius: 13px; padding: 8px 10px; }
    .forecast svg { width: 50px; height: 50px; }
    .forecast .label { display: block; margin-bottom: 5px; }
    .forecast strong { display: block; font-size: 25px; line-height: .95; }
    .forecast p { margin: 6px 0 0; font-size: 14px; font-weight: 900; line-height: 1.15; }
    main { padding: 2px 18px 8px; }
    .agenda-head { display: flex; justify-content: space-between; align-items: baseline; height: 24px; }
    .agenda-head span:last-child { font-size: 14px; font-weight: 900; text-transform: uppercase; }
    .agenda-grid { display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: repeat(3, 1fr); gap: 7px 10px; height: 222px; }
    .agenda-item { min-width: 0; display: grid; grid-template-columns: 96px minmax(0, 1fr); align-items: center; gap: 8px; border: 2px solid var(--ink); border-radius: 11px; padding: 6px 9px; overflow: hidden; }
    .agenda-item time { font-size: 14px; font-weight: 900; line-height: 1.1; text-transform: uppercase; }
    .agenda-item time small { display: block; margin-bottom: 3px; font-size: 14px; letter-spacing: .03em; }
    .agenda-item strong { display: block; font-size: 19px; line-height: .95; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .agenda-item span { display: block; margin-top: 4px; font-size: 14px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .agenda-empty { grid-column: 1 / -1; grid-row: 1 / -1; display: flex; align-items: center; border: 2px solid var(--ink); border-radius: 11px; padding: 18px; font-family: Arial, Helvetica, sans-serif; font-size: 30px; font-weight: 900; }
    footer { display: flex; justify-content: space-between; align-items: center; margin: 0 18px; border-top: 2px solid var(--ink); font-size: 14px; font-weight: 900; letter-spacing: .02em; text-transform: uppercase; }
    .stale { border: 2px solid var(--ink); padding: 2px 5px; }
  </style>
</head>
<body>
  <header>
    <div class="date"><strong class="serif">${escapeHtml(datePart("weekday"))}<span>${escapeHtml(datePart("month"))} ${escapeHtml(datePart("day"))}</span></strong></div>
    <h1 class="serif">Today at a glance</h1>
    <div class="brand"><strong>Family Dashboard</strong><span>Calendar + weather</span></div>
  </header>
  <section class="weather-band" aria-label="Weather forecast">
    <article class="forecast">
      ${weatherIcon(model.weather.today.condition)}
      <div><span class="label">Today</span><strong class="number">${temperature(model.weather.today.high)} / ${temperature(model.weather.today.low)}</strong><p>${escapeHtml(model.weather.today.condition)} · Rain ${Math.round(model.weather.today.precipitationProbability)}%</p></div>
    </article>
    <article class="forecast">
      ${weatherIcon(model.weather.tomorrow.condition)}
      <div><span class="label">Tomorrow</span><strong class="number">${temperature(model.weather.tomorrow.high)} / ${temperature(model.weather.tomorrow.low)}</strong><p>${escapeHtml(model.weather.tomorrow.condition)} · Rain ${Math.round(model.weather.tomorrow.precipitationProbability)}%</p></div>
    </article>
  </section>
  <main>
    <div class="agenda-head"><span class="label">Today + tomorrow schedule</span><span>Up to six calendar entries</span></div>
    <div class="agenda-grid">${agenda}</div>
  </main>
  <footer><span>${warnings.join(" ") || "Forecast · Calendar"}</span><span>Updated ${updated}</span></footer>
</body>
</html>`;
}
