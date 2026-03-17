import { randomUUID } from "node:crypto";

import {
  AppError,
  ExternalApiError,
  QuotaExceededError,
  ReauthRequiredError,
} from "../../lib/errors.js";
import type { AppConfig } from "../../config.js";
import type { AppStore } from "../../db/store.js";
import type { SyncRunLifecycleStatus, SyncRunResult, SyncRunTrackStatus, SyncStats } from "../../types.js";
import { YouTubeSearchService } from "../../providers/search/youtube-search.js";
import { OAuthService } from "../oauth-service.js";
import { QuotaService } from "../quota-service.js";

const TERMINAL_TRACK_STATUSES: SyncRunTrackStatus[] = [
  "inserted",
  "skipped_existing",
  "review_required",
  "no_match",
  "failed",
  "needs_reauth",
];
const SPOTIFY_RETRY_BACKOFF_MS = [30_000, 60_000, 120_000, 300_000, 600_000, 900_000];

export class SyncService {
  constructor(
    private readonly config: AppConfig,
    private readonly store: AppStore,
    private readonly oauthService: OAuthService,
    private readonly quotaService: QuotaService,
    private readonly youtubeSearchService: YouTubeSearchService,
  ) {}

  async run(trigger: string): Promise<SyncRunResult> {
    const result = await this.runWithLock(trigger, false);
    if (!result) {
      throw new AppError("Sync did not produce a result", 500);
    }
    return result;
  }

  async resumeDueRuns(trigger = "schedule"): Promise<SyncRunResult | null> {
    return this.runWithLock(trigger, true);
  }

  private async runWithLock(trigger: string, resumeOnly: boolean): Promise<SyncRunResult | null> {
    const holder = randomUUID();
    const acquired = await this.store.acquireLock("hourly-sync", holder, this.config.syncLockTtlMs);

    if (!acquired) {
      if (resumeOnly) {
        return null;
      }
      throw new AppError("Sync is already running", 409);
    }

    let runId = 0;
    let currentSpotifyTrackId: string | null = null;
    let currentTrackName: string | null = null;
    let stats = createEmptyStats();

    try {
      const resumableRun = await this.store.findResumableSyncRun();
      if (!resumableRun && resumeOnly) {
        return null;
      }

      if (resumableRun) {
        runId = resumableRun.id;
        stats = readStats(resumableRun.statsJson);
        await this.store.markSyncRunRunning(
          runId,
          resumableRun.spotifyScanCompletedAt ? "loading_youtube_playlist" : "scanning_spotify",
          "Resuming paused sync run",
        );
        await this.store.appendSyncRunEvent({
          syncRunId: runId,
          level: "info",
          stage: "resume",
          message: `${trigger} resumed the paused sync run`,
        });
      } else {
        runId = await this.store.createSyncRun(trigger);
        await this.store.appendSyncRunEvent({
          syncRunId: runId,
          level: "info",
          stage: "start",
          message: `${trigger} started a new sync run`,
        });
      }

      const scanResult = await this.scanSpotify(runId, stats);
      stats.scannedSpotifyTracks = scanResult.scannedSpotifyTracks;
      stats.newlySeenTracks = scanResult.newlySeenTracks;
      stats.removedFromSpotify = scanResult.removedFromSpotify;
      await this.store.saveSyncRunStats(runId, stats);

      const youtubeToken = await this.oauthService.getValidAccessToken("youtube");
      const playlistId = await this.resolvePlaylistId(runId, youtubeToken);
      const playlistMap = await this.loadPlaylistSnapshot(runId, youtubeToken, playlistId, stats);
      await this.processTracks(runId, youtubeToken, playlistId, playlistMap, stats, (value) => {
        currentSpotifyTrackId = value?.spotifyTrackId ?? null;
        currentTrackName = value?.trackName ?? null;
      });

      await this.store.refreshSyncRunProgress(runId);
      stats = await this.buildRunStats(runId, stats);
      const finalStatus = determineFinalRunStatus(stats);
      await this.store.finishSyncRun(runId, finalStatus, stats);
      await this.store.appendSyncRunEvent({
        syncRunId: runId,
        level: "info",
        stage: "complete",
        message:
          finalStatus === "partially_completed"
            ? "Automatic processing finished, but some tracks still need review."
            : "Sync completed successfully.",
      });

      return {
        runId,
        status: finalStatus,
        stats,
      };
    } catch (error) {
      const pauseResult = await this.tryPauseRun(
        runId,
        error,
        currentSpotifyTrackId ? { spotifyTrackId: currentSpotifyTrackId, trackName: currentTrackName ?? "" } : null,
        stats,
      );
      if (pauseResult) {
        return pauseResult;
      }

      const message = error instanceof Error ? error.message : String(error);
      if (runId) {
        stats = await this.buildRunStats(runId, stats);
        await this.store.finishSyncRun(runId, "failed", stats, message);
        await this.store.appendSyncRunEvent({
          syncRunId: runId,
          level: "error",
          stage: "failed",
          message,
          spotifyTrackId: currentSpotifyTrackId,
        });
      }

      throw error;
    } finally {
      await this.store.releaseLock("hourly-sync", holder);
    }
  }

