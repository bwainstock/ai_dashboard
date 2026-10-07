export type AdministrationRole = "administrator" | "reviewer";

export interface AdministrationEnv {
  DB: D1Database;
  ADMIN_ORIGIN?: string;
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
}

interface SelectedCalendar {
  account_id: "mom" | "dad";
  calendar_id: string;
  display_label: string;
}

const FIXED_ERROR_CODES = new Set([
  "WEATHER_FETCH_FAILED",
  "WEATHER_UPSTREAM_HTTP",
  "WEATHER_UPSTREAM_NETWORK",
  "WEATHER_INVALID_RESPONSE",
  "LUNCH_UPSTREAM_HTTP",
  "LUNCH_UPSTREAM_NETWORK",
  "LUNCH_INVALID_RESPONSE",
  "CALENDAR_FETCH_FAILED",
  "CALENDAR_OAUTH_REVOKED",
  "CALENDAR_UPSTREAM_HTTP",
  "DAILY_BRIEF_RENDER_FAILED",
  "CALENDAR_VIEW_RENDER_FAILED",
  "LUNCH_VIEW_RENDER_FAILED",
  "RENDERED_IMAGE_INVALID",
  "GENERATION_PUBLICATION_FAILED",
  "AI_QUOTA_EXHAUSTED",
  "DEVICE_AUTH_SUSPICIOUS",
  "DEVICE_CHECK_IN_MISSING"
]);

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
      `SELECT account_id, display_label, oauth_status
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
        connected: account.oauth_status === "connected",
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

function validSlots(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    new Set(value).size === value.length &&
    value.every(
      (slot) =>
        typeof slot === "string" &&
        /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(slot)
    )
  );
}

function validGoogleAccounts(
  value: unknown
): value is Array<{
  accountId: "mom" | "dad";
  displayLabel: string;
  calendars: Array<{ id: string; label: string }>;
}> {
  if (!Array.isArray(value) || value.length !== 2) return false;
  const ids = new Set(value.map((account: { accountId?: unknown }) => account.accountId));
  return (
    ids.size === 2 &&
    ids.has("mom") &&
    ids.has("dad") &&
    value.every(
      (account: {
        accountId?: unknown;
        displayLabel?: unknown;
        calendars?: unknown;
      }) =>
        (account.accountId === "mom" || account.accountId === "dad") &&
        typeof account.displayLabel === "string" &&
        account.displayLabel.trim().length >= 1 &&
        account.displayLabel.trim().length <= 20 &&
        !account.displayLabel.includes("@") &&
        Array.isArray(account.calendars) &&
        account.calendars.every(
          (calendar: { id?: unknown; label?: unknown }) =>
            typeof calendar.id === "string" &&
            calendar.id.length > 0 &&
            typeof calendar.label === "string" &&
            calendar.label.length > 0 &&
            calendar.label.length <= 80
        )
    )
  );
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
    const statements: D1PreparedStatement[] = [];
    if (input.weather) {
      const { latitude, longitude, slots } = input.weather;
      if (
        typeof latitude !== "number" ||
        latitude < -90 ||
        latitude > 90 ||
        typeof longitude !== "number" ||
        longitude < -180 ||
        longitude > 180 ||
        !validSlots(slots)
      ) {
        return json({ error: "Invalid weather configuration" }, 400);
      }
      statements.push(
        env.DB.prepare(
          `UPDATE dashboard_configuration
           SET latitude = ?, longitude = ?, slots_json = ?,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = 1`
        ).bind(latitude, longitude, JSON.stringify([...slots].sort()))
      );
    }
    if (input.google) {
      if (!validGoogleAccounts(input.google.accounts)) {
        return json({ error: "Invalid Google configuration" }, 400);
      }
      for (const account of input.google.accounts) {
        statements.push(
          env.DB.prepare(
            `UPDATE calendar_accounts
             SET display_label = ?, updated_at = CURRENT_TIMESTAMP
             WHERE account_id = ?`
          ).bind(account.displayLabel.trim(), account.accountId),
          env.DB.prepare(
            "DELETE FROM selected_calendars WHERE account_id = ?"
          ).bind(account.accountId),
          ...account.calendars.map((calendar) =>
            env.DB.prepare(
              `INSERT INTO selected_calendars
                 (account_id, calendar_id, display_label)
               VALUES (?, ?, ?)`
            ).bind(account.accountId, calendar.id, calendar.label)
          )
        );
      }
    }
    if (statements.length === 0) {
      return json({ error: "Invalid configuration" }, 400);
    }
    await env.DB.batch(statements);
  }
  try {
    return json(await loadConfiguration(env));
  } catch {
    return json({ error: "Configuration unavailable" }, 503);
  }
}

function safeErrorCode(value: string | null): string | null {
  return value && FIXED_ERROR_CODES.has(value) ? value : null;
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
        `SELECT account_id, display_label, oauth_status
         FROM calendar_accounts ORDER BY account_id`
      ).all<CalendarAccount>(),
      env.DB.prepare(
        `SELECT status_key, status_value FROM operational_status
         WHERE status_key = 'ai_quota'`
      ).all<{ status_key: string; status_value: string }>(),
      env.DB.prepare(
        `SELECT error_code, occurred_at FROM operational_incidents
         WHERE resolved_at IS NULL ORDER BY occurred_at DESC LIMIT 20`
      ).all<{ error_code: string; occurred_at: string }>()
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
            errorCode: safeErrorCode(attempt.error_code)
          }
        : null
    },
    sources: sources.results.map((source) => ({
      source: source.source,
      state: source.state,
      lastSuccessfulAt: source.last_success_at,
      errorCode: safeErrorCode(source.error_code)
    })),
    oauth: accounts.results.map((account) => ({
      accountId: account.account_id,
      state: account.oauth_status
    })),
    aiQuota: ["available", "exhausted", "not_applicable"].includes(aiQuota)
      ? aiQuota
      : "not_applicable",
    incidents: incidents.results
      .map((incident) => ({
        errorCode: safeErrorCode(incident.error_code),
        occurredAt: incident.occurred_at
      }))
      .filter(
        (incident): incident is { errorCode: string; occurredAt: string } =>
          incident.errorCode !== null
      )
  });
}

function administrationPage(role: AdministrationRole): Response {
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Family Dashboard administration</title>
<style>body{font:16px system-ui;max-width:60rem;margin:2rem auto;padding:0 1rem}label{display:block;margin:.75rem 0}input,textarea,button{font:inherit}textarea{width:100%;min-height:10rem}pre{white-space:pre-wrap;background:#f3f3f3;padding:1rem}fieldset{margin:1rem 0}</style>
</head><body data-role="${role}"><main><h1>Family Dashboard administration</h1>
<p>Signed in with the <strong>${role}</strong> role.</p>
<section><h2>Configuration</h2><form id="configuration">
<fieldset><legend>Weather and refresh slots</legend>
<label>Latitude <input name="latitude" type="number" step="any" required></label>
<label>Longitude <input name="longitude" type="number" step="any" required></label>
<label>Refresh times <input name="slots" required></label></fieldset>
<label>Google accounts, labels, and selected calendars
<textarea name="google" spellcheck="false" required></textarea></label>
<p><button type="button" data-connect="mom">Connect Mom Google</button>
<button type="button" data-connect="dad">Connect Dad Google</button></p>
<button type="submit">Save configuration</button> <output id="save-result"></output>
</form></section>
<section><h2>Operational status</h2><pre id="status">Loading…</pre></section>
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
  const script = `const form=document.querySelector("#configuration");
