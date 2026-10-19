import type { CalendarFeedFetchFailureCode } from "./calendar-feed-fetch";

export type AdministrationPageRole = "administrator" | "reviewer";

type CalendarFeedFailureMessages = Record<
  CalendarFeedFetchFailureCode,
  string
>;

function assetResponse(body: string, contentType: string): Response {
  return new Response(body, {
    headers: {
      "cache-control": "no-store",
      "content-security-policy": "default-src 'none'",
      "content-type": contentType,
      "x-content-type-options": "nosniff"
    }
  });
}

export function administrationPage(
  role: AdministrationPageRole
): Response {
  const disabled = role === "administrator" ? "" : " disabled";
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#173f35">
  <title>Family Dashboard administration</title>
  <link rel="stylesheet" href="/admin/app.css">
</head>
<body data-role="${role}">
  <div class="app-shell">
    <aside class="sidebar">
      <a class="brand" href="#overview" aria-label="Family Dashboard administration">
        <span class="brand-mark" aria-hidden="true">FD</span>
        <span><strong>Family Dashboard</strong><small>Administration</small></span>
      </a>
      <nav class="primary-nav" aria-label="Administration sections">
        <a href="#overview" data-route="overview">
          <span aria-hidden="true">⌂</span><span>Overview</span>
        </a>
        <a href="#feeds" data-route="feeds">
          <span aria-hidden="true">☷</span><span>Calendar Feeds</span>
        </a>
        <a href="#settings" data-route="settings">
          <span aria-hidden="true">⚙</span><span>Settings</span>
        </a>
      </nav>
      <div class="sidebar-footer">
        <span class="role-badge">${role}</span>
        <p>${role === "administrator" ? "Full management access" : "Read-only access"}</p>
      </div>
    </aside>

    <div class="workspace">
      <header class="topbar">
        <a class="compact-brand" href="#overview">
          <span class="brand-mark" aria-hidden="true">FD</span>
          <strong>Dashboard Admin</strong>
        </a>
        <button id="refresh-button" class="icon-button" type="button" aria-label="Refresh administration data">
          <span aria-hidden="true">↻</span>
        </button>
      </header>

      <main>
        <section class="view" data-view="overview">
          <div class="page-heading">
            <div>
              <p class="eyebrow">Control center</p>
              <h1>Dashboard overview</h1>
              <p>Monitor generation health, source freshness, and the display from one place.</p>
            </div>
            <div id="sync-indicator" class="sync-indicator" role="status" aria-live="polite">
              <span class="sync-dot" aria-hidden="true"></span>
              <span data-sync-label>Connecting…</span>
            </div>
          </div>

          <article id="system-summary" class="system-summary is-loading" aria-live="polite">
            <div class="summary-icon" aria-hidden="true">…</div>
            <div>
              <p class="eyebrow">System status</p>
              <h2>Loading operational status</h2>
              <p>Checking the latest generation and source health.</p>
            </div>
          </article>

          <div class="status-grid">
            <article class="card span-2">
              <div class="card-heading">
                <div>
                  <p class="eyebrow">Publishing</p>
                  <h2>Latest generation</h2>
                </div>
                <span id="generation-state" class="status-chip neutral">Loading</span>
              </div>
              <div id="generation-details" class="card-content loading-copy">Loading generation details…</div>
            </article>

            <article class="card">
              <div class="card-heading">
                <div>
                  <p class="eyebrow">Hardware</p>
                  <h2>Display</h2>
                </div>
                <span id="device-state" class="status-chip neutral">Loading</span>
              </div>
              <div id="device-details" class="card-content loading-copy">Loading device details…</div>
            </article>

            <article class="card span-2">
              <div class="card-heading">
                <div>
                  <p class="eyebrow">Inputs</p>
                  <h2>Data sources</h2>
                </div>
              </div>
              <div id="source-status" class="source-list loading-copy">Loading source health…</div>
            </article>

            <article class="card">
              <div class="card-heading">
                <div>
                  <p class="eyebrow">Action</p>
                  <h2>Publish now</h2>
                </div>
              </div>
              <p>Refresh enabled feeds and publish a new view set. The display fetches it on its next scheduled refresh or reconnect.</p>
              <button id="generate-dashboard" class="button primary full-width" type="button"${disabled}>
                Generate dashboard
              </button>
              <output id="generation-output" class="form-message" aria-live="polite"></output>
            </article>

            <article class="card span-full">
              <div class="card-heading">
                <div>
                  <p class="eyebrow">Alerts</p>
                  <h2>Open incidents</h2>
                </div>
                <span id="incident-count" class="count-badge">0</span>
              </div>
              <div id="incident-list" class="incident-list loading-copy">Loading incidents…</div>
            </article>
          </div>
        </section>

        <section class="view" data-view="feeds" hidden>
          <div class="page-heading">
            <div>
              <p class="eyebrow">Sources</p>
              <h1>Calendar Feeds</h1>
              <p>Manage redacted feed metadata, labels, health, and secure activation.</p>
            </div>
            <span id="feed-count" class="count-badge">0 feeds</span>
          </div>

          <article class="card callout">
            <div>
              <p class="eyebrow">Privacy protected</p>
              <h2>Feed URLs are never displayed</h2>
              <p>URLs are encrypted after saving. New feeds remain disabled until the secure feed test succeeds.</p>
            </div>
          </article>

          <article class="card">
            <div class="card-heading">
              <div>
                <p class="eyebrow">Add source</p>
                <h2>New Calendar Feed</h2>
              </div>
            </div>
            <form id="calendar-feed-form" class="form-grid">
              <label class="field span-full">
                <span>Feed URL</span>
                <input name="url" type="url" maxlength="4096" autocomplete="off" placeholder="https://…" required${disabled}>
              </label>
              <label class="field">
                <span>Calendar label</span>
                <input name="calendarLabel" maxlength="40" placeholder="School" required${disabled}>
              </label>
              <label class="field">
                <span>Household label <small>Optional</small></span>
                <input name="householdLabel" maxlength="20" placeholder="Family"${disabled}>
              </label>
              <div class="form-actions span-full">
                <button class="button primary" type="submit"${disabled}>Add Calendar Feed</button>
                <output class="form-message" aria-live="polite"></output>
              </div>
            </form>
          </article>

          <div id="calendar-feeds" class="feed-list" aria-live="polite">
            <article class="card loading-copy">Loading Calendar Feeds…</article>
          </div>
        </section>

        <section class="view" data-view="settings" hidden>
          <div class="page-heading">
            <div>
              <p class="eyebrow">Configuration</p>
              <h1>Weather & schedule</h1>
              <p>Set the forecast location and daily generation schedule.</p>
            </div>
          </div>

          <article class="card">
            <form id="weather-form" class="form-grid">
              <label class="field">
                <span>Latitude</span>
                <input name="latitude" type="number" step="any" inputmode="decimal" required${disabled}>
              </label>
              <label class="field">
                <span>Longitude</span>
                <input name="longitude" type="number" step="any" inputmode="decimal" required${disabled}>
              </label>
              <label class="field span-full">
                <span>Refresh times</span>
                <input name="slots" placeholder="06:30, 10:30, 15:00, 19:00" required${disabled}>
                <small>Comma-separated local times in 24-hour format.</small>
              </label>
              <div class="form-actions span-full">
                <button class="button primary" type="submit"${disabled}>Save weather settings</button>
                <output class="form-message" aria-live="polite"></output>
              </div>
            </form>
          </article>
        </section>
      </main>
    </div>
  </div>

  <nav class="mobile-nav" aria-label="Administration sections">
    <a href="#overview" data-route="overview"><span aria-hidden="true">⌂</span><span>Overview</span></a>
    <a href="#feeds" data-route="feeds"><span aria-hidden="true">☷</span><span>Feeds</span></a>
    <a href="#settings" data-route="settings"><span aria-hidden="true">⚙</span><span>Settings</span></a>
  </nav>
  <div id="toast-region" class="toast-region" aria-live="polite" aria-atomic="true"></div>
  <script src="/admin/app.js" defer></script>
</body>
</html>`;
  return new Response(html, {
    headers: {
      "cache-control": "no-store",
      "content-security-policy":
        "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      "content-type": "text/html; charset=utf-8",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff"
    }
  });
}

export function administrationStyles(): Response {
  const styles = `:root {
  color-scheme: light;
  --ink: #16231f;
  --muted: #61706b;
  --faint: #87928e;
  --canvas: #f3f5f1;
  --surface: #ffffff;
  --line: #dfe5df;
  --line-strong: #cdd6ce;
  --brand: #1f6650;
  --brand-dark: #173f35;
  --brand-soft: #e6f1ec;
  --success: #247653;
  --success-soft: #e3f3ea;
  --warning: #9a6115;
  --warning-soft: #fff1d8;
  --danger: #a53d38;
  --danger-soft: #fbe9e7;
  --info: #346b91;
  --info-soft: #e7f1f8;
  --shadow: 0 10px 30px rgba(28, 50, 42, 0.07);
  --radius: 18px;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

* { box-sizing: border-box; }
html { background: var(--canvas); scroll-behavior: smooth; }
body { margin: 0; color: var(--ink); background: var(--canvas); min-width: 320px; }
button, input { font: inherit; }
button, a { -webkit-tap-highlight-color: transparent; }
a { color: inherit; }
button { border: 0; }
[hidden] { display: none !important; }

.app-shell { min-height: 100vh; }
.sidebar { display: none; }
.workspace { min-width: 0; }
.topbar {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 64px;
  padding: env(safe-area-inset-top) 18px 0;
  border-bottom: 1px solid rgba(205, 214, 206, 0.86);
  background: rgba(243, 245, 241, 0.92);
  backdrop-filter: blur(14px);
}
.compact-brand, .brand {
  display: flex;
  align-items: center;
  gap: 11px;
  text-decoration: none;
}
.brand-mark {
  display: grid;
  width: 38px;
  height: 38px;
  place-items: center;
  border-radius: 12px;
  color: white;
  background: var(--brand);
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0.04em;
}
.compact-brand strong { font-size: 15px; }
.icon-button {
  display: grid;
  width: 44px;
  height: 44px;
  place-items: center;
  border: 1px solid var(--line);
  border-radius: 13px;
  color: var(--brand-dark);
  background: var(--surface);
  cursor: pointer;
}
.icon-button:hover { border-color: var(--line-strong); background: var(--brand-soft); }
.icon-button.is-spinning span { animation: spin 0.8s linear infinite; }

main {
  width: min(1120px, 100%);
  margin: 0 auto;
  padding: 26px 16px calc(100px + env(safe-area-inset-bottom));
}
.view { animation: view-in 0.22s ease-out; }
.page-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
  margin-bottom: 22px;
}
.page-heading h1 { margin: 2px 0 7px; font-size: clamp(27px, 7vw, 40px); line-height: 1.08; letter-spacing: -0.035em; }
.page-heading > div > p:last-child { max-width: 650px; margin: 0; color: var(--muted); line-height: 1.55; }
.eyebrow {
  margin: 0;
  color: var(--brand);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.13em;
  text-transform: uppercase;
}
.sync-indicator {
  display: none;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
  min-height: 36px;
  padding: 0 12px;
  border: 1px solid var(--line);
  border-radius: 999px;
  color: var(--muted);
  background: var(--surface);
  font-size: 13px;
  font-weight: 650;
}
.sync-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--faint); }
.sync-indicator.connected .sync-dot { background: var(--success); }
.sync-indicator.syncing .sync-dot { background: var(--info); animation: pulse 1s ease-in-out infinite; }
.sync-indicator.error .sync-dot { background: var(--danger); }

