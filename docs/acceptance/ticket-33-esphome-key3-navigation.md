# Ticket #33: ESPHome Key 3 navigation

Stock TRMNL firmware and its documented BYOS setup remain the standard device
path. This acceptance contract extends only the optional ESPHome proof of
concept from ticket #32.

## Hardware contract

Seeed documents three user buttons on the TRMNL 7.5-inch (OG) DIY Kit as D1,
D2, and D4. Key 3 is the third user button, D4; the official XIAO ESP32-S3 pin
map assigns D4 to GPIO5. The configuration therefore uses active-low GPIO5
with the internal pull-up for both the ESPHome binary sensor and deep-sleep
wake:

- [Seeed TRMNL Arduino cookbook: User Buttons](https://wiki.seeedstudio.com/ogdiy_kit_works_with_arduino/#user-buttons)
- [Seeed XIAO ESP32-S3 pin multiplexing](https://wiki.seeedstudio.com/xiao_esp32s3_pin_multiplexing/)
- [ESPHome deep sleep wakeup pin](https://esphome.io/components/deep_sleep/)

The configuration does not claim that arbitrary GPIOs can wake the device.
Compilation with the pinned ESPHome version verifies the supported GPIO5
wakeup configuration for the selected ESP32-S3 target.

## Gesture and request contract

The first Key 3 press wakes the sleeping device. Its debounced release opens a
750 ms click window; one second debounced press completes the double-click.
The gesture is latched before Wi-Fi request dispatch, and a separate
`request_started` guard permits exactly one manifest request for that boot.
A single press, bounce, held button, or later press outside the click window
does not request a view.

The completed gesture requests the existing authenticated `/api/display`
manifest with:

- `ID` and `Access-Token` headers;
- `Update-Source: button`;
- no local view name, index, or cursor.

The Worker remains the only owner of the two-view cursor and returns the next
Daily Brief or Calendar View filename from the current atomically published
generation. Non-button boots request `Update-Source: timer`, which resets the
Worker cursor to Daily Brief.

Manifest and image validation are unchanged from ticket #32: redirects remain
disabled, the image URL must exactly match the configured HTTPS origin and
returned filename, credentials stay in headers, and only a successful private
PNG download refreshes the panel. Any HTTP, authentication, manifest, origin,
download, or decode failure preserves the current e-paper image and enters the
bounded 15-minute fallback sleep. The 75-second boot guard still bounds paths
that never complete a callback.

## Verification

```sh
npx vitest run \
  test/esphome-daily-brief.test.mjs \
  test/worker.test.ts
npm run esphome:compile
npm run check
```

The configuration tests cover the authoritative GPIO, wake handling,
debounce/request guard, timer source, absence of a client-side cursor,
same-origin validation, and failure behavior. Worker tests cover alternating
the server-managed two-view cursor exactly once per button request, timer reset,
and selection from the current atomic generation.
