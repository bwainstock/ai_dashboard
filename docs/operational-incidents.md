# Operational incidents and email

Operational incidents are durable fixed-code states for actionable production
conditions. They never include source content, URLs, exception messages, or
credentials.

Active incident classes are repeated weather/calendar source failure,
publication-blocking rendering failure, suspicious device authentication, and
missing device check-in. The first scheduled source failure is suppressed; the
second consecutive failure opens and sends one incident. Recovery resolves the
active incident so a later recurrence may notify again.

Configure the `INCIDENT_EMAIL` binding and verified
`OPERATIONAL_EMAIL_FROM`/`OPERATIONAL_EMAIL_TO` values in the production Worker.
If delivery fails, the incident remains pending and retries on the next check.
