import type { DailyBriefWeatherModel } from "./generation";

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

export function dailyBriefHtml(model: DailyBriefWeatherModel): string {
  const { weather } = model;
  const updated = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(model.updatedAt));
  const stale = model.stale
    ? `<strong class="stale">⚠ Weather is using the last available update</strong>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=800,height=480,initial-scale=1">
  <style>
    * { box-sizing: border-box; }
    html, body { width: 800px; height: 480px; margin: 0; overflow: hidden; }
    body { color: #000; background: #fff; font-family: Arial, Helvetica, sans-serif; padding: 26px 34px 20px; }
    header { display: flex; align-items: center; justify-content: space-between; border-bottom: 4px solid #000; padding-bottom: 18px; }
    .current { display: flex; align-items: center; gap: 18px; }
    svg { width: 82px; height: 82px; flex: none; }
    h1 { font-size: 58px; line-height: .9; margin: 0; }
    .condition { font-size: 25px; font-weight: 700; margin-top: 8px; }
    .title { text-align: right; }
    .title strong { display: block; font-size: 31px; }
    .title span { font-size: 20px; }
    main { display: grid; grid-template-columns: 1fr 1fr; gap: 22px; padding-top: 22px; }
    section { border: 3px solid #000; border-radius: 10px; padding: 18px 20px; min-height: 245px; }
    h2 { font-size: 29px; margin: 0 0 14px; }
    .day { display: flex; gap: 14px; align-items: center; }
    .day svg { width: 66px; height: 66px; }
    .day-condition { font-size: 24px; font-weight: 700; }
    .details { font-size: 21px; line-height: 1.45; margin: 18px 0 0; }
    footer { display: flex; justify-content: space-between; align-items: center; font-size: 17px; padding-top: 13px; }
    .stale { border: 2px solid #000; padding: 3px 7px; }
  </style>
</head>
<body>
  <header>
    <div class="current">
      ${weatherIcon(weather.current.condition)}
      <div>
        <h1>${temperature(weather.current.temperature)}F</h1>
        <div class="condition">${escapeHtml(weather.current.condition)}</div>
      </div>
    </div>
    <div class="title"><strong>Daily Brief</strong><span>Local weather</span></div>
  </header>
  <main>
    <section>
      <h2>Today</h2>
      <div class="day">${weatherIcon(weather.today.condition)}<span class="day-condition">${escapeHtml(weather.today.condition)}</span></div>
      <p class="details">High ${temperature(weather.today.high)} · Low ${temperature(weather.today.low)} · Rain ${Math.round(weather.today.precipitationProbability)}%</p>
    </section>
    <section>
      <h2>Tomorrow</h2>
      <div class="day">${weatherIcon(weather.tomorrow.condition)}<span class="day-condition">${escapeHtml(weather.tomorrow.condition)}</span></div>
      <p class="details">High ${temperature(weather.tomorrow.high)} · Low ${temperature(weather.tomorrow.low)} · Rain ${Math.round(weather.tomorrow.precipitationProbability)}%</p>
    </section>
  </main>
  <footer>${stale}<span>Updated ${updated}</span></footer>
</body>
</html>`;
}
