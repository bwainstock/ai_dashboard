# Ticket #5: Calendar View acceptance

Calendar View is generated with the composed Daily Brief at each due local
slot. Publication writes both immutable PNG objects before one D1 batch marks
the complete view set published.

Automated coverage verifies:

- Explicit authenticated requests select Daily Brief or Calendar View from one
  published generation.
- ESPHome caches both decoded views, Key 3 switches locally, and scheduled
  refresh resets local selection to Daily Brief.
- Authenticated display responses retain the dynamic seconds-to-next-slot
  `refresh_rate`; missing and invalid credentials are rejected.
- Daily Brief and Calendar View filenames use distinct view prefixes and stay
  stable between scheduled generations.
- Calendar View groups today and the next two local days, limits output to
  twelve events, reports `+N more`, orders all-day events before timed events,
  and uses compact 12-hour times.
- The rail shows the date, today and tomorrow forecasts, and the generation
  update timestamp. It never presents a clock, current temperature, or other
  live-looking value.
- Shortened locations appear only on Calendar View. Private events render as
  `Busy`, and normalized/rendered data excludes descriptions, attendees,
  meeting links, organizer addresses, and personal email addresses.
- Scheduled and forced generations refresh enabled Calendar Feeds before
  rendering. A failed feed contributes only its own last successful snapshot
  for at most 72 hours; older snapshots and disabled feeds are omitted.
- The administration page exposes privacy-safe snapshot counts and can force a
  two-view generation. The device fetches that publication only at its next
  designed refresh or reconnect and stages the complete pair atomically.
- If no enabled Calendar Feed has a usable snapshot, Daily Brief and Calendar
  View both show `Calendar unavailable` while the complete two-view generation
  still publishes atomically.

The schema migration added a rollback-compatible per-device cursor and a view
type to immutable render generations. Production ESPHome navigation now uses
the cached view set described in ticket #37.
