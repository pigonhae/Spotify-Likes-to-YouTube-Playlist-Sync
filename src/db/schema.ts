import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const oauthAccounts = sqliteTable("oauth_accounts", {
  provider: text("provider").primaryKey(),
  encryptedAccessToken: text("encrypted_access_token").notNull(),
  encryptedRefreshToken: text("encrypted_refresh_token"),
  tokenExpiresAt: integer("token_expires_at"),
  scope: text("scope"),
  externalUserId: text("external_user_id"),
  externalDisplayName: text("external_display_name"),
  connectedAt: integer("connected_at").notNull(),
  invalidatedAt: integer("invalidated_at"),
  lastRefreshError: text("last_refresh_error"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const oauthStates = sqliteTable(
  "oauth_states",
  {
    state: text("state").primaryKey(),
    provider: text("provider").notNull(),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (table) => ({
    providerIdx: index("oauth_states_provider_idx").on(table.provider),
  }),
);

export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const trackMappings = sqliteTable(
  "track_mappings",
  {
    spotifyTrackId: text("spotify_track_id").primaryKey(),
    spotifyAddedAt: integer("spotify_added_at").notNull(),
    spotifyRemovedAt: integer("spotify_removed_at"),
    trackName: text("track_name").notNull(),
    artistNamesJson: text("artist_names_json").notNull(),
    albumName: text("album_name"),
    albumReleaseDate: text("album_release_date"),
    durationMs: integer("duration_ms").notNull(),
    isrc: text("isrc"),
    externalUrl: text("external_url"),
    manualVideoId: text("manual_video_id"),
    matchedVideoId: text("matched_video_id"),
    matchedVideoTitle: text("matched_video_title"),
    matchedChannelTitle: text("matched_channel_title"),
    matchedScore: integer("matched_score"),
    matchedSource: text("matched_source"),
    searchStatus: text("search_status").notNull(),
    searchAttempts: integer("search_attempts").notNull(),
    lastSearchAt: integer("last_search_at"),
    lastError: text("last_error"),
    playlistVideoId: text("playlist_video_id"),
    lastSyncedAt: integer("last_synced_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => ({
    removedIdx: index("track_mappings_removed_idx").on(table.spotifyRemovedAt),
    statusIdx: index("track_mappings_status_idx").on(table.searchStatus),
    matchedVideoIdx: index("track_mappings_matched_video_idx").on(table.matchedVideoId),
  }),
);

export const playlistVideos = sqliteTable(
  "playlist_videos",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    playlistId: text("playlist_id").notNull(),
    playlistItemId: text("playlist_item_id").notNull(),
    videoId: text("video_id").notNull(),
    videoTitle: text("video_title"),
    channelTitle: text("channel_title"),
    sourceSpotifyTrackId: text("source_spotify_track_id"),
    position: integer("position"),
    syncedAt: integer("synced_at").notNull(),
  },
  (table) => ({
    playlistVideoUnique: uniqueIndex("playlist_videos_playlist_video_uidx").on(
      table.playlistId,
      table.videoId,
    ),
    playlistIdx: index("playlist_videos_playlist_idx").on(table.playlistId),
  }),
);

export const syncRuns = sqliteTable("sync_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  trigger: text("trigger").notNull(),
  status: text("status").notNull(),
  startedAt: integer("started_at").notNull(),
  finishedAt: integer("finished_at"),
  statsJson: text("stats_json"),
  errorSummary: text("error_summary"),
});

export const syncLock = sqliteTable("sync_lock", {
  lockName: text("lock_name").primaryKey(),
  holder: text("holder"),
  lockedUntil: integer("locked_until").notNull(),
  updatedAt: integer("updated_at").notNull(),
});
