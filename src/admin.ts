import {
  statusSafeOperationalCode,
  type OperationalCode
} from "./operational-codes";
import { handleCalendarFeedAdministration } from "./calendar-feeds";
import type { CalendarFeedFetchFailureCode } from "./calendar-feed-fetch";

export type AdministrationRole = "administrator" | "reviewer";

export interface AdministrationEnv {
  DB: D1Database;
  ADMIN_ORIGIN?: string;
  CALENDAR_FEED_URL_ENCRYPTION_KEY?: string;
  CALENDAR_FEED_FETCHER?: typeof fetch;
  CALENDAR_FEED_RESOLVE_HOSTNAME?(hostname: string): Promise<string[]>;
  CALENDAR_FEED_NOW?(): Date;
}

interface AdministrationUser {
  role: AdministrationRole;
}

const CALENDAR_FEED_FAILURE_MESSAGES: Record<
  CalendarFeedFetchFailureCode,
  string
> = {
  unsafe_url: "The URL is not a permitted HTTPS Calendar Feed URL.",
  dns_failed: "The feed hostname could not be resolved.",
  unsafe_address: "The feed hostname resolves to a blocked network address.",
  too_many_redirects: "The feed redirected too many times.",
  timeout: "The feed did not respond within 10 seconds.",
  compressed_too_large: "The compressed feed response is too large.",
  decompressed_too_large: "The feed contains too much data.",
  unsupported_encoding: "The feed uses an unsupported compression format.",
  invalid_response: "The response is not a valid supported iCalendar feed.",
  http_error: "The feed server returned an HTTP error."
};

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
  if (!email || !assertion) {
    return json({ error: "Access authentication required" }, 401);
  }
  const user = await env.DB.prepare(
    `SELECT role FROM administration_users
     WHERE email = ? AND active = 1`
  )
    .bind(email)
    .first<AdministrationUser>();
  return user ?? json({ error: "Access identity is not authorized" }, 403);
}

async function operationalStatus(env: AdministrationEnv): Promise<Response> {
  const [device, render, attempt, sources, incidents] = await Promise.all([
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
      `SELECT error_code, occurred_at, notified_at
       FROM operational_incidents
       WHERE resolved_at IS NULL ORDER BY occurred_at DESC LIMIT 20`
    ).all<{
      error_code: string;
      occurred_at: string;
      notified_at: string | null;
    }>()
  ]);

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
        } => incident.errorCode !== null
      )
  });
}

