# Calendar Feed integration

Calendar data comes only from administrator-configured Calendar Feeds. A feed
is a direct HTTPS iCalendar URL whose bearer value is encrypted at rest with
the dedicated `CALENDAR_FEED_URL_ENCRYPTION_KEY` contract. Administration
responses expose only the feed ID, hostname, a short stable fingerprint,
privacy-safe labels, enabled state, and health.

Up to 20 feeds may be stored. Calendar Label is required and Household Label is
optional. A new or replacement URL must pass the secure test before it becomes
enabled. Label-only edits do not fetch. Disabling retains data but excludes the
feed from generation; deleting purges its encrypted URL, snapshot, and health
history.

## Fetch contract

The initial request and every redirect must use HTTPS on port 443, contain no
credentials or fragment, and resolve only to public addresses. At most three
redirects are followed. Requests send no cookies or authorization headers and
use a 10-second deadline, 2 MiB compressed limit, and 10 MiB decompressed/parser
limit. Generation refreshes at most four feeds concurrently and sends stored
`ETag` and `Last-Modified` validators.

## Normalization contract

RFC 5545 `VCALENDAR` input supports `VEVENT`, all-day values, UTC, floating
local time, embedded `VTIMEZONE`, `RRULE`, `RDATE`, `EXDATE`, and
`RECURRENCE-ID` overrides or cancellations. Data is normalized into the
configured dashboard timezone.

Snapshots retain only summary, start/end, all-day state, shortened location,
event status, UID/occurrence identity, Calendar Label, and Household Label.
Private or confidential events become `Busy` without location. Descriptions,
attendees, organizers, addresses, attachments, conference data, and provider
extensions are discarded. Event-level cancellations are excluded.

A valid empty calendar replaces the prior snapshot. Structural failure rejects
the refresh. An isolated malformed standalone event may be skipped with a safe
reason code only when recurrence correctness is unaffected.

## Merge, health, and publication

Recurrence expands before rendering with a fixed work budget. Events are
deduplicated by normalized UID plus occurrence identity. Overrides beat
generated copies; a cancellation removes the occurrence; distinct labels merge
in configured-feed order.

Each feed is independently Healthy, Stale, Unavailable, or Disabled. A failed
feed may use its last successful snapshot for at most 72 hours. After that it
is omitted. If no enabled feed has usable data, both active views show
`Calendar unavailable`.

Feed refresh precedes every scheduled or forced generation. Daily Brief and
Calendar View then apply their existing windows, limits, location rules,
privacy minimization, immutable image writes, and atomic publication.
