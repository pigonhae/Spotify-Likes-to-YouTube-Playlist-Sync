export type Provider = "spotify" | "youtube";
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
}
