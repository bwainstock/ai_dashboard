# Ticket #50: production four-gray device client

The production client promotes the physically accepted external display
adapter without changing the authenticated request, active/staging, generation,
ETag, navigation, scheduling, failure-retention, or maintenance interfaces.

## Accepted adapter and hardware evidence

- ESPHome toolchain: `2026.9.1`.
- External component: repository-vendored `parkghost/esphome-epaper`
  `components/epaper_spi`, copied without modification from immutable revision
  `cf145a72d835a5ef0b66576a5945bc7f16f232c0`.
- Provenance and license: the accepted source/tree identifiers and preserved
  Apache-2.0 license are in
  `esphome/vendor/parkghost-esphome-epaper/UPSTREAM.md` and `LICENSE`.
- Display model: LUT-backed `gdey075t7-gray4-lut`.
- Target: Seeed/TRMNL 7.5-inch OG DIY Kit with the production XIAO ESP32-S3
  Plus pin assignments.
- Physical compatibility: accepted through observed behavior on the installed
  target; enclosure disassembly and a flex marking are not required.
- Full refresh: 3437 ms, with no busy timeout or stuck panel.
- Diagnostic PSRAM headroom: 8,289,824 bytes before and after refresh.
- Four black-to-white bands remained visibly distinct through the initial
  refresh and two additional resets.
- Ghosting observation: only a uniform thin black hairline at the outer edge;
  no image intrusion or irregular streaking.

These observations were recorded in issue #48 on 2026-10-17. They establish
adapter and waveform compatibility; they do not retain credentials, household
content, or a raw device identifier.

## Production behavior

All four Daily Brief and Calendar View active/staging `online_image` slots
decode as `GRAYSCALE`. Metadata revalidation still authenticates with `ID` and
`Access-Token`, requires a shared non-empty generation, and pins both downloads
to that generation. Only two successful decodes activate the inactive slot.

Activation continues to log the generation identity and current PSRAM
headroom. The physically verified monochrome client reported 8,087,608 bytes
of PSRAM headroom after activating a complete view pair; production grayscale
headroom must remain observable in the same activation log.

Scheduled refresh still selects Daily Brief, unchanged ETags avoid downloads
and panel refresh, failures retain the previous complete pair, Key 3 navigates
the active pair without Wi-Fi, and Key 1 retains serial and OTA maintenance
mode.

## Reproducible production and rollback builds

The frozen monochrome rollback configuration is copied from integration
revision `4a8d526c4202095fe2abaf3e5a310199e23da589`. The physical rollback reflash
was performed from its unchanged production firmware at prototype revision
`0c3543a2e34c6860ceaf8c6d656a10f868b1bfc3`.

```sh
cp esphome/secrets.example.yaml esphome/secrets.yaml
# Replace only with local credentials; never commit the populated file.
npm run esphome:compile
npm run esphome:compile:rollback
```

`npm run esphome:compile` builds the production
`gdey075t7-gray4-lut` client entirely from the repository-owned vendored
adapter; it does not fetch the upstream component.
`npm run esphome:compile:rollback` builds the frozen
`waveshare_epaper`/`7.50inv2` client. Both commands use the repository-pinned
ESPHome release.