.system-summary {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 16px;
  padding: 20px;
  border: 1px solid #bddcca;
  border-radius: var(--radius);
  background: linear-gradient(135deg, #e8f5ed, #f8fbf9);
  box-shadow: var(--shadow);
}
.system-summary.warning { border-color: #ecd09a; background: linear-gradient(135deg, #fff2d9, #fffaf1); }
.system-summary.danger { border-color: #efc0bb; background: linear-gradient(135deg, #fbe7e5, #fff7f6); }
.system-summary.info { border-color: #bed7e8; background: linear-gradient(135deg, #e7f2f9, #f7fbfd); }
.summary-icon {
  display: grid;
  flex: 0 0 auto;
  width: 48px;
  height: 48px;
  place-items: center;
  border-radius: 15px;
  color: white;
  background: var(--success);
  font-size: 22px;
  font-weight: 800;
}
.warning .summary-icon { background: var(--warning); }
.danger .summary-icon { background: var(--danger); }
.info .summary-icon { background: var(--info); }
.system-summary h2 { margin: 3px 0 4px; font-size: 20px; }
.system-summary p:last-child { margin: 0; color: var(--muted); line-height: 1.45; }
.system-summary.is-loading { opacity: 0.72; }

.status-grid { display: grid; gap: 14px; }
.card {
  padding: 20px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
  box-shadow: var(--shadow);
}
.card > p { color: var(--muted); line-height: 1.55; }
.card-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  margin-bottom: 16px;
}
.card-heading h2, .callout h2 { margin: 3px 0 0; font-size: 18px; letter-spacing: -0.018em; }
.card-content { min-height: 68px; }
.metric { margin: 0 0 5px; font-size: 24px; font-weight: 780; letter-spacing: -0.03em; }
.supporting { margin: 0; color: var(--muted); font-size: 14px; line-height: 1.5; }
.technical { margin-top: 12px; color: var(--faint); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; word-break: break-all; }
.loading-copy { color: var(--muted); }

.status-chip, .count-badge, .role-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 28px;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 750;
  white-space: nowrap;
}
.status-chip.success { color: var(--success); background: var(--success-soft); }
.status-chip.warning { color: var(--warning); background: var(--warning-soft); }
.status-chip.danger { color: var(--danger); background: var(--danger-soft); }
.status-chip.info { color: var(--info); background: var(--info-soft); }
.status-chip.neutral, .count-badge { color: var(--muted); background: #edf0ed; }
.count-badge { min-height: 32px; }

.source-list, .incident-list { display: grid; gap: 1px; overflow: hidden; border: 1px solid var(--line); border-radius: 13px; background: var(--line); }
.source-row, .incident-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  padding: 13px 14px;
  background: var(--surface);
}
.source-name, .incident-code { font-weight: 720; text-transform: capitalize; }
.source-meta, .incident-meta { margin-top: 3px; color: var(--muted); font-size: 12px; line-height: 1.4; }
.empty-state { padding: 26px 16px; color: var(--muted); text-align: center; background: var(--surface); }

.button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 46px;
  padding: 10px 16px;
  border: 1px solid transparent;
  border-radius: 13px;
  font-weight: 750;
  text-decoration: none;
  cursor: pointer;
  transition: transform 0.12s ease, background 0.12s ease, border-color 0.12s ease;
}
.button:active:not(:disabled) { transform: translateY(1px); }
.button.primary { color: white; background: var(--brand); }
.button.primary:hover:not(:disabled) { background: var(--brand-dark); }
.button.secondary { color: var(--brand-dark); border-color: var(--line-strong); background: var(--surface); }
.button.secondary:hover:not(:disabled) { background: var(--brand-soft); border-color: #aac7ba; }
.button.danger { color: var(--danger); border-color: #edc7c3; background: var(--surface); }
.button.danger:hover:not(:disabled) { background: var(--danger-soft); }
.button:disabled, .icon-button:disabled { cursor: not-allowed; opacity: 0.5; }
.button.busy { cursor: wait; opacity: 0.76; }
.full-width { width: 100%; margin-top: 14px; }

.callout { margin-bottom: 14px; border-color: #cde0d6; background: var(--brand-soft); }
.callout p:last-child { margin-bottom: 0; }
.form-grid { display: grid; gap: 16px; }
.field { display: grid; gap: 7px; min-width: 0; }
.field > span { font-size: 13px; font-weight: 720; }
.field small { color: var(--muted); font-weight: 500; }
.field > small { margin-top: -1px; line-height: 1.4; }
input {
  width: 100%;
  min-height: 48px;
  padding: 10px 12px;
  border: 1px solid var(--line-strong);
  border-radius: 12px;
  color: var(--ink);
  background: var(--surface);
  outline: none;
}
input:focus { border-color: var(--brand); box-shadow: 0 0 0 3px rgba(31, 102, 80, 0.12); }
input:disabled { color: var(--muted); background: #f1f3f1; }
.form-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; }
.form-message { min-height: 20px; color: var(--muted); font-size: 13px; line-height: 1.45; }
.form-message.error { color: var(--danger); }
.form-message.success { color: var(--success); }

.feed-list { display: grid; gap: 14px; margin-top: 14px; }
.feed-card { overflow: hidden; padding: 0; }
.feed-summary { padding: 20px; }
.feed-summary-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.feed-summary h2 { margin: 2px 0 4px; font-size: 19px; overflow-wrap: anywhere; }
.feed-host { color: var(--muted); font-size: 13px; overflow-wrap: anywhere; }
.feed-stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin-top: 18px;
}
.feed-stat { padding: 12px; border-radius: 12px; background: var(--canvas); }
.feed-stat strong { display: block; margin-bottom: 3px; font-size: 17px; }
.feed-stat span { color: var(--muted); font-size: 11px; line-height: 1.35; }
.feed-card details { border-top: 1px solid var(--line); }
.feed-card summary {
  min-height: 50px;
  padding: 14px 20px;
  color: var(--brand);
  font-size: 13px;
  font-weight: 750;
  cursor: pointer;
  list-style-position: inside;
}
.feed-controls { display: grid; gap: 17px; padding: 4px 20px 20px; }
.feed-actions { display: flex; flex-wrap: wrap; gap: 9px; }
.feed-actions .button { flex: 1 1 140px; }
.feed-fingerprint { color: var(--faint); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; }

.mobile-nav {
  position: fixed;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 30;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  padding: 7px 8px calc(7px + env(safe-area-inset-bottom));
  border-top: 1px solid var(--line-strong);
  background: rgba(255, 255, 255, 0.96);
  backdrop-filter: blur(16px);
}
.mobile-nav a {
  display: grid;
  min-height: 53px;
  place-items: center;
  align-content: center;
  gap: 2px;
  border-radius: 12px;
  color: var(--muted);
  font-size: 11px;
  font-weight: 700;
  text-decoration: none;
}
.mobile-nav a span:first-child { font-size: 19px; line-height: 1; }
.mobile-nav a.active { color: var(--brand); background: var(--brand-soft); }

.toast-region { position: fixed; right: 14px; bottom: calc(82px + env(safe-area-inset-bottom)); left: 14px; z-index: 50; pointer-events: none; }
.toast {
  max-width: 440px;
  margin: 8px auto 0;
  padding: 13px 15px;
  border: 1px solid var(--line-strong);
  border-radius: 13px;
  color: white;
  background: var(--brand-dark);
  box-shadow: 0 16px 40px rgba(19, 45, 37, 0.22);
  font-size: 13px;
  font-weight: 650;
  animation: toast-in 0.2s ease-out;
}
.toast.error { background: #7d302c; }

@media (min-width: 620px) {
  main { padding-right: 24px; padding-left: 24px; }
  .sync-indicator { display: inline-flex; }
  .status-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .span-2, .span-full { grid-column: 1 / -1; }
  .form-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .span-full { grid-column: 1 / -1; }
  .feed-stats { grid-template-columns: repeat(4, minmax(0, 1fr)); }
}

@media (min-width: 920px) {
  .app-shell { display: grid; grid-template-columns: 250px minmax(0, 1fr); }
  .sidebar {
    position: sticky;
    top: 0;
    display: flex;
    flex-direction: column;
    height: 100vh;
    padding: 28px 18px 22px;
    color: white;
    background: var(--brand-dark);
  }
  .brand { padding: 0 8px; }
  .brand .brand-mark { color: var(--brand-dark); background: #bde2ce; }
  .brand strong, .brand small { display: block; }
  .brand strong { font-size: 15px; }
  .brand small { margin-top: 2px; color: #afc8bf; font-size: 11px; }
  .primary-nav { display: grid; gap: 6px; margin-top: 42px; }
  .primary-nav a {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 47px;
    padding: 0 13px;
    border-radius: 12px;
    color: #c6d7d1;
    font-size: 14px;
    font-weight: 680;
    text-decoration: none;
  }
  .primary-nav a span:first-child { width: 20px; font-size: 18px; text-align: center; }
  .primary-nav a:hover, .primary-nav a.active { color: white; background: rgba(255, 255, 255, 0.1); }
  .sidebar-footer { margin-top: auto; padding: 16px 9px 0; border-top: 1px solid rgba(255, 255, 255, 0.13); }
  .role-badge { color: #123a2e; background: #bde2ce; text-transform: capitalize; }
  .sidebar-footer p { margin: 8px 0 0; color: #abc2ba; font-size: 11px; }
  .topbar, .mobile-nav { display: none; }
  main { padding: 48px 38px 64px; }
  .status-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
  .span-2 { grid-column: span 2; }
  .span-full { grid-column: 1 / -1; }
  .toast-region { right: 28px; bottom: 28px; left: auto; width: 440px; }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { scroll-behavior: auto !important; animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; }
}

@keyframes spin { to { transform: rotate(360deg); } }
@keyframes pulse { 50% { opacity: 0.35; } }
@keyframes view-in { from { opacity: 0; transform: translateY(5px); } }
@keyframes toast-in { from { opacity: 0; transform: translateY(8px); } }`;
  return assetResponse(styles, "text/css; charset=utf-8");
}

export function administrationScript(
  failureMessages: CalendarFeedFailureMessages
): Response {
  const script = `const POLL_INTERVAL_MS = 8000;
const role = document.body.dataset.role;
const isAdministrator = role === "administrator";
const calendarFeedFailureMessages = ${JSON.stringify(failureMessages)};
const routes = new Set(["overview", "feeds", "settings"]);
const weatherForm = document.querySelector("#weather-form");
const calendarFeedForm = document.querySelector("#calendar-feed-form");
const calendarFeedsBox = document.querySelector("#calendar-feeds");
const generateDashboardButton = document.querySelector("#generate-dashboard");
const generationOutput = document.querySelector("#generation-output");
const refreshButton = document.querySelector("#refresh-button");
const syncIndicator = document.querySelector("#sync-indicator");
const syncLabel = syncIndicator.querySelector("[data-sync-label]");
const toastRegion = document.querySelector("#toast-region");
let pollTimer;
let refreshPromise;
let renderedFeeds = "";
let queuedFeedValue;

function create(tag, className, value) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (value !== undefined) element.textContent = value;
  return element;
}

function formatCode(value) {
  return value ? value.toLowerCase().replaceAll("_", " ") : "";
}

function formatDate(value) {
  if (!value) return "Not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not available";
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function relativeTime(value) {
  if (!value) return "No activity recorded";
  const date = new Date(value);
  const elapsed = Date.now() - date.getTime();
  if (Number.isNaN(elapsed)) return "Time unavailable";
  const seconds = Math.round(Math.abs(elapsed) / 1000);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (seconds < 60) return formatter.format(-Math.round(seconds), "second");
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return formatter.format(-minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (hours < 24) return formatter.format(-hours, "hour");
  return formatter.format(-Math.round(hours / 24), "day");
}

function statusClass(value) {
  const normalized = String(value || "").toLowerCase();
  if (["healthy", "fresh", "published", "online"].includes(normalized)) return "success";
  if (["stale", "pending", "retrying"].includes(normalized)) return "warning";
  if (["error", "failed", "unavailable"].includes(normalized)) return "danger";
  if (["running", "testing"].includes(normalized)) return "info";
  return "neutral";
}

function statusChip(value) {
  return create("span", "status-chip " + statusClass(value), value || "Unknown");
}

function setMessage(output, message, kind) {
  output.textContent = message;
  output.className = "form-message" + (kind ? " " + kind : "");
}

function toast(message, kind) {
  const element = create("div", "toast" + (kind === "error" ? " error" : ""), message);
  toastRegion.replaceChildren(element);
  window.setTimeout(() => {
    if (element.isConnected) element.remove();
  }, 4200);
}

async function responseError(response, fallback) {
  try {
    const body = await response.json();
    const detail = calendarFeedFailureMessages[body.code] || body.error || body.code;
    return typeof detail === "string" && detail ? detail : fallback;
  } catch {
    return fallback;
  }
}

async function read(url) {
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    cache: "no-store"
  });
  if (!response.ok) throw new Error(await responseError(response, "Request failed"));
  return response.json();
}

function setSyncState(state, label) {
  syncIndicator.className = "sync-indicator " + state;
  syncLabel.textContent = label;
  refreshButton.classList.toggle("is-spinning", state === "syncing");
  refreshButton.disabled = state === "syncing";
}

function showRoute() {
  const requested = location.hash.slice(1);
  const route = routes.has(requested) ? requested : "overview";
  for (const view of document.querySelectorAll("[data-view]")) {
    view.hidden = view.dataset.view !== route;
  }
  for (const link of document.querySelectorAll("[data-route]")) {
    const active = link.dataset.route === route;
    link.classList.toggle("active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  document.title =
    (route === "overview" ? "Overview" : route === "feeds" ? "Calendar Feeds" : "Settings") +
    " · Family Dashboard";
  window.scrollTo({ top: 0, behavior: "instant" });
}

function renderSystemSummary(value) {
  const summary = document.querySelector("#system-summary");
  const attempt = value.rendering.latestAttempt;
  const sources = value.sources || [];
  const incidents = value.incidents || [];
  let tone = "success";
  let icon = "✓";
  let heading = "All systems are ready";
  let detail = "The latest view set is published and no operational incidents are open.";
  if (incidents.length > 0 || attempt?.state === "failed" || sources.some((source) => source.state === "error")) {
    tone = "danger";
    icon = "!";
    heading = "Attention is needed";
    detail = incidents.length > 0
      ? incidents.length + " operational incident" + (incidents.length === 1 ? " is" : "s are") + " open."
      : "A generation or source needs review.";
  } else if (attempt?.state === "running") {
    tone = "info";
    icon = "↻";
    heading = "Generation in progress";
    detail = "This page will update automatically when publishing finishes.";
  } else if (sources.some((source) => source.state === "stale")) {
    tone = "warning";
    icon = "i";
    heading = "Some source data is stale";
    detail = "The published dashboard is available while source recovery continues.";
  }
  summary.className = "system-summary " + tone;
  summary.querySelector(".summary-icon").textContent = icon;
  summary.querySelector("h2").textContent = heading;
  summary.querySelector("p:last-child").textContent = detail;
}

function renderGeneration(value) {
  const state = document.querySelector("#generation-state");
  const details = document.querySelector("#generation-details");
  const attempt = value.rendering.latestAttempt;
  const attemptState = attempt?.state || (value.rendering.lastSuccessfulAt ? "published" : "unknown");
  state.className = "status-chip " + statusClass(attemptState);
  state.textContent = attemptState === "published" ? "Published" : attemptState;
  details.replaceChildren();
  details.append(
    create("p", "metric", value.rendering.lastSuccessfulAt ? formatDate(value.rendering.lastSuccessfulAt) : "No publication"),
    create("p", "supporting", value.rendering.lastSuccessfulAt
      ? "Last successful publication · " + relativeTime(value.rendering.lastSuccessfulAt)
      : "No successful generation has been recorded.")
  );
  if (attempt) {
    const attemptParts = ["Attempt " + attempt.attempt];
    if (attempt.retryAt) attemptParts.push("retry " + formatDate(attempt.retryAt));
    if (attempt.errorCode) attemptParts.push(formatCode(attempt.errorCode));
    details.append(create("p", "technical", attemptParts.join(" · ")));
  } else if (value.rendering.currentGenerationId) {
    details.append(create("p", "technical", value.rendering.currentGenerationId));
  }
}

function renderDevice(value) {
  const state = document.querySelector("#device-state");
  const details = document.querySelector("#device-details");
  const checkIn = value.device.lastCheckInAt;
  state.className = "status-chip " + (checkIn ? "success" : "warning");
  state.textContent = checkIn ? "Checked in" : "No check-in";
  details.replaceChildren(
    create("p", "metric", checkIn ? relativeTime(checkIn) : "Not recorded"),
    create("p", "supporting", checkIn ? "Last device contact · " + formatDate(checkIn) : "The display has not reported a check-in.")
  );
}

function renderSources(sources) {
  const box = document.querySelector("#source-status");
  if (!sources.length) {
    box.replaceChildren(create("div", "empty-state", "No source status is available."));
    return;
  }
  const rows = sources.map((source) => {
    const row = create("div", "source-row");
    const copy = create("div");
    copy.append(
      create("div", "source-name", source.source),
      create("div", "source-meta", source.lastSuccessfulAt
        ? "Last successful " + relativeTime(source.lastSuccessfulAt)
        : source.errorCode
          ? formatCode(source.errorCode)
          : "No successful update recorded")
    );
    row.append(copy, statusChip(source.state));
    return row;
  });
  box.replaceChildren(...rows);
}

function renderIncidents(incidents) {
  const box = document.querySelector("#incident-list");
  const count = document.querySelector("#incident-count");
  count.textContent = String(incidents.length);
  if (!incidents.length) {
    box.replaceChildren(create("div", "empty-state", "No open operational incidents."));
    return;
  }
  box.replaceChildren(...incidents.map((incident) => {
    const row = create("div", "incident-row");
    const copy = create("div");
    copy.append(
      create("div", "incident-code", formatCode(incident.errorCode)),
      create("div", "incident-meta", "Opened " + relativeTime(incident.occurredAt) + (incident.notifiedAt ? " · notification sent" : ""))
    );
    row.append(copy, statusChip("Open"));
    return row;
  }));
}

function renderStatus(value) {
  renderSystemSummary(value);
  renderGeneration(value);
  renderDevice(value);
  renderSources(value.sources || []);
  renderIncidents(value.incidents || []);
}

async function loadStatus() {
  renderStatus(await read("/admin/status"));
}

function feedStat(value, label) {
  const stat = create("div", "feed-stat");
  stat.append(create("strong", "", value), create("span", "", label));
  return stat;
}

function feedRow(feed) {
  const form = create("form", "card feed-card");
  form.dataset.feedId = feed.id;
  const summary = create("div", "feed-summary");
  const top = create("div", "feed-summary-top");
  const identity = create("div");
  identity.append(
    create("p", "eyebrow", feed.householdLabel || "Calendar Feed"),
    create("h2", "", feed.calendarLabel),
    create("div", "feed-host", feed.hostname)
  );
  top.append(identity, statusChip(feed.status));
  const stats = create("div", "feed-stats");
  stats.append(
    feedStat(feed.eventCount ?? "—", "Ingested events"),
    feedStat(feed.skippedEventCount ?? "—", "Skipped events"),
    feedStat(feed.snapshotFetchedAt ? relativeTime(feed.snapshotFetchedAt) : "Never", "Snapshot"),
    feedStat(feed.lastSuccessAt ? relativeTime(feed.lastSuccessAt) : "Never", "Last success")
  );
  summary.append(top, stats);
  const details = document.createElement("details");
  const detailsSummary = create("summary", "", isAdministrator ? "Manage feed" : "View feed details");
  const controls = create("div", "feed-controls");
  const labels = create("div", "form-grid");
  const calendarLabel = create("label", "field");
  calendarLabel.innerHTML = "<span>Calendar label</span><input name=\\"calendarLabel\\" maxlength=\\"40\\" required>";
  calendarLabel.querySelector("input").value = feed.calendarLabel;
  const householdLabel = create("label", "field");
  householdLabel.innerHTML = "<span>Household label <small>Optional</small></span><input name=\\"householdLabel\\" maxlength=\\"20\\">";
  householdLabel.querySelector("input").value = feed.householdLabel || "";
  labels.append(calendarLabel, householdLabel);
  const replacement = create("label", "field");
  replacement.innerHTML = "<span>Replacement URL <small>Optional</small></span><input name=\\"replacementUrl\\" type=\\"url\\" maxlength=\\"4096\\" autocomplete=\\"off\\" placeholder=\\"https://…\\">";
  const actions = create("div", "feed-actions");
  const save = create("button", "button secondary", "Save labels");
  save.type = "submit";
  const test = create("button", "button primary", feed.enabled ? "Test or replace URL" : "Test and activate");
  test.type = "button";
  test.dataset.test = "";
  const disable = create("button", "button secondary", "Disable");
  disable.type = "button";
  disable.dataset.disable = "";
  disable.disabled = !feed.enabled || !isAdministrator;
  const remove = create("button", "button danger", "Delete");
  remove.type = "button";
  remove.dataset.delete = "";
  const output = create("output", "form-message");
  output.setAttribute("aria-live", "polite");
  actions.append(save, test, disable, remove);
  controls.append(labels, replacement, actions, create("div", "feed-fingerprint", "URL fingerprint " + feed.fingerprint), output);
  details.append(detailsSummary, controls);
  form.append(summary, details);
  if (!isAdministrator) {
    for (const control of form.querySelectorAll("input, button")) control.disabled = true;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setMessage(output, "Saving…");
    save.classList.add("busy");
    save.disabled = true;
    try {
      const response = await fetch("/admin/calendar-feeds/" + encodeURIComponent(feed.id), {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          calendarLabel: form.elements.calendarLabel.value,
          householdLabel: form.elements.householdLabel.value
        })
      });
      if (!response.ok) throw new Error(await responseError(response, "Calendar Feed was not saved"));
      await loadCalendarFeeds(true);
      toast("Calendar Feed labels saved.");
    } catch (error) {
      setMessage(output, error.message || "Calendar Feed was not saved", "error");
    } finally {
      save.classList.remove("busy");
      save.disabled = !isAdministrator;
    }
  });

  test.addEventListener("click", async () => {
    const replacementUrl = form.elements.replacementUrl.value.trim();
    setMessage(output, replacementUrl ? "Testing replacement…" : "Testing feed…");
    test.classList.add("busy");
    test.disabled = true;
    try {
      const response = await fetch("/admin/calendar-feeds/" + encodeURIComponent(feed.id) + "/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(replacementUrl ? { url: replacementUrl } : {})
      });
      if (!response.ok) {
        const detail = await responseError(response, "Feed test failed");
        throw new Error(replacementUrl
          ? "Replacement failed; existing feed was preserved — " + detail
          : "Feed test failed — " + detail);
      }
      await Promise.all([loadCalendarFeeds(true), loadStatus()]);
      toast(replacementUrl ? "Replacement URL tested and activated." : "Calendar Feed tested and activated.");
    } catch (error) {
      setMessage(output, error.message || "Feed test failed — request could not be completed", "error");
    } finally {
      test.classList.remove("busy");
      test.disabled = !isAdministrator;
    }
  });

  disable.addEventListener("click", async () => {
    if (!confirm("Disable this Calendar Feed?")) return;
    disable.classList.add("busy");
    disable.disabled = true;
    try {
      const response = await fetch("/admin/calendar-feeds/" + encodeURIComponent(feed.id), {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: false })
      });
      if (!response.ok) throw new Error(await responseError(response, "Calendar Feed was not disabled"));
      await loadCalendarFeeds(true);
      toast("Calendar Feed disabled.");
    } catch (error) {
      setMessage(output, error.message || "Calendar Feed was not disabled", "error");
    } finally {
      disable.classList.remove("busy");
    }
  });

  remove.addEventListener("click", async () => {
    if (!confirm("Permanently delete this Calendar Feed and all of its retained data?")) return;
    remove.classList.add("busy");
    remove.disabled = true;
    try {
      const response = await fetch("/admin/calendar-feeds/" + encodeURIComponent(feed.id), { method: "DELETE" });
      if (!response.ok) throw new Error(await responseError(response, "Calendar Feed was not deleted"));
      await loadCalendarFeeds(true);
      toast("Calendar Feed deleted.");
    } catch (error) {
      setMessage(output, error.message || "Calendar Feed was not deleted", "error");
      remove.disabled = !isAdministrator;
    } finally {
      remove.classList.remove("busy");
    }
  });
  return form;
}

function applyCalendarFeeds(value) {
  const serialized = JSON.stringify(value);
  if (serialized === renderedFeeds) return;
  renderedFeeds = serialized;
  const feeds = value.feeds || [];
  document.querySelector("#feed-count").textContent =
    feeds.length + " of " + value.limit + " feed" + (value.limit === 1 ? "" : "s");
  if (!feeds.length) {
    calendarFeedsBox.replaceChildren(create("article", "card empty-state", "No Calendar Feeds have been added."));
    return;
  }
  calendarFeedsBox.replaceChildren(...feeds.map(feedRow));
}

async function loadCalendarFeeds(force) {
  const value = await read("/admin/calendar-feeds");
  if (!force && calendarFeedsBox.contains(document.activeElement)) {
    queuedFeedValue = value;
    return;
  }
  queuedFeedValue = undefined;
  applyCalendarFeeds(value);
}

async function loadWeather() {
  const weather = await read("/admin/weather-configuration");
  weatherForm.elements.latitude.value = weather.latitude;
  weatherForm.elements.longitude.value = weather.longitude;
  weatherForm.elements.slots.value = weather.slots.join(", ");
}

async function refreshData(options) {
  const silent = options?.silent ?? false;
  if (refreshPromise) return refreshPromise;
  if (!silent) setSyncState("syncing", "Refreshing…");
  refreshPromise = Promise.all([loadStatus(), loadCalendarFeeds(false)])
    .then(() => {
      setSyncState("connected", "Updated just now");
    })
    .catch((error) => {
      setSyncState("error", "Update failed");
      if (!silent) toast(error.message || "Administration data is unavailable.", "error");
      throw error;
    })
    .finally(() => {
      refreshPromise = undefined;
    });
  return refreshPromise;
}

function schedulePoll() {
  window.clearTimeout(pollTimer);
  if (document.hidden) return;
  pollTimer = window.setTimeout(async () => {
    try {
      await refreshData({ silent: true });
    } catch {
      // The sync indicator keeps the failure visible; the next poll retries.
    } finally {
      schedulePoll();
    }
  }, POLL_INTERVAL_MS);
}

weatherForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const output = weatherForm.querySelector("output");
  const button = weatherForm.querySelector("button");
  setMessage(output, "Saving…");
  button.classList.add("busy");
  button.disabled = true;
  try {
    const response = await fetch("/admin/weather-configuration", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        latitude: Number(weatherForm.elements.latitude.value),
        longitude: Number(weatherForm.elements.longitude.value),
        slots: weatherForm.elements.slots.value.split(",").map((value) => value.trim()).filter(Boolean)
      })
    });
    if (!response.ok) throw new Error(await responseError(response, "Weather settings were not saved"));
    await loadWeather();
    setMessage(output, "Weather settings saved.", "success");
    toast("Weather settings saved.");
  } catch (error) {
    setMessage(output, error.message || "Weather settings were not saved", "error");
  } finally {
    button.classList.remove("busy");
    button.disabled = !isAdministrator;
  }
});

calendarFeedForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const output = calendarFeedForm.querySelector("output");
  const button = calendarFeedForm.querySelector("button");
  setMessage(output, "Saving…");
  button.classList.add("busy");
  button.disabled = true;
  try {
    const response = await fetch("/admin/calendar-feeds", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: calendarFeedForm.elements.url.value,
        calendarLabel: calendarFeedForm.elements.calendarLabel.value,
        householdLabel: calendarFeedForm.elements.householdLabel.value
      })
    });
    if (!response.ok) throw new Error(await responseError(response, "Calendar Feed was not saved"));
    calendarFeedForm.reset();
    await loadCalendarFeeds(true);
    setMessage(output, "Saved — test the feed to activate it.", "success");
    toast("Calendar Feed saved. Test it to activate.");
  } catch (error) {
    setMessage(output, error.message || "Calendar Feed was not saved", "error");
  } finally {
    button.classList.remove("busy");
    button.disabled = !isAdministrator;
  }
});

generateDashboardButton.addEventListener("click", async () => {
  setMessage(generationOutput, "Generating and publishing…");
  generateDashboardButton.classList.add("busy");
  generateDashboardButton.disabled = true;
  try {
    const response = await fetch("/admin/generations", { method: "POST" });
    if (!response.ok) {
      throw new Error("Generation failed — " + await responseError(response, "request could not be completed"));
    }
    const result = await response.json();
    setMessage(generationOutput, "Published " + result.filename + " — device will fetch at the next scheduled refresh", "success");
    await Promise.all([loadCalendarFeeds(true), loadStatus()]);
    toast("Dashboard generation published.");
  } catch (error) {
    setMessage(generationOutput, error.message || "Generation failed — request could not be completed", "error");
  } finally {
    generateDashboardButton.classList.remove("busy");
    generateDashboardButton.disabled = !isAdministrator;
  }
});

calendarFeedsBox.addEventListener("focusout", () => {
  window.setTimeout(() => {
    if (queuedFeedValue && !calendarFeedsBox.contains(document.activeElement)) {
      applyCalendarFeeds(queuedFeedValue);
      queuedFeedValue = undefined;
    }
  });
});

refreshButton.addEventListener("click", () => {
  refreshData({ silent: false }).catch(() => {});
});

window.addEventListener("hashchange", showRoute);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    window.clearTimeout(pollTimer);
    return;
  }
  refreshData({ silent: true }).catch(() => {});
  schedulePoll();
});

showRoute();
Promise.all([loadWeather(), refreshData({ silent: false })])
  .catch(() => {
    setSyncState("error", "Data unavailable");
  })
  .finally(schedulePoll);`;
  return assetResponse(script, "text/javascript; charset=utf-8");
}
