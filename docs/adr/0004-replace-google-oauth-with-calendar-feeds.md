# ADR 0004: Replace Google OAuth with Calendar Feeds

## Status

Accepted. Supersedes ADR 0002 for current product behavior.

## Context

Provider-account authorization coupled calendar access to one vendor and also
enabled an email-derived feature set that is no longer part of the product.
Shared refresh credentials increased operational and privacy scope.

## Decision

Calendar events come only from administrator-configured, provider-neutral
Calendar Feeds using direct HTTPS iCalendar URLs. Feed URLs are bearer
credentials encrypted under a dedicated contract. Fetching applies SSRF,
redirect, timeout, and size controls; normalization retains only display fields;
and per-feed snapshots provide bounded stale fallback.

The production authorization routes, provider discovery, shared refresh-token
handling, email processing/review controls, separate processing Worker, and
email-derived view are removed. A new forward migration purges their credentials
and derived data and removes obsolete schema. Historical migrations and ADRs
remain unchanged as history.

## Consequences

Administrators configure feeds rather than accounts. Calendar integrations are
provider-neutral, and Google-hosted public or secret iCalendar URLs are merely
one accepted feed example. The active device view set is Daily Brief and
Calendar View; if all enabled feeds are unusable both show
`Calendar unavailable`.
