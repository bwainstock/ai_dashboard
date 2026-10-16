# Production device-client contract

This is the canonical living contract for the Family Dashboard production
device. It supersedes ticket-specific acceptance documents when they disagree
about current behavior. The repository glossary defines **Daily Brief** and
**Calendar View**.

The supported client is the repository ESPHome firmware for the Seeed/TRMNL
7.5-inch OG DIY Kit. TRMNL BYOS manifest, named-image, and server-selected-view
routes are rollback compatibility, not production behavior.

## Protocol

The device retrieves images from the device Worker over HTTPS. Every production
image metadata or body request:

- sends the provisioned device identifier in the `ID` header and secret in the
  `Access-Token` header;
- selects `daily_brief` or `calendar` explicitly rather than asking the server
  to choose a view;
- may pin the selected generation ID when retrieving the body, so publication
  of a newer generation cannot mix two generations;
- keeps credentials out of URLs, filenames, logs, and reports; and
- rejects redirects and accepts only an opaque `image/png` response.

The Worker authenticates every image boundary. A successful response identifies
its generation and view using non-sensitive response metadata, supplies a
private per-view `ETag`, and contains a nonblank opaque 800x480 PNG with only
the exact black-and-white palette accepted by the firmware. Daily Brief and
Calendar View selected from the current publication must identify the same
generation.

## Complete-generation caching

A published generation is one atomic Daily Brief and Calendar View pair. The
device downloads and decodes both images into PSRAM before activating either
one. Only a completely validated pair replaces the active pair.

If authentication, download, size, palette, or decode validation fails for
either view, the device preserves the previous active pair and displayed image.
It never combines views from different generations. Generation-pinned requests
remain valid if the current-generation pointer advances after selection.

The device stores an independent `ETag` for each view. Revalidation of an
unchanged generation avoids downloading that image body. When both views are
unchanged, the device also avoids a physical panel refresh.

## Local navigation

One debounced Key 3 press toggles the selected cached view between Daily Brief
and Calendar View. Navigation is entirely local: it performs no Worker request,
does not depend on Wi-Fi, and remains available while the device is offline.
Two presses therefore complete the loop back to the starting view.

Daily Brief is the initial selection after boot and after every successful
scheduled refresh. A failed refresh leaves both the active pair and current
selection unchanged.

## Refresh behavior

The device remains awake in the current production configuration. It checks for
a complete generation at 06:32, 10:32, 15:02, and 19:02 in
`America/Los_Angeles`, two minutes after the generation slots.

A scheduled check explicitly selects and revalidates both views. A changed
generation is activated only after both images pass validation, then the device
selects Daily Brief and refreshes the panel. An unchanged generation performs
no image-body downloads and no panel refresh. Network or validation failure
preserves the last known-good pair for the next retry or scheduled check.

## Deployment

`esphome/trmnl-daily-brief.yaml` is the deployable firmware definition.
Compile it with the repository-pinned ESPHome command:

```sh
cp esphome/secrets.example.yaml esphome/secrets.yaml
npm run esphome:compile
```

Real Wi-Fi, device, and OTA credentials belong only in the ignored
`esphome/secrets.yaml`. Production deployment must use the configured custom
device hostname and valid Cloudflare bindings. Deliver firmware by
password-protected OTA only when the compiled firmware identity differs from
the installed identity; use reset for refresh-only verification.

## Maintenance

Holding Key 1 during reset latches maintenance mode until the next reset.
Maintenance mode suppresses scheduled image checks while preserving serial
diagnostics and password-protected OTA. Reset without holding Key 1 returns to
normal operation.

Operational diagnosis may record firmware identity, public origins, generation
IDs, timestamps, image measurements, and PSRAM headroom. It must redact device
tokens, authorization headers, raw device identifiers, Wi-Fi details, and
household content.

## Physical acceptance

Automated acceptance must verify authentication at every production image
boundary, explicit selection of both views, one-generation identity,
generation pinning, independent `ETag` behavior, image dimensions, opacity,
palette, nonblank content, configured size limits, and a schema-valid report.

Physical acceptance then uses the pinned compiled firmware and a real device to
confirm:

1. boot and serial reconnection after reset;
2. sufficient PSRAM headroom while a complete pair is active;
3. scheduled refresh selects Daily Brief;
4. one Key 3 press shows Calendar View and a second shows Daily Brief without
   Wi-Fi or HTTP activity;
5. second-view download or decode failure preserves the previous pair;
6. an unchanged generation causes no download and no panel refresh; and
7. the display is readable and mechanically sound.

Automation may leave human observations pending, but cannot promote them to
pass. Sanitized completed reports belong under `evidence/device-acceptance/`
and must validate against
`docs/acceptance/device-acceptance-report.schema.json`.
