import {
  classifyLunchEntree,
  type LunchClassifierPorts,
  type LunchIcon,
  type LunchSnapshot
} from "./lunch";

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
  classifier: LunchClassifierPorts
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
    stale: failure !== null,
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

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=800,height=480,initial-scale=1">
  <style>
    * { box-sizing: border-box; }
    html, body { width: 800px; height: 480px; margin: 0; overflow: hidden; }
    body { color: #000; background: #fff; font-family: Arial, Helvetica, sans-serif; padding: 17px 24px 12px; }
    header { display: flex; justify-content: space-between; align-items: center; border-bottom: 4px solid #000; padding-bottom: 8px; }
    .heading { display: flex; align-items: center; gap: 10px; }
    header svg { width: 34px; height: 34px; }
    h1 { font-size: 32px; margin: 0; }
    header span { font-size: 17px; font-weight: 700; }
    .missing { border: 3px solid #000; margin-top: 12px; padding: 12px; font-size: 24px; font-weight: 700; text-align: center; }
    main { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; height: ${globalState ? "305" : "356"}px; padding-top: 11px; }
    section { border-right: 2px solid #000; padding-right: 7px; min-width: 0; }
    section:last-child { border-right: 0; padding-right: 0; }
    h2 { font-size: 18px; margin: 0 0 7px; border-bottom: 2px solid #000; padding-bottom: 5px; }
    .entree { display: flex; flex-direction: column; align-items: center; gap: 3px; border-bottom: 1px solid #000; padding: 5px 0; font-size: 15px; font-weight: 700; line-height: 1.05; text-align: center; overflow-wrap: anywhere; }
    .entree svg { width: 43px; height: 43px; flex: none; }
    .day-state { border: 2px solid #000; padding: 9px 5px; font-size: 16px; font-weight: 700; line-height: 1.15; }
    footer { display: flex; justify-content: space-between; border-top: 3px solid #000; padding-top: 6px; font-size: 14px; font-weight: 700; }
    .stale { border: 2px solid #000; padding: 1px 5px; }
  </style>
</head>
<body>
  <header><div class="heading"><svg viewBox="0 0 48 48" role="img" aria-label="Lunch icon"><circle cx="24" cy="25" r="15" fill="none" stroke="currentColor" stroke-width="4"/><path d="M6 7v15m0-8h7M42 7v15" stroke="currentColor" stroke-width="4" stroke-linecap="round"/></svg><h1>Lunch View</h1></div><span>${model.week === "upcoming" ? "Upcoming school week" : "Current school week"}</span></header>
  ${globalState}
  <main>${days}</main>
  <footer><span>${model.stale ? '<span class="stale">⚠ Last available menu</span>' : ""}</span><span>Updated ${updated}</span></footer>
</body>
</html>`;
}