const statusBox=document.querySelector("#status");
const result=document.querySelector("#save-result");
const role=document.body.dataset.role;
async function read(url){const response=await fetch(url,{headers:{accept:"application/json"}});if(!response.ok)throw new Error("Request failed");return response.json()}
async function load(){const [configuration,status]=await Promise.all([read("/admin/configuration"),read("/admin/status")]);form.latitude.value=configuration.weather.latitude;form.longitude.value=configuration.weather.longitude;form.slots.value=configuration.weather.slots.join(", ");form.google.value=JSON.stringify(configuration.google,null,2);statusBox.textContent=JSON.stringify(status,null,2);if(role!=="administrator")for(const control of form.elements)control.disabled=true}
form.addEventListener("submit",async event=>{event.preventDefault();result.textContent="Saving…";try{const google=JSON.parse(form.google.value);const response=await fetch("/admin/configuration",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({weather:{latitude:Number(form.latitude.value),longitude:Number(form.longitude.value),slots:form.slots.value.split(",").map(value=>value.trim()).filter(Boolean)},google})});if(!response.ok)throw new Error("Save failed");result.textContent="Saved";await load()}catch{result.textContent="Configuration was not saved"}});
for(const button of document.querySelectorAll("[data-connect]"))button.addEventListener("click",async()=>{try{const value=await read("/admin/calendar/oauth/start?account="+button.dataset.connect);location.assign(value.authorizationUrl)}catch{result.textContent="Google connection could not be started"}});
load().catch(()=>{statusBox.textContent="Status unavailable"});`;
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
