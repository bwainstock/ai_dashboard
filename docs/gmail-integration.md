# Privacy-isolated Gmail processing

Both household accounts use the existing protected Google OAuth flow. The
authorization request grants only Calendar read-only and Gmail read-only
scopes, requests offline access, and stores authenticated-encrypted refresh
tokens. `GET`/`PUT /admin/gmail-configuration` manages the school and childcare
sender-domain allowlist without exposing account addresses or tokens.
Administrators can use the browser controls or
`POST /admin/gmail-accounts/{mom|dad}/disconnect`. Disconnect first revokes the
Google refresh token. It then clears encrypted credentials, Gmail scan cursors,
selected calendars, account notices and review rows, combined calendar
snapshots, every retained render-generation row, and every private R2 image.
If Google revocation fails, deletion does not begin and the control reports a
fixed error so the administrator can retry.

## Worker boundary

`family-dashboard-gmail` is a dedicated, non-public Worker invoked through the
device Worker's service binding immediately before scheduled generation. It
uses a direct Workers AI binding; no AI Gateway is configured. Its Wrangler
configuration disables observability. Application code contains no content
logging, and error responses contain fixed codes only.

The first successful processing pass lists Inbox messages after a date exactly
seven days before the run. It records the resulting Gmail history ID. Later
passes request only `messageAdded` Inbox history after that ID. Spam, Trash,
Social, Promotions, list/bulk mail, marketing, and obvious newsletters are
rejected deterministically before Workers AI. Configured school and childcare
domains override Promotions/list heuristics, but never Spam, Trash, Social, or
non-Inbox exclusion.

## Data minimization and validation

Before inference, the Worker removes quoted history, signatures, tracking
URLs, email addresses, and excess text. The prompt labels all email fields as
untrusted data and explicitly instructs the model to ignore embedded
instructions. Workers AI receives a strict JSON Schema. The application then
independently rejects prompt injection, extra/missing fields, unsafe
categories, addresses, implausible dates, overlong fields, malformed output,
invalid confidence, sensitivity contradictions, and model errors. Provider
quota failures propagate to the Worker boundary so the scan cursor is not
advanced and AI quota status is marked exhausted.

Only independently validated, non-sensitive fields with confidence at least
`0.90` are written automatically to `household_notices`. Lower-confidence
relevant candidates are written only to `gmail_protected_reviews`. Sensitive
relevant candidates are written there and produce only a Mom- or Dad-specific
Private Notice Marker on the shared display. The marker render model contains
only the account label.

Thread deduplication uses a one-way SHA-256 source key derived from the Gmail
thread identifier; raw Gmail message and thread identifiers are never retained.
Protected Review
Records contain only validated structured fields, confidence, account label,
source hash, and lifecycle timestamps. Fixed failure records contain only
account label, reason, and timestamps. Neither contains candidate content or
unvalidated model output. Active notices expire shortly after their date and
are deleted 30 days later. The active grace period is configured consistently
on both Workers with `NOTICE_GRACE_DAYS` and defaults to three days. Protected
and failure review records expire in 14 days.
The Gmail Worker runs retention maintenance before every scheduled scan,
including runs with no connected account, and uses indexed lifecycle
timestamps from migration `0013_gmail_controls.sql`.

## Operational controls

OAuth revocation marks the affected account revoked. AI quota exhaustion marks
the fixed quota state exhausted. Every failed Gmail-processing run increments
the Gmail source failure count with only a fixed code; an unreachable service
binding does the same in the device Worker. The operational incident state
machine sends `OAUTH_REVOKED_OR_EXPIRED`, `AI_QUOTA_EXHAUSTED`, or
`GMAIL_PROCESSING_REPEATED_FAILURE` once while active. Successful OAuth,
Workers AI, and Gmail processing reset the corresponding state so a later
recurrence can alert again.

## Model promotion

`GMAIL_AI_MODEL` and `GMAIL_AI_MODEL_VERSION` are required deployment
configuration. Every accepted notice stores both values, and migration
`0013_gmail_controls.sql` rejects empty provenance. A model change must be made
with:

```sh
CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... \
  npm run gmail:model:promote -- '@cf/provider/model' 'provider-version'
```

The command first runs the complete fail-closed synthetic suite, then runs
non-personal accepted, low-confidence, and safety fixtures against the
candidate through the Workers AI API. It updates `wrangler.gmail.toml` only
after every regression passes. The suite also covers prompt injection,
malformed output, quota exhaustion, and invalid dates without personal data.

## Privacy inspection

Run `npm run privacy:gmail` before deployment. The inspection covers D1
schemas, R2 object metadata and names, authenticated image URLs, Daily Brief
and Notices View render input, fixed-code incidents, Gmail Worker
observability/logging, and synthetic raw Gmail canaries. It fails if subjects,
bodies, sender addresses, message/thread IDs, prompts, or unvalidated output
can reach those retained or delivered surfaces.

Cloudflare Access protects `GET /admin/gmail-review` and
`POST /admin/gmail-review/:id`. Both household roles can inspect the minimized
Protected Review Record response. Only administrators can dismiss, correct,
or publish. Corrections are independently revalidated before storage.

The Daily Brief reads at most two active rows and Notices View reads at most
eight. Both receive only category, neutral summary, normalized date, requested
action, and sender organization.
For a sensitive record it receives only the account-specific marker. Raw
subjects, bodies, sender addresses, Gmail message/thread IDs, prompts, and
unvalidated output are absent from D1 notice/review schemas, R2 metadata,
rendered HTML, application URLs, operational incidents, and captured
application logs. Gmail API message IDs occur only transiently in the required
authenticated upstream API request and are never logged or retained.

## Deployment

Apply D1 migrations `0010_gmail_notices.sql`,
`0011_protected_gmail_review.sql`, and `0013_gmail_controls.sql`. Set these
secrets on both Workers as applicable:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `CALENDAR_TOKEN_ENCRYPTION_KEY`
- `GMAIL_PROCESSOR_KEY`

Set the same non-secret `NOTICE_GRACE_DAYS` value in both Worker
configurations.

Deploy the Gmail Worker with `wrangler.gmail.toml`, then deploy the device
Worker so its `GMAIL_PROCESSOR` service binding resolves.