  private async scanSpotify(runId: number, stats: SyncStats) {
    const run = await this.store.getSyncRun(runId);
    if (run?.spotifyScanCompletedAt) {
      const refreshed = await this.store.refreshSyncRunProgress(runId);
      return {
        scannedSpotifyTracks: refreshed.totalTracks,
        newlySeenTracks: stats.newlySeenTracks,
        removedFromSpotify: stats.removedFromSpotify,
      };
    }

    const spotifyToken = await this.oauthService.getValidAccessToken("spotify");
    const spotifyClient = this.oauthService.getSpotifyClient();
    let offset = run?.spotifyScanOffset ?? 0;
    let total = run?.totalTracks ?? 0;

    await this.store.updateSyncRun(runId, {
      status: "running",
      phase: "scanning_spotify",
      statusMessage: "Reading liked tracks from Spotify",
      spotifyScanOffset: offset,
    });

    if (typeof spotifyClient.getSavedTracksPage !== "function") {
      const tracks = await spotifyClient.getAllSavedTracks(spotifyToken);
      total = tracks.length;

      for (const [index, track] of tracks.entries()) {
        const saved = await this.store.upsertSyncRunTrackFromSpotify({
          syncRunId: runId,
          track,
          trackOrder: index,
        });
        if (saved.isNewTrack) {
          stats.newlySeenTracks += 1;
        }
      }

      await this.store.updateSyncRun(runId, {
        phase: "scanning_spotify",
        statusMessage: `Discovered Spotify tracks ${total}/${total}`,
        progress: {
          totalTracks: total,
          completedTracks: 0,
          remainingTracks: total,
        },
        spotifyScanOffset: total,
      });
      const finalized = await this.store.finalizeSpotifyRunSnapshot(runId);
      stats.removedFromSpotify = finalized.removedFromSpotify;
      return {
        scannedSpotifyTracks: finalized.scannedSpotifyTracks,
        newlySeenTracks: stats.newlySeenTracks,
        removedFromSpotify: finalized.removedFromSpotify,
      };
    }

    while (true) {
      const page = await spotifyClient.getSavedTracksPage(spotifyToken, offset, this.config.SPOTIFY_PAGE_SIZE);
      total = page.total;

      for (const [index, track] of page.items.entries()) {
        const saved = await this.store.upsertSyncRunTrackFromSpotify({
          syncRunId: runId,
          track,
          trackOrder: offset + index,
        });
        if (saved.isNewTrack) {
          stats.newlySeenTracks += 1;
        }
      }

      offset += page.items.length;
      await this.store.updateSyncRun(runId, {
        phase: "scanning_spotify",
        statusMessage: `Discovered Spotify tracks ${offset}/${total}`,
        progress: {
          totalTracks: total,
          completedTracks: 0,
          remainingTracks: total,
        },
        spotifyScanOffset: offset,
      });
      await this.store.appendSyncRunEvent({
        syncRunId: runId,
        level: "info",
        stage: "spotify_scan",
        message: `Imported Spotify page (${offset}/${total})`,
        payload: { offset, total, pageSize: page.items.length },
      });

      if (!page.nextOffset) {
        break;
      }
    }

    const finalized = await this.store.finalizeSpotifyRunSnapshot(runId);
    stats.removedFromSpotify = finalized.removedFromSpotify;
    await this.store.appendSyncRunEvent({
      syncRunId: runId,
      level: "info",
      stage: "spotify_scan",
      message: `Spotify scan completed with ${finalized.scannedSpotifyTracks} tracks`,
      payload: finalized,
    });

    return {
      scannedSpotifyTracks: finalized.scannedSpotifyTracks,
      newlySeenTracks: stats.newlySeenTracks,
      removedFromSpotify: finalized.removedFromSpotify,
    };
  }

