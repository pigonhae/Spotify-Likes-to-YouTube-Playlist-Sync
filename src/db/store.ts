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
  syncState,
  trackMappings,
  users,
} from "./schema.js";
import type { AppDatabase } from "./client.js";

const PLAYLIST_SETTING_KEY = "youtube.playlistId";

export async function createAppStore(
  database: AppDatabase,
  userKey: string,
  displayName = "Owner",
) {
  const now = Date.now();

  await database.db
    .insert(users)
    .values({
      id: randomUUID(),
      userKey,
      displayName,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: users.userKey });

  const user =
    (await database.db.select().from(users).where(eq(users.userKey, userKey)).limit(1))[0] ?? null;

  if (!user) {
    throw new Error(`Failed to initialize owner user for key: ${userKey}`);
  }

  return new AppStore(database, user.id);
}

export class AppStore {
  constructor(
    private readonly database: AppDatabase,
    private readonly userId: string,
  ) {}

  get db() {
    return this.database.db;
  }

  async cleanupExpiredStates(now = Date.now()) {
    await this.db
      .delete(oauthStates)
      .where(and(eq(oauthStates.userId, this.userId), lt(oauthStates.expiresAt, now)));
  }

  async createOAuthState(provider: Provider, ttlMs = 10 * 60 * 1000) {
    const now = Date.now();
    const state = randomUUID();
    await this.db.insert(oauthStates).values({
      state,
      userId: this.userId,
      provider,
      createdAt: now,
      expiresAt: now + ttlMs,
    });
    return state;
  }

  async consumeOAuthState(provider: Provider, state: string) {
    const now = Date.now();
    const row =
      (
        await this.db
          .select()
          .from(oauthStates)
          .where(
            and(
              eq(oauthStates.userId, this.userId),
              eq(oauthStates.provider, provider),
              eq(oauthStates.state, state),
            ),
          )
          .limit(1)
      )[0] ?? null;

    if (!row || row.expiresAt < now) {
      if (row) {
        await this.db
          .delete(oauthStates)
          .where(
            and(eq(oauthStates.userId, this.userId), eq(oauthStates.state, state)),
          );
      }
      return false;
    }

    await this.db
      .delete(oauthStates)
      .where(and(eq(oauthStates.userId, this.userId), eq(oauthStates.state, state)));
    return true;
  }

  async getOAuthAccount(provider: Provider) {
    return (
      (
        await this.db
          .select()
          .from(oauthAccounts)
          .where(
            and(eq(oauthAccounts.userId, this.userId), eq(oauthAccounts.provider, provider)),
          )
          .limit(1)
      )[0] ?? null
    );
  }

  async listOAuthAccounts() {
    return this.db
      .select()
      .from(oauthAccounts)
      .where(eq(oauthAccounts.userId, this.userId));
  }