function administrationPage(role: AdministrationRole): Response {
  const disabled = role === "administrator" ? "" : " disabled";
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Family Dashboard administration</title>
<style>body{font:16px system-ui;max-width:64rem;margin:2rem auto;padding:0 1rem}label{display:block;margin:.75rem 0}input,button{font:inherit}pre{white-space:pre-wrap;background:#f3f3f3;padding:1rem}section{margin:1rem 0;padding:1rem}.muted{color:#555}</style>
</head><body data-role="${role}"><main><h1>Family Dashboard administration</h1>
<p>Signed in with the <strong>${role}</strong> role.</p>
<section><h2>Weather</h2><form id="weather-form">
<label>Latitude <input name="latitude" type="number" step="any" required${disabled}></label>
<label>Longitude <input name="longitude" type="number" step="any" required${disabled}></label>
<label>Refresh times <input name="slots" required${disabled}></label>
<button type="submit"${disabled}>Save weather</button> <output></output>
</form></section>
<section><h2>Calendar Feeds</h2>
<p class="muted">Feed URLs are encrypted and never displayed after saving. New feeds remain disabled until they pass the secure feed test.</p>
<form id="calendar-feed-form">
<label>Feed URL <input name="url" type="url" maxlength="4096" autocomplete="off" required${disabled}></label>
<label>Calendar Label <input name="calendarLabel" maxlength="40" required${disabled}></label>
<label>Household Label (optional) <input name="householdLabel" maxlength="20"${disabled}></label>
<button type="submit"${disabled}>Add Calendar Feed</button> <output></output>
</form><div id="calendar-feeds"></div></section>
<section><h2>Operational status</h2><pre id="status">Loading…</pre></section>
</main><script src="/admin/app.js" defer></script></body></html>`;
  return new Response(html, {
    headers: {
      "cache-control": "no-store",
      "content-security-policy":
        "default-src 'self'; object-src 'none'; base-uri 'none'",
      "content-type": "text/html; charset=utf-8",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff"
    }
  });
}

function administrationScript(): Response {
  const script = `const weatherForm=document.querySelector("#weather-form");
const calendarFeedForm=document.querySelector("#calendar-feed-form");
const calendarFeedsBox=document.querySelector("#calendar-feeds");
const statusBox=document.querySelector("#status");
const role=document.body.dataset.role;
const calendarFeedFailureMessages=${JSON.stringify(CALENDAR_FEED_FAILURE_MESSAGES)};
async function read(url){const response=await fetch(url,{headers:{accept:"application/json"}});if(!response.ok)throw new Error("Request failed");return response.json()}
async function responseError(response,fallback){try{const body=await response.json();const detail=calendarFeedFailureMessages[body.code]??body.error;return typeof detail==="string"&&detail?detail:fallback}catch{return fallback}}
function calendarFeedRow(feed){const row=document.createElement("form");row.className="feed-row";row.dataset.feedId=feed.id;row.innerHTML='<p><strong data-feed-host></strong> · <span data-feed-fingerprint></span> · <span data-feed-status></span></p><label>Calendar Label <input name="calendarLabel" maxlength="40" required></label><label>Household Label (optional) <input name="householdLabel" maxlength="20"></label><button type="submit">Save labels</button> <label>Replacement URL (optional) <input name="replacementUrl" type="url" maxlength="4096" autocomplete="off"></label><button type="button" data-test></button> <button type="button" data-disable>Disable</button> <button type="button" data-delete>Delete</button> <output></output>';row.querySelector("[data-feed-host]").textContent=feed.hostname;row.querySelector("[data-feed-fingerprint]").textContent=feed.fingerprint;row.querySelector("[data-feed-status]").textContent=feed.status;row.querySelector('[name="calendarLabel"]').value=feed.calendarLabel;row.querySelector('[name="householdLabel"]').value=feed.householdLabel??"";row.querySelector("[data-test]").textContent=feed.enabled?"Test or replace URL":"Test and activate";row.querySelector("[data-disable]").disabled=!feed.enabled||role!=="administrator";if(role!=="administrator")for(const control of row.querySelectorAll("input,button"))control.disabled=true;row.addEventListener("submit",async event=>{event.preventDefault();const output=row.querySelector("output");output.textContent="Saving…";try{const response=await fetch("/admin/calendar-feeds/"+encodeURIComponent(feed.id),{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({calendarLabel:row.querySelector('[name="calendarLabel"]').value,householdLabel:row.querySelector('[name="householdLabel"]').value})});if(!response.ok){output.textContent=await responseError(response,"Calendar Feed was not saved");return}await loadCalendarFeeds();output.textContent="Saved"}catch{output.textContent="Calendar Feed was not saved"}});row.querySelector("[data-test]").addEventListener("click",async()=>{const output=row.querySelector("output");const replacementUrl=row.querySelector('[name="replacementUrl"]').value.trim();output.textContent=replacementUrl?"Testing replacement…":"Testing feed…";try{const response=await fetch("/admin/calendar-feeds/"+encodeURIComponent(feed.id)+"/test",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(replacementUrl?{url:replacementUrl}:{})});if(!response.ok){const detail=await responseError(response,"Feed test failed");output.textContent=replacementUrl?"Replacement failed; existing feed was preserved — "+detail:"Feed test failed — "+detail;return}await loadCalendarFeeds();output.textContent=replacementUrl?"Replacement activated":"Feed activated"}catch{output.textContent=replacementUrl?"Replacement failed; existing feed was preserved — request could not be completed":"Feed test failed — request could not be completed"}});row.querySelector("[data-disable]").addEventListener("click",async()=>{if(!confirm("Disable this Calendar Feed?"))return;const response=await fetch("/admin/calendar-feeds/"+encodeURIComponent(feed.id),{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({enabled:false})});if(response.ok)await loadCalendarFeeds()});row.querySelector("[data-delete]").addEventListener("click",async()=>{if(!confirm("Permanently delete this Calendar Feed and all of its retained data?"))return;const response=await fetch("/admin/calendar-feeds/"+encodeURIComponent(feed.id),{method:"DELETE"});if(response.ok)await loadCalendarFeeds()});return row}
async function loadCalendarFeeds(){const value=await read("/admin/calendar-feeds");calendarFeedsBox.replaceChildren(...value.feeds.map(calendarFeedRow))}
async function loadWeather(){const weather=await read("/admin/weather-configuration");weatherForm.latitude.value=weather.latitude;weatherForm.longitude.value=weather.longitude;weatherForm.slots.value=weather.slots.join(", ")}
weatherForm.addEventListener("submit",async event=>{event.preventDefault();const output=weatherForm.querySelector("output");output.textContent="Saving…";try{const response=await fetch("/admin/weather-configuration",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({latitude:Number(weatherForm.latitude.value),longitude:Number(weatherForm.longitude.value),slots:weatherForm.slots.value.split(",").map(value=>value.trim()).filter(Boolean)})});if(!response.ok)throw new Error();await loadWeather();output.textContent="Saved"}catch{output.textContent="Weather was not saved"}});
calendarFeedForm.addEventListener("submit",async event=>{event.preventDefault();const output=calendarFeedForm.querySelector("output");output.textContent="Saving…";try{const response=await fetch("/admin/calendar-feeds",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({url:calendarFeedForm.url.value,calendarLabel:calendarFeedForm.calendarLabel.value,householdLabel:calendarFeedForm.householdLabel.value})});if(!response.ok){output.textContent=await responseError(response,"Calendar Feed was not saved");return}calendarFeedForm.reset();await loadCalendarFeeds();output.textContent="Saved — feed is disabled until securely tested"}catch{output.textContent="Calendar Feed was not saved"}});
Promise.all([loadWeather(),loadCalendarFeeds(),read("/admin/status").then(value=>statusBox.textContent=JSON.stringify(value,null,2))]).catch(()=>{statusBox.textContent="Status unavailable"});`;
  return new Response(script, {
    headers: {
      "cache-control": "no-store",
      "content-security-policy": "default-src 'none'",
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
  if (pathname === "/admin" && request.method === "GET") {
    return administrationPage(identity.role);
  }
  if (pathname === "/admin/app.js" && request.method === "GET") {
    return administrationScript();
  }
  if (pathname === "/admin/status" && request.method === "GET") {
    return operationalStatus(env);
  }
  if (
    pathname === "/admin/calendar-feeds" ||
    pathname.startsWith("/admin/calendar-feeds/")
  ) {
    return handleCalendarFeedAdministration(request, env, identity.role);
  }
  return json({ error: "Not found" }, 404);
}
