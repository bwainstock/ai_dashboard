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
may read weather, safe calendar configuration, Sender-Domain Allowlist
configuration, and status in the structured read-only interface. Anonymous,
unknown, inactive, and
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
  coordinates, render slots, Selected Calendars, and the Mom/Dad Household
  Labels. It remains compatible for existing clients and uses the same
  validation and replacement services as the section-specific routes.
- `GET /admin/calendar/oauth/start`, OAuth callback, calendar discovery, and
  calendar mutations are administrator-only. Reviewers may read
  `GET /admin/calendar-configuration`.
- `GET /admin/status` is available to reviewers and administrators.
- `GET /admin/gmail-configuration` is available to reviewers and
  administrators. `PUT` is administrator-only and replaces the complete
  Sender-Domain Allowlist plus its school/childcare classifications. See
  [Privacy-isolated Gmail processing](gmail-integration.md).
- `GET /admin/gmail-review` is available to reviewers and administrators and
  returns only minimal validated Protected Review Record fields.
- `POST /admin/gmail-review/:id` is administrator-only. It accepts `dismiss`,
  `correct`, or `publish`; corrections must contain exactly `category`,
  `summary`, `relevantDate`, `action`, and `senderOrganization` and pass
  independent validation. Dismissed records no longer produce Private Notice
  Markers, while corrected-and-published fields are used by subsequent Daily
  Brief and Notices View generations.

Status contains only last device check-in, the atomically published current
generation, the latest slot attempt and retry state, source freshness, OAuth
state, AI quota state, and active operational incidents with fixed error codes
and notification timestamps. A source fallback is reported as stale while
retaining its last-success timestamp. Failed generation attempts show whether
the one allowed retry is pending or has run, while the current generation
continues to identify the previous complete published view set. See
[Operational incidents and email](operational-incidents.md) for alert
conditions, suppression, recovery, and deployment configuration.

The status and configuration surfaces never return OAuth credentials, device
tokens, raw provider payloads, household content, exception messages, or other
content-bearing diagnostics. The protected Gmail review surface returns only
validated extracted fields and lifecycle metadata; raw Gmail content,
addresses, identifiers, prompts, and unvalidated output remain absent. Source
and generation failure storage records only fixed codes; migration `0008`
clears legacy diagnostic messages from both scheduled generation and
source-failure records.

Google client credentials, the OAuth token-encryption key, and other deployment
secrets remain Wrangler secrets. OAuth refresh tokens remain encrypted in D1
and are never returned by administration contracts.

The browser interface has independent Weather, household-account calendar, and
Gmail Sender-Domain Allowlist saves. Saving one section does not reset another.
Unsaved section drafts trigger a warning before refresh, reconnect, disconnect,
or navigation. Responses and browser banners use fixed safe status text only.
All administration JSON request bodies are limited to 64 KiB; larger bodies
receive `413`.

Ordinary OAuth callback navigation redirects to `/admin` with a fixed,
account-specific status code. An explicit `Accept: application/json` retains
the existing JSON response contract. Provider codes and errors are never
included in either response. The browser removes the status query after
displaying its fixed banner.
