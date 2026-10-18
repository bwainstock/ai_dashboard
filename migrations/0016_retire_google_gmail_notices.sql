PRAGMA foreign_keys = OFF;

DELETE FROM render_generations WHERE view_type = 'notices';

ALTER TABLE render_generations RENAME TO render_generations_retired_notices;

CREATE TABLE render_generations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL UNIQUE,
  object_key TEXT NOT NULL UNIQUE,
  byte_size INTEGER NOT NULL,
  width INTEGER NOT NULL CHECK (width = 800),
  height INTEGER NOT NULL CHECK (height = 480),
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  slot_key TEXT,
  view_type TEXT NOT NULL DEFAULT 'daily_brief'
    CHECK (view_type IN ('daily_brief', 'calendar', 'lunch')),
  generation_id TEXT
);

INSERT INTO render_generations
  (id, filename, object_key, byte_size, width, height, published_at, created_at,
   slot_key, view_type, generation_id)
SELECT id, filename, object_key, byte_size, width, height, published_at,
       created_at, slot_key, view_type, generation_id
FROM render_generations_retired_notices;

DROP TABLE render_generations_retired_notices;

CREATE INDEX render_generations_published
  ON render_generations(published_at DESC)
  WHERE published_at IS NOT NULL;
CREATE UNIQUE INDEX render_generations_slot_view
  ON render_generations(slot_key, view_type)
  WHERE slot_key IS NOT NULL;
CREATE INDEX render_generations_latest_view
  ON render_generations(view_type, published_at DESC)
  WHERE published_at IS NOT NULL;
CREATE UNIQUE INDEX render_generations_generation_view
  ON render_generations(generation_id, view_type)
  WHERE generation_id IS NOT NULL;

DELETE FROM source_status WHERE source = 'gmail';
ALTER TABLE source_status RENAME TO source_status_retired_gmail;

CREATE TABLE source_status (
  source TEXT PRIMARY KEY CHECK (source IN ('weather', 'calendar', 'lunch')),
  state TEXT NOT NULL CHECK (state IN ('fresh', 'stale', 'error')),
  last_success_at TEXT,
  error_code TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  consecutive_failures INTEGER NOT NULL DEFAULT 0
    CHECK (consecutive_failures >= 0),
  last_failure_slot_key TEXT
);

INSERT INTO source_status
  (source, state, last_success_at, error_code, updated_at,
   consecutive_failures, last_failure_slot_key)
SELECT source, state, last_success_at, error_code, updated_at,
       consecutive_failures, last_failure_slot_key
FROM source_status_retired_gmail;

DROP TABLE source_status_retired_gmail;

DELETE FROM operational_incidents
WHERE incident_key LIKE 'oauth:%'
   OR incident_key LIKE 'source:gmail%'
   OR incident_key LIKE 'ai:%'
   OR error_code IN (
     'OAUTH_REVOKED_OR_EXPIRED',
     'GMAIL_PROCESSING_REPEATED_FAILURE',
     'AI_QUOTA_EXHAUSTED'
   );

DROP TABLE operational_status;
DROP TABLE gmail_protected_reviews;
DROP TABLE gmail_review_records;
DROP TABLE household_notices;
DROP TABLE gmail_sender_allowlist;
DROP TABLE selected_calendars;
DROP TABLE calendar_snapshots;
DROP TABLE calendar_accounts;

PRAGMA foreign_keys = ON;
