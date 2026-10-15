# Family Dashboard

A shared e-ink dashboard focused on household calendars and dated weather
forecasts. Lunch and Gmail-derived display sources are currently deferred.

Target hardware:

- [TRMNL 7.5 Inch OG DIY Kit](https://www.seeedstudio.com/TRMNL-7-5-Inch-OG-DIY-Kit-p-6481.html)

Documentation:

- [System design](docs/design.md)
- [Implementation plan](docs/implementation-plan.md)
- [Domain glossary](GLOSSARY.md)
- [Architecture decisions](docs/adr/)
- [Browser administration and operational status](docs/administration.md)
- [Google Calendar integration](docs/calendar-integration.md)
- [Privacy-isolated Gmail processing](docs/gmail-integration.md)
- [Google OAuth Production cutover](docs/google-oauth-production-cutover.md)
- [Ticket #2 private BYOS acceptance](docs/acceptance/ticket-2-private-byos.md)
- [Ticket #5 Calendar View acceptance](docs/acceptance/ticket-5-calendar-view.md)
- [Ticket #11 physical device acceptance](docs/acceptance/ticket-11-physical-device.md)
- [Ticket #31 ESPHome BYOS manifest acceptance](docs/acceptance/ticket-31-esphome-byos-manifest.md)
- [Ticket #32 ESPHome Daily Brief proof of concept](docs/acceptance/ticket-32-esphome-daily-brief.md)

## Development

```sh
npm ci
npm run check
```

The device Worker is configured in `wrangler.toml`. Its R2 binding is private;
display images are served only by the authenticated `/images/:filename` route.

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

DISPLAY_JSON="$(curl --fail-with-body \
  -H "ID: $DEVICE_ID" \
  -H "Access-Token: $DEVICE_TOKEN" \
  -H "Update-Source: timer" \
  "$DEVICE_ORIGIN/api/display")"
IMAGE_URL="$(
  node -p 'JSON.parse(process.argv[1]).image_url' "$DISPLAY_JSON"
)"

curl --fail-with-body \
  -H "ID: $DEVICE_ID" \
  -H "Access-Token: $DEVICE_TOKEN" \
  -o dashboard-preview.png \
  "$IMAGE_URL"
open dashboard-preview.png
```

The preview is the current deployed Daily Brief PNG. Send
`Update-Source: button` on subsequent `/api/display` requests to advance
to Calendar View and then back to Daily Brief. Run the deployed image check
with the same preview credentials:

```sh
DEVICE_ID="$DEVICE_ID" DEVICE_TOKEN="$DEVICE_TOKEN" \
  npm run acceptance:device -- "$DEVICE_ORIGIN"

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
