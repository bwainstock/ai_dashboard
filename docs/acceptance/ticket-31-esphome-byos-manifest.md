# Ticket #31: ESPHome direct-image acceptance

> [!NOTE]
> Historical ticket specification. See the
> [production device-client contract](../device-client-contract.md) for current
> behavior.

ESPHome is the supported production device client. It performs one
authenticated `GET /api/image` request per startup, scheduled refresh, or Key 3
navigation gesture. Legacy TRMNL manifest and named-image routes remain
rollback-only compatibility.

## Client contract

The request sends:

- `ID`: provisioned device identifier;
- `Access-Token`: high-entropy device credential;
- `Update-Source`: `timer` for scheduled/default selection or `button` for
  forward navigation;
- `Accept: image/png`.

The Worker authenticates before selecting a view. Timer requests select Daily
Brief and reset the cursor. Button requests advance the server-managed cursor.
The response is the private 800x480 opaque 1-bit PNG itself, not a JSON
manifest. It includes:

- `Content-Type: image/png`;
- `Cache-Control: private, no-cache`;
- `ETag` and `Last-Modified`;
- `X-Dashboard-Filename`, `X-Dashboard-Generation`, and `X-Dashboard-View`.

An `If-None-Match` request for the unchanged selected view returns `304`.
ESPHome then skips the physical e-paper refresh. Credentials never appear in
URLs, logs, filenames, or retained acceptance output.

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
  npm run acceptance:esphome-image -- "$DEVICE_ORIGIN" timer
```

The command validates authentication, direct PNG delivery, dimensions, exact
black-and-white palette, generation headers, and ETag revalidation. Its output
contains no credential or household content.

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
