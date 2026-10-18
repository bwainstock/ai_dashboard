# Implementation plan

The active system consists of one Cloudflare Worker, D1, private R2, Browser
Rendering, Open-Meteo, administrator-configured Calendar Feeds, and the ESPHome
device client.

Completed foundations include private authenticated image delivery, scheduled
weather, atomic two-view generations, four-gray rendering, local device
navigation, Access-protected administration, secure Calendar Feed CRUD/fetch,
RFC 5545 normalization and recurrence, per-feed health, 72-hour fallback, and
the provider-neutral cutover migration.

Remaining product work should preserve the contracts in `docs/design.md`,
`docs/calendar-integration.md`, and `docs/product-requirements.md`. School lunch
is deferred and must not join the active generation set without a new accepted
specification.
