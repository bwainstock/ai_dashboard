CREATE TABLE calendar_feeds (
  id TEXT PRIMARY KEY,
  encrypted_url TEXT NOT NULL,
  hostname TEXT NOT NULL CHECK (length(hostname) BETWEEN 1 AND 253),
  url_hash TEXT NOT NULL UNIQUE CHECK (length(url_hash) = 64),
  url_fingerprint TEXT NOT NULL CHECK (length(url_fingerprint) = 12),
  calendar_label TEXT NOT NULL CHECK (length(calendar_label) BETWEEN 1 AND 40),
  household_label TEXT CHECK (
    household_label IS NULL OR length(household_label) BETWEEN 1 AND 20
  ),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE calendar_feed_snapshots (
  feed_id TEXT PRIMARY KEY REFERENCES calendar_feeds(id) ON DELETE CASCADE,
  fetched_at TEXT NOT NULL,
  events_json TEXT NOT NULL CHECK (json_valid(events_json)),
  etag TEXT,
  last_modified TEXT
);

CREATE TABLE calendar_feed_health (
  feed_id TEXT PRIMARY KEY REFERENCES calendar_feeds(id) ON DELETE CASCADE,
  state TEXT NOT NULL CHECK (state IN ('healthy', 'stale', 'unavailable')),
  last_attempt_at TEXT,
  last_success_at TEXT,
  failure_code TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE calendar_feed_health_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  feed_id TEXT NOT NULL REFERENCES calendar_feeds(id) ON DELETE CASCADE,
  state TEXT NOT NULL CHECK (state IN ('healthy', 'stale', 'unavailable')),
  failure_code TEXT,
  recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX calendar_feed_health_history_feed
  ON calendar_feed_health_history(feed_id, recorded_at DESC);
