ALTER TABLE calendar_accounts ADD COLUMN gmail_disconnect_state TEXT
  CHECK (
    gmail_disconnect_state IS NULL
    OR gmail_disconnect_state IN ('revocation_pending', 'cleanup_pending')
  );
