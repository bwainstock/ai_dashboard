ALTER TABLE source_status
  ADD COLUMN consecutive_failures INTEGER NOT NULL DEFAULT 0
  CHECK (consecutive_failures >= 0);

ALTER TABLE source_status ADD COLUMN last_failure_slot_key TEXT;

CREATE TABLE operational_signals (
  signal_key TEXT PRIMARY KEY CHECK (
    signal_key IN ('device_auth_suspicious')
  ),
  active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0, 1)),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO operational_signals (signal_key)
VALUES ('device_auth_suspicious');

ALTER TABLE operational_incidents ADD COLUMN incident_key TEXT;
ALTER TABLE operational_incidents ADD COLUMN notified_at TEXT;

UPDATE operational_incidents
SET resolved_at = CURRENT_TIMESTAMP
WHERE resolved_at IS NULL;

CREATE UNIQUE INDEX operational_incidents_one_active
  ON operational_incidents(incident_key)
  WHERE resolved_at IS NULL AND incident_key IS NOT NULL;
