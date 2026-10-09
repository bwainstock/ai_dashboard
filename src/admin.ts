import { validateProtectedReviewCorrection } from "./gmail";
import {
  type CalendarConfigurationAccount,
  type CalendarSelectionValidationFailure,
  calendarSelectionValidationError,
  normalizeCalendarConfiguration,
  normalizeWeatherConfiguration,
  replaceCalendarConfiguration,
  replaceWeatherConfiguration
} from "./administration-configuration";
import { noticeLifecycle } from "./notice-lifecycle";
import {
  statusSafeOperationalCode,
  type OperationalCode
} from "./operational-codes";

export type AdministrationRole = "administrator" | "reviewer";

export interface AdministrationEnv {
  DB: D1Database;
  ADMIN_ORIGIN?: string;
  NOTICE_GRACE_DAYS?: string;
  validateCalendarSelection?(
    accounts: CalendarConfigurationAccount[]
  ): Promise<CalendarSelectionValidationFailure | null>;
}

interface AdministrationUser {
  role: AdministrationRole;
}

interface WeatherConfigurationRow {
  latitude: number;
  longitude: number;
  timezone: string;
  slots_json: string;
}

interface CalendarAccount {
  account_id: "mom" | "dad";
  display_label: string;
  oauth_status: "connected" | "disconnected" | "revoked";
  gmail_disconnect_state: "revocation_pending" | "cleanup_pending" | null;
}

interface SelectedCalendar {
  account_id: "mom" | "dad";
  calendar_id: string;
  display_label: string;
}

interface ProtectedReviewRow {
  id: number;
  account_id: "mom" | "dad";
  source_key: string;
  review_kind: "uncertain" | "sensitive";
  category: "school" | "childcare" | "activity" | "household";
  summary: string;
  relevant_date: string | null;
  action: string | null;
  sender_organization: string;
  confidence: number;
  created_at: string;
  expires_at: string;
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "content-security-policy": "default-src 'none'",
      "x-content-type-options": "nosniff"
    }
  });
}

export function isAdministrationHost(
  request: Request,
  env: AdministrationEnv
): boolean {
  if (!env.ADMIN_ORIGIN) return false;
  return new URL(request.url).host === new URL(env.ADMIN_ORIGIN).host;
}

export async function authorizeAdministration(
  request: Request,
  env: AdministrationEnv
): Promise<AdministrationUser | Response> {
  const email = request.headers
    .get("Cf-Access-Authenticated-User-Email")
    ?.trim()
    .toLowerCase();
  const assertion = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!email || !assertion) return json({ error: "Access authentication required" }, 401);

  const user = await env.DB.prepare(
    `SELECT role FROM administration_users
     WHERE email = ? AND active = 1`
  )
    .bind(email)
    .first<AdministrationUser>();
  return user ?? json({ error: "Access identity is not authorized" }, 403);
}

function isResponse(value: AdministrationUser | Response): value is Response {
  return value instanceof Response;
}

async function loadConfiguration(env: AdministrationEnv) {
  const [weather, accounts, calendars] = await Promise.all([
    env.DB.prepare(
      `SELECT latitude, longitude, timezone, slots_json
       FROM dashboard_configuration WHERE id = 1`
    ).first<WeatherConfigurationRow>(),
    env.DB.prepare(
      `SELECT account_id, display_label, oauth_status, gmail_disconnect_state
       FROM calendar_accounts ORDER BY account_id`
    ).all<CalendarAccount>(),
    env.DB.prepare(
      `SELECT account_id, calendar_id, display_label
       FROM selected_calendars ORDER BY account_id, display_label`
    ).all<SelectedCalendar>()
  ]);
  if (!weather) throw new Error("Configuration unavailable");
  return {
    weather: {
      latitude: weather.latitude,
      longitude: weather.longitude,
      timezone: weather.timezone,
      slots: JSON.parse(weather.slots_json) as string[]
    },
    google: {
      accounts: accounts.results.map((account) => ({
        accountId: account.account_id,
        displayLabel: account.display_label,
        connected:
          account.oauth_status === "connected" &&
          account.gmail_disconnect_state == null,
        ...(account.oauth_status === "revoked"
          ? { reconnectRequired: true }
          : {}),
        ...(account.gmail_disconnect_state == null
          ? {}
          : { cleanupPending: true }),
        calendars: calendars.results
          .filter(({ account_id }) => account_id === account.account_id)
          .map(({ calendar_id, display_label }) => ({
            id: calendar_id,
            label: display_label
          }))
      }))
    }
  };
}

