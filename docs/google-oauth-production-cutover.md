# Google OAuth Production cutover

This runbook covers the one-time move of the household Google OAuth app from
**Testing** to **In production**. It is specific to the two connections named
`mom` and `dad`, both of which use one encrypted refresh token for the
Calendar and Gmail production flows.

Research and links were checked against current Google documentation on
2026-10-09. Google Cloud Console state is not stored in this repository, so an
administrator must verify the live project before using this plan.

## Repository-specific facts

- `src/calendar-oauth.ts` requests
  `https://www.googleapis.com/auth/calendar.readonly` and
  `https://www.googleapis.com/auth/gmail.readonly` together, with
  `access_type=offline`, `prompt=consent`, and incremental authorization.
- `gmail.readonly` is a **restricted** Gmail scope that can view messages and
  settings
  ([Google Gmail API scopes](https://developers.google.com/workspace/gmail/api/auth/scopes#restricted_scopes)).
  `calendar.readonly` permits reading and downloading calendars available to
  the user
  ([Google Calendar API scopes](https://developers.google.com/workspace/calendar/api/auth#calendar-api-scopes)).
- The callback replaces the encrypted refresh token for only the selected
  `mom` or `dad` row after Google returns both an access token and a refresh
  token. A failed callback leaves the previously stored token unchanged.
- Scheduled generation refreshes both connected accounts for Calendar. The
  private Gmail Worker uses the same account tokens immediately before a due
  generation, performs either the initial seven-day scan or incremental
  history processing, and records only minimized output. See
  [Google Calendar integration](calendar-integration.md) and
  [Privacy-isolated Gmail processing](gmail-integration.md).
- Do not use the repository's **Disconnect** control as a cutover or rollback
  mechanism. It revokes Google access and intentionally purges that account's
  selected calendars, Gmail cursor and retained private data.

## Google requirements and consequences

### Testing versus Production

For an External app in **Testing**, Google permits at most 100 named test
users. A test user's authorization expires seven days after consent, and an
offline refresh token received by the app expires with it. Selecting
**Publish app** changes the publishing status to **In production**, where the
app is available to any Google Account
([Google: Manage App Audience](https://support.google.com/cloud/answer/15549945?hl=en#publishing-status)).

The 100-test-user limit is distinct from the lifetime 100-new-user cap that
Google can apply to an unverified app requesting unapproved sensitive or
restricted scopes. The latter does not materially constrain this two-user
household, but it is not a substitute for verification if the app ceases to
qualify for an exception
([Google: Unverified apps](https://support.google.com/cloud/answer/7454865?hl=en#zippy=%2Cunverified-app-user-cap)).

Google explicitly documents that Testing authorizations expire seven days
from consent. It does **not** explicitly promise that an already-issued
Testing refresh token becomes long-lived when the project is published.
Therefore this plan does not rely on retroactive extension: publish first,
then obtain and validate a Production-era grant for each account, one account
at a time. Google also warns that refresh tokens can be invalidated at any
time, so the application must continue to handle reconnects after cutover
([Google OAuth policy: refresh-token revocation and expiration](https://developers.google.com/identity/protocols/oauth2/policies#handle-refresh-token-revocation-and-expiration)).

### Verification decision

The general rule is that a production app using sensitive or restricted
scopes must submit those scopes for verification
([Google OAuth policy: submit production apps for verification](https://developers.google.com/identity/protocols/oauth2/policies#submit-for-verification)).
Google also documents a **personal use** exception when an app has only one or
a few users who are all personally known to the developer; those users may
proceed through the unverified-app screen without submitting the app for
review
([Google: Restricted-scope verification exceptions](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification#exceptions)).

This repository's fixed `mom` and `dad` audience appears consistent with that
personal-use description, but only the project owner can confirm the actual
audience and accept the unverified warning. Treat the exception as invalid if
the app is offered beyond the few personally known household users. In that
case, complete brand and data-access verification before rollout.

If verification is required, `gmail.readonly` is restricted and the app
accesses Gmail data through a server, so Google may require an independent
security assessment and annual reassessment
([Google: Restricted-scope security assessment](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification#security-assessment)).
Google says restricted-scope verification can take **several weeks**. Brand
verification is normally automated, but a manual review usually takes
**2–3 business days**
([Google: Restricted-scope verification timing](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification#understand-restricted-scopes);
[Google: Brand verification timing](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification)).

### Homepage, policy and domain

Every production OAuth app must have a public homepage on a verified domain it
owns. The homepage must describe the app and link to its privacy policy and
optional terms
([Google OAuth policy: production homepage](https://developers.google.com/identity/protocols/oauth2/policies#host-homepage-production-apps)).
For verification, the privacy policy must be on the same domain, be linked
from both the homepage and consent screen, and disclose how the app accesses,
uses, stores or shares Google user data
([Google: Brand verification requirements](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification#steps-to-prepare-for-verification)).
The policy must describe the Calendar display and Gmail Household Notice
feature, including transient server processing and the repository's minimized
retention; Google's Limited Use rules apply to restricted-scope data
([Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy#additional_requirements_for_specific_api_scopes)).

The top private domains used by the homepage, privacy policy, terms, OAuth
redirect URIs and JavaScript origins must be listed as authorized domains, and
an Owner or Editor of the Cloud project must verify ownership in Search
Console
([Google: Authorized domains](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification#authorized-domains)).

Google requires separate Cloud projects for testing and production tiers, and
a production project's OAuth clients must not contain developer-only test
redirect URIs or origins
([Google: Production policy compliance](https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance#use-separate-projects)).
For this existing-client cutover, do not introduce a client-ID, client-secret,
scope or redirect-URI migration at the same time. Record any project separation
work as a separate change with its own two-account reauthorization plan.

## Responsibilities

### Agent actions

The agent can:

1. Confirm that the deployed revision still requests exactly the two scopes
   above and that both Workers use the same Google client credentials.
2. Confirm that no repository change is scheduled during the cutover.
3. Record privacy-safe baseline and acceptance evidence from the protected
   administration/status surfaces: Household Labels, connection states,
   freshness timestamps, fixed error codes and generation identifiers only.
4. Guide the administrator through the sequence and stop after any failed
   gate.
5. Update this runbook when Google documentation or repository behavior
   changes.

The agent must not claim to publish the app, accept policy terms, verify domain
ownership, decide that the personal-use exception applies, grant account
consent, or inspect a household member's Google Account. Those are
administrator/account-holder actions.

### Administrator or account-holder actions

An administrator must:

1. Inspect and edit the Google Auth Platform project.
2. Confirm the real audience and either document the personal-use exception or
   complete the applicable verification work.
3. Verify domains and publish the required homepage/privacy disclosures.
4. Select **Publish app** and confirm **In production**.
5. Complete consent for `mom` and `dad`; each account holder should review the
   exact consent screen and scopes.
6. Decide whether to continue after an unverified-app warning.

## Preconditions

Do not start until all of the following are true:

- The working production flow has both `mom` and `dad` shown as connected.
- Calendar and Gmail have recent success/freshness timestamps and no active
  OAuth-revoked incident. Record timestamps and fixed status codes, not event
  titles, email subjects, addresses, sender names, tokens or message IDs.
- Both account holders are available during the change window.
- The plan allows one scheduled generation after reconnecting each account, so
  Calendar and Gmail can both be validated before reconnecting the other
  account.
- The live OAuth client ID matches the Worker secrets; the exact production
  callback is the registered HTTPS redirect URI.
- Gmail API and Calendar API are enabled, and the Data Access page declares
  exactly `calendar.readonly` and `gmail.readonly`.
- The project contains no developer-only redirect URI or origin.
- Homepage, privacy-policy, authorized-domain, support-email and developer
  contact fields are current. Project Owners and Editors are reachable because
  Google uses those contacts for required action
  ([Google OAuth policy: maintain contacts](https://developers.google.com/identity/protocols/oauth2/policies#maintain-contacts)).
- The administrator has documented one of:
  - **Personal use:** only the two personally known household users; accept the
    warning and unverified-app user cap.
  - **Verification required:** brand/data-access review is approved, including
    any required restricted-scope security assessment.

## Cutover sequence

Every gate is fail-closed. Do not start `dad` until `mom` has passed.

1. **Agent — baseline.** Capture the protected status for both Household Labels:
   connected state, Calendar/Gmail freshness, current generation ID and active
   fixed-code incidents. Confirm the next scheduled generation time.
2. **Administrator — final Console review.** In Google Auth Platform, confirm
   External audience, current branding, authorized domains, exact production
   redirect URI, and the two declared scopes. Do not rotate credentials or add
   scopes.
3. **Administrator — publish.** On the Audience page, select **Publish app** and
   confirm the status is **In production**
   ([Google: Manage App Audience](https://support.google.com/cloud/answer/15549945?hl=en#publishing-status)).
   Record the time and a content-free note of the resulting status.
4. **Agent — unchanged-token smoke gate.** Before reconnecting, have the
   administrator refresh Calendar discovery for `mom` and `dad`. If either
   existing token is already rejected, stop and reconnect only that account
   first. A successful check is useful evidence but is not proof that a
   Testing-issued token has become long-lived.
5. **Administrator and Mom account holder — reconnect `mom`.** Use the existing
   protected administration **Reconnect** action. Verify that Google's consent
   screen identifies the expected app and asks only for Calendar read-only and
   Gmail read-only access. Complete consent. The app explicitly requests
   offline access; Google documents offline access as the mechanism that lets a
   web-server app refresh access after the user leaves
   ([Google: Web-server offline access](https://developers.google.com/identity/protocols/oauth2/web-server#offline)).
6. **Agent — validate `mom` Calendar.** Require a successful callback and
   connected state, then refresh `mom` Calendar discovery. Confirm the Selected
   Calendar count and Calendar Labels are unchanged; do not record provider
   IDs or event content. If the callback fails, the repository leaves the
   previous token in place: stop and use the rollback section.
7. **Agent — validate `mom` Gmail before touching `dad`.** Allow the next due
   generation to run. The Gmail Worker is invoked only immediately before that
   due generation, and Calendar refresh occurs during generation. Require a
   newly published complete generation, fresh Calendar status, an advanced
   Gmail last-processed timestamp for `mom`, and no new OAuth or repeated
   Gmail-failure incident. Google permits users to grant only some scopes from
   a multi-scope request, so successful Calendar discovery alone does not prove
   that `gmail.readonly` was granted
   ([Google OAuth policy: handle consent for multiple scopes](https://developers.google.com/identity/protocols/oauth2/policies#handle-consent-for-multiple-scopes)).
8. **Administrator and Dad account holder — reconnect `dad`.** Repeat the same
   consent review only after both `mom` flows pass.
9. **Agent — validate `dad` Calendar.** Require connected state, successful
   Calendar discovery, and unchanged Selected Calendar count and Calendar
   Labels.
10. **Agent — validate `dad` Gmail.** Allow the next due generation to run and
    require another newly published complete generation, fresh Calendar
    status, an advanced Gmail last-processed timestamp for `dad`, and no new
    OAuth or repeated Gmail-failure incident.
11. **Administrator — close.** Confirm both grants appear under each account's
    Google third-party connections and retain only the privacy-safe cutover
    evidence described below.

## Privacy-safe acceptance checks

The cutover is accepted only when:

- `mom` and `dad` both report connected, with no cleanup pending or reconnect
  required.
- Calendar discovery succeeds independently for each account and the Selected
  Calendar counts and Calendar Labels are unchanged.
- A post-cutover generation has a new generation ID and a fresh Calendar
  timestamp; the prior complete generation remained available until atomic
  publication.
- Gmail has a post-cutover last-processed timestamp for both accounts and no
  fixed `OAUTH_REVOKED_OR_EXPIRED`,
  `GMAIL_PROCESSING_REPEATED_FAILURE`, or processor-unreachable condition.
- The shared display still shows only the repository's minimized Calendar and
  Household Notice output. A private Gmail result, if naturally present,
  remains only a `Mom` or `Dad` Private Notice Marker.
- Evidence contains no account email, token, Google authorization code,
  calendar provider ID, event title/location, Gmail sender/subject/body,
  message/thread ID, prompt, model output or screenshot of household content.

Do not create a test email containing personal information merely to prove the
cutover. Timestamp and fixed-state evidence from the normal scheduled flow is
sufficient.

## Rollback and stop conditions

There is no Google-documented, token-safe rollback that changes an app from
Production back to Testing while preserving persistent grants. Returning to
Testing reintroduces the named-test-user restriction and seven-day
authorization expiry. **Leave the project In production during operational
rollback.**

- **Failure before Publish app:** make no change; correct the Console
  precondition and reschedule.
- **Failure after publish but before either reconnect:** leave Production
  enabled. Existing tokens may continue to work, but remain subject to their
  original, undocumented-after-publication lifetime. Correct configuration and
  resume promptly.
- **`mom` reconnect fails:** stop before `dad`. Because the callback writes
  only after receiving a refresh token, first test whether `mom` still works
  through Calendar discovery. Correct the consent/client/redirect issue and
  retry `mom`.
- **An account's old token is rejected:** reconnect only that account. If
  Google does not return a refresh token because of the prior grant, the
  account holder may remove the app from Google Account third-party
  connections and immediately authorize again. Do this only between scheduled
  generations; it creates a brief account-specific outage. Google notes that a
  refresh token is normally returned on the first authorization
  ([Google: Web-server authorization](https://developers.google.com/identity/protocols/oauth2/web-server#httprest_1)).
- **One account passes and the other fails:** retain the passing Production
  grant, stop, and remediate only the failing account. Do not disconnect the
  passing account and do not republish or rotate credentials.
- **Calendar succeeds but Gmail fails for one account:** stop before
  reconnecting the other account. Treat the token as missing or lacking usable
  `gmail.readonly` authorization, correct the account's consent, and repeat
  that account's Calendar and Gmail gates.
- **Post-cutover Calendar/Gmail generation fails:** preserve the last complete
  published generation and repository stale fallback, inspect only fixed-code
  protected status, and reconnect the affected account. Do not weaken scopes,
  expose provider responses, or use Disconnect as recovery.
- **Unexpected verification enforcement:** stop new consent attempts, leave
  existing working grants untouched, and complete the requested brand,
  data-access or security review. Budget several weeks for restricted-scope
  review.

## Concrete risks

| Risk | Consequence | Mitigation |
| --- | --- | --- |
| Google does not state that Testing-issued tokens become persistent after publishing. | A token can still fail near its seven-day consent anniversary. | Publish first, then obtain and validate grants sequentially. |
| The personal-use exception does not match the real audience or Google requests review. | New grants can show warnings, hit the 100-new-user cap, or be blocked pending review. | Keep use to the two known household users or complete verification before expansion. |
| Restricted-scope verification applies. | Several-week lead time, possible independent assessment, and annual reassessment. | Decide before cutover; maintain homepage, privacy disclosure, contacts and assessment evidence. |
| Reconnect returns no refresh token. | The callback fails, although the old stored token is not overwritten. | Stop after that account; validate the old token, then revoke the Google Account grant and reauthorize only in a safe window if necessary. |
| Client ID, secret, redirect URI or scopes are changed with publication. | Both Calendar and Gmail can fail for both accounts. | Treat publication as the only Console change; migrate credentials separately. |
| Switching back to Testing is used as rollback. | Seven-day expiry and test-user restrictions return. | Keep Production status and recover per account. |
| An administrator uses Disconnect. | The repository revokes access and purges account-scoped configuration and retained private data. | Use Reconnect for token renewal; reserve Disconnect for intentional deletion. |
| Homepage, privacy policy or domain is incomplete. | Verification delay or rejection; disclosures may not match actual Gmail processing. | Publish accurate public pages on a verified owned domain before review. |
| Google invalidates a refresh token later. | One account's Calendar and Gmail ingestion stops. | Continue fixed-code monitoring and use the existing per-account reconnect path; Google does not guarantee refresh-token permanence. |
