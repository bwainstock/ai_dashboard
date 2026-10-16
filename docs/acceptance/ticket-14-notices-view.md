# Ticket 14 — Notices View

> [!NOTE]
> Historical ticket specification. See the
> [production device-client contract](../device-client-contract.md) for current
> behavior.

Notices View and Gmail processing are deferred and are not part of active
scheduled generation or the device view cycle.

The privacy-isolated Gmail implementation remains in the repository, but it
must not run as a prerequisite for weather-and-calendar publication or place
Gmail-derived content on either active display.
