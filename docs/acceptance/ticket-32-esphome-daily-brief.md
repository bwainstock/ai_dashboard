# Ticket #32: ESPHome Daily Brief proof of concept

Stock TRMNL firmware with the repository's BYOS setup remains the standard
device path. The configuration in `esphome/trmnl-daily-brief.yaml` is an
experimental alternative for the Seeed/TRMNL 7.5-inch OG DIY Kit; it does not
replace BYOS or add a device-specific server route.

## Hardware and toolchain

The configuration follows Seeed's kit-specific ESPHome cookbook:

- XIAO ESP32-S3 Plus, compiled as `esp32-s3-devkitc-1` with Arduino;
- octal PSRAM at 80 MHz;
- SPI clock GPIO7 and MOSI GPIO9;
- Waveshare `7.50inv2`, CS GPIO44, DC GPIO10, reset GPIO38, and inverted busy
  GPIO4;
- 800x480 binary image data and a single unrotated full-panel refresh.
- Explicit monochrome color mapping so bright PNG pixels draw as white paper
  and dark PNG pixels draw as black ink.

Compile with the pinned stable ESPHome release through `uv`:

```sh
cp esphome/secrets.example.yaml esphome/secrets.yaml
# Edit esphome/secrets.yaml before compiling.
npm run esphome:compile
```

`esphome/secrets.yaml` and ESPHome's build directory are ignored by Git. Do not
paste real credentials into the main YAML, commands, documentation, issue
comments, or logs.

## Provisioning and first flash

1. Provision a device through the existing BYOS `/api/setup` flow. Keep the
   returned token private.
2. Copy `esphome/secrets.example.yaml` to `esphome/secrets.yaml`.
3. Set:
   - Wi-Fi SSID and password;
   - `device_origin` to the HTTPS device origin only, without a path or trailing
     slash;
   - the provisioned device identifier and token.
4. Compile as shown above.
5. Connect the kit over USB and install the generated factory firmware using
   ESPHome Device Builder or the browser-based installer described by Seeed.
   Deep sleep makes a later wired flash timing-sensitive; enter the board's
   download mode before reflashing.

The proof of concept intentionally omits Home Assistant API, captive portal,
and OTA credentials. Reflash over USB when changing it.

## Runtime contract

On Wi-Fi connection, the device derives and requests the existing
`<device_origin>/api/display` endpoint
with `ID`, `Access-Token`, and `Update-Source: timer` headers. It accepts only:

- HTTP 200 and valid JSON with integer `status: 0`;
- nonempty `image_url` and `filename` strings;
- an integer `refresh_rate` from 1 through 86,400 seconds;
- an HTTPS configured origin containing only scheme and authority;
- a filename without path or query delimiters;
- an image URL exactly equal to
  `<device_origin>/images/<filename>`.

The exact URL check is stronger than a host suffix or prefix check: it rejects
cross-origin images, URL credentials, alternate ports, redirects, query
strings, and filenames that do not identify the selected generation/view.
HTTP redirects are disabled globally so device credentials are never forwarded
to another host.

After validation, `online_image` downloads the PNG with the same `ID` and
`Access-Token` headers. It decodes directly to the memory-efficient `BINARY`
representation, resized within 800x480. Only the successful
`on_download_finished` callback updates the e-paper display. Once that blocking
panel update returns, image memory is released and the device enters deep sleep
for the manifest's refresh interval.

An HTTP error, authentication rejection, malformed manifest, invalid origin or
filename, out-of-range interval, image download failure, or PNG decode failure
never calls the display update. E-paper therefore retains its previous physical
image. The device sleeps for a bounded 15-minute fallback interval. A 75-second
boot guard covers Wi-Fi and other paths that never produce a callback.

## Verification

Run the executable configuration contract and repository checks:

```sh
npx vitest run test/esphome-daily-brief.test.mjs
npm run esphome:compile
npm run check
```

For a physical proof:

1. Confirm a timer wake requests a `daily-brief-*.png` manifest and displays it
   once in the correct 800x480 orientation.
2. Confirm the next wake occurs at the server-provided interval.
3. Test invalid credentials, an unavailable network, and a non-PNG image; the
   previously displayed panel content must remain visible.
4. Run the deployed manifest verifier from ticket #31 using the same device
   origin and separate preview credentials:

   ```sh
   DEVICE_ID="$DEVICE_ID" DEVICE_TOKEN="$DEVICE_TOKEN" \
     npm run acceptance:byos-manifest -- "$DEVICE_ORIGIN" timer
   ```

Physical battery life, radio conditions, panel lot differences, and first-flash
USB behavior remain hardware acceptance items; compilation alone cannot prove
them.
