CREATE TABLE devices (
  device_id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL CHECK (length(token_hash) = 64),
  friendly_id TEXT NOT NULL UNIQUE CHECK (length(friendly_id) = 6),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE render_generations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL UNIQUE,
  object_key TEXT NOT NULL UNIQUE,
  byte_size INTEGER NOT NULL CHECK (byte_size > 0),
  width INTEGER NOT NULL CHECK (width = 800),
  height INTEGER NOT NULL CHECK (height = 480),
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX render_generations_published
  ON render_generations(published_at DESC)
  WHERE published_at IS NOT NULL;
