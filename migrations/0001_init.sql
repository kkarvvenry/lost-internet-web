CREATE TABLE IF NOT EXISTS catalog_tracks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  artist TEXT NOT NULL DEFAULT 'unknown artist',
  album TEXT NOT NULL DEFAULT '',
  genre TEXT NOT NULL DEFAULT '',
  format TEXT NOT NULL DEFAULT '',
  duration REAL NOT NULL DEFAULT 0,
  likes INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_catalog_tracks_created_at ON catalog_tracks(created_at DESC);
