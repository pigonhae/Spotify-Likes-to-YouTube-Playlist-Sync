ALTER TABLE sync_runs
  ADD COLUMN IF NOT EXISTS phase TEXT,
  ADD COLUMN IF NOT EXISTS status_message TEXT,
  ADD COLUMN IF NOT EXISTS total_tracks INTEGER,
  ADD COLUMN IF NOT EXISTS completed_tracks INTEGER,
  ADD COLUMN IF NOT EXISTS remaining_tracks INTEGER,
  ADD COLUMN IF NOT EXISTS current_spotify_track_id TEXT,
  ADD COLUMN IF NOT EXISTS current_track_name TEXT,
  ADD COLUMN IF NOT EXISTS next_retry_at BIGINT,
  ADD COLUMN IF NOT EXISTS pause_reason TEXT,
  ADD COLUMN IF NOT EXISTS last_error_summary TEXT,
  ADD COLUMN IF NOT EXISTS last_heartbeat_at BIGINT,
  ADD COLUMN IF NOT EXISTS updated_at BIGINT,
  ADD COLUMN IF NOT EXISTS resumed_from_run_id BIGINT,
  ADD COLUMN IF NOT EXISTS spotify_scan_offset INTEGER,
  ADD COLUMN IF NOT EXISTS spotify_scan_completed_at BIGINT,
  ADD COLUMN IF NOT EXISTS playlist_snapshot_completed_at BIGINT;

CREATE INDEX IF NOT EXISTS sync_runs_user_status_idx
  ON sync_runs(user_id, status);

CREATE INDEX IF NOT EXISTS sync_runs_user_next_retry_at_idx
  ON sync_runs(user_id, next_retry_at);

ALTER TABLE sync_state
  ADD COLUMN IF NOT EXISTS active_run_id BIGINT,
  ADD COLUMN IF NOT EXISTS last_heartbeat_at BIGINT;

CREATE TABLE IF NOT EXISTS sync_run_tracks (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sync_run_id BIGINT NOT NULL REFERENCES sync_runs(id) ON DELETE CASCADE,
  spotify_track_id TEXT NOT NULL,
  track_order INTEGER NOT NULL,
  status TEXT NOT NULL,
  status_message TEXT,
  track_name TEXT NOT NULL,
  artist_names_json TEXT NOT NULL,
  album_name TEXT,
  album_release_date TEXT,
  duration_ms INTEGER NOT NULL,
  isrc TEXT,
  external_url TEXT,
  spotify_added_at BIGINT NOT NULL,
  manual_video_id TEXT,
  manual_resolution_type TEXT,
  matched_video_id TEXT,
  matched_video_title TEXT,
  matched_channel_title TEXT,
  matched_score INTEGER,
  matched_source TEXT,
  review_video_id TEXT,
  review_video_title TEXT,
  review_channel_title TEXT,
  review_video_url TEXT,
  review_source TEXT,
  review_score INTEGER,
  review_reasons_json TEXT,
  playlist_item_id TEXT,
  attempt_count INTEGER NOT NULL,
  last_error TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS sync_run_tracks_user_run_track_uidx
  ON sync_run_tracks(user_id, sync_run_id, spotify_track_id);

CREATE INDEX IF NOT EXISTS sync_run_tracks_user_run_order_idx
  ON sync_run_tracks(user_id, sync_run_id, track_order);

CREATE INDEX IF NOT EXISTS sync_run_tracks_user_run_status_idx
  ON sync_run_tracks(user_id, sync_run_id, status);

CREATE TABLE IF NOT EXISTS sync_run_events (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sync_run_id BIGINT NOT NULL REFERENCES sync_runs(id) ON DELETE CASCADE,
  level TEXT NOT NULL,
  stage TEXT NOT NULL,
  message TEXT NOT NULL,
  spotify_track_id TEXT,
  payload_json JSONB,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS sync_run_events_user_run_created_idx
  ON sync_run_events(user_id, sync_run_id, created_at);
