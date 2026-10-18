# Family Dashboard

A shared, glanceable view of near-term household information.

**Daily Brief**: The primary screen showing dated weather and relevant Calendar
Feed events for today and tomorrow.

**Calendar View**: The secondary screen listing events for today and the next
two local calendar days.

**Calendar Feed**: An administrator-configured direct HTTPS iCalendar source.
Its URL is a bearer credential encrypted at rest and never returned.

**Calendar Label**: A required privacy-safe name attached to one Calendar Feed.

**Household Label**: An optional short label attached to one Calendar Feed that
may be shown on the shared display.

**Feed Snapshot**: The last successfully normalized, privacy-minimized event set
for one Calendar Feed.

**Healthy**: The feed's latest refresh succeeded.

**Stale**: The latest refresh failed, but the feed has a successful snapshot no
more than 72 hours old.

**Unavailable**: The feed has no successful snapshot within 72 hours and is
omitted from generation.

**Disabled**: The feed is retained but excluded from generation.

**Calendar unavailable**: The explicit state rendered in both active views when
no enabled Calendar Feed has usable data.

**Operational Incident**: A durable actionable condition represented by a
fixed, non-content-bearing code and resolved automatically after recovery.

**Lunch View**: A deferred secondary screen for school lunch options; it is not
part of the active generation set.
