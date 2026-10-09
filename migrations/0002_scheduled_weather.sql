CREATE TABLE dashboard_configuration (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  latitude REAL NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude REAL NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  timezone TEXT NOT NULL CHECK (timezone = 'America/Los_Angeles'),
  slots_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO dashboard_configuration
  (id, latitude, longitude, timezone, slots_json)
VALUES
  (1, 37.3382, -121.8863, 'America/Los_Angeles',
   '["06:30","10:30","15:00","19:00"]');

CREATE TABLE weather_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  observed_at TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json))
);

CREATE INDEX weather_snapshots_fetched
  ON weather_snapshots(fetched_at DESC);

CREATE TABLE scheduled_generation_slots (
  slot_key TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('running', 'published', 'failed')),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  error_code TEXT,
  error_message TEXT
);

ALTER TABLE render_generations ADD COLUMN slot_key TEXT;

CREATE UNIQUE INDEX render_generations_slot
  ON render_generations(slot_key)
  WHERE slot_key IS NOT NULL;
