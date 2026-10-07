# Family Dashboard Design

## Purpose

The Family Dashboard is a battery-powered, glanceable household display for near-term weather, calendars, school lunch, and eventually important email-derived notices. It targets the Seeed/TRMNL 7.5-inch OG DIY Kit without a paid TRMNL BYOD license.

The system favors low maintenance, controlled handling of Gmail data, readable child-friendly visuals, and Cloudflare free-tier operation.

## Product scope

### Version 1

- Today and tomorrow weather for San Jose, California.
- Selected events from two consumer Google accounts for today and the next two local calendar days.
- School lunch from the SJUSD Elementary Schools MealViewer feed.
- A Daily Brief plus Calendar View and Lunch View.
- Four scheduled updates every day at 06:30, 10:30, 15:00, and 19:00 in `America/Los_Angeles`.
- Forward-only navigation using the stock firmware's wake button.
- Protected configuration and operational status pages.

### Phase 2

- Household Notices extracted from both Gmail accounts.
- Up to two notices on the Daily Brief and up to eight on Notices View.
- Protected review of uncertain or sensitive results.
- Cloudflare Workers AI classification and extraction.

## Architecture

The device keeps the open TRMNL firmware and talks to a custom BYOS-compatible Cloudflare Worker. TRMNL's paid hosted service, Home Assistant, and custom ESP32 firmware are not required.

```text
Google Calendar ─┐
Open-Meteo ──────┼─> source adapters ─> normalized snapshots ─┐
MealViewer ──────┘                                            │
                                                              ├─> HTML/CSS renderer
Gmail ─> private Gmail Worker ─> validated notices ────────────┘        │
                                                                       v
                                                            Browser Rendering
                                                                       │
                                                                       v
TRMNL device <─ device Worker <─ private R2 PNGs <─ generation pointer in D1
                       │
                       └─ D1 configuration, OAuth tokens, status, snapshots
```

### Cloudflare components

- **Workers**:
  - Device API and image delivery.
  - Access-protected administration and status UI.
  - Phase-2 Gmail processing isolated from the main application.
- **D1**: configuration, encrypted OAuth credentials, selected calendars, normalized source snapshots, notice records, device state, and immutable generation pointers.
- **R2**: private immutable 800x480 PNG generations.
- **Browser Rendering**: scheduled HTML/CSS screenshots.
- **Workers AI**: constrained lunch-icon fallback and phase-2 Household Notice extraction.
- **Cron Triggers**: local-time generation scheduling and one delayed retry.
- **Cloudflare Access**: browser authentication and role enforcement.
- **Cloudflare Email**: a verified send-email binding for actionable failure
  alerts.

No KV or Queues are planned initially.

### Hostnames

Use separate hostnames on the existing Cloudflare-managed domain:

- `dashboard-admin.<domain>`: Cloudflare Access-protected administration, review, and status.
- `dashboard-device.<domain>`: TRMNL setup, display, and authenticated image routes.

The device hostname must not require an interactive Access login. `/api/setup` issues a high-entropy device token, and every display or image request validates it. The device MAC address and image filename are identifiers, not credentials.

## Device protocol and navigation

The Worker implements the minimum TRMNL BYOS contract:

- `/api/setup`
- `/api/display`
- `/api/log`, if useful for fixed non-sensitive device error codes

The current stock firmware exposes one reliable wake button for this board target.

- Timer wake: return the latest Daily Brief and set the interval until the next configured local update.
- Short press: advance the per-device view cursor.
- V1 cycle: Daily Brief -> Calendar View -> Lunch View -> Daily Brief.
- Phase-2 cycle: Daily Brief -> Calendar View -> Lunch View -> Notices View -> Daily Brief.
- The next timer wake always returns to the Daily Brief.
- Manual data refresh is intentionally omitted.
- Long firmware gestures retain their built-in Wi-Fi and credential-reset behavior.

Use PNG filenames with distinct view prefixes and generation timestamps so stock firmware can cache multiple views correctly. Every scheduled generation refreshes the view set before firmware cache entries age out.

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
3. Render all active views using a self-contained HTML document.
4. Validate each screenshot as an 800x480 PNG within the device model's tested size limit.
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

Icons are visually primary but always accompanied by short text. Use bundled, open-licensed, monochrome SVG assets rendered inline; do not depend on remote assets or MealViewer images.

### Daily Brief

- Compact weather band across the top.
- Calendar uses roughly 60% of the body.
- Lunch uses roughly 40% of the body, with larger food icons.
- Phase 2 adds at most two Household Notices without shrinking text below the readability threshold.
- Footer shows one global update time.
- A stale section shows a warning marker and age.

### Weather

Show:

- Current temperature and condition.
- Today's high, low, and precipitation probability.
- Tomorrow's condition, high, low, and precipitation probability.

Use Open-Meteo with administrator-configured coordinates. San Jose is the initial location.

### Calendar

The Daily Brief shows the next three relevant events, prioritizing today. Calendar View shows up to twelve events grouped under Today and the following two local calendar days, then `+N more`.

Rules:

- Include accepted and tentative timed events and useful all-day events from selected calendars.
- Exclude declined events and unselected generated calendars.
- Render private events as `Busy`.
- Deduplicate copies with matching iCal UID and occurrence time.
- Use configured `Mom` and `Dad` labels when ownership is useful.
- Show shortened location only on Calendar View.
- Never show descriptions, attendees, conferencing links, organizer addresses, or personal email addresses.
- Use compact 12-hour local time; all-day events precede timed events.

### Lunch

The Daily Brief shows today's entree options. Lunch View shows entree options for the current school week; on Saturday and Sunday it shows the upcoming school week.

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
- Expire notices after the extracted event or deadline plus a short grace period.
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
