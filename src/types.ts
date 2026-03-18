export type Provider = "spotify" | "youtube";
export type Language = "ko" | "en";
export type TrackSearchStatus =
  | "pending"
  | "matched_auto"
  | "review_required"
  | "matched_manual"
  | "no_match"
  | "failed";
export type ManualResolutionType = "recommended" | "manual_input";

export type SyncRunLifecycleStatus =
  | "queued"
  | "running"
  | "waiting_for_youtube_quota"
  | "waiting_for_spotify_retry"
  | "needs_reauth"
  | "partially_completed"
  | "completed"
  | "failed";

export type SyncRunPhase =
  | "queued"
  | "scanning_spotify"
  | "loading_youtube_playlist"
  | "processing_tracks"
  | "paused"
  | "completed"
  | "failed";

export type SyncRunTrackStatus =
  | "discovered"
  | "searching"
  | "matched"
  | "review_required"
  | "ready_to_insert"
  | "inserting"
  | "inserted"
  | "skipped_existing"
  | "waiting_for_youtube_quota"
  | "waiting_for_spotify_retry"
  | "needs_reauth"
  | "no_match"
  | "failed";

export type SyncEventLevel = "info" | "warn" | "error";

export interface SyncRunStats {
  scannedSpotifyTracks: number;
  newlySeenTracks: number;
  removedFromSpotify: number;
  playlistItemsSeen: number;
  queuedTracks: number;
  insertedTracks: number;
  skippedAlreadyInPlaylist: number;
  reusedCachedMatches: number;
  manualOverridesApplied: number;
  reviewRequiredCount: number;
  noMatchCount: number;
  failedCount: number;
  quotaAbort: boolean;
}

export interface LibrarySummary {
  totalTracks: number;
  syncedTracks: number;
  pendingTracks: number;
  reviewRequiredTracks: number;
  failedTracks: number;
  noMatchTracks: number;
  manualMatchTracks: number;
}

export interface RunSummary {
  totalTracks: number;
  completedTracks: number;
  remainingTracks: number;
  skippedExistingTracks: number;
  insertedTracks: number;
  reviewRequiredTracks: number;
  failedTracks: number;
  noMatchTracks: number;
  waitingTracks: number;
  scopedTotalTracks: number | null;
  scopedCompletedTracks: number | null;
  scopedRemainingTracks: number | null;
  baselineReady: boolean;
}

export interface SyncProgressSnapshot {
  totalTracks: number;
  completedTracks: number;
  remainingTracks: number;
  currentSpotifyTrackId: string | null;
  currentTrackName: string | null;
}

export interface SpotifyTrack {
  spotifyTrackId: string;
  name: string;
  artistNames: string[];
  albumName: string;
  albumReleaseDate: string | null;
  durationMs: number;
  isrc: string | null;
  addedAt: number;
  externalUrl: string | null;
}

export interface SearchCandidate {
  videoId: string;
  title: string;
  channelTitle: string;
  description?: string | undefined;
  durationSeconds?: number | undefined;
  publishedAt?: string | undefined;
  isEmbeddable?: boolean | undefined;
  isSyndicated?: boolean | undefined;
  source: "ytsr" | "youtube_api" | "manual";
  url: string;
}

export interface MatchResult {
  candidate: SearchCandidate;
  score: number;
  reasons: string[];
}

export type MatchDisposition = "matched_auto" | "review_required" | "no_match";

export interface MatchDecision {
  disposition: MatchDisposition;
  best: MatchResult | null;
  all: MatchResult[];
}

export type SyncStats = SyncRunStats;

export interface SyncRunResult {
  runId: number;
  status: SyncRunLifecycleStatus;
  stats: SyncStats;
  error?: string;
  disposition?: "started" | "resumed" | "already_running";
}

export type PlaylistComparisonBucket = "spotify_only" | "youtube_only" | "in_both";

export type PlaylistComparisonReasonCode =
  | "pending_sync"
  | "review_required"
  | "no_match"
  | "failed"
  | "waiting_for_youtube_quota"
  | "waiting_for_spotify_retry"
  | "needs_reauth"
  | "mapped_not_in_playlist"
  | "previously_synced_missing_now"
  | "source_removed_from_spotify"
  | "unmanaged_or_added_outside_app"
  | "manual_match_in_playlist"
  | "automatic_match_in_playlist";

export interface PlaylistComparisonReasonSummary {
  reasonCode: PlaylistComparisonReasonCode;
  count: number;
}

export interface PlaylistComparisonMeta {
  playlistId: string | null;
  spotifyBasis: string;
  youtubeBasis: string;
  lastPlaylistSnapshotAt: number | null;
  canRefresh: boolean;
  refreshBlockedReason: string | null;
  activeRunId: number | null;
  activeRunStatus: SyncRunLifecycleStatus | null;
}

export interface PlaylistComparisonSummary {
  spotifyTotal: number;
  youtubeTotal: number;
  inBoth: number;
  spotifyOnly: number;
  youtubeOnly: number;
  countDelta: number;
  reflectedCount: number;
  spotifyOnlyReasons: PlaylistComparisonReasonSummary[];
  youtubeOnlyReasons: PlaylistComparisonReasonSummary[];
}

export interface PlaylistComparisonItem {
  bucket: PlaylistComparisonBucket;
  reasonCode: PlaylistComparisonReasonCode;
  status: SyncRunTrackStatus | TrackSearchStatus | "synced" | null;
  statusMessage: string | null;
  spotifyTrackId: string | null;
  spotifyTrackName: string | null;
  spotifyArtistNames: string[];
  spotifyAlbumName: string | null;
  spotifyAddedAt: number | null;
  spotifyRemovedAt: number | null;
  targetVideoId: string | null;
  targetVideoTitle: string | null;
  targetChannelTitle: string | null;
  reviewVideoId: string | null;
  reviewVideoTitle: string | null;
  reviewChannelTitle: string | null;
  playlistVideoId: string | null;
  playlistVideoTitle: string | null;
  playlistChannelTitle: string | null;
  playlistItemId: string | null;
  playlistPosition: number | null;
  matchSource: "manual" | "automatic" | null;
  manualResolutionType: ManualResolutionType | null;
  searchStatus: TrackSearchStatus | null;
  lastSyncedAt: number | null;
  lastError: string | null;
  detail: string | null;
}

export interface PlaylistComparisonBucketPage {
  bucket: PlaylistComparisonBucket;
  page: number;
  pageSize: number;
  total: number;
  items: PlaylistComparisonItem[];
}

export interface PlaylistComparisonResult {
  meta: PlaylistComparisonMeta;
  summary: PlaylistComparisonSummary;
  bucketPage: PlaylistComparisonBucketPage;
}
