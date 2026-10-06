# Isolate Gmail processing and retain only validated notices

Phase 2 will process Gmail-derived content in a dedicated Worker that calls Workers AI directly, emits no content-bearing logs, and never persists raw message bodies. The rest of the system receives only validated Household Notice fields or an account-specific Private Notice Marker; this separation limits exposure of restricted Gmail data while still allowing the shared display and protected review workflow to use the extracted result.
