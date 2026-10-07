# Ticket 14 — Notices View

Automated acceptance covers the externally visible behavior:

- Device short presses cycle Daily Brief → Calendar View → Lunch View →
  Notices View → Daily Brief, while timer wakes reset to Daily Brief.
- A scheduled generation renders and atomically publishes all four 800×480
  PNGs through one current-generation pointer.
- Notices View renders no more than eight active approved Household Notices
  with category icon, neutral summary, relevant date, action, and sender
  organization.
- Private Notice Markers remain account-only and expose no notice details.
- Gmail updates from one thread share a one-way derived source identity; raw
  Gmail message and thread identifiers are not retained.
- Dated notices expire after their date plus `NOTICE_GRACE_DAYS`; undated
  notices use the bounded fallback lifetime, and expired rows are excluded
  from later generations.
- Reviewers remain read-only. Administrator dismissal removes the protected
  record, and corrected approved fields appear in later rendered generations.

Run `npm run check` after applying migration `0012_notices_view.sql`.