async function configuration(
  request: Request,
  env: AdministrationEnv,
  role: AdministrationRole
): Promise<Response> {
  if (request.method === "PUT") {
    if (role !== "administrator") {
      return json({ error: "Administrator role required" }, 403);
    }
    let input: {
      weather?: { latitude?: unknown; longitude?: unknown; slots?: unknown };
      google?: { accounts?: unknown };
    };
    try {
      input = await request.json();
    } catch {
      return json({ error: "Invalid configuration" }, 400);
    }
    const weather = input.weather
      ? normalizeWeatherConfiguration(input.weather)
      : null;
    const accounts = input.google
      ? normalizeCalendarConfiguration(input.google.accounts)
      : null;
    if (input.weather && !weather) {
      return json({ error: "Invalid weather configuration" }, 400);
    }
    if (input.google && !accounts) {
      return json({ error: "Invalid Google configuration" }, 400);
    }
    if (accounts && env.validateCalendarSelection) {
      const validationError = calendarSelectionValidationError(
        await env.validateCalendarSelection(accounts)
      );
      if (validationError) {
        return json({ error: validationError.error }, validationError.status);
      }
    }
    if (!weather && !accounts) {
      return json({ error: "Invalid configuration" }, 400);
    }
    if (input.weather) {
      await replaceWeatherConfiguration(env.DB, weather);
    }
    if (input.google) {
      await replaceCalendarConfiguration(env.DB, accounts);
    }
  }
  try {
    return json(await loadConfiguration(env));
  } catch {
    return json({ error: "Configuration unavailable" }, 503);
  }
}

async function operationalStatus(env: AdministrationEnv): Promise<Response> {
  const [device, render, attempt, sources, accounts, statuses, incidents] =
    await Promise.all([
      env.DB.prepare(
        "SELECT MAX(last_check_in_at) AS last_check_in_at FROM devices"
      ).first<{ last_check_in_at: string | null }>(),
      env.DB.prepare(
        `SELECT current.generation_id, generation.published_at
         FROM current_render_generation AS current
         JOIN render_generation_sets AS generation
           ON generation.generation_id = current.generation_id
         WHERE current.id = 1`
      ).first<{ generation_id: string; published_at: string }>(),
      env.DB.prepare(
        `SELECT slot_key, status, attempt_count, retry_at, error_code
         FROM scheduled_generation_slots
         ORDER BY started_at DESC LIMIT 1`
      ).first<{
        slot_key: string;
        status: "running" | "published" | "failed";
        attempt_count: number;
        retry_at: string | null;
        error_code: string | null;
      }>(),
      env.DB.prepare(
        `SELECT source, state, last_success_at, error_code
         FROM source_status ORDER BY source`
      ).all<{
        source: string;
        state: "fresh" | "stale" | "error";
        last_success_at: string | null;
        error_code: string | null;
      }>(),
      env.DB.prepare(
        `SELECT account_id, display_label, oauth_status,
                gmail_disconnect_state
         FROM calendar_accounts ORDER BY account_id`
      ).all<CalendarAccount>(),
      env.DB.prepare(
        `SELECT status_key, status_value FROM operational_status
         WHERE status_key = 'ai_quota'`
      ).all<{ status_key: string; status_value: string }>(),
      env.DB.prepare(
        `SELECT error_code, occurred_at, notified_at
         FROM operational_incidents
         WHERE resolved_at IS NULL ORDER BY occurred_at DESC LIMIT 20`
      ).all<{
        error_code: string;
        occurred_at: string;
        notified_at: string | null;
      }>()
    ]);
  const aiQuota = statuses.results[0]?.status_value;
  return json({
    device: { lastCheckInAt: device?.last_check_in_at ?? null },
    rendering: {
      currentGenerationId: render?.generation_id ?? null,
      lastSuccessfulAt: render?.published_at ?? null,
      latestAttempt: attempt
        ? {
            slotKey: attempt.slot_key,
            state: attempt.status,
            attempt: attempt.attempt_count,
            retryAt: attempt.retry_at,
            errorCode: statusSafeOperationalCode(attempt.error_code)
          }
        : null
    },
    sources: sources.results.map((source) => ({
      source: source.source,
      state: source.state,
      lastSuccessfulAt: source.last_success_at,
      errorCode: statusSafeOperationalCode(source.error_code)
    })),
    oauth: accounts.results.map((account) => ({
      accountId: account.account_id,
      state:
        account.gmail_disconnect_state == null
          ? account.oauth_status
          : account.gmail_disconnect_state
    })),
    aiQuota: ["available", "exhausted", "not_applicable"].includes(aiQuota)
      ? aiQuota
      : "not_applicable",
    incidents: incidents.results
      .map((incident) => ({
        errorCode: statusSafeOperationalCode(incident.error_code),
        occurredAt: incident.occurred_at,
        notifiedAt: incident.notified_at
      }))
      .filter(
        (
          incident
        ): incident is {
          errorCode: OperationalCode;
          occurredAt: string;
          notifiedAt: string | null;
        } =>
          incident.errorCode !== null
      )
  });
}

