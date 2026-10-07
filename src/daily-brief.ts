import type {
  DailyBriefLunchModel,
  DailyBriefWeatherModel
} from "./generation";
import type { LunchIcon } from "./lunch";

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
    return `<svg viewBox="0 0 96 96" role="img" aria-label="${label} weather icon"><path d="M27 58h45a18 18 0 0 0 0-36 26 26 0 0 0-49 9 14 14 0 0 0 4 27Z" fill="none" stroke="currentColor" stroke-width="7"/><path d="m30 68-7 17m28-17-7 17m28-17-7 17" stroke="currentColor" stroke-width="7" stroke-linecap="round"/></svg>`;
  }
  if (lowered.includes("cloud")) {
    return `<svg viewBox="0 0 96 96" role="img" aria-label="${label} weather icon"><circle cx="31" cy="30" r="17" fill="none" stroke="currentColor" stroke-width="7"/><path d="M25 69h50a17 17 0 0 0-3-34 25 25 0 0 0-45 9 13 13 0 0 0-2 25Z" fill="#fff" stroke="currentColor" stroke-width="7"/></svg>`;
  }
  return `<svg viewBox="0 0 96 96" role="img" aria-label="${label} weather icon"><circle cx="48" cy="48" r="22" fill="none" stroke="currentColor" stroke-width="7"/><path d="M48 6v13m0 58v13M6 48h13m58 0h13M18 18l10 10m40 40 10 10m0-60L68 28M28 68 18 78" stroke="currentColor" stroke-width="7" stroke-linecap="round"/></svg>`;
}

function temperature(value: number): string {
  return `${Math.round(value)}°`;
}

function lunchIcon(icon: LunchIcon): string {
  const paths: Record<LunchIcon, string> = {
    pizza:
      '<path d="M48 12 18 78h60L48 12Z" fill="none" stroke="currentColor" stroke-width="7"/><circle cx="43" cy="44" r="5"/><circle cx="57" cy="61" r="5"/><path d="M25 67h46" stroke="currentColor" stroke-width="7"/>',
    taco:
      '<path d="M15 60a33 33 0 0 1 66 0v15H15V60Z" fill="none" stroke="currentColor" stroke-width="7"/><path d="M29 57c8-11 30-11 38 0M35 42l7 7m15-8-5 9" stroke="currentColor" stroke-width="6" stroke-linecap="round"/>',
    sandwich:
      '<path d="m16 34 32-18 32 18-32 18-32-18Zm0 13 32 18 32-18v24L48 88 16 71V47Z" fill="none" stroke="currentColor" stroke-width="7" stroke-linejoin="round"/>',
    chicken:
      '<path d="M63 21c17 10 20 31 8 45-11 13-34 12-45-3-10-14-5-34 10-43 8-5 19-4 27 1Z" fill="none" stroke="currentColor" stroke-width="7"/><path d="m27 65-12 12m6-6-8-8m8 8 8 8" stroke="currentColor" stroke-width="7" stroke-linecap="round"/>',
    pasta:
      '<path d="M17 57h62c-3 19-14 28-31 28S20 76 17 57Z" fill="none" stroke="currentColor" stroke-width="7"/><path d="M25 47c5-16 14-16 20 0 5-16 14-16 20 0" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round"/>',
    salad:
      '<path d="M15 52h66c-2 22-13 33-33 33S17 74 15 52Z" fill="none" stroke="currentColor" stroke-width="7"/><path d="M28 49c-4-15 8-26 20-15 7-17 24-10 21 7" fill="none" stroke="currentColor" stroke-width="7"/>',
    generic:
      '<circle cx="48" cy="48" r="34" fill="none" stroke="currentColor" stroke-width="7"/><circle cx="48" cy="48" r="21" fill="none" stroke="currentColor" stroke-width="5"/><path d="M13 13v27m0-13h10M83 13v27" stroke="currentColor" stroke-width="6" stroke-linecap="round"/>'
  };
  return `<svg viewBox="0 0 96 96" role="img" aria-label="${icon} lunch icon">${paths[icon]}</svg>`;
}

