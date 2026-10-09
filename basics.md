# Family Dashboard

A shared dashboard for household information such as schedules, important email, school lunch information, weather, and to-do lists.

Target hardware:

- [TRMNL 7.5 Inch OG DIY Kit](https://www.seeedstudio.com/TRMNL-7-5-Inch-OG-DIY-Kit-p-6481.html)

Design documentation:

- [System design](docs/design.md)
- [Implementation plan](docs/implementation-plan.md)
- [Domain glossary](GLOSSARY.md)
- [Architecture decisions](docs/adr/)
- [Ticket #2 private BYOS acceptance](docs/acceptance/ticket-2-private-byos.md)
- [Ticket #5 Calendar View acceptance](docs/acceptance/ticket-5-calendar-view.md)
- [Ticket #11 physical device acceptance](docs/acceptance/ticket-11-physical-device.md)

## Development

```sh
npm ci
npm run check
```

The device Worker is configured in `wrangler.toml`. Its R2 binding is private;
display images are served only by the authenticated `/images/:filename` route.

## Maintainer workflow

Changes to `main` are made through pull requests. The required `Validation /
Validate` check installs dependencies from `package-lock.json`, then runs type
checking, linting, the complete automated test suite, and dry-run builds for
both Workers.

Maintainers may merge after the required check passes. Direct pushes, force
pushes, branch deletion, and bypassing this requirement are disabled for
`main`.