async function protectedGmailReview(
  request: Request,
  env: AdministrationEnv,
  role: AdministrationRole
): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/admin/gmail-review") {
    const rows = await env.DB.prepare(
      `SELECT id, account_id, review_kind, category, summary, relevant_date,
              action, sender_organization, confidence, created_at, expires_at
       FROM gmail_protected_reviews
       WHERE expires_at >= ?
       ORDER BY created_at DESC, id DESC`
    )
      .bind(new Date().toISOString())
      .all<Omit<ProtectedReviewRow, "source_key">>();
    return json({
      records: rows.results.map((row) => ({
        id: row.id,
        accountId: row.account_id,
        kind: row.review_kind,
        category: row.category,
        summary: row.summary,
        relevantDate: row.relevant_date,
        action: row.action,
        senderOrganization: row.sender_organization,
        confidence: row.confidence,
        createdAt: row.created_at,
        expiresAt: row.expires_at
      }))
    });
  }
  const match = url.pathname.match(/^\/admin\/gmail-review\/(\d+)$/);
  if (request.method !== "POST" || !match) {
    return json({ error: "Not found" }, 404);
  }
  if (role !== "administrator") {
    return json({ error: "Administrator role required" }, 403);
  }
  let input: { action?: unknown; correction?: unknown };
  try {
    input = await request.json();
  } catch {
    return json({ error: "Invalid protected review action" }, 400);
  }
  if (
    !input ||
    typeof input !== "object" ||
    Object.keys(input).some((key) => !["action", "correction"].includes(key)) ||
    !["dismiss", "correct", "publish"].includes(String(input.action))
  ) {
    return json({ error: "Invalid protected review action" }, 400);
  }
  const id = Number(match[1]);
  if (input.action === "dismiss") {
    if ("correction" in input) {
      return json({ error: "Invalid protected review action" }, 400);
    }
    await env.DB.prepare("DELETE FROM gmail_protected_reviews WHERE id = ?")
      .bind(id)
      .run();
    return json({ status: "dismissed" });
  }
  if (input.action === "correct") {
    const validation = validateProtectedReviewCorrection(
      input.correction,
      new Date()
    );
    if (!validation.valid) {
      return json({ error: "Invalid protected review correction" }, 400);
    }
    const correction = validation.correction;
    await env.DB.prepare(
      `UPDATE gmail_protected_reviews
       SET category = ?, summary = ?, relevant_date = ?, action = ?,
           sender_organization = ?
       WHERE id = ?`
    )
      .bind(
        correction.category,
        correction.summary,
        correction.relevantDate,
        correction.action,
        correction.senderOrganization,
        id
      )
      .run();
    return json({ status: "corrected" });
  }
  if ("correction" in input) {
    return json({ error: "Invalid protected review action" }, 400);
  }
  const row = await env.DB.prepare(
    `SELECT id, account_id, source_key, review_kind, category, summary,
            relevant_date, action, sender_organization, confidence,
            created_at, expires_at
     FROM gmail_protected_reviews WHERE id = ?`
  )
    .bind(id)
    .first<ProtectedReviewRow>();
  if (!row) return json({ error: "Protected review record not found" }, 404);
  const now = new Date();
  const lifecycle = noticeLifecycle(
    row.relevant_date,
    now,
    env.NOTICE_GRACE_DAYS
  );
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO household_notices
         (account_id, source_key, category, summary, relevant_date, action,
          sender_organization, model_id, model_version, accepted_at,
          expires_at, retained_until)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(account_id, source_key) DO UPDATE SET
         category = excluded.category,
         summary = excluded.summary,
         relevant_date = excluded.relevant_date,
         action = excluded.action,
         sender_organization = excluded.sender_organization,
         model_id = excluded.model_id,
         model_version = excluded.model_version,
         accepted_at = excluded.accepted_at,
         expires_at = excluded.expires_at,
         retained_until = excluded.retained_until`
    ).bind(
      row.account_id,
      row.source_key,
      row.category,
      row.summary,
      row.relevant_date,
      row.action,
      row.sender_organization,
      "protected-review",
      "administrator-approved",
      now.toISOString(),
      lifecycle.expiresAt,
      lifecycle.retainedUntil
    ),
    env.DB.prepare("DELETE FROM gmail_protected_reviews WHERE id = ?").bind(id)
  ]);
  return json({ status: "published" });
}

function administrationPage(role: AdministrationRole): Response {
  const administratorControls =
    role === "administrator"
      ? `<p><button type="button" data-connect="mom">Connect or reconnect Mom Google</button>
