# Ticket #5: Calendar View acceptance

Calendar View is generated with the composed Daily Brief at each due local
slot. Publication writes both immutable PNG objects before one D1 batch marks
the complete view set published.

Automated coverage verifies:

- `Update-Source: button` advances the server-side device cursor from Daily
  Brief to Calendar View.
- `Update-Source: timer` resets the cursor to Daily Brief.
- Authenticated display responses retain the dynamic seconds-to-next-slot
  `refresh_rate`; missing and invalid credentials are rejected.
- Daily Brief and Calendar View filenames use distinct view prefixes and stay
  stable between scheduled generations.
- Calendar View groups today and the next two local days, limits output to
  twelve events, reports `+N more`, orders all-day events before timed events,
  and uses compact 12-hour times.
- Shortened locations appear only on Calendar View. Private events render as
  `Busy`, and normalized/rendered data excludes descriptions, attendees,
  meeting links, organizer addresses, and personal email addresses.

The schema migration adds the per-device cursor and a view type to immutable
render generations. The previous single-row slot uniqueness becomes
slot-and-view uniqueness.
