import type {
  DailyBriefLunchModel,
  DailyBriefWeatherModel
} from "./generation";
import type { LunchIcon } from "./lunch";
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
  return `<section class="side-card lunch"><span class="label">Today's lunch</span><h2 class="serif">School menu</h2>${state}${previous}<div class="entrees">${entrees}</div></section>`;
}

function staleAge(minutes?: number): string {
  if (minutes === undefined) return "age unavailable";
  if (minutes < 60) return `${minutes}m old`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m old`;
}

function countdown(start: string, updatedAt: string, allDay: boolean): string {
  if (allDay) return "ALL DAY";
  const minutes = Math.max(
    0,
    Math.round(
      (new Date(start).getTime() - new Date(updatedAt).getTime()) / 60_000
    )
  );
  if (minutes === 0) return "NOW";
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

export function dailyBriefHtml(model: DailyBriefWeatherModel): string {
  const { weather } = model;
  const renderedAt = new Date(model.updatedAt);
  const updatedParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    minute: "2-digit"
  }).formatToParts(renderedAt);
  const updatedPart = (type: Intl.DateTimeFormatPartTypes) =>
    updatedParts.find((part) => part.type === type)?.value ?? "";
  const updated = `${updatedPart("hour")}:${updatedPart("minute")} ${updatedPart("dayPeriod")}`;
  const date = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "short",
    month: "long",
    day: "numeric"
  }).formatToParts(renderedAt);
  const datePart = (type: Intl.DateTimeFormatPartTypes) =>
    date.find((part) => part.type === type)?.value ?? "";
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
  const eventMeta = (event: (typeof calendar)[number]) =>
    `${event.tentative ? "Tentative · " : ""}${escapeHtml(event.ownerLabels.join(" & "))}`;
  const nextEvent =
    model.calendarUnavailable
      ? `<article class="next-event inverted" data-missing-state><span class="label">Next up</span><h1 class="serif">Calendar unavailable</h1></article>`
      : calendar.length === 0
        ? `<article class="next-event inverted" data-missing-state><span class="label">Next up</span><h1 class="serif">No upcoming events</h1></article>`
        : `<article class="next-event inverted">
            <div>
              <span class="label">Next up · ${eventTime(calendar[0])}</span>
              <h1 class="serif">${escapeHtml(calendar[0].title)}</h1>
              <p>${eventMeta(calendar[0])}</p>
            </div>
            <div class="next-time"><span class="number">${countdown(calendar[0].start, model.updatedAt, calendar[0].allDay)}</span><small>${calendar[0].allDay ? "today" : "until start"}</small></div>
          </article>`;
  const secondaryEvents = calendar
    .slice(1)
    .map(
      (event) =>
        `<article class="agenda-item"><time>${eventTime(event)}</time><strong class="serif">${escapeHtml(event.title)}</strong><span>${eventMeta(event)}</span></article>`
    )
    .join("");
  const notices = (model.notices ?? [])
    .slice(0, 1)
    .map(
      (notice) =>
        `<li class="notice"><strong>${escapeHtml(notice.summary)}</strong><span class="notice-meta">${escapeHtml(notice.senderOrganization)}${notice.relevantDate ? ` · ${escapeHtml(notice.relevantDate)}` : ""}</span>${notice.action ? `<span class="notice-action">${escapeHtml(notice.action)}</span>` : ""}</li>`
    )
    .join("");
  const privateMarkers = (model.privateNoticeMarkers ?? [])
    .slice(0, 2)
    .map(
      ({ accountId }) =>
        `<li class="notice"><strong>${accountId === "mom" ? "Mom" : "Dad"} Private Notice</strong></li>`
    )
    .join("");
  const noticeItems = `${privateMarkers}${notices}`;
  const noticeIcon = privateMarkers.length > 0
    ? `<svg class="notice-icon" viewBox="0 0 64 64" role="img" aria-label="Private notice icon"><rect x="13" y="29" width="38" height="27" rx="3" fill="none" stroke="currentColor" stroke-width="5"/><path d="M20 29v-8a12 12 0 0 1 24 0v8" fill="none" stroke="currentColor" stroke-width="5"/></svg>`
    : `<svg class="notice-icon" viewBox="0 0 64 64" role="img" aria-label="Household notice icon"><path d="M14 7h28l9 9v41H14zM42 7v11h9M22 29h21M22 39h21M22 49h14" fill="none" stroke="currentColor" stroke-width="5"/></svg>`;
  const noticeSection = noticeItems
    ? `<section class="side-card notice-card inverted" aria-label="Household Notices"><span class="label">Household notice</span><div class="notice-content">${noticeIcon}<ul>${noticeItems}</ul></div></section>`
    : `<section class="side-card tomorrow-card">
        <span class="label">Tomorrow</span>
        <div class="tomorrow-weather">
          ${weatherIcon(weather.tomorrow.condition)}
          <div><h2 class="serif">${escapeHtml(weather.tomorrow.condition)}</h2><p>High ${temperature(weather.tomorrow.high)} · Low ${temperature(weather.tomorrow.low)} · Rain ${Math.round(weather.tomorrow.precipitationProbability)}%</p></div>
        </div>
      </section>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=800,height=480,initial-scale=1">
  <style>
    ${DISPLAY_BASE_CSS}
    body { display: grid; grid-template-columns: 496px 1fr; grid-template-rows: 124px 286px 46px; gap: 0 16px; padding: 12px 18px 10px; }
    header { grid-column: 1 / 3; display: grid; grid-template-columns: 210px 1fr 126px; align-items: center; border-bottom: 4px solid var(--ink); }
    .clock-block { display: flex; align-items: end; gap: 7px; }
    .clock-time { font-size: 63px; line-height: 1.04; }
    .clock-copy strong { display: block; font-size: 16px; text-transform: uppercase; }
    .clock-copy span { display: block; margin-top: 5px; font-size: 12px; font-weight: 900; text-transform: uppercase; }
    .weather { display: grid; grid-template-columns: 52px 91px 1fr; align-items: center; gap: 7px; }
    .weather svg { width: 56px; height: 56px; }
    .temperature { font-size: 48px; line-height: 1; white-space: nowrap; }
    .weather-copy { font-size: 14px; line-height: 1.2; }
    .weather-copy strong { display: block; font-size: 17px; }
    .brand { text-align: right; }
    .brand strong { display: block; font-size: 21px; }
    .brand span { display: block; margin-top: 5px; font-size: 12px; font-weight: 800; }
    .brief { padding-top: 14px; }
    .next-event { height: 155px; padding: 14px 18px; border-radius: 15px; display: grid; grid-template-columns: minmax(0, 1fr) 132px; overflow: hidden; }
    .next-event h1 { display: -webkit-box; margin: 7px 0 4px; font-size: 42px; line-height: .92; overflow: hidden; overflow-wrap: anywhere; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
    .next-event p { margin: 0; font-size: 14px; font-weight: 700; }
    .next-time { align-self: center; text-align: right; }
    .next-time .number { display: block; font-size: 41px; line-height: .9; white-space: nowrap; }
    .next-time small { font-size: 12px; font-weight: 900; letter-spacing: .07em; text-transform: uppercase; }
    .agenda { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; padding-top: 12px; }
    .agenda-item { min-width: 0; border-top: 3px solid var(--ink); padding-top: 7px; overflow: hidden; }
    .agenda-item time { display: block; font-size: 13px; font-weight: 900; }
    .agenda-item strong { display: -webkit-box; margin-top: 3px; font-size: 21px; line-height: 1; overflow: hidden; overflow-wrap: anywhere; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
    .agenda-item span { display: block; margin-top: 4px; font-size: 12px; font-weight: 700; }
    .side { padding-top: 14px; display: grid; grid-template-rows: 134px 128px; gap: 10px; }
    .side-card { border: 2px solid var(--ink); border-radius: 14px; padding: 11px 13px; overflow: hidden; }
    .side-card h2 { margin: 8px 0 7px; font-size: 25px; line-height: 1; }
    .entrees { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }
    .entree { min-width: 0; display: grid; grid-template-columns: 30px 1fr; align-items: center; gap: 5px; border-top: 1px solid var(--ink); padding-top: 5px; font-size: 13px; font-weight: 800; line-height: 1.05; overflow: hidden; }
    .entree svg { width: 29px; height: 29px; }
    .lunch-state { border: 2px solid var(--ink); padding: 6px; font-size: 16px; font-weight: 900; margin-top: 8px; }
    .last-menu { margin-top: 4px; font-size: 12px; font-weight: 900; text-transform: uppercase; }
    .notice-card ul { list-style: none; margin: 8px 0 0; padding: 0; }
    .notice-content { display: grid; grid-template-columns: 52px minmax(0, 1fr); align-items: center; gap: 8px; margin-top: 7px; }
    .notice-icon { width: 50px; height: 50px; }
    .notice-card ul { min-width: 0; margin: 0; }
    .notice-card li { padding-top: 5px; border-top: 1px solid var(--paper); font-size: 16px; line-height: 1.05; }
    .notice-card li:first-child { border-top: 0; padding-top: 0; }
    .notice-card li strong { display: -webkit-box; font-family: Georgia, "Times New Roman", serif; font-size: 17px; font-style: italic; line-height: 1; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 3; }
    .notice-card .notice-meta, .notice-card .notice-action { display: block; margin-top: 3px; font-size: 12px; line-height: 1; }
    .tomorrow-weather { display: grid; grid-template-columns: 58px 1fr; align-items: center; gap: 9px; margin-top: 13px; }
    .tomorrow-weather svg { width: 56px; height: 56px; }
    .tomorrow-weather h2 { margin: 0 0 5px; }
    .tomorrow-weather p { margin: 0; font-size: 12px; font-weight: 800; line-height: 1.2; }
    footer { grid-column: 1 / 3; display: flex; justify-content: space-between; align-items: end; border-top: 2px solid var(--ink); font-size: 12px; font-weight: 900; letter-spacing: .04em; text-transform: uppercase; }
    .stale { border: 2px solid var(--ink); padding: 2px 5px; }
  </style>
</head>
<body>
  <header>
    <div class="clock-block">
      <span class="number clock-time">${escapeHtml(updatedPart("hour"))}:${escapeHtml(updatedPart("minute"))}</span>
      <div class="clock-copy"><strong>${escapeHtml(updatedPart("dayPeriod"))}</strong><span>${escapeHtml(datePart("weekday"))} · ${escapeHtml(datePart("month"))} ${escapeHtml(datePart("day"))}</span></div>
    </div>
    <div class="weather">
      ${weatherIcon(weather.current.condition)}
      <strong class="number temperature">${temperature(weather.current.temperature)}F</strong>
      <div class="weather-copy">
        <strong>${escapeHtml(weather.current.condition)}</strong>
        Today: ${escapeHtml(weather.today.condition)}<br>High ${temperature(weather.today.high)} · Low ${temperature(weather.today.low)} · Rain ${Math.round(weather.today.precipitationProbability)}%
      </div>
    </div>
    <div class="brand"><strong>Family Brief</strong><span>Today at a glance</span></div>
  </header>
  <main class="brief">
    ${nextEvent}
    <div class="agenda">${secondaryEvents}</div>
  </main>
  <aside class="side">
    ${lunchSection(model.lunch)}
    ${noticeSection}
  </aside>
  <footer><span>${[
    stale,
    model.calendarStaleAgeMinutes === undefined
      ? ""
      : `<strong class="stale">⚠ Calendar ${staleAge(model.calendarStaleAgeMinutes)}</strong>`
  ]
    .filter(Boolean)
    .join(" ") || "Weather · Calendar · Lunch current"}</span><span>Updated ${updated}</span></footer>
</body>
</html>`;
}
