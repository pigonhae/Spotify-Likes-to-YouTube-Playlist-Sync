import { randomUUID } from "node:crypto";

import { and, asc, desc, eq, isNull, lt, or, sql } from "drizzle-orm";

import type { MatchResult, Provider, SpotifyTrack } from "../types.js";
import {
  appSettings,
  oauthAccounts,
  oauthStates,
  playlistVideos,
  syncLock,
  syncRuns,
  trackMappings,
} from "./schema.js";
import type { AppDatabase } from "./client.js";

const PLAYLIST_SETTING_KEY = "youtube.playlistId";

export class AppStore {
  constructor(private readonly database: AppDatabase) {}

  get db() {
    return this.database.db;
  }

  cleanupExpiredStates(now = Date.now()) {
    this.db.delete(oauthStates).where(lt(oauthStates.expiresAt, now)).run();
  }

  createOAuthState(provider: Provider, ttlMs = 10 * 60 * 1000) {
    const now = Date.now();
    const state = randomUUID();
    this.db
      .insert(oauthStates)
      .values({
        state,
        provider,
        createdAt: now,
        expiresAt: now + ttlMs,
      })
      .run();
    return state;
  }

  consumeOAuthState(provider: Provider, state: string) {
    const now = Date.now();
    const row =
      this.db
        .select()
        .from(oauthStates)
        .where(and(eq(oauthStates.provider, provider), eq(oauthStates.state, state)))
        .get() ?? null;

    if (!row || row.expiresAt < now) {
      if (row) {
        this.db.delete(oauthStates).where(eq(oauthStates.state, state)).run();
      }
      return false;
    }

    this.db.delete(oauthStates).where(eq(oauthStates.state, state)).run();
    return true;
  }

  getOAuthAccount(provider: Provider) {
    return (
      this.db.select().from(oauthAccounts).where(eq(oauthAccounts.provider, provider)).get() ?? null
    );
  }

  listOAuthAccounts() {
    return this.db.select().from(oauthAccounts).all();
  }

  upsertOAuthAccount(input: {
    provider: Provider;
    encryptedAccessToken: string;
    encryptedRefreshToken: string | null;
    tokenExpiresAt: number | null;
    scope: string | null;
    externalUserId: string | null;
    externalDisplayName: string | null;
    invalidatedAt?: number | null;
    lastRefreshError?: string | null;
  }) {
    const now = Date.now();
    this.db
      .insert(oauthAccounts)
      .values({
        ...input,
        connectedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: oauthAccounts.provider,
        set: {
          encryptedAccessToken: input.encryptedAccessToken,
          encryptedRefreshToken: input.encryptedRefreshToken,
          tokenExpiresAt: input.tokenExpiresAt,
          scope: input.scope,
          externalUserId: input.externalUserId,
          externalDisplayName: input.externalDisplayName,
          connectedAt: now,
          invalidatedAt: input.invalidatedAt ?? null,
          lastRefreshError: input.lastRefreshError ?? null,
          updatedAt: now,
        },
      })
      .run();
  }

  markOAuthAccountInvalid(provider: Provider, message: string) {
    this.db
      .update(oauthAccounts)
      .set({
        invalidatedAt: Date.now(),
        lastRefreshError: message,
        updatedAt: Date.now(),
      })
      .where(eq(oauthAccounts.provider, provider))
      .run();
  }

