CREATE TABLE gmail_protected_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL CHECK (account_id IN ('mom', 'dad')),
  source_key TEXT NOT NULL CHECK (length(source_key) = 64),
  review_kind TEXT NOT NULL CHECK (
    review_kind IN ('uncertain', 'sensitive')
  ),
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
  confidence REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  UNIQUE (account_id, source_key)
);

CREATE INDEX gmail_protected_reviews_pending
  ON gmail_protected_reviews(expires_at, created_at DESC);

ALTER TABLE gmail_review_records RENAME TO gmail_review_records_v1;

CREATE TABLE gmail_review_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL CHECK (account_id IN ('mom', 'dad')),
  reason TEXT NOT NULL CHECK (
    reason IN (
      'model_error', 'malformed', 'schema', 'confidence', 'date', 'sensitive',
      'prompt_injection', 'sensitivity_contradiction'
    )
  ),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

INSERT INTO gmail_review_records
  (id, account_id, reason, created_at, expires_at)
SELECT id, account_id, reason, created_at, expires_at
FROM gmail_review_records_v1;

DROP TABLE gmail_review_records_v1;
