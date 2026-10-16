# Family Dashboard Design

## Purpose

The Family Dashboard is a battery-powered, glanceable household display for near-term weather, calendars, school lunch, and eventually important email-derived notices. It targets the Seeed/TRMNL 7.5-inch OG DIY Kit without a paid TRMNL BYOD license.

The system favors low maintenance, controlled handling of Gmail data, readable child-friendly visuals, and Cloudflare free-tier operation.

## Product scope

### Version 1

- Today and tomorrow weather for San Jose, California.
- Selected events from two consumer Google accounts for today and the next two local calendar days.
- A weather-and-calendar Daily Brief plus Calendar View.
- Four scheduled updates every day at 06:30, 10:30, 15:00, and 19:00 in `America/Los_Angeles`.
- Forward navigation using the ESPHome Key 3 gesture.
- Protected configuration and operational status pages.

### Deferred sources

- School lunch from the SJUSD Elementary Schools MealViewer feed.
- Household Notices extracted from both Gmail accounts.
- Protected review of uncertain or sensitive results.
- Lunch and Gmail processing remain outside the active generation and device
  view cycle until explicitly resumed.

## Architecture

The device runs the repository's ESPHome firmware and talks directly to a
custom Cloudflare Worker. Home Assistant and TRMNL's paid hosted service are
not required. Legacy TRMNL BYOS routes remain deployed only as rollback
compatibility.

```text
Google Calendar ─┐
Open-Meteo ──────┴─> source adapters ─> normalized snapshots ─> HTML/CSS renderer
                                                                       │
                                                                       v
                                                              Browser Rendering
                                                                       │
                                                                       v
ESPHome device <─ one authenticated PNG request ─ device Worker
                                                    │
                                      private R2 PNGs + D1 generation pointer
                                                    │
                               D1 configuration, OAuth tokens, status, snapshots
```

### Cloudflare components

- **Workers**:
  - Device API and image delivery.
  - Access-protected administration and status UI.
  - Deferred Gmail processing remains isolated from the main application.
- **D1**: configuration, encrypted OAuth credentials, selected calendars, normalized source snapshots, device state, and immutable generation pointers.
- **R2**: private immutable 800x480 PNG generations.
- **Browser Rendering**: scheduled HTML/CSS screenshots.
- **Workers AI**: reserved for deferred source processing.
- **Cron Triggers**: local-time generation scheduling and one delayed retry.
- **Cloudflare Access**: browser authentication and role enforcement.
- **Cloudflare Email**: a verified send-email binding for actionable failure
  alerts.

No KV or Queues are planned initially.

### Hostnames

Use separate hostnames on the existing Cloudflare-managed domain:

- `dashboard-admin.<domain>`: Cloudflare Access-protected administration, review, and status.
- `dashboard-device.<domain>`: ESPHome direct-image and rollback BYOS routes.

The device hostname must not require an interactive Access login. `/api/setup`
issues a high-entropy device token, and every image request validates it. The
device identifier and generation metadata are not credentials.

## Device protocol and navigation

The production device interface is authenticated `GET /api/image` requests.
`ID` and `Access-Token` remain headers. ESPHome explicitly selects Daily Brief
or Calendar View with `X-Dashboard-View`. It first performs bodyless metadata
revalidation for both views, then pins both image downloads with
`X-Dashboard-Generation` so a publication between requests cannot create a
mixed pair.

- Startup and scheduled refresh stage both views in the inactive PSRAM slot.
  The slot becomes active only after both images decode successfully.
- Scheduled refresh resets local selection to Daily Brief.
- One Key 3 press switches between the two active decoded images locally;
  navigation does not require Wi-Fi or a Worker request.
- Per-view `ETag` revalidation skips both downloads and the physical panel
  refresh when the published generation is unchanged.
- A request, authentication, download, decode, or mixed-generation failure
  leaves the previous complete slot active.
- The device remains awake in the initial production cutover. It refreshes at
  06:32, 10:32, 15:02, and 19:02 local time, two minutes after Cloudflare's
  generation slots. Deep sleep is deferred to #36.
