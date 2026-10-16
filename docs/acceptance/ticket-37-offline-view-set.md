# Ticket #37: offline cached view set

Startup and each scheduled refresh validate Daily Brief and Calendar View as
one published generation. When changed, ESPHome downloads both views into the
inactive PSRAM slot and activates that slot only after both 800x480 binary PNGs
decode successfully. The previous complete pair remains active on any metadata,
authentication, network, download, decode, or timeout failure.

The Worker accepts explicit `X-Dashboard-View` selection. Metadata requests use
`X-Dashboard-Metadata: true` and per-view `If-None-Match` validators. Image
downloads include `X-Dashboard-Generation`, which pins both responses to the
same immutable published generation even if the current pointer advances
between requests. Device credentials remain in headers.

One Key 3 press switches Daily Brief to Calendar View and back from the
active decoded slot. The navigation path performs no HTTP action and remains
available without Wi-Fi. Scheduled refresh resets local selection to Daily
Brief. If both metadata requests return `304`, no image body is downloaded and
the panel is not refreshed.

## Automated verification

```sh
npx vitest run \
  test/worker.test.ts \
  test/esphome-daily-brief.test.mjs \
  test/device-acceptance.test.mjs
npm run esphome:compile
npm run check
```

The tests cover explicit same-generation view selection, generation pinning,
bodyless cache validation, four decoded image buffers, inactive-slot staging,
atomic activation, failure preservation, timer reset, and local Key 3
navigation.

## Deployed and physical verification

Run the two-view deployed verifier from ticket #31. On the physical device,
record the serial PSRAM-headroom line after activation, verify scheduled
refresh, force a second-view download and decode failure, and confirm both
previous views remain available. Disconnect Wi-Fi and confirm two Key 3 presses cycle Calendar View then Daily
Brief without a device request.
Record these observations in the physical acceptance report fields
`viewSetMemoryHeadroom`, `partialFailurePreservation`, and
`offlineNavigation`.
