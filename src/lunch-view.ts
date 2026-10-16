import {
  classifyLunchEntree,
  type LunchClassifierPorts,
  type LunchIcon,
  type LunchSnapshot
} from "./lunch";
import { DISPLAY_BASE_CSS } from "./display-style";

export interface LunchViewDay {
  date: string;
  status: "menu" | "closed" | "missing";
  entrees: Array<{ name: string; icon: LunchIcon }>;
}

export interface LunchViewModel {
  week: "current" | "upcoming";
  status:
    | "available"
    | "upcoming_unavailable"
    | "schema_failure"
    | "adapter_failure";
  days: LunchViewDay[];
  stale: boolean;
  staleAgeMinutes?: number;
  timezone: string;
  updatedAt: string;
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

function schoolWeek(date: string, timezone: string) {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short"
  }).format(new Date(`${date}T12:00:00Z`));
  const index = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
    weekday
  );
  const upcoming = index === 0 || index === 6;
  const mondayOffset = upcoming ? (index === 6 ? 2 : 1) : 1 - index;
  return {
    week: upcoming ? ("upcoming" as const) : ("current" as const),
    dates: Array.from({ length: 5 }, (_, offset) =>
      addDays(date, mondayOffset + offset)
    )
  };
}

export async function lunchViewModel(
  snapshot: LunchSnapshot,
  now: Date,
  timezone: string,
  failure: "schema_failure" | "adapter_failure" | null,
  classifier: LunchClassifierPorts,
  staleAgeMinutes?: number
): Promise<LunchViewModel> {
  const target = schoolWeek(localDate(now, timezone), timezone);
  const days = await Promise.all(
    target.dates.map(async (date): Promise<LunchViewDay> => {
      const source = snapshot.days.find((day) => day.date === date);
      if (!source) return { date, status: "missing", entrees: [] };
      return {
        date,
        status: source.status,
        entrees: await Promise.all(
          source.entrees.map(async (name) => ({
            name,
            icon: await classifyLunchEntree(name, classifier)
          }))
        )
      };
    })
  );
  const hasPostedDay = days.some(({ status }) => status !== "missing");
  return {
    week: target.week,
    status:
      failure ??
      (target.week === "upcoming" && !hasPostedDay
        ? "upcoming_unavailable"
        : "available"),
    days,
    stale: failure !== null && staleAgeMinutes !== undefined,
    ...(failure !== null && staleAgeMinutes !== undefined
      ? { staleAgeMinutes }
      : {}),
    timezone,
    updatedAt: now.toISOString()
  };
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

export function lunchViewHtml(model: LunchViewModel): string {
  const globalState = {
    available: "",
    upcoming_unavailable:
      '<div class="missing" data-missing-state>Next week\'s menu not posted</div>',
    schema_failure:
      '<div class="missing" data-missing-state>Lunch source changed</div>',
    adapter_failure:
      '<div class="missing" data-missing-state>Lunch unavailable</div>'
  }[model.status];
  const days = model.days
    .map((day) => {
      const label = new Intl.DateTimeFormat("en-US", {
        timeZone: model.timezone,
        weekday: "short",
        month: "short",
        day: "numeric"
      }).format(new Date(`${day.date}T12:00:00Z`));
      const content =
        day.status === "closed"
          ? '<div class="day-state" data-missing-state>School closed</div>'
          : day.entrees.length === 0
            ? '<div class="day-state" data-missing-state>No menu posted</div>'
            : day.entrees
                .slice(0, 3)
                .map(
                  ({ name, icon }) =>
                    `<div class="entree">${lunchIcon(icon)}<span>${escapeHtml(name)}</span></div>`
                )
                .join("");
      return `<section><h2>${label}</h2>${content}</section>`;
    })
    .join("");
  const updated = new Intl.DateTimeFormat("en-US", {
    timeZone: model.timezone,
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(model.updatedAt));
  const staleAge =
    model.staleAgeMinutes === undefined
      ? "age unavailable"
      : model.staleAgeMinutes < 60
        ? `${model.staleAgeMinutes}m old`
        : `${Math.floor(model.staleAgeMinutes / 60)}h ${model.staleAgeMinutes % 60}m old`;
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
    .rail .day-number { font-size: 70px; line-height: 1.08; }
    .rail .date { margin-top: 9px; font-size: 18px; font-weight: 900; line-height: 1.1; text-transform: uppercase; }
    .rail .meal-icon { width: 60px; height: 60px; margin-top: 26px; }
    .rail .week { margin-top: 10px; font-size: 14px; font-weight: 900; line-height: 1.3; text-transform: uppercase; }
    .rail .updated { margin-top: auto; font-size: 14px; font-weight: 900; letter-spacing: .07em; line-height: 1.35; text-transform: uppercase; }
    .content { min-width: 0; padding: 15px 18px 12px; }
    header { display: flex; justify-content: space-between; align-items: baseline; padding-bottom: 9px; border-bottom: 4px solid var(--ink); }
    h1 { margin: 0; font-size: 35px; line-height: 1; }
    header span { font-size: 14px; font-weight: 900; letter-spacing: .09em; text-transform: uppercase; }
    .missing { border: 3px solid var(--ink); margin-top: 11px; padding: 8px 12px; font-size: 18px; font-weight: 900; text-align: center; }
    main { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px; height: ${globalState ? "306" : "348"}px; padding-top: 11px; }
    main section { min-width: 0; padding-right: 7px; border-right: 2px solid var(--ink); overflow: hidden; }
    main section:last-child { padding-right: 0; border-right: 0; }
    h2 { margin: 0 0 7px; padding-bottom: 5px; border-bottom: 2px solid var(--ink); font-size: 17px; line-height: 1; }
    .entree { min-width: 0; display: flex; flex-direction: column; align-items: center; gap: 3px; margin-bottom: 7px; padding: 6px 3px; border: 2px solid var(--ink); border-radius: 10px; font-size: 14px; font-weight: 800; line-height: 1.02; text-align: center; overflow: hidden; overflow-wrap: anywhere; }
    .entree:first-of-type { color: var(--paper); background: var(--ink); }
    .entree svg { width: 42px; height: 42px; flex: none; }
    .day-state { min-height: 64px; border: 2px solid var(--ink); border-radius: 10px; padding: 9px 5px; font-size: 15px; font-weight: 900; line-height: 1.15; }
    footer { display: flex; justify-content: space-between; border-top: 3px solid var(--ink); padding-top: 5px; font-size: 14px; font-weight: 900; text-transform: uppercase; }
    .stale { border: 2px solid var(--ink); padding: 1px 5px; }
  </style>
</head>
<body>
  <aside class="rail">
    <span class="number day-number">${escapeHtml(railDay)}</span>
    <span class="date">${escapeHtml(railWeekday)}<br>${escapeHtml(railMonth)}</span>
    <svg class="meal-icon" viewBox="0 0 48 48" role="img" aria-label="Lunch icon"><circle cx="24" cy="25" r="15" fill="none" stroke="currentColor" stroke-width="4"/><path d="M6 7v15m0-8h7M42 7v15" stroke="currentColor" stroke-width="4" stroke-linecap="round"/></svg>
    <span class="week">${model.week === "upcoming" ? "Upcoming school week" : "Current school week"}</span>
    <div class="updated">Lunch View<br>Updated ${updated}</div>
  </aside>
  <div class="content">
    <header><h1 class="serif">What’s for lunch</h1><span>Monday through Friday</span></header>
    ${globalState}
    <main>${days}</main>
    <footer><span>${model.stale ? `<span class="stale">⚠ Menu ${staleAge}</span>` : "School menu"}</span><span>Five school days</span></footer>
  </div>
</body>
</html>`;
}