<button type="button" data-disconnect="mom">Disconnect Mom Google</button></p>
<p><button type="button" data-connect="dad">Connect or reconnect Dad Google</button>
<button type="button" data-disconnect="dad">Disconnect Dad Google</button></p>`
      : "";
  const disabled = role === "administrator" ? "" : " disabled";
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Family Dashboard administration</title>
<style>body{font:16px system-ui;max-width:64rem;margin:2rem auto;padding:0 1rem}label{display:block;margin:.75rem 0}input,select,button{font:inherit}pre{white-space:pre-wrap;background:#f3f3f3;padding:1rem}fieldset,section{margin:1rem 0;padding:1rem}.calendar-row,.sender-row{display:grid;grid-template-columns:auto 1fr 1fr;gap:.5rem;align-items:center}.muted{color:#555}.banner{padding:.75rem;background:#eef6ff}</style>
</head><body data-role="${role}" data-read-only="${role !== "administrator"}"><main><h1>Family Dashboard administration</h1>
<p>Signed in with the <strong>${role}</strong> role.</p>
<p id="oauth-banner" class="banner" hidden></p>
<h2>Configuration</h2>
<section><h2>Weather</h2><form id="weather-form">
<label>Latitude <input name="latitude" type="number" step="any" required${disabled}></label>
<label>Longitude <input name="longitude" type="number" step="any" required${disabled}></label>
<label>Refresh times <input name="slots" required${disabled}></label>
<button type="submit"${disabled}>Save weather</button> <output></output>
</form></section>
<section><h2>Household accounts and calendars</h2>
<p class="muted">Household Label is device-visible. Calendar Label is administrator-only.</p>
${(["mom", "dad"] as const)
  .map(
    (accountId) => `<form class="calendar-form" data-account="${accountId}">
