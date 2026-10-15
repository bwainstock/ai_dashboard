# Ticket #31: ESPHome BYOS manifest acceptance

Stock TRMNL firmware using the documented BYOS setup remains the standard
device path. This acceptance contract supports an optional ESPHome experiment
without adding an ESPHome-specific endpoint: both clients use the existing
authenticated `/api/display` manifest and `/images/:filename` delivery.

## Client contract

The ESPHome proof of concept must send `ID`, `Access-Token`, and
`Update-Source` headers to `/api/display`. It may download an image only when:

- the HTTP response succeeds and contains valid JSON with `status: 0`;
- `image_url` and `filename` are nonempty strings;
- `refresh_rate` is an integer from 1 through 86,400 seconds;
- `image_url` is exactly
  `<configured-origin>/images/<encoded filename>`, with no URL credentials,
  query string, or fragment.

The filename is the generation/view cache identity. The refresh rate is the
server-directed timer wake interval. The image request sends `ID` and
`Access-Token` as headers again, uses manual redirect handling, and accepts only
a successful `image/png` response. A rejection must retain the currently
displayed e-paper content. Device credentials must not appear in a URL, log, or
committed file.

The repository's executable contract check applies these rules and downloads
the selected private image:

```sh
DEVICE_ID="$DEVICE_ID" DEVICE_TOKEN="$DEVICE_TOKEN" \
  npm run acceptance:byos-manifest -- "$DEVICE_ORIGIN" timer
```

Its output contains only the filename, refresh interval, image byte count, and
media type.

## Deployed curl sequence

Use a preview-only identifier because setup rotates the token for an existing
device identifier:

```sh
export DEVICE_ORIGIN="https://dashboard-device.example.com"
export DEVICE_ID="ESPHOME-MANIFEST-PREVIEW"

SETUP_JSON="$(curl --fail-with-body \
  -H "ID: $DEVICE_ID" \
  "$DEVICE_ORIGIN/api/setup")"
export DEVICE_TOKEN="$(printf '%s' "$SETUP_JSON" | jq -er .api_key)"
unset SETUP_JSON
```

Request each automatic wake source. Every result must identify a
`daily-brief-*.png` file:

```sh
for SOURCE in timer scheduled powercycle unknown; do
  MANIFEST_JSON="$(curl --fail-with-body \
    -H "ID: $DEVICE_ID" \
    -H "Access-Token: $DEVICE_TOKEN" \
    -H "Update-Source: $SOURCE" \
    "$DEVICE_ORIGIN/api/display")"
  printf '%s' "$MANIFEST_JSON" |
    jq -e '
      .status == 0 and
      (.image_url | type == "string") and
      (.filename | type == "string" and startswith("daily-brief-")) and
      (.refresh_rate | type == "number" and floor == . and . > 0 and . <= 86400)
    ' >/dev/null
done
```

One button request advances the server-managed cursor once. The next timer
request resets it to Daily Brief:

```sh
BUTTON_JSON="$(curl --fail-with-body \
  -H "ID: $DEVICE_ID" \
  -H "Access-Token: $DEVICE_TOKEN" \
  -H "Update-Source: button" \
  "$DEVICE_ORIGIN/api/display")"
printf '%s' "$BUTTON_JSON" |
  jq -e '.filename | startswith("calendar-view-")' >/dev/null

TIMER_JSON="$(curl --fail-with-body \
  -H "ID: $DEVICE_ID" \
  -H "Access-Token: $DEVICE_TOKEN" \
  -H "Update-Source: timer" \
  "$DEVICE_ORIGIN/api/display")"
printf '%s' "$TIMER_JSON" |
  jq -e '.filename | startswith("daily-brief-")' >/dev/null
```

Validate the timer manifest's origin and generation/view identity before
downloading it with the same header credentials:

```sh
IMAGE_URL="$(printf '%s' "$TIMER_JSON" | jq -er .image_url)"
FILENAME="$(printf '%s' "$TIMER_JSON" | jq -er .filename)"
node -e '
  const [origin, imageUrl, filename] = process.argv.slice(1);
  const image = new URL(imageUrl);
  const expected = new URL(`/images/${encodeURIComponent(filename)}`,
    new URL(origin).origin);
  if (image.username || image.password || image.href !== expected.href)
    process.exit(1);
' "$DEVICE_ORIGIN" "$IMAGE_URL" "$FILENAME"

curl --fail-with-body \
  -H "ID: $DEVICE_ID" \
  -H "Access-Token: $DEVICE_TOKEN" \
  --output "$FILENAME" \
  "$IMAGE_URL"
```

Finally verify that neither route becomes public:

```sh
test "$(curl -sS -o /dev/null -w '%{http_code}' \
  -H "ID: $DEVICE_ID" \
  "$DEVICE_ORIGIN/api/display")" = 401
test "$(curl -sS -o /dev/null -w '%{http_code}' \
  -H "ID: $DEVICE_ID" \
  "$IMAGE_URL")" = 401
test "$(curl -sS -o /dev/null -w '%{http_code}' \
  -H "ID: $DEVICE_ID" \
  -H "Access-Token: invalid" \
  "$IMAGE_URL")" = 401

rm -f "$FILENAME"
unset BUTTON_JSON TIMER_JSON MANIFEST_JSON IMAGE_URL FILENAME
unset DEVICE_TOKEN DEVICE_ID DEVICE_ORIGIN
```
