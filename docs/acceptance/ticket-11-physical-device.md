# Ticket #11: physical device acceptance

This procedure separates repeatable automated checks from observations that
require the Seeed/TRMNL 7.5-inch OG DIY Kit. Never mark a hardware or battery
item pass from API output, a browser preview, or an assumption.

Reports use
[`device-acceptance-report.schema.json`](device-acceptance-report.schema.json).
The validator also enforces cross-field rules that JSON Schema cannot express,
including the 28-day battery minimum and applying discovered limits to
`config/device-limits.json`. Reports contain no device token or device ID and
may be retained under `evidence/device-acceptance/`.

## 1. Automated deployed acceptance

Use a newly issued device token only in the current shell. Do not put it in a
URL, command argument, report, issue, or log.

```sh
export DEVICE_ID="device MAC"
export DEVICE_TOKEN="issued setup token"
export FIRMWARE_VERSION="version shown by the stock firmware"

npm run acceptance:run -- \
  https://dashboard-device.example.com \
  evidence/device-acceptance/2026-10-07-device.json

unset DEVICE_TOKEN
npm run acceptance:validate -- \
  evidence/device-acceptance/2026-10-07-device.json
```

The run fails nonzero if any automated check fails. It:

- rejects missing and invalid device credentials;
- requests timer, timer, three button wakes, then timer and verifies stable
  cache names, the complete forward cycle, one generation ID, and timer reset;
- independently calculates the next scheduled wake from
  `config/device-limits.json` and checks `refresh_rate`;
- downloads all three authenticated images and rejects a public image route;
- fully decodes each PNG and checks its view-specific filename, 800x480
  dimensions, configured byte limit, opaque grayscale pixels, and nonblank
  content.

The harness intentionally leaves every physical observation and battery result
`pending`, even when all automated checks pass.

## 2. Physical image and navigation record

Keep the generated report open while using the stock firmware. For each
observation, change `status` only after observing it, set `observedAt` to an ISO
8601 timestamp, and add concise non-sensitive notes. A failure must include the
fixed on-screen error or symptom, firmware version, and filename; never include
the token.

1. Wake to **Daily Brief**. Confirm landscape orientation, left-to-right text,
   readable weather/calendar/lunch typography at the agreed normal viewing
   distance, recognizable labeled icons, and no failed-decode screen.
2. Short press once for **Calendar View**, then once for **Lunch View**. Repeat
   the orientation, readability, icon, and decode checks for both views.
3. Short press once more. Confirm the cycle returns to **Daily Brief** and the
   three filenames match the automated report's one generation.
4. Let the panel sleep, then short press through the cycle again. Confirm named
   cached images display without a failed download or Wi-Fi setup screen.
5. Wait for a timer wake. Confirm it resets to **Daily Brief**, rather than the
   next manual cursor position.
6. During a controlled test, make the configured Wi-Fi unavailable for one
   wake, restore it without resetting credentials, and confirm the stock
   firmware reconnects and displays the authenticated image.
7. Observe all four local scheduled wakes (06:30, 10:30, 15:00, and 19:00,
   allowing only normal network/firmware latency). Record actual local times.
8. Confirm physical operation never exposes an image without the provisioned
   device credential. The automated route checks are supporting evidence, not
   a substitute for observing the provisioned device.

Run `npm run acceptance:validate -- <report>` after every edit. A failed
observation without notes or a completed observation without a timestamp is
rejected.

## 3. Four-week battery baseline

1. Charge once to the recorded starting percentage. Record `startedAt`,
   `startChargePercent`, firmware version, Wi-Fi conditions, and `recharges: 0`.
2. Use the agreed baseline: four scheduled wakes per day, normal household
   Wi-Fi, and modest short-press navigation. Count scheduled wakes and presses.
3. Do not recharge during a passing run. If the device requires charging,
   record the time, increment `recharges`, set the result to `fail`, and retain
   the partial duration and final charge.
4. At or after 28 elapsed days, record `endedAt` and `endChargePercent`.
   `status: pass` is valid only for at least 28 elapsed days and zero recharges.
5. Retain battery telemetry or check-in references in `notes` without secrets.

The validator will not turn an incomplete or short run into a pass.

## 4. Feed physical limits back into validation

If a real panel establishes a lower reliable PNG size or a larger minimum
readable font:

1. Record the measured values and method in `discoveredLimits`.
2. Apply the values to `config/device-limits.json`.
3. Keep `MAX_IMAGE_BYTES` at or below the configured tested maximum.
4. Adjust view CSS so every visible leaf text node meets
   `minimumVisibleTextPixels`.
5. Run `npm run check`, rerun deployed acceptance, and validate the report.

Generation uses the lower of `MAX_IMAGE_BYTES` and the tested configuration,
so deployment configuration cannot silently weaken a discovered device limit.
Rendered-page validation rejects text below the configured typography limit.
