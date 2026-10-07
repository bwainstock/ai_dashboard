# Operational incidents and email

The five V1 incident conditions are evaluated after every five-minute scheduled
run. Device-authentication state changes are evaluated immediately as well:

- Google Calendar OAuth is revoked or expired.
- One source fails two consecutive scheduled refreshes.
- Rendering, image validation, storage, or pointer publication blocks a new
  generation.
- A device presents missing or invalid credentials.
- A provisioned device has not checked in for 24 hours.

One source failure is recorded as stale but does not alert. Each active
condition has one durable incident key, so repeated evaluations do not send
duplicate email. Recovery resolves the active row; a later recurrence creates
a new incident and sends a new email. Failed email delivery remains pending and
is retried by the next scheduled evaluation.

Operational email contains only one of these fixed codes:

- `OAUTH_REVOKED_OR_EXPIRED`
- `SOURCE_SCHEDULED_FAILURE`
- `GENERATION_PUBLICATION_BLOCKED`
- `DEVICE_AUTH_SUSPICIOUS`
- `DEVICE_CHECK_IN_MISSING`

Email directs the operator to the Access-protected status page. It contains no
account address, source payload, household content, token, exception text, or
other secret.

## Deployment

Apply migration `0009_operational_incidents.sql`. Configure the
`INCIDENT_EMAIL` send-email binding with an Email Routing-verified destination,
then set `OPERATIONAL_EMAIL_FROM` and `OPERATIONAL_EMAIL_TO` to verified
non-secret addresses. The placeholders in `wrangler.toml` must be replaced
before deployment.

`GET /admin/status` lists active incidents with their fixed code, occurrence
time, and notification time. A null notification time means email delivery is
pending.
