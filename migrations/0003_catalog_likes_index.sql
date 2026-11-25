CREATE INDEX IF NOT EXISTS idx_catalog_tracks_likes ON catalog_tracks(likes DESC, created_at DESC);
