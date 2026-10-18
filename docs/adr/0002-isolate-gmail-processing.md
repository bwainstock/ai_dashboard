# Isolate Gmail processing and retain only validated notices

## Status

Superseded by ADR 0004. Retained as architecture history only.

## Historical decision

The earlier plan isolated Gmail processing in a dedicated Worker and retained
only validated notice fields. Ticket #59 retired that capability before it
became part of the active product and migration `0016` purged its data and
schema.
