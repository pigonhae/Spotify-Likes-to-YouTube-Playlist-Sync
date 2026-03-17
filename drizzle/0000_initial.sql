CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  user_key TEXT NOT NULL,
  display_name TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS users_user_key_uidx ON users(user_key);

CREATE TABLE IF NOT EXISTS oauth_accounts (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  encrypted_access_token TEXT NOT NULL,
  encrypted_refresh_token TEXT,
  token_expires_at BIGINT,
  scope TEXT,
  external_user_id TEXT,
  external_display_name TEXT,
  connected_at BIGINT NOT NULL,
  invalidated_at BIGINT,
  last_refresh_error TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS oauth_accounts_user_provider_uidx
  ON oauth_accounts(user_id, provider);
CREATE INDEX IF NOT EXISTS oauth_accounts_user_provider_idx
  ON oauth_accounts(user_id, provider);

CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS oauth_states_user_provider_idx
  ON oauth_states(user_id, provider);
CREATE INDEX IF NOT EXISTS oauth_states_expires_idx
  ON oauth_states(expires_at);

CREATE TABLE IF NOT EXISTS user_settings (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS user_settings_user_key_uidx
  ON user_settings(user_id, key);

CREATE TABLE IF NOT EXISTS track_mappings (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  spotify_track_id TEXT NOT NULL,
  spotify_added_at BIGINT NOT NULL,
  spotify_removed_at BIGINT,
  track_name TEXT NOT NULL,
  artist_names_json TEXT NOT NULL,
  album_name TEXT,
  album_release_date TEXT,
  duration_ms INTEGER NOT NULL,
  isrc TEXT,
  external_url TEXT,
  manual_video_id TEXT,
  matched_video_id TEXT,
  matched_video_title TEXT,
  matched_channel_title TEXT,
  matched_score INTEGER,
  matched_source TEXT,
  search_status TEXT NOT NULL,
  search_attempts INTEGER NOT NULL,
  last_search_at BIGINT,
  last_error TEXT,
  playlist_video_id TEXT,
  last_synced_at BIGINT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS track_mappings_user_track_uidx
  ON track_mappings(user_id, spotify_track_id);
CREATE INDEX IF NOT EXISTS track_mappings_user_removed_idx
  ON track_mappings(user_id, spotify_removed_at);
CREATE INDEX IF NOT EXISTS track_mappings_user_status_idx
  ON track_mappings(user_id, search_status);
CREATE INDEX IF NOT EXISTS track_mappings_user_matched_video_idx
  ON track_mappings(user_id, matched_video_id);

CREATE TABLE IF NOT EXISTS playlist_videos (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  playlist_id TEXT NOT NULL,
  playlist_item_id TEXT NOT NULL,
  video_id TEXT NOT NULL,
  video_title TEXT,
  channel_title TEXT,
  source_spotify_track_id TEXT,
  position INTEGER,
  synced_at BIGINT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS playlist_videos_user_playlist_video_uidx
  ON playlist_videos(user_id, playlist_id, video_id);
CREATE INDEX IF NOT EXISTS playlist_videos_user_playlist_idx
  ON playlist_videos(user_id, playlist_id);

CREATE TABLE IF NOT EXISTS sync_runs (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  trigger TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at BIGINT NOT NULL,
  finished_at BIGINT,
  stats_json JSONB,
  error_summary TEXT
);

CREATE INDEX IF NOT EXISTS sync_runs_user_started_at_idx
  ON sync_runs(user_id, started_at DESC);

CREATE TABLE IF NOT EXISTS sync_state (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  last_started_sync_at BIGINT,
  last_successful_sync_at BIGINT,
  last_failed_sync_at BIGINT,
  spotify_scan_offset INTEGER,
  last_error TEXT,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_lock (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lock_name TEXT NOT NULL,
  holder TEXT,
  locked_until BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, lock_name)
);
