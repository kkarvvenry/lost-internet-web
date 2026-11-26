CREATE TABLE IF NOT EXISTS spotify_oauth_states (
  state TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS spotify_links (
  account_id TEXT PRIMARY KEY,
  spotify_user_id TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL DEFAULT '',
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  scope TEXT NOT NULL DEFAULT '',
  connected_at INTEGER NOT NULL
);
