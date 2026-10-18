# Product requirements

## Active experience

- Publish Daily Brief and Calendar View as one atomic generation.
- Show dated weather and privacy-minimized events from enabled Calendar Feeds.
- Preserve the documented event limits, three-day Calendar View window,
  shortened-location rule, overflow behavior, and four-gray rendering contract.
- Show `Calendar unavailable` in both views when no enabled feed has usable
  data.
- Support offline local navigation between the cached active views.

## Calendar Feed administration

- Store at most 20 direct HTTPS iCalendar feeds.
- Require a Calendar Label and allow an optional Household Label.
- Encrypt every URL at rest and expose only hostname, feed ID, and fingerprint.
- Require a successful secure test before enabling a new or replacement URL.
- Allow label edits, disable, re-enable through testing, replacement, and
  deletion with the documented retention behavior.
- Report Healthy, Stale, Unavailable, and Disabled states.

## Safety and privacy

- Apply public-address SSRF checks to the initial request and every redirect.
- Permit HTTPS port 443 only, at most three redirects, ten seconds, 2 MiB
  compressed, and 10 MiB decompressed/parser input.
- Retain only fields used by rendering. Private events become `Busy`.
- Never retain source descriptions, attendee or organizer data, addresses,
  attachments, conference data, or arbitrary diagnostics.
- Use each feed's last successful snapshot for at most 72 hours.

## Retired capabilities

Provider-account authorization, provider calendar discovery, shared credential
storage, email ingestion and review, and an email-derived display surface are
not active product requirements. Forward migration `0016` purges their
persisted credentials and data while historical migrations remain unchanged.
