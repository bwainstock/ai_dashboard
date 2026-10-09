import type { DailyBriefNotice } from "./generation";

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
  const content =
    markers || notices
      ? `<ul>${markers}${notices}</ul>`
      : '<div class="empty" data-missing-state><svg viewBox="0 0 48 48" role="img" aria-label="Notices icon"><path d="M9 10h30v28H9zM15 18h18M15 25h18M15 32h12" fill="none" stroke="currentColor" stroke-width="4"/></svg><strong>No active Household Notices</strong></div>';
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
    header { display: flex; align-items: center; gap: 12px; border-bottom: 4px solid #000; padding-bottom: 8px; }
    header svg { width: 35px; height: 35px; }
    h1 { font-size: 32px; margin: 0; }
    main { height: 378px; padding-top: 10px; }
    ul { height: 100%; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); grid-template-rows: repeat(4, minmax(0, 1fr)); grid-auto-flow: row; gap: 7px 14px; list-style: none; margin: 0; padding: 0; overflow: hidden; }
    li { display: flex; align-items: center; gap: 10px; min-width: 0; min-height: 0; border-bottom: 2px solid #000; padding: 5px 0; overflow: hidden; }
    li svg { width: 42px; height: 42px; flex: none; }
    li div { min-width: 0; max-height: 100%; overflow: hidden; }
    li strong { display: -webkit-box; font-size: 18px; line-height: 1.08; overflow: hidden; overflow-wrap: anywhere; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
    li span { display: -webkit-box; margin-top: 4px; font-size: 14px; line-height: 1.1; overflow: hidden; overflow-wrap: anywhere; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
    .private { border: 3px solid #000; padding: 7px; }
    .empty { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; border: 3px solid #000; font-size: 25px; }
    .empty svg { width: 64px; height: 64px; }
    footer { display: flex; justify-content: flex-end; border-top: 3px solid #000; padding-top: 6px; font-size: 14px; font-weight: 700; }
  </style>
</head>
<body>
  <header><svg viewBox="0 0 48 48" role="img" aria-label="Notices icon"><path d="M9 10h30v28H9zM15 18h18M15 25h18M15 32h12" fill="none" stroke="currentColor" stroke-width="4"/></svg><h1>Notices View</h1></header>
  <main>${content}</main>
  <footer>Updated ${updated}</footer>
</body>
</html>`;
}
