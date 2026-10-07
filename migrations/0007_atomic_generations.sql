ALTER TABLE scheduled_generation_slots
  ADD COLUMN retry_at TEXT;

ALTER TABLE scheduled_generation_slots
  ADD COLUMN retry_claimed_at TEXT;

ALTER TABLE scheduled_generation_slots
  ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 1
  CHECK (attempt_count IN (1, 2));

CREATE TABLE generation_source_failures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slot_key TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('weather', 'calendar', 'lunch')),
  error_code TEXT NOT NULL,
  error_message TEXT NOT NULL,
  occurred_at TEXT NOT NULL
);

CREATE INDEX generation_source_failures_slot
  ON generation_source_failures(slot_key, occurred_at DESC);

CREATE TABLE render_generation_sets (
  generation_id TEXT PRIMARY KEY,
  slot_key TEXT NOT NULL UNIQUE,
  generated_at TEXT NOT NULL,
  published_at TEXT NOT NULL
);

ALTER TABLE render_generations
  ADD COLUMN generation_id TEXT;

INSERT INTO render_generation_sets
  (generation_id, slot_key, generated_at, published_at)
SELECT slot_key, slot_key, MAX(published_at), MAX(published_at)
FROM render_generations
WHERE slot_key IS NOT NULL AND published_at IS NOT NULL
GROUP BY slot_key
HAVING COUNT(DISTINCT view_type) = 3;

UPDATE render_generations
SET generation_id = slot_key
WHERE slot_key IN (SELECT slot_key FROM render_generation_sets);

CREATE UNIQUE INDEX render_generations_generation_view
  ON render_generations(generation_id, view_type)
  WHERE generation_id IS NOT NULL;

CREATE TABLE current_render_generation (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  generation_id TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (generation_id) REFERENCES render_generation_sets(generation_id)
);

INSERT INTO current_render_generation (id, generation_id, updated_at)
SELECT 1, generation_id, published_at
FROM render_generation_sets
ORDER BY published_at DESC
LIMIT 1;
