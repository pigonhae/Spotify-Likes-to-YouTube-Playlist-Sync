import { randomUUID } from "node:crypto";

import {
  bigint,
  bigserial,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().$defaultFn(() => randomUUID()),
  userKey: text("user_key").notNull(),
  displayName: text("display_name"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
}, (table) => ({
  userKeyUnique: uniqueIndex("users_user_key_uidx").on(table.userKey),
}));

export const oauthAccounts = pgTable("oauth_accounts", {
  id: uuid("id").primaryKey().$defaultFn(() => randomUUID()),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  encryptedAccessToken: text("encrypted_access_token").notNull(),
  encryptedRefreshToken: text("encrypted_refresh_token"),
  tokenExpiresAt: bigint("token_expires_at", { mode: "number" }),
  scope: text("scope"),
  externalUserId: text("external_user_id"),
  externalDisplayName: text("external_display_name"),
  connectedAt: bigint("connected_at", { mode: "number" }).notNull(),
  invalidatedAt: bigint("invalidated_at", { mode: "number" }),
  lastRefreshError: text("last_refresh_error"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
}, (table) => ({
  userProviderUnique: uniqueIndex("oauth_accounts_user_provider_uidx").on(table.userId, table.provider),
  userProviderIdx: index("oauth_accounts_user_provider_idx").on(table.userId, table.provider),
}));

export const oauthStates = pgTable("oauth_states", {
  state: text("state").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
}, (table) => ({
  providerIdx: index("oauth_states_user_provider_idx").on(table.userId, table.provider),
  expiresIdx: index("oauth_states_expires_idx").on(table.expiresAt),
}));

export const appSettings = pgTable("user_settings", {
  id: uuid("id").primaryKey().$defaultFn(() => randomUUID()),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  settingValue: text("value").notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
}, (table) => ({
  userKeyUnique: uniqueIndex("user_settings_user_key_uidx").on(table.userId, table.key),
}));

export const trackMappings = pgTable("track_mappings", {
  id: uuid("id").primaryKey().$defaultFn(() => randomUUID()),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  spotifyTrackId: text("spotify_track_id").notNull(),
  spotifyAddedAt: bigint("spotify_added_at", { mode: "number" }).notNull(),
  spotifyRemovedAt: bigint("spotify_removed_at", { mode: "number" }),
  trackName: text("track_name").notNull(),
  artistNamesJson: text("artist_names_json").notNull(),
  albumName: text("album_name"),
  albumReleaseDate: text("album_release_date"),
  durationMs: integer("duration_ms").notNull(),
  isrc: text("isrc"),
  externalUrl: text("external_url"),
  manualVideoId: text("manual_video_id"),
  manualResolutionType: text("manual_resolution_type"),
  matchedVideoId: text("matched_video_id"),
  matchedVideoTitle: text("matched_video_title"),
  matchedChannelTitle: text("matched_channel_title"),
  matchedScore: integer("matched_score"),
  matchedSource: text("matched_source"),
  reviewVideoId: text("review_video_id"),
  reviewVideoTitle: text("review_video_title"),
  reviewChannelTitle: text("review_channel_title"),
  reviewVideoUrl: text("review_video_url"),
  reviewSource: text("review_source"),
  reviewScore: integer("review_score"),
  reviewReasonsJson: text("review_reasons_json"),
  reviewUpdatedAt: bigint("review_updated_at", { mode: "number" }),
  searchStatus: text("search_status").notNull(),
  searchAttempts: integer("search_attempts").notNull(),
  lastSearchAt: bigint("last_search_at", { mode: "number" }),
  lastError: text("last_error"),
  playlistVideoId: text("playlist_video_id"),
  lastSyncedAt: bigint("last_synced_at", { mode: "number" }),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
}, (table) => ({
  userTrackUnique: uniqueIndex("track_mappings_user_track_uidx").on(table.userId, table.spotifyTrackId),
  removedIdx: index("track_mappings_user_removed_idx").on(table.userId, table.spotifyRemovedAt),
  statusIdx: index("track_mappings_user_status_idx").on(table.userId, table.searchStatus),
  matchedVideoIdx: index("track_mappings_user_matched_video_idx").on(table.userId, table.matchedVideoId),
}));

export const playlistVideos = pgTable("playlist_videos", {
  id: uuid("id").primaryKey().$defaultFn(() => randomUUID()),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  playlistId: text("playlist_id").notNull(),
  playlistItemId: text("playlist_item_id").notNull(),
  videoId: text("video_id").notNull(),
  videoTitle: text("video_title"),
  channelTitle: text("channel_title"),
  sourceSpotifyTrackId: text("source_spotify_track_id"),
  position: integer("position"),
  syncedAt: bigint("synced_at", { mode: "number" }).notNull(),
}, (table) => ({
  playlistVideoUnique: uniqueIndex("playlist_videos_user_playlist_video_uidx").on(
    table.userId,
    table.playlistId,
    table.videoId,
  ),
  playlistIdx: index("playlist_videos_user_playlist_idx").on(table.userId, table.playlistId),
}));

export const syncRuns = pgTable("sync_runs", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  trigger: text("trigger").notNull(),
  status: text("status").notNull(),
  phase: text("phase"),
  statusMessage: text("status_message"),
  startedAt: bigint("started_at", { mode: "number" }).notNull(),
  finishedAt: bigint("finished_at", { mode: "number" }),
  totalTracks: integer("total_tracks"),
  completedTracks: integer("completed_tracks"),
  remainingTracks: integer("remaining_tracks"),
  currentSpotifyTrackId: text("current_spotify_track_id"),
  currentTrackName: text("current_track_name"),
  nextRetryAt: bigint("next_retry_at", { mode: "number" }),
  pauseReason: text("pause_reason"),
  lastErrorSummary: text("last_error_summary"),
  lastHeartbeatAt: bigint("last_heartbeat_at", { mode: "number" }),
  updatedAt: bigint("updated_at", { mode: "number" }),
  resumedFromRunId: bigint("resumed_from_run_id", { mode: "number" }),
  spotifyScanOffset: integer("spotify_scan_offset"),
  spotifyScanCompletedAt: bigint("spotify_scan_completed_at", { mode: "number" }),
  playlistSnapshotCompletedAt: bigint("playlist_snapshot_completed_at", { mode: "number" }),
  statsJson: jsonb("stats_json").$type<unknown>(),
  errorSummary: text("error_summary"),
}, (table) => ({
  startedAtIdx: index("sync_runs_user_started_at_idx").on(table.userId, table.startedAt),
  statusIdx: index("sync_runs_user_status_idx").on(table.userId, table.status),
  retryIdx: index("sync_runs_user_next_retry_at_idx").on(table.userId, table.nextRetryAt),
}));