<h3>${accountId === "mom" ? "Mom" : "Dad"} account</h3>
<p data-account-status>Loading…</p>
<label>Household Label <input name="householdLabel" maxlength="20" required${disabled}></label>
<label>Filter Discovered Calendars <input name="filter" type="search"></label>
<p><button type="button" data-refresh="${accountId}"${disabled}>Refresh Discovered Calendars</button></p>
<p data-discovery-status></p><div data-calendars></div>
<button type="submit"${disabled}>Save ${accountId === "mom" ? "Mom" : "Dad"} calendars</button> <output></output>
</form>`
  )
  .join("")}
${administratorControls}</section>
<section><h2>Gmail Sender-Domain Allowlist</h2><form id="gmail-form">
<p>Domains match the exact domain and its subdomains. An empty list is allowed, but no Gmail senders will qualify.</p>
<div id="gmail-accounts"></div><div id="senders"></div>
<p><button type="button" id="add-sender"${disabled}>Add domain</button></p>
<button type="submit"${disabled}>Save Sender-Domain Allowlist</button> <output></output>
</form></section>
<section><h2>Operational status</h2><pre id="status">Loading…</pre></section>
<section><h2>Protected Gmail review</h2><pre id="gmail-review">Loading…</pre></section>
</main><script src="/admin/app.js" defer></script></body></html>`;
  return new Response(html, {
    headers: {
      "cache-control": "no-store",
      "content-security-policy": "default-src 'self'; object-src 'none'; base-uri 'none'",
      "content-type": "text/html; charset=utf-8",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff"
    }
  });
}

