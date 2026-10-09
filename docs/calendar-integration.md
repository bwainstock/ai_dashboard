# Google Calendar integration

The Calendar source supports exactly two household connections, identified
internally as `mom` and `dad`. Each connection requests only
`calendar.readonly`; refresh tokens are AES-GCM encrypted with
`CALENDAR_TOKEN_ENCRYPTION_KEY` before D1 storage. Google client credentials and
the encryption key are Wrangler secrets.

Administrator endpoints are protected by the same administrator boundary as
weather configuration:

- `GET /admin/calendar/oauth/start?account=mom|dad`
- `GET /admin/calendar/oauth/callback`
- `GET /admin/calendar/discovery?account=mom|dad`
- `GET|PUT /admin/calendar-configuration`

Discovery follows all provider calendar-list pages, with a hard limit of 20
pages per household account. Crossing the limit fails discovery without
returning a partial list. The browser orders Selected Calendars first and then
sorts case-insensitively by label; its filter is local. Discovery runs
automatically after a successful OAuth return and is also available through an
explicit refresh control. A newly connected account initially has no Selected
Calendars.

Configuration stores Selected Calendar provider IDs, Calendar Labels, and each
Household Label. A Household Label is device-visible and has a 20-character
limit. A Calendar Label is administrator-only and has a 40-character limit.
Both accept Unicode letters and numbers, spaces, ampersand, apostrophe, hyphen,
and period; whitespace is trimmed and collapsed. Symbols, emoji, control
characters, URLs, and email-like text are rejected. Provider names are
sanitized only as editable discovery prefills and are not persisted until an
administrator selects and saves them.

Each household account may have at most 10 Selected Calendars. Newly selected
provider IDs must appear in a fresh server-side discovery during save. An
existing Selected Calendar missing from discovery remains visible as
Unavailable and remains selected until explicitly removed. The same shared
calendar may be selected under both accounts. Discovery or save failure leaves
the persisted configuration unchanged. Configuration never returns or exposes
refresh tokens.

Scheduled generation refreshes both selected account sources, normalizes the
three-local-day window, and persists only the fields used by rendering:
hashed occurrence identity, safe title, timing, all-day/tentative/private
flags, household labels, and shortened location. Descriptions, attendees,
conference data, organizer addresses, and email addresses are not copied into
normalized snapshots. Daily Brief uses the first three normalized events and
never renders location.

A complete household generation has one shared budget of 100 Calendar API
event-list pages across both accounts and every Selected Calendar. Exceeding
the budget fails the Calendar source with fixed, content-free failure handling;
partial provider data is never published. Existing stale fallback and
generation failure behavior remains in effect.

Each scheduled publication renders a complete immutable view set. Calendar
View groups at most twelve normalized events under Today and the following two
local days, orders all-day events before timed events, uses compact 12-hour
times, and reports overflow as `+N more`. Shortened locations are rendered only
on Calendar View; private events remain `Busy` and never retain a location.

The device sends its firmware `Update-Source` header to `/api/display`. A
`timer` wake resets the persisted device cursor to Daily Brief; a manual wake
advances it to Calendar View. Daily Brief and Calendar View have distinct
immutable cache filenames (`daily-brief-<timestamp>.png` and
`calendar-view-<timestamp>.png`) that remain stable until the next complete
generation is published.
