CREATE TABLE IF NOT EXISTS catalog_like_hits (
  hit_key TEXT PRIMARY KEY,
  track_id TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  day INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_catalog_like_hits_track_day ON catalog_like_hits(track_id, day);