  private async loadPlaylistSnapshot(
    runId: number,
    youtubeToken: string,
    playlistId: string,
    stats: SyncStats,
  ) {
    await this.store.updateSyncRun(runId, {
      status: "running",
      phase: "loading_youtube_playlist",
      statusMessage: "Refreshing current YouTube playlist contents",
    });

    const playlistItems = await this.oauthService.getYouTubeClient().listPlaylistItems(youtubeToken, playlistId);
    await this.quotaService.charge(Math.max(1, Math.ceil(playlistItems.length / 50)));
    await this.store.replacePlaylistVideos(playlistId, playlistItems);
    stats.playlistItemsSeen = playlistItems.length;

    await this.store.updateSyncRun(runId, {
      playlistSnapshotCompletedAt: Date.now(),
      statusMessage: `Loaded ${playlistItems.length} YouTube playlist items`,
    });

    return new Map(playlistItems.map((item) => [item.videoId, item]));
  }

  private async processTracks(
    runId: number,
    youtubeToken: string,
    playlistId: string,
    playlistMap: Map<string, {
      playlistItemId: string;
      videoId: string;
      videoTitle: string | null;
      channelTitle: string | null;
      position: number | null;
    }>,
    stats: SyncStats,
    setCurrentTrack: (track: { spotifyTrackId: string; trackName: string } | null) => void,
  ) {
    const tracks = await this.store.listProcessableSyncRunTracks(runId);

    for (const track of tracks) {
      if (TERMINAL_TRACK_STATUSES.includes(track.status as SyncRunTrackStatus)) {
        continue;
      }

      const trackContext = {
        spotifyTrackId: track.spotifyTrackId,
        trackName: track.trackName,
      };
      setCurrentTrack(trackContext);
      await this.store.updateSyncRun(runId, {
        status: "running",
        phase: "processing_tracks",
        statusMessage: `Processing ${track.trackName}`,
        progress: {
          currentSpotifyTrackId: track.spotifyTrackId,
          currentTrackName: track.trackName,
        },
      });

      const artistNames = JSON.parse(track.artistNamesJson) as string[];
      const manualVideoId = track.manualVideoId;
      const matchedVideoId = track.matchedVideoId ?? null;
      let targetVideoId = manualVideoId ?? matchedVideoId;

      if (track.status === "inserting" && targetVideoId && playlistMap.has(targetVideoId)) {
        const existingItemId = playlistMap.get(targetVideoId)?.playlistItemId ?? null;
        await this.store.markTrackInserted(track.spotifyTrackId, existingItemId);
        await this.store.updateSyncRunTrack(runId, track.spotifyTrackId, {
          status: "inserted",
          statusMessage: "Recovered inserted state after restart",
          playlistItemId: existingItemId,
          lastError: null,
        });
        stats.skippedAlreadyInPlaylist += 1;
        continue;
      }

      if (targetVideoId && playlistMap.has(targetVideoId)) {
        const existingItemId = playlistMap.get(targetVideoId)?.playlistItemId ?? null;
        await this.store.markTrackInserted(track.spotifyTrackId, existingItemId);
        await this.store.updateSyncRunTrack(runId, track.spotifyTrackId, {
          status: "skipped_existing",
          statusMessage: "Video already exists in playlist",
          playlistItemId: existingItemId,
          lastError: null,
        });
        stats.skippedAlreadyInPlaylist += 1;
        continue;
      }

      stats.queuedTracks += 1;

      try {
        if (manualVideoId) {
          stats.manualOverridesApplied += 1;
          await this.store.updateSyncRunTrack(runId, track.spotifyTrackId, {
            status: "ready_to_insert",
            statusMessage: "Using manual mapping",
            matchedVideoId: manualVideoId,
            matchedVideoTitle: track.matchedVideoTitle,
            matchedChannelTitle: track.matchedChannelTitle,
            matchedSource: track.matchedSource ?? "manual",
          });
        } else if (matchedVideoId) {
          stats.reusedCachedMatches += 1;
          await this.store.updateSyncRunTrack(runId, track.spotifyTrackId, {
            status: "ready_to_insert",
            statusMessage: "Reusing cached YouTube match",
          });
        } else {
          await this.store.updateSyncRunTrack(runId, track.spotifyTrackId, {
            status: "searching",
            statusMessage: "Searching YouTube candidates",
            incrementAttemptCount: true,
          });

          const decision = await this.youtubeSearchService.findBestMatch({
            spotifyTrackId: track.spotifyTrackId,
            trackName: track.trackName,
            artistNames,
            albumName: track.albumName,
            durationMs: track.durationMs,
          });

          if (decision.disposition === "no_match" || !decision.best) {
            const message = "No suitable YouTube candidate found";
            await this.store.markTrackSearchFailure(track.spotifyTrackId, "no_match", message);
            await this.store.updateSyncRunTrack(runId, track.spotifyTrackId, {
              status: "no_match",
              statusMessage: "No automatic match found",
              lastError: message,
            });
            stats.noMatchCount += 1;
            continue;
          }

          if (decision.disposition === "review_required") {
            await this.store.saveReviewCandidate(track.spotifyTrackId, decision.best);
            await this.store.updateSyncRunTrack(runId, track.spotifyTrackId, {
              status: "review_required",
              statusMessage: "Low-confidence candidate requires review",
              reviewVideoId: decision.best.candidate.videoId,
              reviewVideoTitle: decision.best.candidate.title,
              reviewChannelTitle: decision.best.candidate.channelTitle,
              reviewVideoUrl: decision.best.candidate.url,
              reviewSource: decision.best.candidate.source,
              reviewScore: Math.round(decision.best.score),
              reviewReasonsJson: JSON.stringify(decision.best.reasons),
              lastError: null,
            });
            stats.reviewRequiredCount += 1;
            continue;
          }

          await this.store.saveMatchResult(track.spotifyTrackId, decision.best);
          targetVideoId = decision.best.candidate.videoId;
          await this.store.updateSyncRunTrack(runId, track.spotifyTrackId, {
            status: "ready_to_insert",
            statusMessage: "Automatic match found",
            matchedVideoId: decision.best.candidate.videoId,
            matchedVideoTitle: decision.best.candidate.title,
            matchedChannelTitle: decision.best.candidate.channelTitle,
            matchedSource: decision.best.candidate.source,
            matchedScore: Math.round(decision.best.score),
            lastError: null,
          });
        }

        if (!targetVideoId) {
          const message = "Unable to determine a YouTube video ID";
          await this.store.markTrackSearchFailure(track.spotifyTrackId, "failed", message);
          await this.store.updateSyncRunTrack(runId, track.spotifyTrackId, {
            status: "failed",
            statusMessage: "Could not determine insert target",
            lastError: message,
          });
          stats.failedCount += 1;
          continue;
        }

        if (!(await this.quotaService.hasRoom(50))) {
          throw new QuotaExceededError("Not enough YouTube quota remaining for playlist insertion");
        }

        await this.store.updateSyncRunTrack(runId, track.spotifyTrackId, {
          status: "inserting",
          statusMessage: "Inserting track into YouTube playlist",
          matchedVideoId: targetVideoId,
          lastError: null,
        });

        const playlistItemId = await this.oauthService
          .getYouTubeClient()
          .insertPlaylistItem(youtubeToken, playlistId, targetVideoId);
        await this.quotaService.charge(50);
        playlistMap.set(targetVideoId, {
          playlistItemId,
          videoId: targetVideoId,
          videoTitle: track.matchedVideoTitle,
          channelTitle: track.matchedChannelTitle,
          position: null,
        });
        await this.store.markTrackInserted(track.spotifyTrackId, playlistItemId);
        await this.store.updateSyncRunTrack(runId, track.spotifyTrackId, {
          status: "inserted",
          statusMessage: "Inserted into YouTube playlist",
          playlistItemId,
          lastError: null,
        });
        stats.insertedTracks += 1;
        await this.store.refreshSyncRunProgress(runId);
      } catch (error) {
        const paused = await this.pauseTrackIfNeeded(runId, track.spotifyTrackId, error);
        if (paused) {
          throw error;
        }

        const message = error instanceof Error ? error.message : String(error);
        await this.store.markTrackSearchFailure(track.spotifyTrackId, "failed", message);
        await this.store.updateSyncRunTrack(runId, track.spotifyTrackId, {
          status: "failed",
          statusMessage: "Track processing failed",
          lastError: message,
        });
        stats.failedCount += 1;
      } finally {
        await this.store.saveSyncRunStats(runId, stats);
      }
    }

    setCurrentTrack(null);
    await this.store.updateSyncRun(runId, {
      progress: {
        currentSpotifyTrackId: null,
        currentTrackName: null,
      },
    });
  }