export const syncState = pgTable("sync_state", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  lastStartedSyncAt: bigint("last_started_sync_at", { mode: "number" }),
  lastSuccessfulSyncAt: bigint("last_successful_sync_at", { mode: "number" }),
  lastFailedSyncAt: bigint("last_failed_sync_at", { mode: "number" }),
  activeRunId: bigint("active_run_id", { mode: "number" }),
  lastHeartbeatAt: bigint("last_heartbeat_at", { mode: "number" }),
  spotifyScanOffset: integer("spotify_scan_offset"),
  lastError: text("last_error"),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});

export const syncRunTracks = pgTable("sync_run_tracks", {
  id: uuid("id").primaryKey().$defaultFn(() => randomUUID()),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  syncRunId: bigint("sync_run_id", { mode: "number" }).notNull().references(() => syncRuns.id, { onDelete: "cascade" }),
  spotifyTrackId: text("spotify_track_id").notNull(),
  trackOrder: integer("track_order").notNull(),
  status: text("status").notNull(),
  statusMessage: text("status_message"),
  trackName: text("track_name").notNull(),
  artistNamesJson: text("artist_names_json").notNull(),
  albumName: text("album_name"),
  albumReleaseDate: text("album_release_date"),
  durationMs: integer("duration_ms").notNull(),
  isrc: text("isrc"),
  externalUrl: text("external_url"),
  spotifyAddedAt: bigint("spotify_added_at", { mode: "number" }).notNull(),
  manualVideoId: text("manual_video_id"),
  manualResolutionType: text("manual_resolution_type"),
  matchedVideoId: text("matched_video_id"),
  matchedVideoTitle: text("matched_video_title"),
  matchedChannelTitle: text("matched_channel_title"),
  matchedScore: integer("matched_score"),
  matchedSource: text("matched_source"),
  reviewVideoId: text("review_video_id"),
  reviewVideoTitle: text("review_video_title"),
  reviewChannelTitle: text("review_channel_title"),
  reviewVideoUrl: text("review_video_url"),
  reviewSource: text("review_source"),
  reviewScore: integer("review_score"),
  reviewReasonsJson: text("review_reasons_json"),
  playlistItemId: text("playlist_item_id"),
  attemptCount: integer("attempt_count").notNull(),
  lastError: text("last_error"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
}, (table) => ({
  runTrackUnique: uniqueIndex("sync_run_tracks_user_run_track_uidx").on(
    table.userId,
    table.syncRunId,
    table.spotifyTrackId,
  ),
  runOrderIdx: index("sync_run_tracks_user_run_order_idx").on(table.userId, table.syncRunId, table.trackOrder),
  runStatusIdx: index("sync_run_tracks_user_run_status_idx").on(table.userId, table.syncRunId, table.status),
}));

export const syncRunEvents = pgTable("sync_run_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  syncRunId: bigint("sync_run_id", { mode: "number" }).notNull().references(() => syncRuns.id, { onDelete: "cascade" }),
  level: text("level").notNull(),
  stage: text("stage").notNull(),
  message: text("message").notNull(),
  spotifyTrackId: text("spotify_track_id"),
  payloadJson: jsonb("payload_json").$type<unknown>(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
}, (table) => ({
  runCreatedIdx: index("sync_run_events_user_run_created_idx").on(table.userId, table.syncRunId, table.createdAt),
}));

export const syncLock = pgTable("sync_lock", {
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  lockName: text("lock_name").notNull(),
  holder: text("holder"),
  lockedUntil: bigint("locked_until", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
}, (table) => ({
  pk: primaryKey({ name: "sync_lock_pkey", columns: [table.userId, table.lockName] }),
}));
