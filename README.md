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
the production ESPHome client receives explicitly selected, generation-pinned
images only through authenticated `/api/image` requests.

## Previewing without a physical display

### Local renderer previews

Render both active views with an installed Chrome-family browser, without
deploying:

```sh
npm run preview:render
```

Set `CHROME_PATH` or pass `-- --chrome /path/to/chrome` when Chrome is not in a
standard location. Use `-- --output path` to choose the artifact directory and
`-- --now 2026-10-07T17:30:00.000Z` for a repeatable comparison. The command
creates labeled Daily Brief and Calendar View PNGs plus a manifest recording
the native 800x480 scale, monochrome threshold, font strategy, and configured
minimum text size. It uses the same HTML, viewport, mechanical validation, and
palette conversion as production.

Local preview artifacts belong under `artifacts/renderer-previews/`. They are
for renderer debugging and comparison only. They are not physical acceptance
evidence and do not replace human observation of readability and mechanical
quality on the e-paper display.

### Published-generation diagnostics

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

DEVICE_ID="$DEVICE_ID" DEVICE_TOKEN="$DEVICE_TOKEN" \
  npm run acceptance:run -- \
  "$DEVICE_ORIGIN" evidence/device-acceptance/preview.json

unset DEVICE_TOKEN
```

The report validates explicit Daily Brief and Calendar View selection, one
published generation, generation-pinned downloads, independent ETags,
authentication, and exact image constraints. Automated results are recorded
separately from physical observations, which remain pending.

Legacy manifest, named-image, and server-cursor diagnostics are available only
through the `acceptance:rollback-*` commands.

## Maintainer workflow

Changes to `main` are made through pull requests. The required `Validation /
Validate` check installs dependencies from `package-lock.json`, then runs type
checking, linting, the complete automated test suite, and dry-run builds for
both Workers.

Maintainers may merge after the required check passes. Direct pushes, force
pushes, branch deletion, and bypassing this requirement are disabled for
`main`.
