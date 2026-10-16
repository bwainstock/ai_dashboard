# Ticket #33: ESPHome Key 3 navigation

ESPHome is the supported production device client. This contract covers Key 3 navigation through the locally cached view set.

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

A debounced Key 3 press is accepted only when a complete active view set exists
and no refresh is in progress. It toggles the local Daily Brief/Calendar View
selection and refreshes the panel from PSRAM. The 30 ms debounce filters switch
bounce so one physical press produces one view change.

No HTTP action, Wi-Fi condition, credential use, or Cloudflare request occurs
in the Key 3 path. Scheduled refresh resets local selection to Daily Brief
before checking the next complete generation. Deep-sleep wake navigation is
deferred to #36; the production client currently remains awake.

## Verification

```sh
npx vitest run \
  test/esphome-daily-brief.test.mjs \
  test/worker.test.ts
npm run esphome:compile
npm run check
```

The configuration tests cover the authoritative GPIO, debounce guard, local
toggle, absence of network actions in the Key 3 path, timer reset, atomic
staging, and failure preservation. Worker tests cover explicit view selection,
generation pinning, and current-generation cache validation.