- Pressing Key 1 while awake, or holding it during reset, latches maintenance
  mode until the next reset and suppresses scheduled image requests so serial
  diagnostics and password-protected OTA remain available.

`/api/setup`, `/api/display`, and `/images/:filename` remain rollback-only
TRMNL BYOS compatibility routes.

## Scheduling

The desired local render times are:

- 06:30
- 10:30
- 15:00
- 19:00

Cloudflare Cron is evaluated in UTC, so one frequent scheduler should determine whether a local-time slot is due in `America/Los_Angeles`. This avoids manual daylight-saving changes. Duplicate slot execution must be idempotent.

For each slot:

1. Refresh due sources in parallel.
2. Preserve the newest valid normalized snapshot for any failed source.
3. Render all active views using a self-contained HTML document at the native
   800x480 device scale and apply one fixed luminance threshold to an exact
   1-bit black-and-white palette. Native-scale rasterization preserves browser
   font hinting; supersampling and downsampling make small glyphs visibly
   irregular after 1-bit conversion. A spatially varying dither threshold is
   also avoided because it makes antialiased text edges visibly speckled.
4. Validate each screenshot as an 800x480 1-bit-palette PNG within the device
   model's tested size limit.
5. Write immutable R2 objects.
6. In one D1 batch, record the complete generation set and atomically advance
   the singleton current-generation pointer only after every required image is
   stored. Device view selection always resolves through this one pointer.

If source fetching or rendering fails, retry once after 15 minutes. Retry
objects receive a new immutable generation ID. A render, validation, storage,
or pointer-publication failure preserves the previous complete generation. A
source failure may still publish a new generation using a visibly stale
last-good section with its snapshot age.

## Screen design

Both active views are fixed 800x480 monochrome compositions. They share condensed
sans-serif labels and numbers, editorial serif headings, inversion, spacing,
and rule styles. Use bundled, open-licensed SVG assets rendered inline and pair
every icon with text; do not depend on remote assets.
Keep every element inside the viewport and all visible text at least 12px.

### Daily Brief

- The header combines the local day and date with the Family Dashboard label.
- Today and tomorrow forecasts show condition, high, low, and precipitation
  probability.
- Up to six calendar entries use equal visual weight and show their date,
  start time, title, and owner label without a live-style countdown or
  `Next up` treatment.
- No view shows a clock, current temperature, or `current`, `live`, or
  `right now` framing because scheduled generations may remain displayed for
  hours.
- The footer shows one global update time and warning markers with ages for
  stale weather or calendar data.

### Weather

Show:

- Today's condition, high, low, and precipitation probability.
- Tomorrow's condition, high, low, and precipitation probability.

Use Open-Meteo with administrator-configured coordinates. San Jose is the initial location.

### Calendar

The Daily Brief shows up to six relevant events across today and tomorrow.
Calendar View uses a date, forecast, and update rail beside three
day lanes for Today and the following two local calendar days. It shows up to
twelve events and reports `+N more`.

Rules:

- Include accepted and tentative timed events and useful all-day events from selected calendars.
- Exclude declined events and unselected generated calendars.
- Render private events as `Busy`.
- Deduplicate copies with matching iCal UID and occurrence time.
- Use configured `Mom` and `Dad` labels when ownership is useful.
- Show shortened location only on Calendar View.
- Never show descriptions, attendees, conferencing links, organizer addresses, or personal email addresses.
- Use compact 12-hour local time; all-day events precede timed events.
- Distinguish calendar ownership with deterministic monochrome edge patterns,
  not color alone.

### Deferred: Lunch

If lunch is resumed, the Daily Brief may show today's entree options and Lunch
View may use the shared date
and update rail beside five Monday-through-Friday lanes. It shows the current
school week on weekdays and the upcoming school week on Saturday and Sunday.

Rules:

- Do not show breakfast, sides, nutrition, or allergen claims.
- Treat the MealViewer `/api/v4` interface as undocumented and revocable.
- Fetch at low frequency and retain only normalized dates and entree names.
- Say `No menu posted` unless a reliable explicit closure or blackout is present.
- Say `Next week's menu not posted` on weekends when appropriate.
- Validate schema changes and preserve stale data visibly.

