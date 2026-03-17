CREATE TABLE IF NOT EXISTS oauth_accounts (
  provider TEXT PRIMARY KEY NOT NULL,
  encrypted_access_token TEXT NOT NULL,
  encrypted_refresh_token TEXT,
  token_expires_at INTEGER,
  scope TEXT,
  external_user_id TEXT,
  external_display_name TEXT,
  connected_at INTEGER NOT NULL,
  invalidated_at INTEGER,
  last_refresh_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY NOT NULL,
  provider TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS oauth_states_provider_idx ON oauth_states(provider);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS track_mappings (
  spotify_track_id TEXT PRIMARY KEY NOT NULL,
  spotify_added_at INTEGER NOT NULL,
  spotify_removed_at INTEGER,
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
  last_search_at INTEGER,
  last_error TEXT,
  playlist_video_id TEXT,
  last_synced_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS track_mappings_removed_idx ON track_mappings(spotify_removed_at);
CREATE INDEX IF NOT EXISTS track_mappings_status_idx ON track_mappings(search_status);
CREATE INDEX IF NOT EXISTS track_mappings_matched_video_idx ON track_mappings(matched_video_id);

CREATE TABLE IF NOT EXISTS playlist_videos (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  playlist_id TEXT NOT NULL,
  playlist_item_id TEXT NOT NULL,
  video_id TEXT NOT NULL,
  video_title TEXT,
  channel_title TEXT,
  source_spotify_track_id TEXT,
  position INTEGER,
  synced_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS playlist_videos_playlist_video_uidx
  ON playlist_videos(playlist_id, video_id);
CREATE INDEX IF NOT EXISTS playlist_videos_playlist_idx ON playlist_videos(playlist_id);

CREATE TABLE IF NOT EXISTS sync_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  trigger TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  stats_json TEXT,
  error_summary TEXT
);

CREATE TABLE IF NOT EXISTS sync_lock (
  lock_name TEXT PRIMARY KEY NOT NULL,
  holder TEXT,
  locked_until INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
