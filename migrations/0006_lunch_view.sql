PRAGMA foreign_keys = OFF;

CREATE TABLE devices_lunch_view (
  device_id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL CHECK (length(token_hash) = 64),
  friendly_id TEXT NOT NULL UNIQUE CHECK (length(friendly_id) = 6),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  view_cursor INTEGER NOT NULL DEFAULT 0 CHECK (view_cursor IN (0, 1, 2))
);

INSERT INTO devices_lunch_view
  (device_id, token_hash, friendly_id, created_at, updated_at, view_cursor)
SELECT device_id, token_hash, friendly_id, created_at, updated_at, view_cursor
FROM devices;

DROP TABLE devices;
ALTER TABLE devices_lunch_view RENAME TO devices;

CREATE TABLE render_generations_lunch_view (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL UNIQUE,
  object_key TEXT NOT NULL UNIQUE,
  byte_size INTEGER NOT NULL CHECK (byte_size > 0),
  width INTEGER NOT NULL CHECK (width = 800),
  height INTEGER NOT NULL CHECK (height = 480),
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  slot_key TEXT,
  view_type TEXT NOT NULL DEFAULT 'daily_brief'
    CHECK (view_type IN ('daily_brief', 'calendar', 'lunch'))
);

INSERT INTO render_generations_lunch_view
  (id, filename, object_key, byte_size, width, height, published_at, created_at,
   slot_key, view_type)
SELECT id, filename, object_key, byte_size, width, height, published_at,
       created_at, slot_key, view_type
FROM render_generations;

DROP TABLE render_generations;
ALTER TABLE render_generations_lunch_view RENAME TO render_generations;

CREATE INDEX render_generations_published
  ON render_generations(published_at DESC)
  WHERE published_at IS NOT NULL;

CREATE UNIQUE INDEX render_generations_slot_view
  ON render_generations(slot_key, view_type)
  WHERE slot_key IS NOT NULL;

CREATE INDEX render_generations_latest_view
  ON render_generations(view_type, published_at DESC)
  WHERE published_at IS NOT NULL;

PRAGMA foreign_keys = ON;
