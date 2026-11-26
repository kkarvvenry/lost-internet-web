CREATE TABLE IF NOT EXISTS integration_hits (
  day INTEGER NOT NULL,
  ip_hash TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (day, ip_hash)
);
