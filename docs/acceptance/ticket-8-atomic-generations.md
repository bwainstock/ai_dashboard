# Ticket #8: stale-safe atomic generations

Every scheduled execution now builds one immutable generation containing Daily
Brief, Calendar View, and Lunch View. R2 objects are written under the
generation ID first; one D1 batch then records the complete set and advances the
singleton current-generation pointer. Display requests resolve every view
through that pointer, so rendering, validation, R2 storage, or D1 publication
failure leaves the prior complete set active.

Normalized weather, calendar, and lunch snapshots retain their fetch time.
When a source fails, the newest valid snapshot is rendered with a section-level
age while each view keeps one compact generation-wide `Updated` time. A source
without any valid calendar snapshot is shown as unavailable rather than as a
successful empty calendar.

Scheduling behavior:

- Local slot keys use local date, local time, and IANA timezone, making duplicate
  Cron deliveries and the repeated fall-back hour idempotent.
- Nonexistent spring-forward local minutes are skipped rather than shifted.
- A failed generation receives one retry after
  `GENERATION_RETRY_MINUTES` (15 in `wrangler.toml`).
- Retry images use the retry execution time as a new immutable generation ID,
  so objects left by a failed storage attempt are never overwritten.

Migration `0007_atomic_generations.sql` adds the all-view pointer, generation
sets, retry claim state, snapshot-source failure records, and a backfill for the
latest previously published complete three-view set.

Automated coverage exercises fresh and partially stale generations, visible
stale ages, unavailable sources, invalid screenshots, rendering and publication
failure, one successful and one terminal retry, duplicate delivery, incomplete
view sets, and both daylight-saving boundaries. Images remain private and are
still available only through authenticated device routes.