  private async pauseTrackIfNeeded(runId: number, spotifyTrackId: string, error: unknown) {
    if (error instanceof QuotaExceededError) {
      await this.store.updateSyncRunTrack(runId, spotifyTrackId, {
        status: "waiting_for_youtube_quota",
        statusMessage: "Waiting for YouTube quota",
        lastError: error.message,
      });
      return true;
    }

    if (error instanceof ReauthRequiredError) {
      await this.store.updateSyncRunTrack(runId, spotifyTrackId, {
        status: "needs_reauth",
        statusMessage: `${error.provider} reconnection required`,
        lastError: error.message,
      });
      return true;
    }

    if (isRetryableSpotifyError(error)) {
      await this.store.updateSyncRunTrack(runId, spotifyTrackId, {
        status: "waiting_for_spotify_retry",
        statusMessage: "Waiting for Spotify retry",
        lastError: error instanceof Error ? error.message : String(error),
      });
      return true;
    }

    return false;
  }

  private async tryPauseRun(
    runId: number,
    error: unknown,
    currentTrack: { spotifyTrackId: string; trackName: string } | null,
    stats: SyncStats,
  ): Promise<SyncRunResult | null> {
    if (!runId) {
      return null;
    }

    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof QuotaExceededError) {
      stats.quotaAbort = true;
      const reasonCode = error.reasonCode?.toLowerCase();
      const nextRetryAt =
        reasonCode === "dailylimitexceeded" ||
        reasonCode === "quotaexceeded" ||
        !error.retryAfterSeconds
          ? this.quotaService.getNextResetAt()
          : Date.now() + error.retryAfterSeconds * 1000;

      await this.store.pauseSyncRun(runId, "waiting_for_youtube_quota", {
        phase: "paused",
        statusMessage: "Paused until YouTube quota is available again",
        nextRetryAt,
        pauseReason: error.reasonCode ?? "youtube_quota",
        errorSummary: message,
        currentSpotifyTrackId: currentTrack?.spotifyTrackId ?? null,
        currentTrackName: currentTrack?.trackName ?? null,
      });
      await this.store.saveSyncRunStats(runId, stats);
      await this.store.appendSyncRunEvent({
        syncRunId: runId,
        level: "warn",
        stage: "pause",
        message: "Paused due to YouTube quota",
        spotifyTrackId: currentTrack?.spotifyTrackId ?? null,
        payload: {
          nextRetryAt,
          reasonCode: error.reasonCode ?? null,
        },
      });
      const pausedStats = await this.buildRunStats(runId, stats);
      return {
        runId,
        status: "waiting_for_youtube_quota",
        stats: pausedStats,
        error: message,
      };
    }

