ALTER TABLE calendar_accounts ADD COLUMN gmail_history_id TEXT;
ALTER TABLE calendar_accounts ADD COLUMN gmail_scan_started_at TEXT;
ALTER TABLE calendar_accounts ADD COLUMN gmail_scan_completed_at TEXT;

CREATE TABLE gmail_sender_allowlist (
  domain TEXT PRIMARY KEY CHECK (
    domain = lower(domain)
    AND instr(domain, '@') = 0
    AND instr(domain, '.') > 0
  ),
  kind TEXT NOT NULL CHECK (kind IN ('school', 'childcare')),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE household_notices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL CHECK (account_id IN ('mom', 'dad')),
  source_key TEXT NOT NULL CHECK (length(source_key) = 64),
  category TEXT NOT NULL CHECK (
    category IN ('school', 'childcare', 'activity', 'household')
  ),
  summary TEXT NOT NULL CHECK (length(summary) BETWEEN 1 AND 160),
  relevant_date TEXT,
  action TEXT CHECK (action IS NULL OR length(action) BETWEEN 1 AND 100),
  sender_organization TEXT NOT NULL CHECK (
    length(sender_organization) BETWEEN 1 AND 80
    AND instr(sender_organization, '@') = 0
  ),
  model_id TEXT NOT NULL,
  model_version TEXT NOT NULL,
  accepted_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  retained_until TEXT NOT NULL,
  UNIQUE (account_id, source_key)
);

CREATE INDEX household_notices_active
  ON household_notices(expires_at, accepted_at DESC);

CREATE TABLE gmail_review_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL CHECK (account_id IN ('mom', 'dad')),
  reason TEXT NOT NULL CHECK (
    reason IN (
      'model_error', 'malformed', 'schema', 'confidence', 'date', 'sensitive'
    )
  ),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

ALTER TABLE source_status RENAME TO source_status_v1;

CREATE TABLE source_status (
  source TEXT PRIMARY KEY CHECK (
    source IN ('weather', 'calendar', 'lunch', 'gmail')
  ),
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
FROM source_status_v1;

DROP TABLE source_status_v1;

INSERT INTO source_status (source, state)
VALUES ('gmail', 'stale');
