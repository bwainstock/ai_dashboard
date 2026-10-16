# Ticket #32: ESPHome production device client

`esphome/trmnl-daily-brief.yaml` is the supported firmware for the
Seeed/TRMNL 7.5-inch OG DIY Kit. It uses Cloudflare for private image
generation and delivery but does not require Home Assistant.

## Hardware and toolchain

- XIAO ESP32-S3 Plus, compiled as `esp32-s3-devkitc-1` with Arduino;
- octal PSRAM at 80 MHz;
- SPI clock GPIO7 and MOSI GPIO9;
- Waveshare `7.50inv2`, CS GPIO44, DC GPIO10, reset GPIO38, and inverted busy
  GPIO4;
- active-low XIAO user LED on GPIO21;
- Key 1 on GPIO2 for maintenance boot and Key 3 on GPIO5 for navigation;
- 800x480 binary image data and one unrotated full-panel refresh.

Compile with the pinned ESPHome release:

```sh
cp esphome/secrets.example.yaml esphome/secrets.yaml
# Populate Wi-Fi, device, origin, and OTA credentials.
npm run esphome:compile
```

`esphome/secrets.yaml` and ESPHome build output are ignored. Never put real
credentials in the main YAML, commands, documentation, issues, or logs.

## Runtime contract

On Wi-Fi connection, ESPHome requests
`<device_origin>/api/image` once with device credentials and
`Update-Source: timer`. SNTP applies `America/Los_Angeles` and triggers later
timer refreshes at:

- 06:32;
- 10:32;
- 15:02;
- 19:02.

These are two minutes after Cloudflare's generation slots so the complete
atomic view set is available. Key 3 double-click requests the next view with
`Update-Source: button`. Timer refreshes reset to Daily Brief.

`online_image` decodes the direct PNG to `BINARY`. A fresh response updates the
panel once; an ETag cache hit skips the panel refresh. Image memory is released
after handling. HTTP, authentication, download, decode, or timeout failure
preserves the existing e-paper image and returns the firmware to its idle
state.

The initial production cutover intentionally remains awake. Deep sleep,
wake-button behavior, bounded retry sleep, and battery acceptance are tracked
separately in #36.

## Status and maintenance

The GPIO21 user LED reports:

- steady: booting, idle, waiting for Wi-Fi, maintenance, or panel refresh;
- 100 ms blink: downloading and decoding the PNG;
- three short pulses: request, download, decode, or boot-timeout failure.

The larger green driver-board LED is wired to USB `VBUS` and is not
software-controlled. GPIO21 is also the XIAO Plus microSD chip-select, so the
microSD slot must remain empty.

For maintenance, press Key 1 while the device is awake, or hold it while
resetting. Maintenance mode latches until the next reset, suppresses image
requests and scheduled refreshes, and keeps serial logs and
password-protected ESPHome OTA available. Reset without holding Key 1 to resume
normal operation.

## Verification

```sh
npx vitest run \
  test/esphome-daily-brief.test.mjs \
  test/worker.test.ts
npm run esphome:compile
npm run check
```

Physical acceptance confirms:

1. Startup performs one authenticated `/api/image` request and displays Daily
   Brief.
2. Key 3 double-click advances exactly one view and remains usable while the
   device is awake.
3. Timer refreshes occur at the four documented local times and reset to Daily
   Brief.
4. An unchanged ETag does not visibly refresh the panel.
5. Invalid credentials and network failure preserve the previous image.
6. Holding Key 1 during reset enters maintenance mode and permits serial and
   OTA access.
7. The deployed direct-image verifier passes with preview credentials.