    if (error instanceof ReauthRequiredError) {
      await this.store.pauseSyncRun(runId, "needs_reauth", {
        phase: "paused",
        statusMessage: `${error.provider} needs to be reconnected`,
        pauseReason: error.provider,
        errorSummary: message,
        currentSpotifyTrackId: currentTrack?.spotifyTrackId ?? null,
        currentTrackName: currentTrack?.trackName ?? null,
      });
      await this.store.saveSyncRunStats(runId, stats);
      await this.store.appendSyncRunEvent({
        syncRunId: runId,
        level: "error",
        stage: "pause",
        message: `${error.provider} reauthentication required`,
        spotifyTrackId: currentTrack?.spotifyTrackId ?? null,
      });
      const pausedStats = await this.buildRunStats(runId, stats);
      return {
        runId,
        status: "needs_reauth",
        stats: pausedStats,
        error: message,
      };
    }

    if (isRetryableSpotifyError(error)) {
      const nextRetryAt = calculateSpotifyRetryAt(error, stats.failedCount);
      await this.store.pauseSyncRun(runId, "waiting_for_spotify_retry", {
        phase: "paused",
        statusMessage: "Paused until Spotify retry window opens",
        nextRetryAt,
        pauseReason: getReasonCode(error) ?? "spotify_retry",
        errorSummary: message,
        currentSpotifyTrackId: currentTrack?.spotifyTrackId ?? null,
        currentTrackName: currentTrack?.trackName ?? null,
      });
      await this.store.saveSyncRunStats(runId, stats);
      await this.store.appendSyncRunEvent({
        syncRunId: runId,
        level: "warn",
        stage: "pause",
        message: "Paused due to Spotify retryable error",
        spotifyTrackId: currentTrack?.spotifyTrackId ?? null,
        payload: {
          nextRetryAt,
          reasonCode: getReasonCode(error),
        },
      });
      const pausedStats = await this.buildRunStats(runId, stats);
      return {
        runId,
        status: "waiting_for_spotify_retry",
        stats: pausedStats,
        error: message,
      };
    }

