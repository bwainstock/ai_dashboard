# Family Dashboard

A shared, glanceable view of near-term household information.

## Language

**Daily Brief**:
The single composite screen showing the household information relevant to the current day and near future.
_Avoid_: Dashboard, home screen, playlist

**Calendar View**:
A secondary screen listing selected events for today and the next two local calendar days.
_Avoid_: Calendar page, schedule screen

**Discovered Calendar**:
A calendar identified as available for household event retrieval.

**Selected Calendar**:
A Discovered Calendar designated as a source of household events and assigned a Calendar Label.

**Calendar Label**:
A privacy-safe, administrator-facing name for a Selected Calendar. It is not shown on the shared display.

**Household Label**:
A short, non-identifying name for a connected household account that may be shown on the shared display.

**Lunch View**:
A secondary screen listing school lunch options for the current school week.
_Avoid_: Menu page, meal screen

**Notices View**:
A secondary screen listing active Household Notices extracted from household email.
_Avoid_: Email screen, inbox, alerts page

**Household Notice**:
A message-derived item with a concrete date, deadline, schedule change, requested action, or relevance to a child or school.
_Avoid_: Important email, priority email

**Private Notice Marker**:
An account-specific indication that a sensitive Household Notice is available for protected review, revealing no category, sender, date, or message content.
_Avoid_: Private email, sensitive alert

**Protected Review Record**:
A validated, access-protected Gmail extraction awaiting administrator dismissal,
correction, or publication. Both administrator and reviewer roles may inspect it;
only the administrator may change its state.
_Avoid_: Raw email, review email

**Sender-Domain Allowlist**:
A set of approved email sender domains whose messages may be treated as household email sources. Each domain is classified as either school or childcare.

**Operational Incident**:
A durable active state for one actionable system condition. It sends one fixed-code email, resolves automatically after recovery, and may alert again only after a later recurrence.
_Avoid_: Error message, household alert