  async upsertOAuthAccount(input: {
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
    await this.db
      .insert(oauthAccounts)
      .values({
        id: randomUUID(),
        userId: this.userId,
        ...input,
        connectedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [oauthAccounts.userId, oauthAccounts.provider],
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
      });
  }

  async markOAuthAccountInvalid(provider: Provider, message: string) {
    await this.db
      .update(oauthAccounts)
      .set({
        invalidatedAt: Date.now(),
        lastRefreshError: message,
        updatedAt: Date.now(),
      })
      .where(and(eq(oauthAccounts.userId, this.userId), eq(oauthAccounts.provider, provider)));
  }

  async saveSetting(key: string, settingValue: string) {
    const now = Date.now();
    await this.db
      .insert(appSettings)
      .values({
        id: randomUUID(),
        userId: this.userId,
        key,
        settingValue,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [appSettings.userId, appSettings.key],
        set: { settingValue, updatedAt: now },
      });
  }

  async getSetting(key: string) {
    return (
      (
        await this.db
          .select()
          .from(appSettings)
          .where(and(eq(appSettings.userId, this.userId), eq(appSettings.key, key)))
          .limit(1)
      )[0] ?? null
    );
  }

  async saveManagedPlaylistId(playlistId: string) {
    await this.saveSetting(PLAYLIST_SETTING_KEY, playlistId);
  }

  async getManagedPlaylistId() {
    return (await this.getSetting(PLAYLIST_SETTING_KEY))?.settingValue ?? null;
  }

  async disconnectSpotifyState() {
    return this.db.transaction(async (tx: any) => {
      const deletedAccounts = (
        await tx
          .delete(oauthAccounts)
          .where(and(eq(oauthAccounts.userId, this.userId), eq(oauthAccounts.provider, "spotify")))
          .returning({ id: oauthAccounts.id })
      ).length;
      const deletedStates = (
        await tx
          .delete(oauthStates)
          .where(and(eq(oauthStates.userId, this.userId), eq(oauthStates.provider, "spotify")))
          .returning({ state: oauthStates.state })
      ).length;

      return {
        deletedAccounts,
        deletedStates,
        alreadyDisconnected: deletedAccounts === 0,
      };
    });
  }

  async disconnectYouTubeState() {
    const now = Date.now();

    return this.db.transaction(async (tx: any) => {
      const deletedAccounts = (
        await tx
          .delete(oauthAccounts)
          .where(and(eq(oauthAccounts.userId, this.userId), eq(oauthAccounts.provider, "youtube")))
          .returning({ id: oauthAccounts.id })
      ).length;
      const deletedStates = (
        await tx
          .delete(oauthStates)
          .where(and(eq(oauthStates.userId, this.userId), eq(oauthStates.provider, "youtube")))
          .returning({ state: oauthStates.state })
      ).length;
      const deletedPlaylistSetting = (
        await tx
          .delete(appSettings)
          .where(and(eq(appSettings.userId, this.userId), eq(appSettings.key, PLAYLIST_SETTING_KEY)))
          .returning({ id: appSettings.id })
      ).length;
      const deletedPlaylistVideos = (
        await tx
          .delete(playlistVideos)
          .where(eq(playlistVideos.userId, this.userId))
          .returning({ id: playlistVideos.id })
      ).length;
      const resetTrackBindings = (
        await tx
          .update(trackMappings)
          .set({
            playlistVideoId: null,
            lastSyncedAt: null,
            updatedAt: now,
          })
          .where(eq(trackMappings.userId, this.userId))
          .returning({ id: trackMappings.id })
      ).length;

      return {
        deletedAccounts,
        deletedStates,
        deletedPlaylistSetting,
        deletedPlaylistVideos,
        resetTrackBindings,
        alreadyDisconnected: deletedAccounts === 0,
      };
    });
  }

  async resetAllProjectState() {
    const now = Date.now();

    return this.db.transaction(async (tx: any) => {
      const deletedAccounts = (
        await tx
          .delete(oauthAccounts)
          .where(eq(oauthAccounts.userId, this.userId))
          .returning({ id: oauthAccounts.id })
      ).length;
      const deletedStates = (
        await tx
          .delete(oauthStates)
          .where(eq(oauthStates.userId, this.userId))
          .returning({ state: oauthStates.state })
      ).length;
      const deletedSettings = (
        await tx
          .delete(appSettings)
          .where(eq(appSettings.userId, this.userId))
          .returning({ id: appSettings.id })
      ).length;
      const deletedTrackMappings = (
        await tx
          .delete(trackMappings)
          .where(eq(trackMappings.userId, this.userId))
          .returning({ id: trackMappings.id })
      ).length;
      const deletedPlaylistVideos = (
        await tx
          .delete(playlistVideos)
          .where(eq(playlistVideos.userId, this.userId))
          .returning({ id: playlistVideos.id })
      ).length;
      const deletedSyncRuns = (
        await tx
          .delete(syncRuns)
          .where(eq(syncRuns.userId, this.userId))
          .returning({ id: syncRuns.id })
      ).length;

      await tx.delete(syncState).where(eq(syncState.userId, this.userId));
      await tx
        .insert(syncLock)
        .values({
          userId: this.userId,
          lockName: "hourly-sync",
          holder: null,
          lockedUntil: 0,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [syncLock.userId, syncLock.lockName],
          set: {
            holder: null,
            lockedUntil: 0,
            updatedAt: now,
          },
        });

      return {
        deletedAccounts,
        deletedStates,
        deletedSettings,
        deletedTrackMappings,
        deletedPlaylistVideos,
        deletedSyncRuns,
      };
    });
  }

  async acquireLock(lockName: string, holder: string, ttlMs: number) {
    const now = Date.now();
    const lockedUntil = now + ttlMs;
    const result = await this.database.pool.query(
      `
        INSERT INTO sync_lock (user_id, lock_name, holder, locked_until, updated_at)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (user_id, lock_name) DO UPDATE
        SET holder = EXCLUDED.holder,
            locked_until = EXCLUDED.locked_until,
            updated_at = EXCLUDED.updated_at
        WHERE sync_lock.locked_until <= $5
           OR sync_lock.holder = $3
        RETURNING holder
      `,
      [this.userId, lockName, holder, lockedUntil, now],
    );

    return (result.rowCount ?? 0) > 0;
  }

  async releaseLock(lockName: string, holder: string) {
    await this.db
      .update(syncLock)
      .set({
        holder: null,
        lockedUntil: 0,
        updatedAt: Date.now(),
      })
      .where(
        and(
          eq(syncLock.userId, this.userId),
          eq(syncLock.lockName, lockName),
          eq(syncLock.holder, holder),
        ),
      );
  }

  async createSyncRun(trigger: string) {
    const now = Date.now();
    const result = await this.db
      .insert(syncRuns)
      .values({
        userId: this.userId,
        trigger,
        status: "running",
        startedAt: now,
      })
      .returning({ id: syncRuns.id });

    await this.db
      .insert(syncState)
      .values({
        userId: this.userId,
        lastStartedSyncAt: now,
        lastSuccessfulSyncAt: null,
        lastFailedSyncAt: null,
        spotifyScanOffset: null,
        lastError: null,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: syncState.userId,
        set: {
          lastStartedSyncAt: now,
          updatedAt: now,
        },
      });

    return result[0]?.id ?? 0;
  }

  async finishSyncRun(runId: number, status: string, stats: unknown, errorSummary?: string) {
    const now = Date.now();

    await this.db.transaction(async (tx: any) => {
      await tx
        .update(syncRuns)
        .set({
          status,
          finishedAt: now,
          statsJson: stats,
          errorSummary: errorSummary ?? null,
        })
        .where(and(eq(syncRuns.userId, this.userId), eq(syncRuns.id, runId)));

      await tx
        .insert(syncState)
        .values({
          userId: this.userId,
          lastStartedSyncAt: null,
          lastSuccessfulSyncAt: status === "success" ? now : null,
          lastFailedSyncAt: status === "success" ? null : now,
          spotifyScanOffset: null,
          lastError: errorSummary ?? null,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: syncState.userId,
          set: {
            lastSuccessfulSyncAt: status === "success" ? now : syncState.lastSuccessfulSyncAt,
            lastFailedSyncAt: status === "success" ? syncState.lastFailedSyncAt : now,
            lastError: status === "success" ? null : errorSummary ?? null,
            updatedAt: now,
          },
        });
    });
  }

  async listRecentSyncRuns(limit = 10) {
    return this.db
      .select()
      .from(syncRuns)
      .where(eq(syncRuns.userId, this.userId))
      .orderBy(desc(syncRuns.startedAt))
      .limit(limit);
  }

  async saveSpotifySnapshot(tracks: SpotifyTrack[]) {
    const now = Date.now();
    const existing = await this.db
      .select({
        spotifyTrackId: trackMappings.spotifyTrackId,
        spotifyRemovedAt: trackMappings.spotifyRemovedAt,
      })
      .from(trackMappings)
      .where(eq(trackMappings.userId, this.userId));

    const existingIds = new Set(existing.map((row: { spotifyTrackId: string }) => row.spotifyTrackId));
    const currentIds = new Set(tracks.map((track: SpotifyTrack) => track.spotifyTrackId));
    let newlySeenTracks = 0;
    let removedFromSpotify = 0;

    await this.db.transaction(async (tx: any) => {
      for (const track of tracks) {
        if (!existingIds.has(track.spotifyTrackId)) {
          newlySeenTracks += 1;
        }

        await tx
          .insert(trackMappings)
          .values({
            id: randomUUID(),
            userId: this.userId,
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
            target: [trackMappings.userId, trackMappings.spotifyTrackId],
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
          });
      }

      for (const row of existing) {
        if (currentIds.has(row.spotifyTrackId) || row.spotifyRemovedAt) {
          continue;
        }

        removedFromSpotify += 1;
        await tx
          .update(trackMappings)
          .set({
            spotifyRemovedAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(trackMappings.userId, this.userId),
              eq(trackMappings.spotifyTrackId, row.spotifyTrackId),
            ),
          );
      }
    });

    return {
      scannedSpotifyTracks: tracks.length,
      newlySeenTracks,
      removedFromSpotify,
    };
  }

  async getTrackBySpotifyId(spotifyTrackId: string) {
    return (
      (
        await this.db
          .select()
          .from(trackMappings)
          .where(
            and(
              eq(trackMappings.userId, this.userId),
              eq(trackMappings.spotifyTrackId, spotifyTrackId),
            ),
          )
          .limit(1)
      )[0] ?? null
    );
  }

  async listTracksForSync() {
    return this.db
      .select()
      .from(trackMappings)
      .where(and(eq(trackMappings.userId, this.userId), isNull(trackMappings.spotifyRemovedAt)))
      .orderBy(asc(trackMappings.spotifyAddedAt));
  }

  async listAttentionTracks(limit = 30) {
    return this.db
      .select()
      .from(trackMappings)
      .where(
        and(
          eq(trackMappings.userId, this.userId),
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
      .limit(limit);
  }

  async setManualVideoId(spotifyTrackId: string, manualVideoId: string) {
    await this.db
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
      .where(
        and(
          eq(trackMappings.userId, this.userId),
          eq(trackMappings.spotifyTrackId, spotifyTrackId),
        ),
      );
  }

  async clearSearchFailure(spotifyTrackId: string) {
    await this.db
      .update(trackMappings)
      .set({
        searchStatus: "pending",
        lastError: null,
        updatedAt: Date.now(),
      })
      .where(
        and(
          eq(trackMappings.userId, this.userId),
          eq(trackMappings.spotifyTrackId, spotifyTrackId),
        ),
      );
  }

  async saveMatchResult(spotifyTrackId: string, result: MatchResult) {
    await this.db
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
      .where(
        and(
          eq(trackMappings.userId, this.userId),
          eq(trackMappings.spotifyTrackId, spotifyTrackId),
        ),
      );
  }

  async markTrackSearchFailure(
    spotifyTrackId: string,
    searchStatus: "failed" | "no_match" | "needs_manual",
    message: string,
  ) {
    await this.db
      .update(trackMappings)
      .set({
        searchStatus,
        searchAttempts: sql`${trackMappings.searchAttempts} + 1`,
        lastSearchAt: Date.now(),
        lastError: message,
        updatedAt: Date.now(),
      })
      .where(
        and(
          eq(trackMappings.userId, this.userId),
          eq(trackMappings.spotifyTrackId, spotifyTrackId),
        ),
      );
  }

  async markTrackInserted(spotifyTrackId: string, playlistVideoId: string | null) {
    await this.db
      .update(trackMappings)
      .set({
        playlistVideoId,
        lastSyncedAt: Date.now(),
        lastError: null,
        updatedAt: Date.now(),
      })
      .where(
        and(
          eq(trackMappings.userId, this.userId),
          eq(trackMappings.spotifyTrackId, spotifyTrackId),
        ),
      );
  }

  async resetTrackForRetry(spotifyTrackId: string, message: string) {
    await this.db
      .update(trackMappings)
      .set({
        searchStatus: "failed",
        lastError: message,
        updatedAt: Date.now(),
      })
      .where(
        and(
          eq(trackMappings.userId, this.userId),
          eq(trackMappings.spotifyTrackId, spotifyTrackId),
        ),
      );
  }

  async replacePlaylistVideos(
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
    await this.db.transaction(async (tx: any) => {
      await tx
        .delete(playlistVideos)
        .where(and(eq(playlistVideos.userId, this.userId), eq(playlistVideos.playlistId, playlistId)));

      for (const video of videos) {
        await tx.insert(playlistVideos).values({
          id: randomUUID(),
          userId: this.userId,
          playlistId,
          playlistItemId: video.playlistItemId,
          videoId: video.videoId,
          videoTitle: video.videoTitle,
          channelTitle: video.channelTitle,
          sourceSpotifyTrackId: null,
          position: video.position,
          syncedAt: now,
        });
      }
    });
  }

  async listPlaylistVideos(playlistId: string) {
    return this.db
      .select()
      .from(playlistVideos)
      .where(and(eq(playlistVideos.userId, this.userId), eq(playlistVideos.playlistId, playlistId)));
  }

  async getDailyQuotaUsage(dayKey: string) {
    const key = `youtube.quota.${dayKey}`;
    const raw = (await this.getSetting(key))?.settingValue;
    return raw ? Number(raw) : 0;
  }

  async incrementDailyQuotaUsage(dayKey: string, amount: number) {
    const key = `youtube.quota.${dayKey}`;
    const nextValue = (await this.getDailyQuotaUsage(dayKey)) + amount;
    await this.saveSetting(key, String(nextValue));
    return nextValue;
  }

  async getDashboardSummary() {
    const oauth = await this.listOAuthAccounts();
    const recentRuns = await this.listRecentSyncRuns(10);
    const attentionTracks = (await this.listAttentionTracks(30)).map((track: any) => ({
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
      spotifyConnected: oauth.some((account: any) => account.provider === "spotify" && !account.invalidatedAt),
      youtubeConnected: oauth.some((account: any) => account.provider === "youtube" && !account.invalidatedAt),
      playlistId: await this.getManagedPlaylistId(),
      lastRunAt: recentRuns[0]?.finishedAt ?? recentRuns[0]?.startedAt ?? null,
      recentRuns,
      attentionTracks,
    };
  }
}