    return null;
  }

  private async buildRunStats(runId: number, fallback: SyncStats) {
    const tracks = await this.store.listAllSyncRunTracks(runId);
    const next = {
      ...fallback,
      scannedSpotifyTracks: tracks.length,
      reviewRequiredCount: tracks.filter((track: any) => track.status === "review_required").length,
      noMatchCount: tracks.filter((track: any) => track.status === "no_match").length,
      failedCount: tracks.filter((track: any) => track.status === "failed").length,
      insertedTracks: tracks.filter((track: any) => track.status === "inserted").length,
      skippedAlreadyInPlaylist: tracks.filter((track: any) => track.status === "skipped_existing").length,
      manualOverridesApplied: tracks.filter((track: any) => Boolean(track.manualVideoId)).length,
      reusedCachedMatches: tracks.filter((track: any) =>
        track.status === "ready_to_insert" && Boolean(track.matchedVideoId) && !track.manualVideoId
      ).length,
      queuedTracks: tracks.filter((track: any) =>
        !TERMINAL_TRACK_STATUSES.includes(track.status as SyncRunTrackStatus)
      ).length,
    };

    await this.store.saveSyncRunStats(runId, next);
    return next;
  }

  private async resolvePlaylistId(runId: number, youtubeToken: string) {
    const configuredPlaylistId = this.config.YOUTUBE_PLAYLIST_ID ?? await this.store.getManagedPlaylistId();
    if (configuredPlaylistId) {
      if (!this.config.YOUTUBE_PLAYLIST_ID) {
        await this.store.saveManagedPlaylistId(configuredPlaylistId);
      }
      return configuredPlaylistId;
    }

    if (!(await this.quotaService.hasRoom(50))) {
      throw new QuotaExceededError("Not enough YouTube quota remaining to create the playlist");
    }

    await this.store.updateSyncRun(runId, {
      phase: "loading_youtube_playlist",
      statusMessage: "Creating the managed YouTube playlist",
    });

    const playlistId = await this.oauthService.getYouTubeClient().createPlaylist(
      youtubeToken,
      this.config.YOUTUBE_PLAYLIST_TITLE,
      this.config.YOUTUBE_PLAYLIST_DESCRIPTION,
      this.config.YOUTUBE_PLAYLIST_PRIVACY,
    );
    await this.quotaService.charge(50);
    await this.store.saveManagedPlaylistId(playlistId);
    return playlistId;
  }
}

function createEmptyStats(): SyncStats {
  return {
    scannedSpotifyTracks: 0,
    newlySeenTracks: 0,
    removedFromSpotify: 0,
    playlistItemsSeen: 0,
    queuedTracks: 0,
    insertedTracks: 0,
    skippedAlreadyInPlaylist: 0,
    reusedCachedMatches: 0,
    manualOverridesApplied: 0,
    reviewRequiredCount: 0,
    noMatchCount: 0,
    failedCount: 0,
    quotaAbort: false,
  };
}

function readStats(raw: unknown): SyncStats {
  if (!raw || typeof raw !== "object") {
    return createEmptyStats();
  }

  return {
    ...createEmptyStats(),
    ...(raw as Partial<SyncStats>),
  };
}

function determineFinalRunStatus(stats: SyncStats): SyncRunLifecycleStatus {
  if (stats.reviewRequiredCount > 0 || stats.noMatchCount > 0 || stats.failedCount > 0) {
    return "partially_completed";
  }

  return "completed";
}

function isRetryableSpotifyError(error: unknown) {
  if (!(error instanceof ExternalApiError) || error.provider !== "spotify") {
    return false;
  }

  return error.status === 429 || error.status === 408 || !error.status || error.status >= 500;
}

function calculateSpotifyRetryAt(error: unknown, failedCount: number) {
  if (error instanceof ExternalApiError && error.retryAfterSeconds) {
    return Date.now() + error.retryAfterSeconds * 1000;
  }

  const index = Math.min(
    SPOTIFY_RETRY_BACKOFF_MS.length - 1,
    Math.max(0, failedCount),
  );
  return Date.now() + SPOTIFY_RETRY_BACKOFF_MS[index]!;
}

function getReasonCode(error: unknown) {
  if (error instanceof ExternalApiError) {
    return error.reasonCode;
  }

  if (error instanceof QuotaExceededError) {
    return error.reasonCode;
  }

  if (error instanceof ReauthRequiredError) {
    return error.reasonCode;
  }

  return undefined;
}