  saveSetting(key: string, value: string) {
    const now = Date.now();
    this.db
      .insert(appSettings)
      .values({ key, value, updatedAt: now })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value, updatedAt: now },
      })
      .run();
  }

  getSetting(key: string) {
    return this.db.select().from(appSettings).where(eq(appSettings.key, key)).get() ?? null;
  }

  saveManagedPlaylistId(playlistId: string) {
    this.saveSetting(PLAYLIST_SETTING_KEY, playlistId);
  }

  getManagedPlaylistId() {
    return this.getSetting(PLAYLIST_SETTING_KEY)?.value ?? null;
  }

  disconnectSpotifyState() {
    return this.database.sqlite.transaction(() => {
      const deletedAccounts = Number(
        this.db.delete(oauthAccounts).where(eq(oauthAccounts.provider, "spotify")).run().changes ?? 0,
      );
      const deletedStates = Number(
        this.db.delete(oauthStates).where(eq(oauthStates.provider, "spotify")).run().changes ?? 0,
      );

      return {
        deletedAccounts,
        deletedStates,
        alreadyDisconnected: deletedAccounts === 0,
      };
    })();
  }

  disconnectYouTubeState() {
    const now = Date.now();

    return this.database.sqlite.transaction(() => {
      const deletedAccounts = Number(
        this.db.delete(oauthAccounts).where(eq(oauthAccounts.provider, "youtube")).run().changes ?? 0,
      );
      const deletedStates = Number(
        this.db.delete(oauthStates).where(eq(oauthStates.provider, "youtube")).run().changes ?? 0,
      );
      const deletedPlaylistSetting = Number(
        this.db.delete(appSettings).where(eq(appSettings.key, PLAYLIST_SETTING_KEY)).run().changes ?? 0,
      );
      const deletedPlaylistVideos = Number(this.db.delete(playlistVideos).run().changes ?? 0);
      const resetTrackBindings = Number(
        this.db
          .update(trackMappings)
          .set({
            playlistVideoId: null,
            lastSyncedAt: null,
            updatedAt: now,
          })
          .run().changes ?? 0,
      );

      return {
        deletedAccounts,
        deletedStates,
        deletedPlaylistSetting,
        deletedPlaylistVideos,
        resetTrackBindings,
        alreadyDisconnected: deletedAccounts === 0,
      };
    })();
  }

  resetAllProjectState() {
    return this.database.sqlite.transaction(() => {
      const deletedAccounts = Number(this.db.delete(oauthAccounts).run().changes ?? 0);
      const deletedStates = Number(this.db.delete(oauthStates).run().changes ?? 0);
      const deletedSettings = Number(this.db.delete(appSettings).run().changes ?? 0);
      const deletedTrackMappings = Number(this.db.delete(trackMappings).run().changes ?? 0);
      const deletedPlaylistVideos = Number(this.db.delete(playlistVideos).run().changes ?? 0);
      const deletedSyncRuns = Number(this.db.delete(syncRuns).run().changes ?? 0);

      return {
        deletedAccounts,
        deletedStates,
        deletedSettings,
        deletedTrackMappings,
        deletedPlaylistVideos,
        deletedSyncRuns,
      };
    })();
  }

  acquireLock(lockName: string, holder: string, ttlMs: number) {
    const now = Date.now();
    const lockedUntil = now + ttlMs;

    return this.database.sqlite.transaction(() => {
      const existing =
        this.db.select().from(syncLock).where(eq(syncLock.lockName, lockName)).get() ?? null;

      if (!existing) {
        this.db
          .insert(syncLock)
          .values({
            lockName,
            holder,
            lockedUntil,
            updatedAt: now,
          })
          .run();
        return true;
      }

      if (existing.lockedUntil > now && existing.holder !== holder) {
        return false;
      }

      this.db
        .update(syncLock)
        .set({
          holder,
          lockedUntil,
          updatedAt: now,
        })
        .where(eq(syncLock.lockName, lockName))
        .run();

      return true;
    })();
  }

  releaseLock(lockName: string, holder: string) {
    this.db
      .update(syncLock)
      .set({
        holder: null,
        lockedUntil: 0,
        updatedAt: Date.now(),
      })
      .where(and(eq(syncLock.lockName, lockName), eq(syncLock.holder, holder)))
      .run();
  }

  createSyncRun(trigger: string) {
    const now = Date.now();
    const result = this.db
      .insert(syncRuns)
      .values({
        trigger,
        status: "running",
        startedAt: now,
      })
      .run();

    return Number(result.lastInsertRowid);
  }

  finishSyncRun(runId: number, status: string, stats: unknown, errorSummary?: string) {
    this.db
      .update(syncRuns)
      .set({
        status,
        finishedAt: Date.now(),
        statsJson: JSON.stringify(stats),
        errorSummary: errorSummary ?? null,
      })
      .where(eq(syncRuns.id, runId))
      .run();
  }

  listRecentSyncRuns(limit = 10) {
    return this.db.select().from(syncRuns).orderBy(desc(syncRuns.startedAt)).limit(limit).all();
  }

  saveSpotifySnapshot(tracks: SpotifyTrack[]) {
    const now = Date.now();
    const existing = this.db
      .select({
        spotifyTrackId: trackMappings.spotifyTrackId,
        spotifyRemovedAt: trackMappings.spotifyRemovedAt,
      })
      .from(trackMappings)
      .all();
    const existingIds = new Set(existing.map((row) => row.spotifyTrackId));
    const currentIds = new Set(tracks.map((track) => track.spotifyTrackId));
    let newlySeenTracks = 0;
    let removedFromSpotify = 0;

    this.database.sqlite.transaction(() => {
      for (const track of tracks) {
        if (!existingIds.has(track.spotifyTrackId)) {
          newlySeenTracks += 1;
        }

        this.db
          .insert(trackMappings)
          .values({
            spotifyTrackId: track.spotifyTrackId,
            spotifyAddedAt: track.addedAt,
            spotifyRemovedAt: null,
            trackName: track.name,
            artistNamesJson: JSON.stringify(track.artistNames),
            albumName: track.albumName,
            albumReleaseDate: track.albumReleaseDate,
            durationMs: track.durationMs,
            isrc: track.isrc,
            externalUrl: track.externalUrl,
            searchStatus: "pending",
            searchAttempts: 0,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: trackMappings.spotifyTrackId,
            set: {
              spotifyAddedAt: track.addedAt,
              spotifyRemovedAt: null,
              trackName: track.name,
              artistNamesJson: JSON.stringify(track.artistNames),
              albumName: track.albumName,
              albumReleaseDate: track.albumReleaseDate,
              durationMs: track.durationMs,
              isrc: track.isrc,
              externalUrl: track.externalUrl,
              updatedAt: now,
            },
          })
          .run();
      }

      for (const row of existing) {
        if (currentIds.has(row.spotifyTrackId) || row.spotifyRemovedAt) {
          continue;
        }

        removedFromSpotify += 1;
        this.db
          .update(trackMappings)
          .set({
            spotifyRemovedAt: now,
            updatedAt: now,
          })
          .where(eq(trackMappings.spotifyTrackId, row.spotifyTrackId))
          .run();
      }
    })();

    return {
      scannedSpotifyTracks: tracks.length,
      newlySeenTracks,
      removedFromSpotify,
    };
  }

  getTrackBySpotifyId(spotifyTrackId: string) {
    return (
      this.db
        .select()
        .from(trackMappings)
        .where(eq(trackMappings.spotifyTrackId, spotifyTrackId))
        .get() ?? null
    );
  }

  listTracksForSync() {
    return this.db
      .select()
      .from(trackMappings)
      .where(isNull(trackMappings.spotifyRemovedAt))
      .orderBy(asc(trackMappings.spotifyAddedAt))
      .all();
  }

  listAttentionTracks(limit = 30) {
    return this.db
      .select()
      .from(trackMappings)
      .where(
        and(
          isNull(trackMappings.spotifyRemovedAt),
          or(
            eq(trackMappings.searchStatus, "failed"),
            eq(trackMappings.searchStatus, "no_match"),
            eq(trackMappings.searchStatus, "needs_manual"),
            and(eq(trackMappings.searchStatus, "matched_manual"), isNull(trackMappings.lastSyncedAt)),
          ),
        ),
      )
      .orderBy(desc(trackMappings.updatedAt))
      .limit(limit)
      .all();
  }

  setManualVideoId(spotifyTrackId: string, manualVideoId: string) {
    this.db
      .update(trackMappings)
      .set({
        manualVideoId,
        searchStatus: "matched_manual",
        matchedVideoId: manualVideoId,
        matchedSource: "manual",
        matchedScore: 100,
        lastError: null,
        updatedAt: Date.now(),
      })
      .where(eq(trackMappings.spotifyTrackId, spotifyTrackId))
      .run();
  }

  clearSearchFailure(spotifyTrackId: string) {
    this.db
      .update(trackMappings)
      .set({
        searchStatus: "pending",
        lastError: null,
        updatedAt: Date.now(),
      })
      .where(eq(trackMappings.spotifyTrackId, spotifyTrackId))
      .run();
  }

  saveMatchResult(spotifyTrackId: string, result: MatchResult) {
    this.db
      .update(trackMappings)
      .set({
        matchedVideoId: result.candidate.videoId,
        matchedVideoTitle: result.candidate.title,
        matchedChannelTitle: result.candidate.channelTitle,
        matchedScore: Math.round(result.score),
        matchedSource: result.candidate.source,
        searchStatus: "matched_auto",
        searchAttempts: sql`${trackMappings.searchAttempts} + 1`,
        lastSearchAt: Date.now(),
        lastError: null,
        updatedAt: Date.now(),
      })
      .where(eq(trackMappings.spotifyTrackId, spotifyTrackId))
      .run();
  }

  markTrackSearchFailure(
    spotifyTrackId: string,
    searchStatus: "failed" | "no_match" | "needs_manual",
    message: string,
  ) {
    this.db
      .update(trackMappings)
      .set({
        searchStatus,
        searchAttempts: sql`${trackMappings.searchAttempts} + 1`,
        lastSearchAt: Date.now(),
        lastError: message,
        updatedAt: Date.now(),
      })
      .where(eq(trackMappings.spotifyTrackId, spotifyTrackId))
      .run();
  }

  markTrackInserted(spotifyTrackId: string, playlistVideoId: string | null) {
    this.db
      .update(trackMappings)
      .set({
        playlistVideoId,
        lastSyncedAt: Date.now(),
        lastError: null,
        updatedAt: Date.now(),
      })
      .where(eq(trackMappings.spotifyTrackId, spotifyTrackId))
      .run();
  }

  resetTrackForRetry(spotifyTrackId: string, message: string) {
    this.db
      .update(trackMappings)
      .set({
        searchStatus: "failed",
        lastError: message,
        updatedAt: Date.now(),
      })
      .where(eq(trackMappings.spotifyTrackId, spotifyTrackId))
      .run();
  }

  replacePlaylistVideos(
    playlistId: string,
    videos: Array<{
      playlistItemId: string;
      videoId: string;
      videoTitle: string | null;
      channelTitle: string | null;
      position: number | null;
    }>,
  ) {
    const now = Date.now();
    this.database.sqlite.transaction(() => {
      this.db.delete(playlistVideos).where(eq(playlistVideos.playlistId, playlistId)).run();

      for (const video of videos) {
        this.db
          .insert(playlistVideos)
          .values({
            playlistId,
            playlistItemId: video.playlistItemId,
            videoId: video.videoId,
            videoTitle: video.videoTitle,
            channelTitle: video.channelTitle,
            sourceSpotifyTrackId: null,
            position: video.position,
            syncedAt: now,
          })
          .run();
      }
    })();
  }

  listPlaylistVideos(playlistId: string) {
    return this.db
      .select()
      .from(playlistVideos)
      .where(eq(playlistVideos.playlistId, playlistId))
      .all();
  }

  getDailyQuotaUsage(dayKey: string) {
    const key = `youtube.quota.${dayKey}`;
    const raw = this.getSetting(key)?.value;
    return raw ? Number(raw) : 0;
  }

  incrementDailyQuotaUsage(dayKey: string, amount: number) {
    const key = `youtube.quota.${dayKey}`;
    const nextValue = this.getDailyQuotaUsage(dayKey) + amount;
    this.saveSetting(key, String(nextValue));
    return nextValue;
  }

  getDashboardSummary() {
    const oauth = this.listOAuthAccounts();
    const recentRuns = this.listRecentSyncRuns(10);
    const attentionTracks = this.listAttentionTracks(30).map((track) => ({
      spotifyTrackId: track.spotifyTrackId,
      trackName: track.trackName,
      artistNames: JSON.parse(track.artistNamesJson) as string[],
      albumName: track.albumName,
      searchStatus: track.searchStatus,
      lastError: track.lastError,
      manualVideoId: track.manualVideoId,
      matchedVideoId: track.matchedVideoId,
      lastSyncedAt: track.lastSyncedAt,
    }));

    return {
      spotifyConnected: oauth.some((account) => account.provider === "spotify" && !account.invalidatedAt),
      youtubeConnected: oauth.some((account) => account.provider === "youtube" && !account.invalidatedAt),
      playlistId: this.getManagedPlaylistId(),
      lastRunAt: recentRuns[0]?.finishedAt ?? recentRuns[0]?.startedAt ?? null,
      recentRuns,
      attentionTracks,
    };
  }
}
