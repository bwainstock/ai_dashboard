# Browser administration and operational status

Administration is served only from `ADMIN_ORIGIN` and protected by Cloudflare
Access. The Worker requires both authenticated identity headers and maps the
normalized email to an active `administration_users` row. Administrators may
mutate weather and Calendar Feeds; reviewers have read-only access.

## Routes

- `GET /admin` and `GET /admin/app.js`: browser interface.
- `GET|PUT /admin/weather-configuration`: weather and generation slots; `PUT`
  is administrator-only.
- `GET /admin/calendar-feeds`: redacted metadata for either role.
- `POST /admin/calendar-feeds`: create a disabled feed.
- `PATCH /admin/calendar-feeds/:id`: edit labels or disable.
- `POST /admin/calendar-feeds/:id/test`: securely test and activate the stored
  URL or a replacement.
- `DELETE /admin/calendar-feeds/:id`: purge the feed and retained data.
- `POST /admin/generations`: force the production two-view generation path.
- `GET /admin/status`: device, generation, source, and fixed-code incident
  status.

JSON administration bodies are limited to 64 KiB. Mutation routes require the
administrator role.

## Calendar Feed contract

Set `CALENDAR_FEED_URL_ENCRYPTION_KEY` as a Wrangler secret. Responses expose
only feed ID, hostname, 12-character fingerprint, labels, enabled state, safe
timestamps, snapshot event and skipped-event counts, and Healthy, Stale,
Unavailable, or Disabled status. Plaintext and encrypted URLs are never
returned.

The secure test applies the same initial-request and redirect SSRF validation,
timeouts, response-size limits, and parser limits used by generation. A failed
replacement preserves the working URL, snapshot, enabled state, and health.
The browser reports a safe, actionable reason for test failures such as DNS,
HTTP, timeout, response-size, compression, or invalid-calendar errors.
Label-only edits do not fetch. Disable retains data; delete removes URL,
snapshot, and health history.

Administrators can force generation from the browser after changing a feed.
The production ESPHome client checks image metadata once per minute and stages
both views only when the published generation changes.

The current deployment has no provider-account authorization, provider
discovery, email ingestion/review controls, or email-derived view routes.

## Deployment

`wrangler.toml` defines the single production Worker. Configure the feed URL
encryption secret separately and replace operational email placeholders with
verified addresses. Apply every forward D1 migration, including migration
`0016`, before deploying the cutover.
