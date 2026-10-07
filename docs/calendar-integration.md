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
