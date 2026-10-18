# Family Dashboard design

## Purpose and active product

The Family Dashboard is a battery-powered, glanceable household display for
near-term weather and Calendar Feed events. Version 1 publishes Daily Brief and
Calendar View at 06:30, 10:30, 15:00, and 19:00 in
`America/Los_Angeles`, with local Key 3 navigation on the ESPHome device.

Email-derived content and its former display surface are not product
capabilities. School lunch remains deferred and outside the active generation
set.

## Architecture

```text
Calendar Feeds ─┐
Open-Meteo ─────┴─> minimized snapshots ─> HTML/CSS ─> Browser Rendering
                                                               │
ESPHome device <─ authenticated immutable PNGs <─ Worker <──────┘
                                                │
                              D1 state + private R2 generations
```

The single Worker serves the device API, Access-protected administration,
scheduled generation, and Calendar Feed refresh. D1 stores configuration,
encrypted feed URLs, minimized snapshots, health, status, and atomic generation
pointers. R2 stores private immutable 800x480 PNGs. Browser Rendering captures
the two active views. No provider-account discovery, shared credentials, or
separate content-processing Worker participates in production.

## Device and publication contract

The device authenticates `GET /api/image` with `ID` and `Access-Token`, selects
`daily_brief` or `calendar` through `X-Dashboard-View`, and pins both downloads
to one `X-Dashboard-Generation`. It stages and decodes both four-gray images
before replacing the active PSRAM slot. Failure leaves the previous complete
pair active.

Every due generation:

1. Refreshes enabled Calendar Feeds with bounded concurrency and per-feed
   fallback.
2. Fetches weather and preserves last-good data visibly on source failure.
3. Renders native 800x480 images using luminance values 0, 85, 170, and 255.
4. Validates opaque PNG dimensions, palette, and byte limit.
5. Writes both immutable R2 objects.
6. Advances the singleton D1 pointer only after the complete pair exists.

If every enabled Calendar Feed is unusable, both views explicitly render
`Calendar unavailable`; publication remains atomic.

## Display rules

Daily Brief shows weather plus up to six events across today and tomorrow.
Calendar View shows up to twelve events across today and the next two local
days and reports `+N more`. All-day events precede timed events. Only Calendar
View may show shortened location.

Events are deduplicated by normalized iCalendar UID and occurrence. Private
events render as `Busy`. Descriptions, attendees, organizers, addresses,
attachments, conference data, and other unneeded source fields never enter
render snapshots.

## Administration and operations

Cloudflare Access protects the administration hostname. Administrators manage
weather and Calendar Feeds; reviewers have read-only access to redacted feed
metadata and operational status. Calendar Feed URLs are URL bearer credentials,
encrypted with the dedicated feed key and never returned.

The status surface contains device check-in, generation attempts, source
freshness, redacted feed health, and fixed-code incidents. Source or rendering
failures never store content-bearing diagnostics.
