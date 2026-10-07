CREATE TABLE calendar_accounts (
  account_id TEXT PRIMARY KEY CHECK (account_id IN ('mom', 'dad')),
  display_label TEXT NOT NULL CHECK (
    length(display_label) BETWEEN 1 AND 20
    AND instr(display_label, '@') = 0
  ),
  encrypted_refresh_token TEXT,
  oauth_status TEXT NOT NULL DEFAULT 'disconnected'
    CHECK (oauth_status IN ('connected', 'disconnected', 'revoked')),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO calendar_accounts (account_id, display_label)
VALUES ('mom', 'Mom'), ('dad', 'Dad');

CREATE TABLE selected_calendars (
  account_id TEXT NOT NULL REFERENCES calendar_accounts(account_id)
    ON DELETE CASCADE,
  calendar_id TEXT NOT NULL,
  display_label TEXT NOT NULL CHECK (length(display_label) BETWEEN 1 AND 80),
  PRIMARY KEY (account_id, calendar_id)
);

CREATE TABLE calendar_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fetched_at TEXT NOT NULL,
  events_json TEXT NOT NULL CHECK (json_valid(events_json))
);

CREATE INDEX calendar_snapshots_fetched
  ON calendar_snapshots(fetched_at DESC);
