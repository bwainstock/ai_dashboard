# Ticket #31: ESPHome direct-image acceptance

ESPHome is the supported production device client. Startup and scheduled
refresh inspect and, when changed, download both active views. Key 3 navigation
uses the decoded PSRAM cache and performs no request. Legacy TRMNL manifest and
named-image routes remain rollback-only compatibility.

## Client contract

The request sends:

- `ID`: provisioned device identifier;
- `Access-Token`: high-entropy device credential;
- `X-Dashboard-View`: `daily_brief` or `calendar`;
- `X-Dashboard-Generation`: the generation selected by the paired metadata
  requests when downloading image bytes;
- `X-Dashboard-Metadata: true` for a bodyless cache-validation request;
- `Accept: image/png`.

The Worker authenticates before selecting a view. Explicit requests resolve
through the atomic current-generation pointer, while pinned downloads can only
select a named immutable published generation. The image response is the
private 800x480 opaque 1-bit PNG itself, not a JSON manifest. It includes:

- `Content-Type: image/png`;
- `Cache-Control: private, no-cache`;
- `ETag` and `Last-Modified`;
- `X-Dashboard-Filename`, `X-Dashboard-Generation`, and `X-Dashboard-View`.

An `If-None-Match` metadata request for each unchanged view returns `304`.
ESPHome then skips both image downloads and the physical e-paper refresh.
Credentials never appear in URLs, logs, filenames, or retained acceptance
output.

## Executable deployed contract

Use preview-only credentials because `/api/setup` rotates the token for an
existing identifier:

```sh
export DEVICE_ORIGIN="https://dashboard-device.example.com"
export DEVICE_ID="ESPHOME-IMAGE-PREVIEW"

SETUP_JSON="$(curl --fail-with-body \
  -H "ID: $DEVICE_ID" \
  "$DEVICE_ORIGIN/api/setup")"
export DEVICE_TOKEN="$(printf '%s' "$SETUP_JSON" | jq -er .api_key)"
unset SETUP_JSON

DEVICE_ID="$DEVICE_ID" DEVICE_TOKEN="$DEVICE_TOKEN" \
  npm run acceptance:esphome-image -- "$DEVICE_ORIGIN"
```

The command validates both explicit views, same-generation delivery,
dimensions, exact black-and-white palettes, generation headers, and per-view
ETag revalidation. Its output contains no credential or household content.

Verify the route remains private:

```sh
test "$(curl -sS -o /dev/null -w '%{http_code}' \
  -H "ID: $DEVICE_ID" \
  "$DEVICE_ORIGIN/api/image")" = 401
test "$(curl -sS -o /dev/null -w '%{http_code}' \
  -H "ID: $DEVICE_ID" \
  -H "Access-Token: invalid" \
  "$DEVICE_ORIGIN/api/image")" = 401

unset DEVICE_TOKEN DEVICE_ID DEVICE_ORIGIN
```
