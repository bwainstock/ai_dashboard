# Browser administration and operational status

The browser administration surface is served only from `ADMIN_ORIGIN`. The
device protocol remains on `DEVICE_ORIGIN`; administration routes return 404
from the device hostname, and device routes return 404 from the administration
hostname. `workers_dev` is disabled so the Worker cannot bypass the configured
custom-hostname policies.

## Cloudflare Access boundary

Create a Cloudflare Access self-hosted application for the administration
hostname. Do not put the device hostname behind an interactive Access policy.
The Worker requires both Access identity headers:

- `Cf-Access-Authenticated-User-Email`
- `Cf-Access-Jwt-Assertion`

Access must validate the assertion before forwarding the request. The Worker
then looks up the normalized email in D1 `administration_users`. An
`administrator` may mutate configuration and start Google OAuth; a `reviewer`
may read configuration and status. Anonymous, unknown, inactive, and
device-token-only requests are denied.

After applying migrations, bootstrap the household roles with parameterized D1
statements equivalent to:

```sql
INSERT INTO administration_users (email, role)
VALUES ('administrator@example.com', 'administrator');
INSERT INTO administration_users (email, role)
VALUES ('reviewer@example.com', 'reviewer');
```

Use lowercase Access email identities. Role rows are configuration, not
secrets.

## Protected contracts

- `GET /admin` provides the browser entry point.
- `GET /admin/configuration` is available to reviewers and administrators.
- `PUT /admin/configuration` is administrator-only and manages weather
  coordinates, render slots, selected calendars, and the Mom/Dad display
  labels.
- `GET /admin/calendar/oauth/start`, OAuth callback, calendar discovery, and
  the existing calendar configuration contract are administrator-only.
- `GET /admin/status` is available to reviewers and administrators.

Status contains only last device check-in, last successful render, source
freshness, OAuth state, AI quota state, and fixed error codes. It never returns
OAuth credentials, device tokens, raw provider payloads, household content,
exception messages, or other content-bearing diagnostics. Scheduled failure
storage records only a fixed code; migration `0007` clears legacy diagnostic
messages.

Google client credentials, the OAuth token-encryption key, and other deployment
secrets remain Wrangler secrets. OAuth refresh tokens remain encrypted in D1
and are never returned by administration contracts.