Initial lunch icon enum:

- `pizza`
- `taco`
- `sandwich`
- `chicken`
- `pasta`
- `salad`
- `generic`

Deterministic exact/keyword mappings and cached decisions run first. Workers AI may classify genuinely unknown names, but its output must be one exact enum value; every invalid or uncertain result becomes `generic`.

### Deferred: Notices

If notices are resumed, Notices View may use the shared date and update rail
with an adaptive two-column
card grid. It shows at most eight entries total, including up to two Private
Notice Markers. Approved cards pair a category icon with the neutral summary,
relevant date, requested action, and sender organization. Private markers show
only the account label, and the empty state says `No active Household Notices`.

## Data freshness and failure behavior

- Publish the newest valid snapshot for each section.
- Show one global `Updated` time.
- Show age only for stale sections.
- Never replace missing data with success-shaped empty content.
- Preserve the previous generation if image rendering or publication fails.
- Alert the operational address after:
  - OAuth revocation or expiry.
  - Two consecutive scheduled failures for one source.
  - A rendering failure that prevents a new generation.
  - Workers AI quota exhaustion.
  - Suspicious device-authentication activity.
  - No device check-in for 24 hours.
- Clear outage alerts automatically after recovery.

The V1 incident state machine suppresses the first scheduled source failure,
sends once when the second consecutive failure makes the condition actionable,
and deduplicates every active condition. Successful source refresh, OAuth
reconnection, successful publication, valid device authentication, or renewed
device check-in resolves the corresponding active incident so a later
recurrence can alert again. Email contains only a fixed incident code and a
direction to the protected status page.

The protected status page shows device check-in, last successful render, per-source freshness, OAuth health, Workers AI quota state, and fixed error codes. It never displays raw email content, tokens, or Gmail prompts.

The administration hostname is enforced by the Worker as well as by routing.
Cloudflare Access authenticates the browser identity, while D1 maps that
identity to the administrator or reviewer role. Device credentials are never
accepted at this boundary. Operational incidents retain fixed codes and
timestamps only; exception text and upstream or household content are omitted.
Status reads the atomic current-generation pointer rather than inferring
success from individual image rows, and exposes retry attempts without
displaying stored diagnostic text.

## Authentication and roles

Two Google consumer accounts authorize read-only Calendar access. Phase 2 adds `gmail.readonly` for both accounts.

The Google OAuth app will be published to Production for persistent refresh tokens and limited in practice to the two household users. The users may see Google's unverified-app warning.

Cloudflare Access roles:

- **Administrator**: one person can connect accounts, select calendars, change settings, dismiss/correct notices, and manage the device.
- **Reviewer**: both spouses can inspect protected uncertain or sensitive notice records.

The display uses configured `Mom` and `Dad` labels rather than email addresses or legal names.

OAuth refresh tokens are encrypted before D1 storage using an application key held as a Worker secret. Disconnect and delete controls must revoke access and remove retained data.
The administrator-facing disconnect control revokes Google first, then purges
account-scoped structured data and all private render generations so removed
data cannot remain in D1, R2, or a previously rendered image.

## Phase-2 Household Notices

### Candidate selection

At setup, inspect at most the previous seven days. Afterward, process incremental Gmail history immediately before each scheduled render.

Before AI inference:

- Include new Inbox messages.
- Exclude Spam, Trash, Promotions, Social, obvious marketing, bulk newsletters, and routine receipts.
- Always include configured school and childcare sender domains.
- Remove repeated quoted history, signatures, boilerplate, tracking URLs, and unnecessary headers.

### AI boundary

Use a dedicated Gmail-processing Worker:

- Call Workers AI directly rather than through AI Gateway.
- Disable content-bearing observability and never log prompts, responses, subjects, senders, message IDs, tokens, or bodies.
- Treat email content as untrusted and explicitly ignore instructions embedded in it.
- Require strict JSON Schema generation followed by independent application validation.
- Fail closed on model errors, malformed output, implausible dates, sensitive leakage, quota exhaustion, or low confidence.
- Store the configured model ID and model version with accepted results.
- Keep model IDs configurable and validate changes against synthetic fixtures.
- Record the exact configured model ID and version on every accepted result;
  promotion tooling must pass non-personal live and fail-closed regressions
  before changing the deployment configuration.

