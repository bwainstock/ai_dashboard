import type { DailyBriefNotice } from "./generation";
import { DISPLAY_BASE_CSS } from "./display-style";

export interface NoticesViewModel {
  notices: DailyBriefNotice[];
  privateNoticeMarkers: Array<{ accountId: "mom" | "dad" }>;
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

function categoryIcon(category: DailyBriefNotice["category"]): string {
  const paths: Record<DailyBriefNotice["category"], string> = {
    school:
      '<path d="m24 7 19 10-19 10L5 17 24 7Z"/><path d="M12 23v11c7 6 17 6 24 0V23M43 18v17" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/>',
    childcare:
      '<circle cx="24" cy="17" r="8" fill="none" stroke="currentColor" stroke-width="4"/><path d="M10 43c1-12 7-18 14-18s13 6 14 18M8 14l8-6m24 6-8-6" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>',
    activity:
      '<path d="M9 34 20 23l8 8 11-17M8 41h32" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="39" cy="14" r="4"/>',
    household:
      '<path d="m6 23 18-15 18 15v19H29V30H19v12H6V23Z" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/>'
  };
  return `<svg viewBox="0 0 48 48" role="img" aria-label="${category} notice icon">${paths[category]}</svg>`;
}

export function noticesViewHtml(model: NoticesViewModel): string {
  const selectedMarkers = model.privateNoticeMarkers.slice(0, 2);
  const markers = selectedMarkers
    .map(
      ({ accountId }) =>
        `<li class="private"><svg viewBox="0 0 48 48" role="img" aria-label="Private notice icon"><rect x="9" y="21" width="30" height="22" rx="3" fill="none" stroke="currentColor" stroke-width="4"/><path d="M15 21v-6a9 9 0 0 1 18 0v6" fill="none" stroke="currentColor" stroke-width="4"/></svg><strong>${accountId === "mom" ? "Mom" : "Dad"} Private Notice</strong></li>`
    )
    .join("");
  const notices = model.notices
    .slice(0, 8 - selectedMarkers.length)
    .map((notice) => {
      const details = [
        notice.relevantDate,
        notice.action,
        notice.senderOrganization
      ]
        .filter((value): value is string => Boolean(value))
        .map(escapeHtml)
        .join(" · ");
      return `<li>${categoryIcon(notice.category)}<div><strong>${escapeHtml(notice.summary)}</strong><span>${details}</span></div></li>`;
    })
    .join("");
  const entryCount =
    selectedMarkers.length +
    Math.min(model.notices.length, 8 - selectedMarkers.length);
  const rowCount = Math.max(1, Math.min(4, Math.ceil(entryCount / 2)));
  const content =
    markers || notices
      ? `<ul class="${entryCount % 2 === 1 ? "odd" : ""}" style="grid-template-rows: repeat(${rowCount}, minmax(0, 1fr))">${markers}${notices}</ul>`
      : '<div class="empty" data-missing-state><svg viewBox="0 0 48 48" role="img" aria-label="Notices icon"><path d="M9 10h30v28H9zM15 18h18M15 25h18M15 32h12" fill="none" stroke="currentColor" stroke-width="4"/></svg><strong>No active Household Notices</strong></div>';
  const updated = new Intl.DateTimeFormat("en-US", {
    timeZone: model.timezone,
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(model.updatedAt));
  const renderedAt = new Date(model.updatedAt);
  const day = new Intl.DateTimeFormat("en-US", {
    timeZone: model.timezone,
    day: "numeric"
  }).format(renderedAt);
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: model.timezone,
    weekday: "short"
  }).format(renderedAt);
  const month = new Intl.DateTimeFormat("en-US", {
    timeZone: model.timezone,
    month: "short"
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
    .rail span, header span, footer span { overflow: hidden; }
    .rail .day-number { font-size: 70px; line-height: .8; }
    .rail .date { margin-top: 9px; font-size: 18px; font-weight: 900; line-height: 1.1; text-transform: uppercase; }
    .rail svg { width: 60px; height: 60px; margin-top: 28px; }
    .rail .count { margin-top: 12px; font-size: 14px; font-weight: 900; line-height: 1.3; text-transform: uppercase; }
    .rail .updated { margin-top: auto; font-size: 14px; font-weight: 900; letter-spacing: .07em; line-height: 1.35; text-transform: uppercase; }
    .content { min-width: 0; padding: 15px 18px 12px; }
    header { display: flex; justify-content: space-between; align-items: baseline; padding-bottom: 9px; border-bottom: 4px solid var(--ink); }
    h1 { margin: 0; font-size: 35px; line-height: 1; }
    header span { font-size: 14px; font-weight: 900; letter-spacing: .09em; text-transform: uppercase; }
    main { height: 352px; padding-top: 11px; }
    ul { height: 100%; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); grid-template-rows: repeat(4, minmax(0, 1fr)); grid-auto-flow: row; gap: 8px 12px; list-style: none; margin: 0; padding: 0; overflow: hidden; }
    ul.odd li:last-child { grid-column: 1 / 3; }
    li { display: flex; align-items: center; gap: 9px; min-width: 0; min-height: 0; border: 2px solid var(--ink); border-radius: 11px; padding: 7px 9px; overflow: hidden; }
    li:first-child { color: var(--paper); background: var(--ink); }
    li svg { width: 40px; height: 40px; flex: none; }
    li div { min-width: 0; max-height: 100%; overflow: hidden; }
    li strong { display: -webkit-box; font-size: 17px; font-style: italic; line-height: 1.03; overflow: hidden; overflow-wrap: anywhere; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
    li span { display: -webkit-box; margin-top: 4px; font-size: 14px; font-weight: 700; line-height: 1.05; overflow: hidden; overflow-wrap: anywhere; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
    .private { border-width: 3px; }
    .empty { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; border: 3px solid var(--ink); border-radius: 15px; font-size: 28px; font-style: italic; font-weight: 700; }
    .empty svg { width: 64px; height: 64px; }
    footer { display: flex; justify-content: space-between; border-top: 3px solid var(--ink); padding-top: 5px; font-size: 14px; font-weight: 900; text-transform: uppercase; }
  </style>
</head>
<body>
  <aside class="rail">
    <span class="number day-number">${escapeHtml(day)}</span>
    <span class="date">${escapeHtml(weekday)}<br>${escapeHtml(month)}</span>
    <svg viewBox="0 0 48 48" role="img" aria-label="Notices icon"><path d="M9 10h30v28H9zM15 18h18M15 25h18M15 32h12" fill="none" stroke="currentColor" stroke-width="4"/></svg>
    <span class="count">${entryCount} active notices</span>
    <div class="updated">Notices View<br>Updated ${updated}</div>
  </aside>
  <div class="content">
    <header><h1 class="serif">Household notices</h1><span>Important family updates</span></header>
    <main>${content}</main>
    <footer><span>Approved display fields only</span><span>Updated ${updated}</span></footer>
  </div>
</body>
</html>`;
}
