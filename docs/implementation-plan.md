# Family Dashboard Implementation Plan

## Phase 0: Physical display proof

1. Flash and configure the open TRMNL firmware for BYOS.
2. Implement minimal `/api/setup` and `/api/display` endpoints.
3. Render one self-contained 800x480 black-and-white HTML fixture through Cloudflare Browser Rendering.
4. Store it privately in R2 and serve it through a device-token-authenticated route.
5. Verify on the physical panel:
   - Correct dimensions and orientation.
   - Readable typography and bundled SVG icons.
   - Acceptable PNG size and decoding.
   - Named PNG caching and short-press wake behavior.

Do not build source integrations until this path is proven.

## Phase 1: Weather, calendar, and lunch

### Foundation

1. Create separate admin and device Workers or clearly isolated entry points.
2. Add D1 schema and migrations for:
   - Users and roles.
   - OAuth connections and encrypted tokens.
   - Calendar selection.
   - Device credentials and view cursor.
   - Source snapshots and freshness.
   - Render generations and immutable image keys.
   - Operational incidents.
3. Configure private R2, Browser Rendering, Cron Triggers, and Cloudflare Access.
4. Add a protected status page with fixed error codes and no secret values.

### Source adapters

1. Open-Meteo adapter for current, today, and tomorrow forecasts.
2. Google OAuth and Calendar adapters for both consumer accounts.
   - Implemented with read-only scopes, encrypted refresh-token storage,
     administrator selection/labels, and minimized normalized snapshots. See
     [Google Calendar integration](calendar-integration.md).
3. MealViewer adapter isolated behind an interface that:
   - Uses low-frequency server-side requests.
   - Validates the undocumented response schema.
   - Normalizes only school dates and entree names.
   - Supports stale data and clear missing-menu states.

### Rendering

1. Define a renderer input model independent of source payloads.
2. Build Daily Brief, Calendar View, and Lunch View.
3. Bundle open-licensed monochrome SVGs.
4. Implement deterministic lunch mappings and an optional constrained Workers AI fallback.
5. Add overflow rules, stale markers, and global update time.
6. Render all views for one immutable generation and atomically publish its pointer.

### Scheduling and device behavior

1. Implement DST-safe local slot detection for 06:30, 10:30, 15:00, and 19:00.
2. Make each slot idempotent.
3. Retry a failed generation once after 15 minutes.
4. Return a dynamic `refresh_rate` that wakes the device for the next local slot.
5. Implement the forward-only view cursor and timer reset to Daily Brief.
6. Alert after 24 hours without a device check-in.

### V1 acceptance

- Physical device displays all three views.
- Short press cycles forward; scheduled wake returns to Daily Brief.
- Four local-time generations and delayed retry are verified across a daylight-saving boundary in tests.
- Calendar privacy, deduplication, and overflow rules are covered by tests.
- MealViewer schema and missing-menu cases fail visibly.
- Section-level stale fallback works without blank success states.
- Images remain private and device-token authenticated.
- Admin and status routes enforce Access roles.
- Battery measurement reaches at least four weeks under the agreed usage profile.

## Phase 2: Gmail Household Notices

### Privacy boundary

1. Create a dedicated Gmail-processing Worker.
2. Disable content logging and avoid AI Gateway for Gmail inference.
3. Add `gmail.readonly` authorization for both accounts.
4. Publish the personal Google OAuth app to Production.
5. Add explicit consent text describing the Household Notice feature and Cloudflare inference.

### Processing pipeline

1. Perform a seven-day initial scan, then incremental Gmail history processing before each render.
2. Apply strict Gmail query, category, bulk-mail, and sender-domain filters before inference.
3. Strip quoted history, signatures, boilerplate, trackers, and unnecessary headers.
4. Run strict structured extraction through a configurable Workers AI model.
5. Independently validate schema, dates, sensitivity, confidence, and forbidden data.
6. Store only accepted structured notice or protected review fields.
7. Add thread deduplication, expiry, dismissal, and correction.

### UI and display

1. Add Notices View to the forward cycle.
2. Add at most two notices to the Daily Brief.
3. Add Mom/Dad-specific Private Notice Markers.
4. Permit both spouses to review protected records; restrict configuration and mutation to the administrator.
5. Add AI quota, OAuth health, and review status to the protected status page.

### Phase-2 acceptance

- Raw message bodies are absent from D1, R2, Worker logs, AI Gateway logs, URLs, and Browser Rendering input.
- Candidate filtering is tested before model invocation.
- Publication requires confidence >= 0.90 and deterministic validation.
- Sensitive content never appears as a normal Household Notice.
- Synthetic prompt-injection and malformed-output fixtures fail closed.
- Model changes require the synthetic regression suite.
- OAuth revocation, quota exhaustion, and repeated processing failure trigger actionable alerts.
- Retention and disconnect/delete controls are verified.

## Deferred work

- Apple Reminders or an Apple-device helper.
- Custom firmware using all three physical buttons.
- Supported MealViewer signage feed migration if SJUSD or Heartland provides one.
- Additional lunch icons justified by observed unknown-item history.
- Cadence optimization if measured battery life misses the four-week target.
