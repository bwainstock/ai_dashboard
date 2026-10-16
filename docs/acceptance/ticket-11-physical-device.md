# Ticket #11: physical device acceptance

This procedure separates automated checks from observations requiring the
Seeed/TRMNL 7.5-inch OG DIY Kit. ESPHome is the supported production client.
Legacy TRMNL BYOS acceptance remains useful only for rollback compatibility.

Reports use
[`device-acceptance-report.schema.json`](device-acceptance-report.schema.json)
and contain no device token, Wi-Fi credential, or raw device identifier.

## 1. Automated deployed acceptance

Provision preview-only credentials and run the direct-image check:

```sh
export DEVICE_ORIGIN="https://dashboard-device.example.com"
export DEVICE_ID="ESPHOME-IMAGE-PREVIEW"

SETUP_JSON="$(curl --fail-with-body \
  -H "ID: $DEVICE_ID" \
  "$DEVICE_ORIGIN/api/setup")"
export DEVICE_TOKEN="$(printf '%s' "$SETUP_JSON" | jq -er .api_key)"
unset SETUP_JSON

DEVICE_ID="$DEVICE_ID" DEVICE_TOKEN="$DEVICE_TOKEN" \
  npm run acceptance:esphome-image -- "$DEVICE_ORIGIN" timer

unset DEVICE_TOKEN DEVICE_ID DEVICE_ORIGIN
```

The check authenticates one `/api/image` request, decodes the PNG, enforces
800x480 dimensions and an exact opaque black-and-white palette, validates
non-sensitive generation headers, and confirms ETag revalidation.

## 2. Physical image, navigation, and scheduling

1. Reset normally. Confirm the GPIO21 user LED blinks rapidly during one image
   download, the Daily Brief refreshes once, and the LED returns steady.
2. Confirm landscape orientation, readable typography at the agreed viewing
   distance, recognizable labeled icons, and no failed-decode screen.
3. Double-click Key 3. Confirm one Calendar View request and one panel refresh.
4. Double-click Key 3 again. Confirm the cycle returns to Daily Brief.
5. Observe automatic local refreshes at 06:32, 10:32, 15:02, and 19:02. Each
   must select Daily Brief and fetch the complete generation produced two
   minutes earlier.
6. Repeat a timer refresh without a new generation and confirm ETag caching
   avoids a visible e-paper refresh.
7. During a controlled test, make Wi-Fi unavailable for one request and restore
   it. Confirm the previous image remains and the next scheduled request
   recovers without reflashing.
8. Press Key 1 while awake. Confirm maintenance mode remains idle without
   scheduled image requests and permits serial logs and password-protected OTA.
   Reset to resume normal operation.
9. Confirm missing or invalid device credentials cannot retrieve `/api/image`.

Record firmware version, generation ID, filename, observed times, and
non-sensitive symptoms. Never retain tokens or household source data.

## 3. Deep sleep and battery

Deep sleep is intentionally disabled during the initial ESPHome production
cutover. Wake behavior, maintenance recovery, sleep current, and battery
acceptance are tracked in #36. Do not claim the historical 28-day battery
baseline until that issue is completed on the physical device.

## 4. Feed physical limits back into validation

If the panel establishes a lower reliable PNG size or a larger minimum readable
font, record the measured value and method, update
`config/device-limits.json`, rerun `npm run check`, redeploy, and repeat the
physical image observations.
