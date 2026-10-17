# Ticket #48: four-gray panel prototype

This prototype is intentionally separate from
`esphome/trmnl-daily-brief.yaml`. It does not change the production Daily Brief
or Calendar View image, download, caching, or rendering contract.

## Reproducible builds

The diagnostic uses ESPHome `2026.9.1` and the external
`parkghost/esphome-epaper` component at immutable commit
`cf145a72d835a5ef0b66576a5945bc7f16f232c0`. The selected
`gdey075t7-gray4-lut` model downloads its waveform instead of depending on a
panel-batch-specific OTP waveform.

Both builds use the production XIAO ESP32-S3 Plus assignments:

- SPI clock GPIO7 and MOSI GPIO9;
- display CS GPIO44, DC GPIO10, reset GPIO38, and busy GPIO4;
- 800x480 landscape output with octal PSRAM at 80 MHz.

The external adapter handles the UC8179 active-low busy polarity internally.
The diagnostic therefore declares `busy_pin: GPIO4` without an ESPHome pin
inversion.

Compile both configurations with repository-standard commands:

```sh
npm run esphome:compile:gray4

cp esphome/secrets.example.yaml esphome/secrets.yaml
# Replace the example values only when testing the production rollback.
npm run esphome:compile:rollback
```

The rollback command compiles the unchanged production monochrome
`waveshare_epaper`/`7.50inv2` firmware. ESPHome build output and
`esphome/secrets.yaml` are ignored and must not be committed.

## Physical acceptance procedure

Physical observations require the target Seeed/TRMNL 7.5-inch OG DIY Kit. Do
not convert a successful compile into a physical result.

1. Disconnect power before opening the enclosure. Record the exact controller
   or flex marking visible on the installed panel. Confirm it identifies a
   UC8179/GDEY075T7-compatible panel before flashing. The pinned upstream
   adapter was verified on `GDEY075T7 (FPC-C001 21.08.30 HB)`; an unidentified
   or incompatible marking blocks rollout rather than selecting another model
   silently.
2. Compile both commands above before connecting the device. Keep the complete
   command output as the reproducibility record, but do not retain credentials,
   household content, or raw device identifiers.
3. Connect by USB and flash the diagnostic with the same pinned toolchain:

   ```sh
   uvx --from esphome==2026.9.1 esphome run \
     esphome/trmnl-four-gray-diagnostic.yaml \
     --device <serial-port>
   ```

4. Observe one full refresh. The screen must show four vertical bands, from
   left to right: black (`0`), dark gray (`85`), light gray (`170`), and white
   (`255`). Record whether all four are visibly distinct under the same room
   lighting and viewing distance used for the production display.
5. Record the adapter's `Display update took ... ms` DEBUG log as the refresh
   duration. Record both `Four-gray diagnostic PSRAM headroom ...` lines. The
   values are non-sensitive; do not copy unrelated serial output.
6. Confirm busy polarity and refresh completion by verifying there is no busy
   timeout, controller error, repeated unintended refresh, or stuck panel.
7. Inspect the solid bands immediately after refresh and again after at least
   two diagnostic resets. Record visible ghosting, streaking, or gray bezel
   effects without interpreting an unobserved result.
8. Reflash the monochrome rollback with the locally populated
   `esphome/secrets.yaml`:

   ```sh
   uvx --from esphome==2026.9.1 esphome run \
     esphome/trmnl-daily-brief.yaml \
     --device <serial-port>
   ```

   Confirm the existing monochrome Daily Brief starts, stages the complete
   view pair, and remains navigable. Do not record image contents or
   credentials.

## Physical result record

Copy this section into the ticket's eventual acceptance record only after each
observation is performed. Use ISO 8601 timestamps. Leave blocked or unperformed
items pending; do not infer results.

- Status: pending
- Recorded at: null
- Firmware commit: null
- Installed controller or flex marking: null
- Marking compatible with UC8179/GDEY075T7: pending
- Four visibly distinct levels: pending
- Refresh duration milliseconds: null
- Visible ghosting or streaking: pending
- PSRAM headroom before refresh bytes: null
- PSRAM headroom after refresh bytes: null
- Busy polarity and refresh completion: pending
- Controller timeouts or stuck-panel symptoms: pending
- Monochrome rollback reflashed successfully: pending
- Notes: Physical hardware acceptance has not yet been performed.
