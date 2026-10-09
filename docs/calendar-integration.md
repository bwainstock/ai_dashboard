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

Discovery returns the calendars available to the connected account.
Configuration stores selected provider calendar IDs, safe display labels, and
the configurable household labels. It never returns or exposes refresh tokens.

Scheduled generation refreshes both selected account sources, normalizes the
three-local-day window, and persists only the fields used by rendering:
hashed occurrence identity, safe title, timing, all-day/tentative/private
flags, household labels, and shortened location. Descriptions, attendees,
conference data, organizer addresses, and email addresses are not copied into
normalized snapshots. Daily Brief uses the first three normalized events and
never renders location.

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
