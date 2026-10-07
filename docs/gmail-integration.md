# Privacy-isolated Gmail processing

Both household accounts use the existing protected Google OAuth flow. The
authorization request grants only Calendar read-only and Gmail read-only
scopes, requests offline access, and stores authenticated-encrypted refresh
tokens. `GET`/`PUT /admin/gmail-configuration` manages the school and childcare
sender-domain allowlist without exposing account addresses or tokens.

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
independently rejects extra/missing fields, unsafe categories, sensitive text,
addresses, implausible dates, overlong fields, malformed output, model errors,
and confidence below `0.90`.

Only independently validated fields are written to `household_notices`.
Thread deduplication uses a one-way SHA-256 source key. Review records contain
only the household account label, a fixed rejection reason, and timestamps.
They contain no candidate or model content. Active notices expire shortly
after their date and are deleted 30 days later; review records expire in 14
days.

The Daily Brief reads at most two active rows and receives only category,
neutral summary, normalized date, requested action, and sender organization.
Raw subjects, bodies, sender addresses, Gmail message/thread IDs, prompts,
confidence, and unvalidated output are absent from D1 notice/review schemas,
R2 metadata, rendered HTML, application URLs, operational incidents, and
captured application logs. Gmail API message IDs occur only transiently in the
required authenticated upstream API request and are never logged or retained.

## Deployment

Apply D1 migration `0010_gmail_notices.sql`. Set these secrets on both Workers
as applicable:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `CALENDAR_TOKEN_ENCRYPTION_KEY`
- `GMAIL_PROCESSOR_KEY`

Deploy the Gmail Worker with `wrangler.gmail.toml`, then deploy the device
Worker so its `GMAIL_PROCESSOR` service binding resolves.
