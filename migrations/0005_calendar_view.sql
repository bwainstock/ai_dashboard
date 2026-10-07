ALTER TABLE devices ADD COLUMN view_cursor INTEGER NOT NULL DEFAULT 0
  CHECK (view_cursor IN (0, 1));

ALTER TABLE render_generations ADD COLUMN view_type TEXT NOT NULL
  DEFAULT 'daily_brief'
  CHECK (view_type IN ('daily_brief', 'calendar'));

DROP INDEX render_generations_slot;

CREATE UNIQUE INDEX render_generations_slot_view
  ON render_generations(slot_key, view_type)
  WHERE slot_key IS NOT NULL;

CREATE INDEX render_generations_latest_view
  ON render_generations(view_type, published_at DESC)
  WHERE published_at IS NOT NULL;
