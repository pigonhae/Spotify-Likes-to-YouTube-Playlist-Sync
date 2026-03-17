ALTER TABLE track_mappings
  ADD COLUMN IF NOT EXISTS manual_resolution_type TEXT,
  ADD COLUMN IF NOT EXISTS review_video_id TEXT,
  ADD COLUMN IF NOT EXISTS review_video_title TEXT,
  ADD COLUMN IF NOT EXISTS review_channel_title TEXT,
  ADD COLUMN IF NOT EXISTS review_video_url TEXT,
  ADD COLUMN IF NOT EXISTS review_source TEXT,
  ADD COLUMN IF NOT EXISTS review_score INTEGER,
  ADD COLUMN IF NOT EXISTS review_reasons_json TEXT,
  ADD COLUMN IF NOT EXISTS review_updated_at BIGINT;

UPDATE track_mappings
SET search_status = 'review_required'
WHERE search_status = 'needs_manual';
