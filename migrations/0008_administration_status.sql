CREATE TABLE administration_users (
  email TEXT PRIMARY KEY CHECK (
    email = lower(email)
    AND instr(email, '@') > 1
  ),
  role TEXT NOT NULL CHECK (role IN ('administrator', 'reviewer')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE devices ADD COLUMN last_check_in_at TEXT;

CREATE TABLE source_status (
  source TEXT PRIMARY KEY CHECK (source IN ('weather', 'calendar', 'lunch')),
  state TEXT NOT NULL CHECK (state IN ('fresh', 'stale', 'error')),
  last_success_at TEXT,
  error_code TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO source_status (source, state)
VALUES ('weather', 'stale'), ('calendar', 'stale'), ('lunch', 'stale');

CREATE TABLE operational_status (
  status_key TEXT PRIMARY KEY CHECK (status_key IN ('ai_quota')),
  status_value TEXT NOT NULL CHECK (
    status_value IN ('available', 'exhausted', 'not_applicable')
  ),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO operational_status (status_key, status_value)
VALUES ('ai_quota', 'not_applicable');

CREATE TABLE operational_incidents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  error_code TEXT NOT NULL,
  occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TEXT
);

CREATE INDEX operational_incidents_active
  ON operational_incidents(occurred_at DESC)
  WHERE resolved_at IS NULL;

UPDATE scheduled_generation_slots SET error_message = NULL;

UPDATE generation_source_failures SET error_message = error_code;
