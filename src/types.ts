export type Provider = "spotify" | "youtube";

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

export interface SyncStats {
  scannedSpotifyTracks: number;
  newlySeenTracks: number;
  removedFromSpotify: number;
  playlistItemsSeen: number;
  queuedTracks: number;
  insertedTracks: number;
  skippedAlreadyInPlaylist: number;
  reusedCachedMatches: number;
  manualOverridesApplied: number;
  noMatchCount: number;
  failedCount: number;
  quotaAbort: boolean;
}
