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
- `GET`/`PUT /admin/gmail-configuration` is administrator-only and manages
  school/childcare sender domains plus content-free processing status. See
  [Privacy-isolated Gmail processing](gmail-integration.md).

Status contains only last device check-in, the atomically published current
generation, the latest slot attempt and retry state, source freshness, OAuth
state, AI quota state, and active operational incidents with fixed error codes
and notification timestamps. A source fallback is reported as stale while
retaining its last-success timestamp. Failed generation attempts show whether
the one allowed retry is pending or has run, while the current generation
continues to identify the previous complete published view set. See
[Operational incidents and email](operational-incidents.md) for alert
conditions, suppression, recovery, and deployment configuration.

The surface never returns OAuth credentials, device tokens, raw provider
payloads, household content, exception messages, or other content-bearing
diagnostics. Source and generation failure storage records only fixed codes;
migration `0008` clears legacy diagnostic messages from both scheduled
generation and source-failure records.

Google client credentials, the OAuth token-encryption key, and other deployment
secrets remain Wrangler secrets. OAuth refresh tokens remain encrypted in D1
and are never returned by administration contracts.