function administrationScript(): Response {
  const script = `const weatherForm=document.querySelector("#weather-form");
const gmailForm=document.querySelector("#gmail-form");
const statusBox=document.querySelector("#status");
const reviewBox=document.querySelector("#gmail-review");
const role=document.body.dataset.role;
const dirty=new Set();
const discovered={mom:[],dad:[]};
const discoveryState={mom:"not-attempted",dad:"not-attempted"};
const calendarDraft={mom:new Map(),dad:new Map()};
async function read(url){const response=await fetch(url,{headers:{accept:"application/json"}});if(!response.ok)throw new Error("Request failed");return response.json()}
function safeNavigate(message){return dirty.size===0||confirm(message)}
function markDirty(event){dirty.add(event.currentTarget.id||event.currentTarget.dataset.account)}
function senderRow(sender={domain:"",kind:"school"}){const row=document.createElement("div");row.className="sender-row";row.innerHTML='<button type="button" data-remove aria-label="Remove domain">Remove</button><input name="domain" placeholder="school.example.org" value="'+sender.domain+'"><select name="kind"><option value="school">school</option><option value="childcare">childcare</option></select>';row.querySelector("select").value=sender.kind;if(role!=="administrator")for(const control of row.querySelectorAll("input,select,button"))control.disabled=true;row.querySelector("[data-remove]").addEventListener("click",()=>{row.remove();dirty.add("gmail-form")});return row}
function renderSenders(senders){const box=document.querySelector("#senders");box.replaceChildren(...senders.map(senderRow))}
function renderCalendars(accountId){const form=document.querySelector('[data-account="'+accountId+'"]');const filter=form.filter.value.toLocaleLowerCase();const draft=calendarDraft[accountId];const byId=new Map(discovered[accountId].map(item=>[item.id,item]));for(const [id,item] of draft)if(item.selected&&!byId.has(id))byId.set(id,{id,label:item.label,unavailable:discoveryState[accountId]==="succeeded"});const rows=[...byId.values()].filter(item=>item.label.toLocaleLowerCase().includes(filter)).sort((a,b)=>Number(draft.get(b.id)?.selected)-Number(draft.get(a.id)?.selected)||a.label.localeCompare(b.label,undefined,{sensitivity:"base"}));const box=form.querySelector("[data-calendars]");box.replaceChildren(...rows.map(item=>{const row=document.createElement("div");row.className="calendar-row";const state=draft.get(item.id)??{selected:false,label:item.label};row.innerHTML='<input type="checkbox" name="calendar" value="'+item.id+'"><span>'+item.label+(item.unavailable?" — Unavailable":"")+'</span><label>Calendar Label <input name="calendarLabel" maxlength="40" value="'+state.label+'"></label>';const checkbox=row.querySelector('[name="calendar"]');const label=row.querySelector('[name="calendarLabel"]');checkbox.checked=state.selected;checkbox.addEventListener("input",()=>{draft.set(item.id,{selected:checkbox.checked,label:label.value});dirty.add(accountId)});label.addEventListener("input",()=>{draft.set(item.id,{selected:checkbox.checked,label:label.value});dirty.add(accountId)});if(role!=="administrator"){checkbox.disabled=true;label.disabled=true}return row}));}
async function loadWeatherConfiguration(){const weather=await read("/admin/weather-configuration");weatherForm.latitude.value=weather.latitude;weatherForm.longitude.value=weather.longitude;weatherForm.slots.value=weather.slots.join(", ")}
async function loadCalendarConfiguration(accountId){const calendar=await read("/admin/calendar-configuration");for(const account of calendar.accounts){if(accountId&&account.accountId!==accountId)continue;const form=document.querySelector('[data-account="'+account.accountId+'"]');form.householdLabel.value=account.displayLabel;form.querySelector("[data-account-status]").textContent=account.cleanupPending?"Cleanup pending":account.reconnectRequired?"Reconnect required":account.connected?"Connected":"Disconnected";calendarDraft[account.accountId]=new Map(account.calendars.map(item=>[item.id,{selected:true,label:item.label}]));renderCalendars(account.accountId)}}
async function loadGmailConfiguration(){const gmail=await read("/admin/gmail-configuration");renderSenders(gmail.senders);document.querySelector("#gmail-accounts").textContent=gmail.accounts.map(account=>account.accountId+": "+(account.cleanupPending?"cleanup pending":account.reconnectRequired?"reconnect required":account.connected?"connected":"disconnected")+(account.lastProcessedAt?" · last processed "+account.lastProcessedAt:"")).join("\\n")}
async function loadConfiguration(){await Promise.all([loadWeatherConfiguration(),loadCalendarConfiguration(),loadGmailConfiguration()]);dirty.clear()}
async function refreshDiscovery(accountId){const form=document.querySelector('[data-account="'+accountId+'"]');const output=form.querySelector("[data-discovery-status]");if(!safeNavigate("Discard unsaved configuration changes and refresh Discovered Calendars?"))return;discoveryState[accountId]="loading";output.textContent="Loading Discovered Calendars…";renderCalendars(accountId);try{const body=await read("/admin/calendar/discovery?account="+accountId);discovered[accountId]=body.calendars;discoveryState[accountId]="succeeded";output.textContent="Discovered Calendars refreshed";renderCalendars(accountId)}catch{discoveryState[accountId]="failed";output.textContent="Calendar discovery failed";renderCalendars(accountId)}}
weatherForm.addEventListener("input",markDirty);weatherForm.addEventListener("submit",async event=>{event.preventDefault();const output=weatherForm.querySelector("output");output.textContent="Saving…";try{const response=await fetch("/admin/weather-configuration",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({latitude:Number(weatherForm.latitude.value),longitude:Number(weatherForm.longitude.value),slots:weatherForm.slots.value.split(",").map(value=>value.trim()).filter(Boolean)})});if(!response.ok)throw new Error();await loadWeatherConfiguration();output.textContent="Saved";dirty.delete("weather-form")}catch{output.textContent="Weather was not saved"}});
for(const form of document.querySelectorAll(".calendar-form")){form.addEventListener("input",event=>{if(event.target.name!=="filter")dirty.add(form.dataset.account)});form.filter.addEventListener("input",()=>renderCalendars(form.dataset.account));form.addEventListener("submit",async event=>{event.preventDefault();const calendars=[...calendarDraft[form.dataset.account]].filter(([,item])=>item.selected).map(([id,item])=>({id,label:item.label}));const output=form.querySelector("output");output.textContent="Saving…";try{const current=await read("/admin/calendar-configuration");const accounts=current.accounts.map(account=>account.accountId===form.dataset.account?{accountId:account.accountId,displayLabel:form.householdLabel.value,calendars}:{accountId:account.accountId,displayLabel:account.displayLabel,calendars:account.calendars});const response=await fetch("/admin/calendar-configuration",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({accounts})});if(!response.ok)throw new Error();await loadCalendarConfiguration(form.dataset.account);output.textContent="Saved";dirty.delete(form.dataset.account)}catch{output.textContent="Calendar configuration was not saved"}})}
gmailForm.addEventListener("input",markDirty);gmailForm.addEventListener("submit",async event=>{event.preventDefault();const senders=[...document.querySelectorAll(".sender-row")].map(row=>({domain:row.querySelector('[name="domain"]').value,kind:row.querySelector('[name="kind"]').value}));const output=gmailForm.querySelector("output");output.textContent="Saving…";try{const response=await fetch("/admin/gmail-configuration",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({senders})});if(!response.ok)throw new Error();await loadGmailConfiguration();output.textContent=senders.length?"Saved":"Saved — Sender-Domain Allowlist is empty";dirty.delete("gmail-form")}catch{output.textContent="Sender-Domain Allowlist was not saved"}});
document.querySelector("#add-sender")?.addEventListener("click",()=>{document.querySelector("#senders").append(senderRow());dirty.add("gmail-form")});
for(const button of document.querySelectorAll("[data-refresh]"))button.addEventListener("click",()=>refreshDiscovery(button.dataset.refresh));
for(const button of document.querySelectorAll("[data-connect]"))button.addEventListener("click",async()=>{if(!safeNavigate("Discard unsaved configuration changes and reconnect this account?"))return;try{const value=await read("/admin/calendar/oauth/start?account="+button.dataset.connect);location.assign(value.authorizationUrl)}catch{button.closest("section").querySelector("output").textContent="Google connection could not be started"}});
for(const button of document.querySelectorAll("[data-disconnect]"))button.addEventListener("click",async()=>{if(!safeNavigate("Discard unsaved configuration changes and disconnect this account?")||!confirm("Revoke Google access and permanently delete retained account data?"))return;try{const response=await fetch("/admin/gmail-accounts/"+button.dataset.disconnect+"/disconnect",{method:"POST"});if(!response.ok)throw new Error();await loadConfiguration()}catch{button.closest("section").querySelector("output").textContent="Google account was not disconnected"}});
addEventListener("beforeunload",event=>{if(dirty.size){event.preventDefault();event.returnValue=""}});
const oauthStatus=new URL(location.href).searchParams.get("calendar");if(oauthStatus){const banner=document.querySelector("#oauth-banner");banner.hidden=false;banner.textContent=oauthStatus.endsWith("-connected")?"Google account connected":"Google account connection failed";history.replaceState(null,"",location.pathname);const account=oauthStatus.startsWith("mom-")?"mom":oauthStatus.startsWith("dad-")?"dad":null;if(account)queueMicrotask(()=>refreshDiscovery(account))}
Promise.all([loadConfiguration(),read("/admin/status").then(value=>statusBox.textContent=JSON.stringify(value,null,2)),read("/admin/gmail-review").then(value=>reviewBox.textContent=JSON.stringify(value,null,2))]).catch(()=>{statusBox.textContent="Status unavailable"});`;
  return new Response(script, {
    headers: {
      "cache-control": "no-store",
      "content-type": "text/javascript; charset=utf-8",
      "x-content-type-options": "nosniff"
    }
  });
}

export async function handleAuthorizedAdministration(
  request: Request,
  env: AdministrationEnv,
  identity: AdministrationUser
): Promise<Response> {
  const pathname = new URL(request.url).pathname;
  if (request.method === "GET" && pathname === "/admin") {
    return administrationPage(identity.role);
  }
  if (request.method === "GET" && pathname === "/admin/app.js") {
    return administrationScript();
  }
  if (
    (request.method === "GET" || request.method === "PUT") &&
    pathname === "/admin/configuration"
  ) {
    return configuration(request, env, identity.role);
  }
  if (request.method === "GET" && pathname === "/admin/status") {
    return operationalStatus(env);
  }
  if (pathname === "/admin/gmail-review" || pathname.startsWith("/admin/gmail-review/")) {
    return protectedGmailReview(request, env, identity.role);
  }
  return json({ error: "Not found" }, 404);
}

export async function handleAdministration(
  request: Request,
  env: AdministrationEnv
): Promise<Response> {
  const identity = await authorizeAdministration(request, env);
  if (isResponse(identity)) return identity;
  return handleAuthorizedAdministration(request, env, identity);
}
