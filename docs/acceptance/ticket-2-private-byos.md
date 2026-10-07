# Ticket #2: private BYOS path acceptance

The automated suite covers token issuance, display authentication, authenticated
private image delivery, rejection of unpublished generations, and PNG
dimensions/palette. The panel-specific observations below must be completed on
the Seeed/TRMNL 7.5-inch OG DIY Kit; they are intentionally not claimed by CI.

## Deploy the proof

1. Create the resources and replace the placeholder D1 ID, bucket name, and
   `DEVICE_ORIGIN` in `wrangler.toml`:

   ```sh
   npx wrangler d1 create family-dashboard
   npx wrangler r2 bucket create family-dashboard-private-images
   ```

2. In the Cloudflare R2 dashboard, verify **Public Development URL** and
   **Custom Domains** are both disabled for the image bucket. R2 is accessed
   only through the Worker binding.
3. Apply the migration and set the generation credential as a Worker secret:

   ```sh
   npx wrangler d1 migrations apply family-dashboard --remote
   npx wrangler secret put GENERATION_SECRET
   npx wrangler deploy
   ```

4. Generate the immutable fixture without putting the secret in a URL:

   ```sh
   curl --fail-with-body -X POST \
     -H "Authorization: Bearer $GENERATION_SECRET" \
     https://dashboard-device.example.com/admin/fixture-generations
   ```

5. Before provisioning the panel, exercise setup and retain its token only in
   the current shell. This token will be rotated when the physical device later
   performs setup:

   ```sh
   SETUP_JSON="$(curl --fail-with-body \
     -H "ID: $DEVICE_MAC" \
     https://dashboard-device.example.com/api/setup)"
   export DEVICE_TOKEN="$(printf '%s' "$SETUP_JSON" | jq -r .api_key)"
   ```

6. Run the automated deployed-image check:

   ```sh
   DEVICE_ID="$DEVICE_MAC" DEVICE_TOKEN="$DEVICE_TOKEN" \
     npm run acceptance:device -- https://dashboard-device.example.com
   ```

7. Unset the temporary token, then point the stock TRMNL firmware BYOS base URL
   at the device hostname. The firmware calls `/api/setup` with its `ID` header,
   receives a newly rotated `api_key`, and stores it on-device:

   ```sh
   unset SETUP_JSON DEVICE_TOKEN
   ```

   Do not paste a device token into URLs, issue comments, or logs.

## Required physical-panel record

Record the firmware version, panel model, test time, fixture filename, and PNG
byte size with the result. Mark an item pass only after observing it on hardware.

- [ ] **Orientation:** the house icon is upright at upper left and all text reads
      left-to-right in landscape orientation.
- [ ] **Typography and icon:** “Family Dashboard,” both section headings, and
      the bundled house icon are legible at normal viewing distance; no remote
      asset is missing.
- [ ] **Decode and size:** the panel displays the same filename reported by
      `acceptance:device`, and its byte size is at or below `MAX_IMAGE_BYTES`.
- [ ] **Named PNG caching:** two consecutive wakes without a new generation
      return the same filename and do not produce a failed-download screen.
      After generating a new fixture, the next wake returns a different
      `daily-brief-*.png` filename and displays it.
- [ ] **Short-press wake:** while sleeping, one short press wakes the device,
      performs an authenticated display request, and shows the fixture without
      entering Wi-Fi setup or credential reset.

If any item fails, retain the observed filename, firmware version, and
non-sensitive fixed error message. Never include the device token.
