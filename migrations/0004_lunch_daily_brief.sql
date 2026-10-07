CREATE TABLE lunch_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fetched_at TEXT NOT NULL,
  snapshot_json TEXT NOT NULL CHECK (
    json_valid(snapshot_json) AND
    json_type(snapshot_json, '$.days') = 'array'
  )
);

CREATE INDEX lunch_snapshots_fetched
  ON lunch_snapshots(fetched_at DESC);

CREATE TABLE lunch_icon_mappings (
  entree_key TEXT PRIMARY KEY,
  icon TEXT NOT NULL CHECK (
    icon IN ('pizza', 'taco', 'sandwich', 'chicken', 'pasta', 'salad', 'generic')
  ),
  source TEXT NOT NULL CHECK (source = 'ai'),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
