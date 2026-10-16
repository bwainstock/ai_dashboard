---
status: accepted
---

# Use ESPHome as the production device client

The physical kit proved easier to operate and diagnose with ESPHome than with
stock TRMNL firmware. The supported device path is therefore an ESPHome client
that makes one authenticated request to a Cloudflare direct-image interface,
while Cloudflare retains source aggregation, rendering, atomic publication,
privacy enforcement, and server-managed view selection. Legacy TRMNL BYOS
routes remain only as rollback compatibility; deep sleep is deliberately
deferred to #36 until its wake, recovery, maintenance, and battery behavior are
physically accepted.
