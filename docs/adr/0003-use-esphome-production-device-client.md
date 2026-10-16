---
status: accepted
---

# Use ESPHome as the production device client

The physical kit proved easier to operate and diagnose with ESPHome than with
stock TRMNL firmware. The supported device path is therefore an ESPHome client
that authenticates to a Cloudflare direct-image interface and caches the
complete published view set in PSRAM. Cloudflare retains source aggregation,
rendering, atomic publication, privacy enforcement, explicit view delivery,
and generation pinning; Key 3 selection is local and works offline. Legacy
TRMNL BYOS routes and their server-managed cursor remain only as rollback
compatibility. Deep sleep is deliberately deferred to #36 until its wake,
recovery, maintenance, and battery behavior are physically accepted.