Raw email bodies are processed transiently and never persisted.

The implemented boundary, retention fields, deployment configuration, and
privacy inspection are documented in
[Privacy-isolated Gmail processing](gmail-integration.md).

### Publication

Automatically publish only results with:

- Confidence of at least 0.90.
- A safe shared category.
- A neutral summary of at most two short lines.
- A valid normalized date or action whenever one is claimed.
- No prohibited sensitive content.

A displayed Household Notice contains:

- Category icon.
- Neutral summary.
- Relevant date or deadline.
- Requested action when present.
- Sender organization.

It never contains the raw subject, body excerpt, sender address, or confidence score.

### Sensitive and uncertain results

- Uncertain candidates enter protected review and do not appear as normal notices.
- Sensitive relevant content produces a Private Notice Marker identifying only `Mom` or `Dad`.
- The marker reveals no category, sender, date, summary, or message content.
- Both reviewers may inspect the protected record.
- Only the administrator may dismiss, correct, or publish a result.

### Lifecycle

- Deduplicate updates from the same email thread.
- Expire notices after the extracted event or deadline plus the configured
  `NOTICE_GRACE_DAYS` period (three days by default).
- Retain accepted structured notices until 30 days after expiry.
- Retain uncertain or sensitive review records for 14 days.
- Never retain raw bodies.

## Privacy and security boundaries

- R2 is private; images are served through authenticated Worker routes.
- Gmail-derived data is transferred only for the visible Household Notice feature.
- Workers AI prompts and outputs are not used as application logs.
- No raw Gmail content enters Browser Rendering HTML.
- No public dashboard image or unauthenticated current-image endpoint exists.
- Secrets and tokens never appear in URLs.
- Upstream messages and AI output are untrusted input.
- Normalized snapshots contain only fields required for rendering.

## Battery target

V1 targets at least four weeks between charges with:

- Four scheduled wakes per day.
- Normal Wi-Fi conditions.
- Modest short-press navigation among cached views.

Record device check-ins and available battery telemetry. Optimize cadence or image behavior only if physical measurement misses the target.

## Non-goals

- TRMNL hosted service or paid BYOD license.
- Home Assistant.
- Custom ESP32 firmware.
- Touch interaction or task completion on the display.
- Manual data refresh.
- Apple Reminders.
- Public dashboard images.
- Raw email display or storage.
- Medical, nutrition, or allergen guidance.
- Treating MealViewer's implementation endpoint as a supported public API.

## External references

- [TRMNL DIY configurations](https://docs.trmnl.com/go/diy/introduction)
- [TRMNL BYOD/S](https://docs.trmnl.com/go/diy/byod-s)
- [TRMNL minimum BYOS API](https://docs.trmnl.com/go/diy/byos)
- [Seeed kit documentation](https://wiki.seeedstudio.com/trmnl_7inch5_diy_kit_main_page/)
- [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Cloudflare Browser Rendering limits](https://developers.cloudflare.com/browser-run/limits/)
- [Cloudflare Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)
- [Cloudflare Workers AI data usage](https://developers.cloudflare.com/workers-ai/platform/data-usage/)
- [Gmail API scopes](https://developers.google.com/workspace/gmail/api/auth/scopes)
- [Google Workspace user-data policy](https://developers.google.com/workspace/workspace-api-user-data-developer-policy)
- [Google Calendar authorization](https://developers.google.com/workspace/calendar/api/auth)
- [Open-Meteo API](https://open-meteo.com/en/docs)
- [SJUSD MealViewer page](https://schools.mealviewer.com/school/SJUSDElementarySchoolsSJUSD)

## Implementation-time configuration

The following values remain intentionally configurable rather than architectural:

- Actual Cloudflare domain and hostname names.
- Administrator and reviewer identities.
- Operational email alias and destination.
- Exact weather coordinates.
- Selected Google calendars.
- School/childcare sender allowlist.
- Open-licensed icon package and required attribution.
- Tested device model image-size limit.
- Final text sizes and spacing after physical e-paper review.
