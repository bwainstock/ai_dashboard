# Ticket #7: Lunch View acceptance

> [!NOTE]
> Historical ticket specification. See the
> [production device-client contract](../device-client-contract.md) for current
> behavior.

Lunch View is deferred and is not generated, published, or included in the
active device cycle.

The active generation is complete only when its Daily Brief and Calendar View
images are both rendered, validated, stored, and atomically published.
