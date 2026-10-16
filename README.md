# Family Dashboard

A shared e-ink dashboard focused on household calendars and dated weather
forecasts. Lunch and Gmail-derived display sources are currently deferred.

Target hardware:

- [TRMNL 7.5 Inch OG DIY Kit](https://www.seeedstudio.com/TRMNL-7-5-Inch-OG-DIY-Kit-p-6481.html)

Documentation:

- [System design](docs/design.md)
- [Production device-client contract](docs/device-client-contract.md)
- [Implementation plan](docs/implementation-plan.md)
- [Domain glossary](GLOSSARY.md)
- [Architecture decisions](docs/adr/)
- [Browser administration and operational status](docs/administration.md)
- [Google Calendar integration](docs/calendar-integration.md)
- [Privacy-isolated Gmail processing](docs/gmail-integration.md)
- [Google OAuth Production cutover](docs/google-oauth-production-cutover.md)
- [Historical ticket acceptance specifications](docs/acceptance/)

## Development

```sh
npm ci
npm run check
```

The device Worker is configured in `wrangler.toml`. Its R2 binding is private;
the production ESPHome client receives images only through authenticated
`/api/image`.

## Previewing without a physical display

Use a preview-only device ID rather than the physical device MAC, because
`/api/setup` replaces the token for an existing device ID.

```sh
export DEVICE_ORIGIN="https://dashboard-device.example.com"
export DEVICE_ID="LOCAL-PREVIEW"

SETUP_JSON="$(curl --fail-with-body \
  -H "ID: $DEVICE_ID" \
  "$DEVICE_ORIGIN/api/setup")"
export DEVICE_TOKEN="$(
  node -p 'JSON.parse(process.argv[1]).api_key' "$SETUP_JSON"
)"

curl --fail-with-body \
  -H "ID: $DEVICE_ID" \
  -H "Access-Token: $DEVICE_TOKEN" \
  -H "Update-Source: timer" \
  -o dashboard-preview.png \
  "$DEVICE_ORIGIN/api/image"
open dashboard-preview.png
```

The preview command above exercises the legacy request shape and is retained
for rollback diagnosis. Follow the
[production device-client contract](docs/device-client-contract.md) for current
explicit view selection, complete-generation caching, and local navigation.
Run the deployed image check with the same preview credentials:

```sh
DEVICE_ID="$DEVICE_ID" DEVICE_TOKEN="$DEVICE_TOKEN" \
  npm run acceptance:esphome-image -- "$DEVICE_ORIGIN" timer

unset DEVICE_TOKEN
```

## Maintainer workflow

Changes to `main` are made through pull requests. The required `Validation /
Validate` check installs dependencies from `package-lock.json`, then runs type
checking, linting, the complete automated test suite, and dry-run builds for
both Workers.

Maintainers may merge after the required check passes. Direct pushes, force
pushes, branch deletion, and bypassing this requirement are disabled for
`main`.
