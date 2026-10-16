# Ticket #33: ESPHome Key 3 navigation

> [!NOTE]
> Historical ticket specification. See the
> [production device-client contract](../device-client-contract.md) for current
> behavior.

ESPHome is the supported production device client. This contract covers Key 3
navigation through the one-request direct-image interface.

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

The first debounced Key 3 release opens a 750 ms click window; the second
debounced press completes the double-click.
The gesture is latched before Wi-Fi request dispatch, and a separate
`request_started` guard permits exactly one direct image request for the
gesture. A single press, bounce, held button, or later press outside the click
window does not request a view.

The completed gesture requests authenticated `/api/image` with:

- `ID` and `Access-Token` headers;
- `Update-Source: button`;
- no local view name, index, filename, or cursor.

The Worker remains the only owner of the two-view cursor and returns the next
Daily Brief or Calendar View filename from the current atomically published
generation. Non-button boots request `Update-Source: timer`, which resets the
Worker cursor to Daily Brief.

Credentials stay in headers, redirects remain disabled, and only a successful
fresh private PNG download refreshes the panel. Any HTTP, authentication,
download, or decode failure preserves the current e-paper image. The 75-second
guard still bounds paths that never produce a callback. Deep-sleep wake
navigation is deferred to #36; the production client currently remains awake.

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
