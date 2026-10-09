# Ticket 3: Scheduled weather Daily Brief

## Runtime configuration

Migration `0002_scheduled_weather.sql` creates the singleton
`dashboard_configuration` row with San Jose coordinates, the
`America/Los_Angeles` timezone, and generation slots at 06:30, 10:30, 15:00,
and 19:00.

An administrator can read or update coordinates and slots through
`GET/PUT /admin/weather-configuration`. The endpoint accepts the same
administrator credential as fixture generation, either as a bearer token or
in `X-Admin-Token`. Ordinary location and cadence changes are stored in D1 and
do not require deployment-secret changes.

Example body:

```json
{
  "latitude": 37.3382,
  "longitude": -121.8863,
  "slots": ["06:30", "10:30", "15:00", "19:00"]
}
```

## Scheduled generation

Wrangler invokes the Worker every five minutes. The Worker converts the
invocation to `America/Los_Angeles`, claims a due local slot idempotently,
fetches and normalizes Open-Meteo weather, and renders an 800x480 Daily Brief.
The image is written under an immutable generation key before D1 publishes the
generation. An invalid or failed render never advances the published image.

Open-Meteo HTTP, network, and response-schema failures have fixed error codes.
When a last valid weather snapshot exists, the Worker renders it with an
explicit stale marker. Without a valid snapshot, the slot fails visibly and
the existing published generation remains active.

`/api/display` calculates `refresh_rate` from the next configured local slot,
including daylight-saving transitions.

## Verification

The scheduled-generation boundary tests cover successful publication, stale
fallback, explicit failure without a snapshot, duplicate delivery, PNG
validation, and daylight-saving next-wake calculations. Adapter contract tests
cover normalization and explicit Open-Meteo failures.