function lunchSection(lunch: DailyBriefLunchModel): string {
  const states = {
    no_menu: "No menu posted",
    closed: "School closed",
    schema_failure: "Lunch source changed",
    adapter_failure: "Lunch unavailable"
  } as const;
  const state =
    lunch.status === "available"
      ? ""
      : `<div class="lunch-state" data-missing-state>${states[lunch.status]}</div>`;
  const previous =
    lunch.stale && lunch.entrees.length > 0
      ? `<div class="last-menu">Last menu · ${staleAge(lunch.staleAgeMinutes)}</div>`
      : "";
  const entrees = lunch.entrees
    .slice(0, 3)
    .map(
      ({ name, icon }) =>
        `<div class="entree">${lunchIcon(icon)}<span>${escapeHtml(name)}</span></div>`
    )
    .join("");
  return `<section class="lunch"><h2>Today's lunch</h2>${state}${previous}${entrees}</section>`;
}

function staleAge(minutes?: number): string {
  if (minutes === undefined) return "age unavailable";
  if (minutes < 60) return `${minutes}m old`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m old`;
}

export function dailyBriefHtml(model: DailyBriefWeatherModel): string {
  const { weather } = model;
  const updated = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(model.updatedAt));
  const stale = model.stale
    ? `<strong class="stale">⚠ Weather ${staleAge(model.staleAgeMinutes)}</strong>`
    : "";
  const calendar = (model.calendar ?? []).slice(0, 3);
  const eventTime = (event: (typeof calendar)[number]) => {
    if (event.allDay) return "All day";
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles",
      hour: "numeric",
      minute: "2-digit"
    }).format(new Date(event.start));
  };
  const events =
    model.calendarUnavailable
      ? `<li class="empty" data-missing-state>Calendar unavailable</li>`
      : calendar.length === 0
      ? `<li class="empty" data-missing-state>No upcoming calendar events</li>`
      : calendar
          .map(
            (event) =>
              `<li><span class="event-time">${eventTime(event)}</span><strong>${escapeHtml(event.title)}</strong><span class="event-meta">${event.tentative ? "Tentative · " : ""}${escapeHtml(event.ownerLabels.join(" & "))}</span></li>`
          )
          .join("");
  const notices = (model.notices ?? [])
    .slice(0, 2)
    .map(
      (notice) =>
        `<li class="notice"><strong>${escapeHtml(notice.summary)}</strong><span class="notice-meta">${escapeHtml(notice.senderOrganization)}${notice.relevantDate ? ` · ${escapeHtml(notice.relevantDate)}` : ""}${notice.action ? ` · ${escapeHtml(notice.action)}` : ""}</span></li>`
    )
    .join("");
  const noticeSection = notices
    ? `<aside class="notices" aria-label="Household Notices"><h2>Notices</h2><ul>${notices}</ul></aside>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=800,height=480,initial-scale=1">
  <style>
    * { box-sizing: border-box; }
    html, body { width: 800px; height: 480px; margin: 0; overflow: hidden; }
    body { color: #000; background: #fff; font-family: Arial, Helvetica, sans-serif; padding: 18px 28px 14px; }
    header { display: flex; align-items: center; justify-content: space-between; border-bottom: 4px solid #000; padding-bottom: 10px; }
    .current { display: flex; align-items: center; gap: 18px; }
    svg { width: 60px; height: 60px; flex: none; }
    h1 { font-size: 45px; line-height: .9; margin: 0; }
    .condition { font-size: 20px; font-weight: 700; margin-top: 6px; }
    .title { text-align: right; }
    .title strong { display: block; font-size: 31px; }
    .title span { font-size: 20px; }
    .weather-band { display: flex; align-items: center; gap: 20px; }
    .forecast-days { display: flex; gap: 18px; }
    .mini-day { display: grid; grid-template-columns: 38px 1fr; align-items: center; min-width: 168px; }
    .mini-day svg { width: 34px; height: 34px; grid-row: 1 / 3; }
    .mini-day strong { font-size: 16px; }
    .mini-day span { font-size: 14px; }
    main { display: grid; grid-template-columns: 3fr 2fr; gap: 14px; padding-top: 14px; }
    section { border: 3px solid #000; border-radius: 10px; padding: 12px 15px; min-height: 292px; }
    h2 { font-size: 25px; margin: 0 0 9px; }
    ul { list-style: none; margin: 0; padding: 0; }
    li { display: grid; grid-template-columns: 78px 1fr; gap: 3px 10px; border-top: 2px solid #000; padding: 9px 0; font-size: 20px; }
    li:first-child { border-top: 0; }
    .event-time { font-size: 16px; font-weight: 700; grid-row: 1 / 3; }
    .event-meta { font-size: 15px; }
    .empty { display: block; }
    .lunch { padding: 12px 14px; }
    .lunch h2 { margin-bottom: 7px; }
    .entree { display: flex; align-items: center; gap: 9px; min-height: 70px; font-size: 19px; font-weight: 700; line-height: 1.05; }
    .entree svg { width: 58px; height: 58px; }
    .lunch-state { border: 3px solid #000; padding: 9px; font-size: 22px; font-weight: 700; margin-top: 20px; }
    .last-menu { font-size: 16px; font-weight: 700; margin: 5px 0 0; text-transform: uppercase; }
    .notices { grid-column: 1 / 3; min-height: 0; padding: 7px 12px; display: grid; grid-template-columns: 92px 1fr; align-items: center; }
    .notices h2 { margin: 0; font-size: 20px; }
    .notices ul { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .notices li { display: block; border: 0; padding: 0; font-size: 15px; }
    .notice-meta { display: block; font-size: 12px; }
    main:has(.notices) section { min-height: 224px; }
    footer { display: flex; justify-content: space-between; align-items: center; font-size: 15px; padding-top: 8px; }
    .stale { border: 2px solid #000; padding: 3px 7px; }
  </style>
</head>
<body>
  <header>
    <div class="weather-band">
      <div class="current">
        ${weatherIcon(weather.current.condition)}
        <div>
          <h1>${temperature(weather.current.temperature)}F</h1>
          <div class="condition">${escapeHtml(weather.current.condition)}</div>
        </div>
      </div>
      <div class="forecast-days">
        <div class="mini-day">
          ${weatherIcon(weather.today.condition)}
          <strong>Today · ${escapeHtml(weather.today.condition)}</strong>
          <span>High ${temperature(weather.today.high)} · Low ${temperature(weather.today.low)} · Rain ${Math.round(weather.today.precipitationProbability)}%</span>
        </div>
        <div class="mini-day">
          ${weatherIcon(weather.tomorrow.condition)}
          <strong>Tomorrow · ${escapeHtml(weather.tomorrow.condition)}</strong>
          <span>High ${temperature(weather.tomorrow.high)} · Low ${temperature(weather.tomorrow.low)} · Rain ${Math.round(weather.tomorrow.precipitationProbability)}%</span>
        </div>
      </div>
    </div>
    <div class="title"><strong>Daily Brief</strong></div>
  </header>
  <main>
    <section class="calendar">
      <h2>Next up</h2>
      <ul>${events}</ul>
    </section>
    ${lunchSection(model.lunch)}
    ${noticeSection}
  </main>
  <footer><span>${[
    stale,
    model.calendarStaleAgeMinutes === undefined
      ? ""
      : `<strong class="stale">⚠ Calendar ${staleAge(model.calendarStaleAgeMinutes)}</strong>`
  ]
    .filter(Boolean)
    .join(" ")}</span><span>Updated ${updated}</span></footer>
</body>
</html>`;
}
