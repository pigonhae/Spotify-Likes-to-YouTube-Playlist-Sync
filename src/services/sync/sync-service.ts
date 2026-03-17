import { randomUUID } from "node:crypto";

import { AppError, LowConfidenceMatchError, NoSearchResultsError, QuotaExceededError } from "../../lib/errors.js";
import { YouTubeSearchService } from "../../providers/search/youtube-search.js";
import type { AppConfig } from "../../config.js";
import type { AppStore } from "../../db/store.js";
import { OAuthService } from "../oauth-service.js";
import { QuotaService } from "../quota-service.js";
import type { SyncStats } from "../../types.js";

export class SyncService {
  constructor(
    private readonly config: AppConfig,
    private readonly store: AppStore,
    private readonly oauthService: OAuthService,
    private readonly quotaService: QuotaService,
    private readonly youtubeSearchService: YouTubeSearchService,
  ) {}

  async run(trigger: string) {
    const holder = randomUUID();
    const acquired = this.store.acquireLock("hourly-sync", holder, this.config.syncLockTtlMs);

    if (!acquired) {
      throw new AppError("Sync is already running", 409);
    }

    const runId = this.store.createSyncRun(trigger);
    const stats: SyncStats = {
      scannedSpotifyTracks: 0,
      newlySeenTracks: 0,
      removedFromSpotify: 0,
      playlistItemsSeen: 0,
      queuedTracks: 0,
      insertedTracks: 0,
      skippedAlreadyInPlaylist: 0,
      reusedCachedMatches: 0,
      manualOverridesApplied: 0,
      noMatchCount: 0,
      failedCount: 0,
      quotaAbort: false,
    };

    try {
      const spotifyToken = await this.oauthService.getValidAccessToken("spotify");
      const youtubeToken = await this.oauthService.getValidAccessToken("youtube");

      const spotifyTracks = await this.oauthService.getSpotifyClient().getAllSavedTracks(spotifyToken);
      Object.assign(stats, this.store.saveSpotifySnapshot(spotifyTracks));

      const playlistId = await this.resolvePlaylistId(youtubeToken);
      const playlistItems = await this.oauthService.getYouTubeClient().listPlaylistItems(youtubeToken, playlistId);
      this.quotaService.charge(Math.max(1, Math.ceil(playlistItems.length / 50)));
      this.store.replacePlaylistVideos(playlistId, playlistItems);
      stats.playlistItemsSeen = playlistItems.length;

      const playlistMap = new Map(playlistItems.map((item) => [item.videoId, item]));
      const tracks = this.store.listTracksForSync();

      for (const track of tracks) {
        const manualVideoId = track.manualVideoId;
        const matchedVideoId = track.matchedVideoId;
        const targetVideoId = manualVideoId ?? matchedVideoId;

        if (targetVideoId && playlistMap.has(targetVideoId)) {
          this.store.markTrackInserted(track.spotifyTrackId, playlistMap.get(targetVideoId)?.playlistItemId ?? null);
          stats.skippedAlreadyInPlaylist += 1;
          continue;
        }

        stats.queuedTracks += 1;

        try {
          let videoId = targetVideoId;

          if (manualVideoId) {
            stats.manualOverridesApplied += 1;
          } else if (matchedVideoId) {
            stats.reusedCachedMatches += 1;
          } else {
            const match = await this.youtubeSearchService.findBestMatch({
              spotifyTrackId: track.spotifyTrackId,
              trackName: track.trackName,
              artistNames: JSON.parse(track.artistNamesJson) as string[],
              albumName: track.albumName,
              durationMs: track.durationMs,
            });
            this.store.saveMatchResult(track.spotifyTrackId, match.best);
            videoId = match.best.candidate.videoId;
          }

          if (!videoId) {
            this.store.markTrackSearchFailure(track.spotifyTrackId, "needs_manual", "No target video ID available");
            stats.noMatchCount += 1;
            continue;
          }

          if (!this.quotaService.hasRoom(50)) {
            throw new QuotaExceededError("Not enough YouTube quota remaining for playlist insertion");
          }

          const playlistItemId = await this.oauthService
            .getYouTubeClient()
            .insertPlaylistItem(youtubeToken, playlistId, videoId);
          this.quotaService.charge(50);
          playlistMap.set(videoId, {
            playlistItemId,
            videoId,
            videoTitle: track.matchedVideoTitle,
            channelTitle: track.matchedChannelTitle,
            position: null,
          });
          this.store.markTrackInserted(track.spotifyTrackId, playlistItemId);
          stats.insertedTracks += 1;
        } catch (error) {
          if (error instanceof QuotaExceededError) {
            stats.quotaAbort = true;
            throw error;
          }

          if (error instanceof NoSearchResultsError) {
            this.store.markTrackSearchFailure(track.spotifyTrackId, "no_match", error.message);
            stats.noMatchCount += 1;
            continue;
          }

          if (error instanceof LowConfidenceMatchError) {
            this.store.markTrackSearchFailure(track.spotifyTrackId, "needs_manual", error.message);
            stats.noMatchCount += 1;
            continue;
          }

          const message = error instanceof Error ? error.message : String(error);
          this.store.markTrackSearchFailure(track.spotifyTrackId, "failed", message);
          stats.failedCount += 1;
        }
      }

      this.store.finishSyncRun(runId, stats.quotaAbort ? "quota_exhausted" : "success", stats);
      return {
        runId,
        stats,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = error instanceof QuotaExceededError ? "quota_exhausted" : "failed";
      this.store.finishSyncRun(runId, status, stats, message);
      throw error;
    } finally {
      this.store.releaseLock("hourly-sync", holder);
    }
  }

  private async resolvePlaylistId(youtubeToken: string) {
    const configuredPlaylistId = this.config.YOUTUBE_PLAYLIST_ID ?? this.store.getManagedPlaylistId();
    if (configuredPlaylistId) {
      if (!this.config.YOUTUBE_PLAYLIST_ID) {
        this.store.saveManagedPlaylistId(configuredPlaylistId);
      }
      return configuredPlaylistId;
    }

    if (!this.quotaService.hasRoom(50)) {
      throw new QuotaExceededError("Not enough YouTube quota remaining to create the playlist");
    }

    const playlistId = await this.oauthService.getYouTubeClient().createPlaylist(
      youtubeToken,
      this.config.YOUTUBE_PLAYLIST_TITLE,
      this.config.YOUTUBE_PLAYLIST_DESCRIPTION,
      this.config.YOUTUBE_PLAYLIST_PRIVACY,
    );
    this.quotaService.charge(50);
    this.store.saveManagedPlaylistId(playlistId);
    return playlistId;
  }
}
