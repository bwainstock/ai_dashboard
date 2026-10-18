# Ticket #32: ESPHome production device client

`esphome/trmnl-daily-brief.yaml` is the supported firmware for the
Seeed/TRMNL 7.5-inch OG DIY Kit. It uses Cloudflare for private image
generation and delivery but does not require Home Assistant.

## Hardware and toolchain

- XIAO ESP32-S3 Plus, compiled as `esp32-s3-devkitc-1` with Arduino;
- octal PSRAM at 80 MHz;
- SPI clock GPIO7 and MOSI GPIO9;
- repository-vendored `parkghost/esphome-epaper` component with immutable
  upstream provenance and preserved Apache-2.0 license
  `cf145a72d835a5ef0b66576a5945bc7f16f232c0` with LUT-backed
  `gdey075t7-gray4-lut`, CS GPIO44, DC GPIO10, reset GPIO38, and active-low
  busy GPIO4 handled inside the adapter;
- active-low XIAO user LED on GPIO21;
- Key 1 on GPIO2 for maintenance boot and Key 3 on GPIO5 for navigation;
- 800x480 grayscale image data and one unrotated full-panel refresh.

Compile with the pinned ESPHome release:

```sh
cp esphome/secrets.example.yaml esphome/secrets.yaml
# Populate Wi-Fi, device, origin, and OTA credentials.
npm run esphome:compile
```

`esphome/secrets.yaml` and ESPHome build output are ignored. Never put real
credentials in the main YAML, commands, documentation, issues, or logs.

## Runtime contract

On Wi-Fi connection, ESPHome checks Daily Brief and Calendar View metadata,
then downloads both images when the published generation changed. SNTP applies
`America/Los_Angeles` and triggers later refreshes at:

- 06:32;
- 10:32;
- 15:02;
- 19:02.

These are two minutes after Cloudflare's generation slots so the complete
atomic view set is available. Four `online_image` components provide active
and staging slots for two decoded `GRAYSCALE` images. Both downloads are
pinned to the generation returned by metadata; only two successful decodes
activate the staging slot. One Key 3 press changes the selected active image
locally. Adapter-level UC8179 commands, LUT loading, pixel packing, busy
polarity, and refresh timing are not exposed to these scripts.
Scheduled refresh resets selection to Daily Brief.

When both metadata requests return `304`, ESPHome skips image downloads and the
panel refresh. HTTP, authentication, mixed-generation metadata, download,
decode, or timeout failure preserves the previous active pair and returns the
firmware to its idle state. Activation logs remaining PSRAM for physical
headroom measurement.

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

1. Startup stages one same-generation Daily Brief and Calendar View pair, then
   displays Daily Brief.
2. One Key 3 press advances exactly one cached view without Wi-Fi or a
   Worker request.
3. Timer refreshes occur at the four documented local times and reset to Daily
   Brief.
4. An unchanged ETag does not visibly refresh the panel.
5. Invalid credentials, partial download, decode failure, mixed generation,
   and network failure preserve the previous complete pair.
6. Holding Key 1 during reset enters maintenance mode and permits serial and
   OTA access.
7. Serial logs record adequate PSRAM headroom after all four decoded buffers
   are allocated.
8. The deployed direct-image verifier passes with preview credentials.

The accepted adapter evidence and frozen monochrome rollback procedure are
recorded in
[`ticket-50-production-four-gray-device.md`](ticket-50-production-four-gray-device.md).
