import { randomUUID } from "node:crypto";

import { and, asc, desc, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";

import type {
  LibrarySummary,
  ManualResolutionType,
  MatchResult,
  Provider,
  RunSummary,
  SpotifyTrack,
  SyncEventLevel,
  SyncProgressSnapshot,
  SyncRunLifecycleStatus,
  SyncRunPhase,
  SyncRunTrackStatus,
  TrackSearchStatus,
} from "../types.js";
import {
  appSettings,
  oauthAccounts,
  oauthStates,
  playlistVideos,
  syncLock,
  syncRunEvents,
  syncRunTracks,
  syncRuns,
  syncState,
  trackMappings,
  users,
} from "./schema.js";
import type { AppDatabase } from "./client.js";

const PLAYLIST_SETTING_KEY = "youtube.playlistId";
const PLAYLIST_SNAPSHOT_REFRESHED_AT_SETTING_KEY = "youtube.playlistSnapshotRefreshedAt";
const ACTIVE_SYNC_STATUSES: SyncRunLifecycleStatus[] = [
  "queued",
  "running",
  "waiting_for_youtube_quota",
  "waiting_for_spotify_retry",
  "needs_reauth",
];
const TERMINAL_RUN_TRACK_STATUSES: SyncRunTrackStatus[] = [
  "inserted",
  "skipped_existing",
  "review_required",
  "no_match",
  "failed",
  "needs_reauth",
];

interface ManualSelectionMetadata {
  matchedVideoTitle?: string | null;
  matchedChannelTitle?: string | null;
  matchedSource?: string | null;
  matchedScore?: number | null;
  manualResolutionType?: ManualResolutionType | null;
}

interface PlaylistVideoInput {
  playlistItemId: string;
  videoId: string;
  videoTitle: string | null;
  channelTitle: string | null;
  position: number | null;
  sourceSpotifyTrackId?: string | null;
}

interface ReplacePlaylistVideosResult {
  storedVideos: PlaylistVideoInput[];
  duplicateVideoIds: string[];
  invalidItems: number;
}

interface NormalizedPlaylistVideo {
  playlistId: string;
  playlistItemId: string;
  videoId: string;
  videoTitle: string | null;
  channelTitle: string | null;
  position: number | null;
  sourceSpotifyTrackId: string | null;
}

interface SyncRunTrackUpsertInput {
  syncRunId: number;
  track: SpotifyTrack;
  trackOrder: number;
}

interface SyncRunTrackPatch {
  status?: SyncRunTrackStatus;
  statusMessage?: string | null;
  currentTrackName?: string | null;
  matchedVideoId?: string | null;
  matchedVideoTitle?: string | null;
  matchedChannelTitle?: string | null;
  matchedScore?: number | null;
  matchedSource?: string | null;
  reviewVideoId?: string | null;
  reviewVideoTitle?: string | null;
  reviewChannelTitle?: string | null;
  reviewVideoUrl?: string | null;
  reviewSource?: string | null;
  reviewScore?: number | null;
  reviewReasonsJson?: string | null;
  manualVideoId?: string | null;
  manualResolutionType?: ManualResolutionType | null;
  playlistItemId?: string | null;
  lastError?: string | null;
  incrementAttemptCount?: boolean;
}

interface RecentSyncRunsCursor {
  startedAt: number;
  id: number;
}

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

  async savePlaylistSnapshotRefreshedAt(refreshedAt = Date.now()) {
    await this.saveSetting(PLAYLIST_SNAPSHOT_REFRESHED_AT_SETTING_KEY, String(refreshedAt));
    return refreshedAt;
  }

  async getPlaylistSnapshotRefreshedAt() {
    const raw = (await this.getSetting(PLAYLIST_SNAPSHOT_REFRESHED_AT_SETTING_KEY))?.settingValue;
    if (!raw) {
      return null;
    }

    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
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
          .where(
            and(
              eq(appSettings.userId, this.userId),
              inArray(appSettings.key, [
                PLAYLIST_SETTING_KEY,
                PLAYLIST_SNAPSHOT_REFRESHED_AT_SETTING_KEY,
              ]),
            ),
          )
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

  async createSyncRun(trigger: string, resumedFromRunId: number | null = null) {
    const now = Date.now();
    const result = await this.db
      .insert(syncRuns)
      .values({
        userId: this.userId,
        trigger,
        status: "running",
        phase: "queued",
        statusMessage: "Preparing sync run",
        startedAt: now,
        totalTracks: 0,
        completedTracks: 0,
        remainingTracks: 0,
        currentSpotifyTrackId: null,
        currentTrackName: null,
        nextRetryAt: null,
        pauseReason: null,
        lastErrorSummary: null,
        lastHeartbeatAt: now,
        updatedAt: now,
        resumedFromRunId,
        spotifyScanOffset: 0,
        spotifyScanCompletedAt: null,
        playlistSnapshotCompletedAt: null,
      })
      .returning({ id: syncRuns.id });

    const runId = result[0]?.id ?? 0;
    await this.upsertSyncState({
      lastStartedSyncAt: now,
      activeRunId: runId,
      lastHeartbeatAt: now,
      spotifyScanOffset: 0,
      lastError: null,
    });

    return runId;
  }

  async getSyncRun(runId: number) {
    return (
      (
        await this.db
          .select()
          .from(syncRuns)
          .where(and(eq(syncRuns.userId, this.userId), eq(syncRuns.id, runId)))
          .limit(1)
      )[0] ?? null
    );
  }

  async getActiveSyncRun() {
    return (
      (
        await this.db
          .select()
          .from(syncRuns)
          .where(
            and(
              eq(syncRuns.userId, this.userId),
              inArray(syncRuns.status, ACTIVE_SYNC_STATUSES),
            ),
          )
          .orderBy(desc(syncRuns.startedAt))
          .limit(1)
      )[0] ?? null
    );
  }

  async getSyncState() {
    return (
      (
        await this.db
          .select()
          .from(syncState)
          .where(eq(syncState.userId, this.userId))
          .limit(1)
      )[0] ?? null
    );
  }

  async findResumableSyncRun(now = Date.now(), staleHeartbeatMs = 5 * 60 * 1000) {
    const staleThreshold = now - staleHeartbeatMs;
    return (
      (
        await this.db
          .select()
          .from(syncRuns)
          .where(
            and(
              eq(syncRuns.userId, this.userId),
              or(
                and(
                  inArray(syncRuns.status, [
                    "waiting_for_youtube_quota",
                    "waiting_for_spotify_retry",
                  ] satisfies SyncRunLifecycleStatus[]),
                  lt(syncRuns.nextRetryAt, now + 1),
                ),
                eq(syncRuns.status, "queued"),
                and(eq(syncRuns.status, "running"), lt(syncRuns.lastHeartbeatAt, staleThreshold)),
              ),
            ),
          )
          .orderBy(desc(syncRuns.startedAt))
          .limit(1)
      )[0] ?? null
    );
  }

  async hasSyncRunWithTriggerInWindow(trigger: string, startAt: number, endAt: number) {
    return (
      (
        await this.db
          .select({ id: syncRuns.id })
          .from(syncRuns)
          .where(
            and(
              eq(syncRuns.userId, this.userId),
              eq(syncRuns.trigger, trigger),
              gte(syncRuns.startedAt, startAt),
              lt(syncRuns.startedAt, endAt),
            ),
          )
          .limit(1)
      )[0] ?? null
    ) !== null;
  }

  async markSyncRunRunning(runId: number, phase: SyncRunPhase, statusMessage?: string | null) {
    const now = Date.now();
    await this.db
      .update(syncRuns)
      .set({
        status: "running",
        phase,
        statusMessage: statusMessage ?? null,
        nextRetryAt: null,
        pauseReason: null,
        lastHeartbeatAt: now,
        updatedAt: now,
      })
      .where(and(eq(syncRuns.userId, this.userId), eq(syncRuns.id, runId)));

    await this.upsertSyncState({
      activeRunId: runId,
      lastHeartbeatAt: now,
      lastStartedSyncAt: now,
    });
  }

  async updateSyncRun(runId: number, input: {
    status?: SyncRunLifecycleStatus;
    phase?: SyncRunPhase | null;
    statusMessage?: string | null;
    progress?: Partial<SyncProgressSnapshot>;
    nextRetryAt?: number | null;
    pauseReason?: string | null;
    lastErrorSummary?: string | null;
    spotifyScanOffset?: number | null;
    spotifyScanCompletedAt?: number | null;
    playlistSnapshotCompletedAt?: number | null;
  }) {
    const now = Date.now();
    await this.db
      .update(syncRuns)
      .set({
        ...(input.status ? { status: input.status } : {}),
        ...(input.phase !== undefined ? { phase: input.phase } : {}),
        ...(input.statusMessage !== undefined ? { statusMessage: input.statusMessage } : {}),
        ...(input.progress?.totalTracks !== undefined ? { totalTracks: input.progress.totalTracks } : {}),
        ...(input.progress?.completedTracks !== undefined ? { completedTracks: input.progress.completedTracks } : {}),
        ...(input.progress?.remainingTracks !== undefined ? { remainingTracks: input.progress.remainingTracks } : {}),
        ...(input.progress?.currentSpotifyTrackId !== undefined ? { currentSpotifyTrackId: input.progress.currentSpotifyTrackId } : {}),
        ...(input.progress?.currentTrackName !== undefined ? { currentTrackName: input.progress.currentTrackName } : {}),
        ...(input.nextRetryAt !== undefined ? { nextRetryAt: input.nextRetryAt } : {}),
        ...(input.pauseReason !== undefined ? { pauseReason: input.pauseReason } : {}),
        ...(input.lastErrorSummary !== undefined ? { lastErrorSummary: input.lastErrorSummary } : {}),
        ...(input.spotifyScanOffset !== undefined ? { spotifyScanOffset: input.spotifyScanOffset } : {}),
        ...(input.spotifyScanCompletedAt !== undefined ? { spotifyScanCompletedAt: input.spotifyScanCompletedAt } : {}),
        ...(input.playlistSnapshotCompletedAt !== undefined ? { playlistSnapshotCompletedAt: input.playlistSnapshotCompletedAt } : {}),
        lastHeartbeatAt: now,
        updatedAt: now,
      })
      .where(and(eq(syncRuns.userId, this.userId), eq(syncRuns.id, runId)));

    await this.upsertSyncState({
      activeRunId: input.status && !ACTIVE_SYNC_STATUSES.includes(input.status) ? null : runId,
      lastHeartbeatAt: now,
      ...(input.spotifyScanOffset !== undefined ? { spotifyScanOffset: input.spotifyScanOffset } : {}),
      ...(input.lastErrorSummary !== undefined ? { lastError: input.lastErrorSummary } : {}),
    });
  }

  async pauseSyncRun(
    runId: number,
    status: Extract<SyncRunLifecycleStatus, "waiting_for_youtube_quota" | "waiting_for_spotify_retry" | "needs_reauth">,
    input: {
      phase: SyncRunPhase;
      statusMessage: string;
      nextRetryAt?: number | null;
      pauseReason?: string | null;
      errorSummary?: string | null;
      currentSpotifyTrackId?: string | null;
      currentTrackName?: string | null;
    },
  ) {
    await this.updateSyncRun(runId, {
      status,
      phase: input.phase,
      statusMessage: input.statusMessage,
      progress: {
        ...(input.currentSpotifyTrackId !== undefined ? { currentSpotifyTrackId: input.currentSpotifyTrackId } : {}),
        ...(input.currentTrackName !== undefined ? { currentTrackName: input.currentTrackName } : {}),
      },
      nextRetryAt: input.nextRetryAt ?? null,
      pauseReason: input.pauseReason ?? null,
      lastErrorSummary: input.errorSummary ?? null,
    });
  }

  async finishSyncRun(
    runId: number,
    status: SyncRunLifecycleStatus | "success" | "quota_exhausted",
    stats: unknown,
    errorSummary?: string,
  ) {
    const now = Date.now();
    const normalizedStatus = normalizeRunStatus(status);

    await this.refreshSyncRunProgress(runId);

    const run = await this.getSyncRun(runId);
    await this.db.transaction(async (tx: any) => {
      await tx
        .update(syncRuns)
        .set({
          status: normalizedStatus,
          phase: normalizedStatus === "completed" || normalizedStatus === "partially_completed" ? "completed" : "failed",
          finishedAt: now,
          nextRetryAt: null,
          pauseReason: null,
          statsJson: stats,
          errorSummary: errorSummary ?? null,
          lastErrorSummary: errorSummary ?? null,
          currentSpotifyTrackId: null,
          currentTrackName: null,
          lastHeartbeatAt: now,
          updatedAt: now,
        })
        .where(and(eq(syncRuns.userId, this.userId), eq(syncRuns.id, runId)));

      await tx
        .insert(syncState)
        .values({
          userId: this.userId,
          lastStartedSyncAt: run?.startedAt ?? now,
          lastSuccessfulSyncAt:
            normalizedStatus === "completed" || normalizedStatus === "partially_completed" ? now : null,
          lastFailedSyncAt:
            normalizedStatus === "completed" || normalizedStatus === "partially_completed" ? null : now,
          activeRunId: null,
          lastHeartbeatAt: now,
          spotifyScanOffset: null,
          lastError:
            normalizedStatus === "completed" || normalizedStatus === "partially_completed"
              ? null
              : errorSummary ?? null,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: syncState.userId,
          set: {
            lastSuccessfulSyncAt:
              normalizedStatus === "completed" || normalizedStatus === "partially_completed"
                ? now
                : syncState.lastSuccessfulSyncAt,
            lastFailedSyncAt:
              normalizedStatus === "completed" || normalizedStatus === "partially_completed"
                ? syncState.lastFailedSyncAt
                : now,
            activeRunId: null,
            lastHeartbeatAt: now,
            spotifyScanOffset: null,
            lastError:
              normalizedStatus === "completed" || normalizedStatus === "partially_completed"
                ? null
                : errorSummary ?? null,
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
      .orderBy(desc(syncRuns.startedAt), desc(syncRuns.id))
      .limit(limit);
  }

  async listRecentSyncRunsPage(input: {
    limit?: number;
    cursor?: RecentSyncRunsCursor | null;
  } = {}) {
    const limit = Math.max(1, Math.min(50, input.limit ?? 5));
    const cursor = input.cursor ?? null;
    const cursorPredicate = cursor
      ? or(
          lt(syncRuns.startedAt, cursor.startedAt),
          and(eq(syncRuns.startedAt, cursor.startedAt), lt(syncRuns.id, cursor.id)),
        )
      : undefined;
    const rows = await this.db
      .select()
      .from(syncRuns)
      .where(cursorPredicate ? and(eq(syncRuns.userId, this.userId), cursorPredicate) : eq(syncRuns.userId, this.userId))
      .orderBy(desc(syncRuns.startedAt), desc(syncRuns.id))
      .limit(limit + 1);

    const items = rows.slice(0, limit);
    const hasMore = rows.length > limit;
    const lastItem = items[items.length - 1] ?? null;

    return {
      items,
      hasMore,
      nextCursor:
        hasMore && lastItem
          ? {
              startedAt: lastItem.startedAt,
              id: lastItem.id,
            }
          : null,
    };
  }

  async saveSyncRunStats(runId: number, stats: unknown) {
    await this.db
      .update(syncRuns)
      .set({
        statsJson: stats,
        updatedAt: Date.now(),
      })
      .where(and(eq(syncRuns.userId, this.userId), eq(syncRuns.id, runId)));
  }

  async appendSyncRunEvent(input: {
    syncRunId: number;
    level: SyncEventLevel;
    stage: string;
    message: string;
    spotifyTrackId?: string | null;
    payload?: unknown;
  }) {
    const now = Date.now();
    await this.db.insert(syncRunEvents).values({
      userId: this.userId,
      syncRunId: input.syncRunId,
      level: input.level,
      stage: input.stage,
      message: input.message,
      spotifyTrackId: input.spotifyTrackId ?? null,
      payloadJson: sanitizeSyncPayload(input.payload),
      createdAt: now,
    });
  }

  async listSyncRunEvents(syncRunId: number, limit = 30) {
    return this.db
      .select()
      .from(syncRunEvents)
      .where(and(eq(syncRunEvents.userId, this.userId), eq(syncRunEvents.syncRunId, syncRunId)))
      .orderBy(desc(syncRunEvents.createdAt))
      .limit(limit);
  }

  async upsertSyncRunTrackFromSpotify(input: SyncRunTrackUpsertInput) {
    const existingTrack = await this.getTrackBySpotifyId(input.track.spotifyTrackId);
    const now = Date.now();

    await this.db.transaction(async (tx: any) => {
      await tx
        .insert(syncRunTracks)
        .values({
          id: randomUUID(),
          userId: this.userId,
          syncRunId: input.syncRunId,
          spotifyTrackId: input.track.spotifyTrackId,
          trackOrder: input.trackOrder,
          status: "discovered",
          statusMessage: "Imported from Spotify",
          trackName: input.track.name,
          artistNamesJson: JSON.stringify(input.track.artistNames),
          albumName: input.track.albumName,
          albumReleaseDate: input.track.albumReleaseDate,
          durationMs: input.track.durationMs,
          isrc: input.track.isrc,
          externalUrl: input.track.externalUrl,
          spotifyAddedAt: input.track.addedAt,
          manualVideoId: existingTrack?.manualVideoId ?? null,
          manualResolutionType: existingTrack?.manualResolutionType ?? null,
          matchedVideoId: existingTrack?.matchedVideoId ?? null,
          matchedVideoTitle: existingTrack?.matchedVideoTitle ?? null,
          matchedChannelTitle: existingTrack?.matchedChannelTitle ?? null,
          matchedScore: existingTrack?.matchedScore ?? null,
          matchedSource: existingTrack?.matchedSource ?? null,
          reviewVideoId: existingTrack?.reviewVideoId ?? null,
          reviewVideoTitle: existingTrack?.reviewVideoTitle ?? null,
          reviewChannelTitle: existingTrack?.reviewChannelTitle ?? null,
          reviewVideoUrl: existingTrack?.reviewVideoUrl ?? null,
          reviewSource: existingTrack?.reviewSource ?? null,
          reviewScore: existingTrack?.reviewScore ?? null,
          reviewReasonsJson: existingTrack?.reviewReasonsJson ?? null,
          playlistItemId: existingTrack?.playlistVideoId ?? null,
          attemptCount: 0,
          lastError: null,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [syncRunTracks.userId, syncRunTracks.syncRunId, syncRunTracks.spotifyTrackId],
          set: {
            trackOrder: input.trackOrder,
            trackName: input.track.name,
            artistNamesJson: JSON.stringify(input.track.artistNames),
            albumName: input.track.albumName,
            albumReleaseDate: input.track.albumReleaseDate,
            durationMs: input.track.durationMs,
            isrc: input.track.isrc,
            externalUrl: input.track.externalUrl,
            spotifyAddedAt: input.track.addedAt,
            manualVideoId: existingTrack?.manualVideoId ?? null,
            manualResolutionType: existingTrack?.manualResolutionType ?? null,
            matchedVideoId: existingTrack?.matchedVideoId ?? null,
            matchedVideoTitle: existingTrack?.matchedVideoTitle ?? null,
            matchedChannelTitle: existingTrack?.matchedChannelTitle ?? null,
            matchedScore: existingTrack?.matchedScore ?? null,
            matchedSource: existingTrack?.matchedSource ?? null,
            reviewVideoId: existingTrack?.reviewVideoId ?? null,
            reviewVideoTitle: existingTrack?.reviewVideoTitle ?? null,
            reviewChannelTitle: existingTrack?.reviewChannelTitle ?? null,
            reviewVideoUrl: existingTrack?.reviewVideoUrl ?? null,
            reviewSource: existingTrack?.reviewSource ?? null,
            reviewScore: existingTrack?.reviewScore ?? null,
            reviewReasonsJson: existingTrack?.reviewReasonsJson ?? null,
            playlistItemId: existingTrack?.playlistVideoId ?? null,
            updatedAt: now,
          },
        });

      await tx
        .insert(trackMappings)
        .values({
          id: randomUUID(),
          userId: this.userId,
          spotifyTrackId: input.track.spotifyTrackId,
          spotifyAddedAt: input.track.addedAt,
          spotifyRemovedAt: null,
          trackName: input.track.name,
          artistNamesJson: JSON.stringify(input.track.artistNames),
          albumName: input.track.albumName,
          albumReleaseDate: input.track.albumReleaseDate,
          durationMs: input.track.durationMs,
          isrc: input.track.isrc,
          externalUrl: input.track.externalUrl,
          searchStatus: "pending",
          searchAttempts: existingTrack?.searchAttempts ?? 0,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [trackMappings.userId, trackMappings.spotifyTrackId],
          set: {
            spotifyAddedAt: input.track.addedAt,
            spotifyRemovedAt: null,
            trackName: input.track.name,
            artistNamesJson: JSON.stringify(input.track.artistNames),
            albumName: input.track.albumName,
            albumReleaseDate: input.track.albumReleaseDate,
            durationMs: input.track.durationMs,
            isrc: input.track.isrc,
            externalUrl: input.track.externalUrl,
            updatedAt: now,
          },
        });
    });

    return {
      isNewTrack: existingTrack === null,
    };
  }

  async finalizeSpotifyRunSnapshot(syncRunId: number) {
    const now = Date.now();
    const discoveredTracks = await this.db
      .select({ spotifyTrackId: syncRunTracks.spotifyTrackId })
      .from(syncRunTracks)
      .where(and(eq(syncRunTracks.userId, this.userId), eq(syncRunTracks.syncRunId, syncRunId)));

    const currentIds = new Set(discoveredTracks.map((row: { spotifyTrackId: string }) => row.spotifyTrackId));
    const existing = await this.db
      .select({
        spotifyTrackId: trackMappings.spotifyTrackId,
        spotifyRemovedAt: trackMappings.spotifyRemovedAt,
      })
      .from(trackMappings)
      .where(eq(trackMappings.userId, this.userId));

    let removedFromSpotify = 0;
    for (const row of existing) {
      if (currentIds.has(row.spotifyTrackId) || row.spotifyRemovedAt) {
        continue;
      }

      removedFromSpotify += 1;
      await this.db
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

    await this.resequenceSyncRunTracks(syncRunId);
    await this.updateSyncRun(syncRunId, {
      spotifyScanCompletedAt: now,
      spotifyScanOffset: currentIds.size,
    });

    return {
      scannedSpotifyTracks: currentIds.size,
      removedFromSpotify,
    };
  }

  async resequenceSyncRunTracks(syncRunId: number) {
    const rows = await this.db
      .select({
        spotifyTrackId: syncRunTracks.spotifyTrackId,
        spotifyAddedAt: syncRunTracks.spotifyAddedAt,
        createdAt: syncRunTracks.createdAt,
      })
      .from(syncRunTracks)
      .where(and(eq(syncRunTracks.userId, this.userId), eq(syncRunTracks.syncRunId, syncRunId)))
      .orderBy(
        asc(syncRunTracks.spotifyAddedAt),
        asc(syncRunTracks.createdAt),
        asc(syncRunTracks.spotifyTrackId),
      );

    for (const [trackOrder, row] of rows.entries()) {
      await this.db
        .update(syncRunTracks)
        .set({
          trackOrder,
          updatedAt: Date.now(),
        })
        .where(
          and(
            eq(syncRunTracks.userId, this.userId),
            eq(syncRunTracks.syncRunId, syncRunId),
            eq(syncRunTracks.spotifyTrackId, row.spotifyTrackId),
          ),
        );
    }
  }

  async listSyncRunTracks(
    syncRunId: number,
    input: {
      page?: number;
      pageSize?: number;
      filter?: SyncRunTrackStatus | "active" | "all";
    } = {},
  ) {
    const page = Math.max(1, input.page ?? 1);
    const pageSize = Math.max(1, Math.min(100, input.pageSize ?? 50));
    const offset = (page - 1) * pageSize;
    const filter = input.filter ?? "all";

    const rows = await this.db
      .select()
      .from(syncRunTracks)
      .where(
        and(
          eq(syncRunTracks.userId, this.userId),
          eq(syncRunTracks.syncRunId, syncRunId),
          buildRunTrackFilter(filter),
        ),
      )
      .orderBy(asc(syncRunTracks.trackOrder))
      .limit(pageSize)
      .offset(offset);

    return rows.map((row: any) => ({
      ...row,
      artistNames: JSON.parse(row.artistNamesJson) as string[],
      reviewReasons: parseReviewReasons(row.reviewReasonsJson),
    }));
  }

  async listAllSyncRunTracks(syncRunId: number) {
    const rows = await this.db
      .select()
      .from(syncRunTracks)
      .where(and(eq(syncRunTracks.userId, this.userId), eq(syncRunTracks.syncRunId, syncRunId)))
      .orderBy(asc(syncRunTracks.trackOrder));

    return rows.map((row: any) => ({
      ...row,
      artistNames: JSON.parse(row.artistNamesJson) as string[],
      reviewReasons: parseReviewReasons(row.reviewReasonsJson),
    }));
  }

  async getSyncRunTrack(syncRunId: number, spotifyTrackId: string) {
    return (
      (
        await this.db
          .select()
          .from(syncRunTracks)
          .where(
            and(
              eq(syncRunTracks.userId, this.userId),
              eq(syncRunTracks.syncRunId, syncRunId),
              eq(syncRunTracks.spotifyTrackId, spotifyTrackId),
            ),
          )
          .limit(1)
      )[0] ?? null
    );
  }

  async updateSyncRunTrack(syncRunId: number, spotifyTrackId: string, patch: SyncRunTrackPatch) {
    const now = Date.now();
    await this.db
      .update(syncRunTracks)
      .set({
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.statusMessage !== undefined ? { statusMessage: patch.statusMessage } : {}),
        ...(patch.matchedVideoId !== undefined ? { matchedVideoId: patch.matchedVideoId } : {}),
        ...(patch.matchedVideoTitle !== undefined ? { matchedVideoTitle: patch.matchedVideoTitle } : {}),
        ...(patch.matchedChannelTitle !== undefined ? { matchedChannelTitle: patch.matchedChannelTitle } : {}),
        ...(patch.matchedScore !== undefined ? { matchedScore: patch.matchedScore } : {}),
        ...(patch.matchedSource !== undefined ? { matchedSource: patch.matchedSource } : {}),
        ...(patch.reviewVideoId !== undefined ? { reviewVideoId: patch.reviewVideoId } : {}),
        ...(patch.reviewVideoTitle !== undefined ? { reviewVideoTitle: patch.reviewVideoTitle } : {}),
        ...(patch.reviewChannelTitle !== undefined ? { reviewChannelTitle: patch.reviewChannelTitle } : {}),
        ...(patch.reviewVideoUrl !== undefined ? { reviewVideoUrl: patch.reviewVideoUrl } : {}),
        ...(patch.reviewSource !== undefined ? { reviewSource: patch.reviewSource } : {}),
        ...(patch.reviewScore !== undefined ? { reviewScore: patch.reviewScore } : {}),
        ...(patch.reviewReasonsJson !== undefined ? { reviewReasonsJson: patch.reviewReasonsJson } : {}),
        ...(patch.manualVideoId !== undefined ? { manualVideoId: patch.manualVideoId } : {}),
        ...(patch.manualResolutionType !== undefined ? { manualResolutionType: patch.manualResolutionType } : {}),
        ...(patch.playlistItemId !== undefined ? { playlistItemId: patch.playlistItemId } : {}),
        ...(patch.lastError !== undefined ? { lastError: patch.lastError } : {}),
        ...(patch.incrementAttemptCount ? { attemptCount: sql`${syncRunTracks.attemptCount} + 1` } : {}),
        updatedAt: now,
      })
      .where(
        and(
          eq(syncRunTracks.userId, this.userId),
          eq(syncRunTracks.syncRunId, syncRunId),
          eq(syncRunTracks.spotifyTrackId, spotifyTrackId),
        ),
      );
  }

  async listProcessableSyncRunTracks(syncRunId: number) {
    return this.db
      .select()
      .from(syncRunTracks)
      .where(
        and(
          eq(syncRunTracks.userId, this.userId),
          eq(syncRunTracks.syncRunId, syncRunId),
          sql`${syncRunTracks.status} NOT IN (${sql.join(TERMINAL_RUN_TRACK_STATUSES.map((status) => sql`${status}`), sql`, `)})`,
        ),
      )
      .orderBy(asc(syncRunTracks.trackOrder));
  }

  async refreshSyncRunProgress(syncRunId: number) {
    const rows = await this.db
      .select({
        status: syncRunTracks.status,
      })
      .from(syncRunTracks)
      .where(and(eq(syncRunTracks.userId, this.userId), eq(syncRunTracks.syncRunId, syncRunId)));

    const totalTracks = rows.length;
    const completedTracks = rows.filter((row: any) =>
      TERMINAL_RUN_TRACK_STATUSES.includes(row.status as SyncRunTrackStatus),
    ).length;
    const remainingTracks = Math.max(0, totalTracks - completedTracks);

    await this.updateSyncRun(syncRunId, {
      progress: {
        totalTracks,
        completedTracks,
        remainingTracks,
      },
    });

    return {
      totalTracks,
      completedTracks,
      remainingTracks,
    };
  }

  async getLibrarySummary(): Promise<LibrarySummary> {
    const rows = await this.db
      .select({
        searchStatus: trackMappings.searchStatus,
        lastSyncedAt: trackMappings.lastSyncedAt,
        manualVideoId: trackMappings.manualVideoId,
      })
      .from(trackMappings)
      .where(and(eq(trackMappings.userId, this.userId), isNull(trackMappings.spotifyRemovedAt)));

    return {
      totalTracks: rows.length,
      syncedTracks: rows.filter((row: any) => Boolean(row.lastSyncedAt)).length,
      pendingTracks: rows.filter((row: any) => !row.lastSyncedAt).length,
      reviewRequiredTracks: rows.filter((row: any) => row.searchStatus === "review_required").length,
      failedTracks: rows.filter((row: any) => row.searchStatus === "failed").length,
      noMatchTracks: rows.filter((row: any) => row.searchStatus === "no_match").length,
      manualMatchTracks: rows.filter((row: any) => Boolean(row.manualVideoId)).length,
    };
  }

  async getRunSummary(runId: number): Promise<RunSummary | null> {
    const run = await this.getSyncRun(runId);
    if (!run) {
      return null;
    }

    const rows = await this.db
      .select({
        status: syncRunTracks.status,
      })
      .from(syncRunTracks)
      .where(and(eq(syncRunTracks.userId, this.userId), eq(syncRunTracks.syncRunId, runId)));

    const statusCounts: Record<string, number> = {};
    for (const row of rows as Array<{ status: string }>) {
      statusCounts[row.status] = (statusCounts[row.status] ?? 0) + 1;
    }

    const totalTracks = rows.length;
    const skippedExistingTracks = statusCounts.skipped_existing ?? 0;
    const insertedTracks = statusCounts.inserted ?? 0;
    const reviewRequiredTracks = statusCounts.review_required ?? 0;
    const failedTracks = statusCounts.failed ?? 0;
    const noMatchTracks = statusCounts.no_match ?? 0;
    const waitingTracks =
      (statusCounts.waiting_for_youtube_quota ?? 0) +
      (statusCounts.waiting_for_spotify_retry ?? 0) +
      (statusCounts.needs_reauth ?? 0);
    const completedTracks = TERMINAL_RUN_TRACK_STATUSES.reduce(
      (count, status) => count + (statusCounts[status] ?? 0),
      0,
    );
    const remainingTracks = Math.max(0, totalTracks - completedTracks);
    const baselineReady = Boolean(run.playlistSnapshotCompletedAt);
    const scopedTotalTracks = baselineReady ? Math.max(0, totalTracks - skippedExistingTracks) : null;
    const scopedCompletedTracks =
      baselineReady && scopedTotalTracks !== null
        ? Math.min(
            scopedTotalTracks,
            insertedTracks +
              reviewRequiredTracks +
              failedTracks +
              noMatchTracks +
              (statusCounts.needs_reauth ?? 0),
          )
        : null;
    const scopedRemainingTracks =
      scopedTotalTracks !== null && scopedCompletedTracks !== null
        ? Math.max(0, scopedTotalTracks - scopedCompletedTracks)
        : null;

    return {
      totalTracks,
      completedTracks,
      remainingTracks,
      skippedExistingTracks,
      insertedTracks,
      reviewRequiredTracks,
      failedTracks,
      noMatchTracks,
      waitingTracks,
      scopedTotalTracks,
      scopedCompletedTracks,
      scopedRemainingTracks,
      baselineReady,
    };
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

  async listRemovedTracks() {
    return this.db
      .select()
      .from(trackMappings)
      .where(and(eq(trackMappings.userId, this.userId), sql`${trackMappings.spotifyRemovedAt} IS NOT NULL`))
      .orderBy(desc(trackMappings.spotifyRemovedAt), asc(trackMappings.spotifyAddedAt));
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
            eq(trackMappings.searchStatus, "review_required"),
            and(eq(trackMappings.searchStatus, "matched_manual"), isNull(trackMappings.lastSyncedAt)),
          ),
        ),
      )
      .orderBy(desc(trackMappings.updatedAt))
      .limit(limit);
  }

  async setManualVideoId(
    spotifyTrackId: string,
    manualVideoId: string,
    metadata: ManualSelectionMetadata = {},
  ) {
    await this.db
      .update(trackMappings)
      .set({
        manualVideoId,
        manualResolutionType: metadata.manualResolutionType ?? "manual_input",
        searchStatus: "matched_manual",
        matchedVideoId: manualVideoId,
        matchedVideoTitle: metadata.matchedVideoTitle ?? null,
        matchedChannelTitle: metadata.matchedChannelTitle ?? null,
        matchedSource: metadata.matchedSource ?? "manual",
        matchedScore: metadata.matchedScore ?? 100,
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
        searchStatus: "pending" satisfies TrackSearchStatus,
        reviewVideoId: null,
        reviewVideoTitle: null,
        reviewChannelTitle: null,
        reviewVideoUrl: null,
        reviewSource: null,
        reviewScore: null,
        reviewReasonsJson: null,
        reviewUpdatedAt: null,
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
        manualResolutionType: null,
        reviewVideoId: null,
        reviewVideoTitle: null,
        reviewChannelTitle: null,
        reviewVideoUrl: null,
        reviewSource: null,
        reviewScore: null,
        reviewReasonsJson: null,
        reviewUpdatedAt: null,
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

  async saveReviewCandidate(spotifyTrackId: string, result: MatchResult) {
    await this.db
      .update(trackMappings)
      .set({
        searchStatus: "review_required",
        reviewVideoId: result.candidate.videoId,
        reviewVideoTitle: result.candidate.title,
        reviewChannelTitle: result.candidate.channelTitle,
        reviewVideoUrl: result.candidate.url,
        reviewSource: result.candidate.source,
        reviewScore: Math.round(result.score),
        reviewReasonsJson: JSON.stringify(result.reasons),
        reviewUpdatedAt: Date.now(),
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
    searchStatus: "failed" | "no_match",
    message: string,
  ) {
    await this.db
      .update(trackMappings)
      .set({
        searchStatus,
        reviewVideoId: null,
        reviewVideoTitle: null,
        reviewChannelTitle: null,
        reviewVideoUrl: null,
        reviewSource: null,
        reviewScore: null,
        reviewReasonsJson: null,
        reviewUpdatedAt: null,
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

  async getPlaylistVideoByVideoId(playlistId: string, videoId: string) {
    return (
      (
        await this.db
          .select()
          .from(playlistVideos)
          .where(
            and(
              eq(playlistVideos.userId, this.userId),
              eq(playlistVideos.playlistId, playlistId),
              eq(playlistVideos.videoId, videoId),
            ),
          )
          .limit(1)
      )[0] ?? null
    );
  }

  async savePlaylistVideo(
    playlistId: string,
    video: PlaylistVideoInput,
  ) {
    const normalized = normalizePlaylistVideo(playlistId, video);
    if (!normalized) {
      throw new Error(
        `Cannot persist playlist video without playlistId, playlistItemId, and videoId (playlistId=${playlistId}, playlistItemId=${String(video.playlistItemId)}, videoId=${String(video.videoId)})`,
      );
    }

    const now = Date.now();
    await this.db
      .insert(playlistVideos)
      .values({
        id: randomUUID(),
        userId: this.userId,
        playlistId: normalized.playlistId,
        playlistItemId: normalized.playlistItemId,
        videoId: normalized.videoId,
        videoTitle: normalized.videoTitle,
        channelTitle: normalized.channelTitle,
        sourceSpotifyTrackId: normalized.sourceSpotifyTrackId ?? null,
        position: normalized.position,
        syncedAt: now,
      })
      .onConflictDoNothing({
        target: [playlistVideos.userId, playlistVideos.playlistId, playlistVideos.videoId],
      });

    return this.getPlaylistVideoByVideoId(normalized.playlistId, normalized.videoId);
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
  ): Promise<ReplacePlaylistVideosResult> {
    const now = Date.now();
    const normalized = normalizePlaylistVideoSnapshot(playlistId, videos);

    await this.db.transaction(async (tx: any) => {
      await tx
        .delete(playlistVideos)
        .where(and(eq(playlistVideos.userId, this.userId), eq(playlistVideos.playlistId, playlistId)));

      for (const video of normalized.storedVideos) {
        await tx
          .insert(playlistVideos)
          .values({
            id: randomUUID(),
            userId: this.userId,
            playlistId: video.playlistId,
            playlistItemId: video.playlistItemId,
            videoId: video.videoId,
            videoTitle: video.videoTitle,
            channelTitle: video.channelTitle,
            sourceSpotifyTrackId: video.sourceSpotifyTrackId ?? null,
            position: video.position,
            syncedAt: now,
          })
          .onConflictDoNothing({
            target: [playlistVideos.userId, playlistVideos.playlistId, playlistVideos.videoId],
          });
      }
    });

    await this.savePlaylistSnapshotRefreshedAt(now);

    return {
      storedVideos: normalized.storedVideos.map((video) => ({
        playlistItemId: video.playlistItemId,
        videoId: video.videoId,
        videoTitle: video.videoTitle,
        channelTitle: video.channelTitle,
        position: video.position,
        sourceSpotifyTrackId: video.sourceSpotifyTrackId ?? null,
      })),
      duplicateVideoIds: normalized.duplicateVideoIds,
      invalidItems: normalized.invalidItems,
    };
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

  async countSyncRunTracks(
    syncRunId: number,
    filter: SyncRunTrackStatus | "active" | "all" = "all",
  ) {
    const rows = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(syncRunTracks)
      .where(
        and(
          eq(syncRunTracks.userId, this.userId),
          eq(syncRunTracks.syncRunId, syncRunId),
          buildRunTrackFilter(filter),
        ),
      );

    return Number(rows[0]?.count ?? 0);
  }

  async getDashboardLiveData() {
    const summary = await this.getDashboardSummary();
    const activeRun = summary.activeRun;
    if (!activeRun) {
      return {
        ...summary,
        activeRunUpdatedAt: null,
        activeRunTracks: [],
        activeRunEvents: [],
        runSummary: null,
      };
    }

    return {
      ...summary,
      activeRunUpdatedAt: activeRun.updatedAt ?? activeRun.lastHeartbeatAt ?? activeRun.startedAt,
      activeRunTracks: await this.listSyncRunTracks(activeRun.id, { page: 1, pageSize: 50 }),
      activeRunEvents: await this.listSyncRunEvents(activeRun.id, 20),
      runSummary: await this.getRunSummary(activeRun.id),
    };
  }

  async getDashboardSummary() {
    const oauth = await this.listOAuthAccounts();
    const recentRunsPage = await this.listRecentSyncRunsPage({ limit: 5 });
    const recentRuns = recentRunsPage.items;
    const currentSyncState = await this.getSyncState();
    const attentionTracks = (await this.listAttentionTracks(30)).map((track: any) => ({
      spotifyTrackId: track.spotifyTrackId,
      trackName: track.trackName,
      artistNames: JSON.parse(track.artistNamesJson) as string[],
      albumName: track.albumName,
      searchStatus: track.searchStatus,
      lastError: track.lastError,
      externalUrl: track.externalUrl,
      manualVideoId: track.manualVideoId,
      manualResolutionType: track.manualResolutionType,
      matchedVideoId: track.matchedVideoId,
      matchedVideoTitle: track.matchedVideoTitle,
      matchedChannelTitle: track.matchedChannelTitle,
      matchedScore: track.matchedScore,
      reviewVideoId: track.reviewVideoId,
      reviewVideoTitle: track.reviewVideoTitle,
      reviewChannelTitle: track.reviewChannelTitle,
      reviewVideoUrl: track.reviewVideoUrl,
      reviewSource: track.reviewSource,
      reviewScore: track.reviewScore,
      reviewReasons: parseReviewReasons(track.reviewReasonsJson),
      reviewUpdatedAt: track.reviewUpdatedAt,
      playlistVideoId: track.playlistVideoId,
      matchedSource: track.matchedSource,
      lastSyncedAt: track.lastSyncedAt,
      updatedAt: track.updatedAt,
    }));
    const activeRun = await this.getActiveSyncRun();

    return {
      spotifyConnected: oauth.some((account: any) => account.provider === "spotify" && !account.invalidatedAt),
      youtubeConnected: oauth.some((account: any) => account.provider === "youtube" && !account.invalidatedAt),
      playlistId: await this.getManagedPlaylistId(),
      lastRunAt: recentRuns[0]?.finishedAt ?? recentRuns[0]?.startedAt ?? null,
      activeRun,
      recentRuns,
      recentRunsPage,
      attentionTracks,
      librarySummary: await this.getLibrarySummary(),
      lastLiveError: currentSyncState?.lastError ?? activeRun?.lastErrorSummary ?? null,
    };
  }

  private async upsertSyncState(input: {
    lastStartedSyncAt?: number | null;
    lastSuccessfulSyncAt?: number | null;
    lastFailedSyncAt?: number | null;
    activeRunId?: number | null;
    lastHeartbeatAt?: number | null;
    spotifyScanOffset?: number | null;
    lastError?: string | null;
  }) {
    const now = Date.now();
    await this.db
      .insert(syncState)
      .values({
        userId: this.userId,
        lastStartedSyncAt: input.lastStartedSyncAt ?? null,
        lastSuccessfulSyncAt: input.lastSuccessfulSyncAt ?? null,
        lastFailedSyncAt: input.lastFailedSyncAt ?? null,
        activeRunId: input.activeRunId ?? null,
        lastHeartbeatAt: input.lastHeartbeatAt ?? null,
        spotifyScanOffset: input.spotifyScanOffset ?? null,
        lastError: input.lastError ?? null,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: syncState.userId,
        set: {
          ...(input.lastStartedSyncAt !== undefined ? { lastStartedSyncAt: input.lastStartedSyncAt } : {}),
          ...(input.lastSuccessfulSyncAt !== undefined ? { lastSuccessfulSyncAt: input.lastSuccessfulSyncAt } : {}),
          ...(input.lastFailedSyncAt !== undefined ? { lastFailedSyncAt: input.lastFailedSyncAt } : {}),
          ...(input.activeRunId !== undefined ? { activeRunId: input.activeRunId } : {}),
          ...(input.lastHeartbeatAt !== undefined ? { lastHeartbeatAt: input.lastHeartbeatAt } : {}),
          ...(input.spotifyScanOffset !== undefined ? { spotifyScanOffset: input.spotifyScanOffset } : {}),
          ...(input.lastError !== undefined ? { lastError: input.lastError } : {}),
          updatedAt: now,
        },
      });
  }
}

function parseReviewReasons(raw: string | null) {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
  } catch {
    return [];
  }
}

function sanitizeSyncPayload(payload: unknown) {
  if (payload == null) {
    return null;
  }

  try {
    const text = JSON.stringify(payload);
    if (text.length <= 1200) {
      return JSON.parse(text) as unknown;
    }

    return {
      truncated: true,
      preview: text.slice(0, 1200),
    };
  } catch {
    return String(payload).slice(0, 1200);
  }
}

function normalizeRunStatus(status: SyncRunLifecycleStatus | "success" | "quota_exhausted"): SyncRunLifecycleStatus {
  switch (status) {
    case "success":
      return "completed";
    case "quota_exhausted":
      return "waiting_for_youtube_quota";
    default:
      return status;
  }
}

function buildRunTrackFilter(filter: SyncRunTrackStatus | "active" | "all") {
  if (filter === "all") {
    return sql`1 = 1`;
  }

  if (filter === "active") {
    return sql`${syncRunTracks.status} NOT IN (${sql.join(TERMINAL_RUN_TRACK_STATUSES.map((status) => sql`${status}`), sql`, `)})`;
  }

  return eq(syncRunTracks.status, filter);
}

function normalizePlaylistVideo(
  playlistId: string,
  video: PlaylistVideoInput,
): NormalizedPlaylistVideo | null {
  const normalizedPlaylistId = normalizeNonEmptyString(playlistId);
  const playlistItemId = normalizeNonEmptyString(video.playlistItemId);
  const videoId = normalizeNonEmptyString(video.videoId);

  if (!normalizedPlaylistId || !playlistItemId || !videoId) {
    return null;
  }

  return {
    playlistId: normalizedPlaylistId,
    playlistItemId,
    videoId,
    videoTitle: normalizeNullableString(video.videoTitle),
    channelTitle: normalizeNullableString(video.channelTitle),
    position: typeof video.position === "number" ? video.position : null,
    sourceSpotifyTrackId: normalizeNullableString(video.sourceSpotifyTrackId ?? null),
  };
}

function normalizePlaylistVideoSnapshot(
  playlistId: string,
  videos: PlaylistVideoInput[],
) {
  const uniqueByVideoId = new Map<string, NormalizedPlaylistVideo>();
  const duplicateVideoIds = new Set<string>();
  let invalidItems = 0;

  for (const video of videos) {
    const normalized = normalizePlaylistVideo(playlistId, video);
    if (!normalized) {
      invalidItems += 1;
      continue;
    }

    const existing = uniqueByVideoId.get(normalized.videoId);
    if (!existing) {
      uniqueByVideoId.set(normalized.videoId, normalized);
      continue;
    }

    duplicateVideoIds.add(normalized.videoId);
    if (shouldReplacePlaylistVideo(existing, normalized)) {
      uniqueByVideoId.set(normalized.videoId, normalized);
    }
  }

  return {
    storedVideos: Array.from(uniqueByVideoId.values()).sort(comparePlaylistVideoOrder),
    duplicateVideoIds: Array.from(duplicateVideoIds.values()).sort(),
    invalidItems,
  };
}

function shouldReplacePlaylistVideo(
  current: NormalizedPlaylistVideo,
  candidate: NormalizedPlaylistVideo,
) {
  if (current.position === null) {
    return candidate.position !== null;
  }

  if (candidate.position === null) {
    return false;
  }

  if (candidate.position !== current.position) {
    return candidate.position < current.position;
  }

  return candidate.playlistItemId < current.playlistItemId;
}

function comparePlaylistVideoOrder(
  left: NormalizedPlaylistVideo,
  right: NormalizedPlaylistVideo,
) {
  const leftPosition = left.position ?? Number.MAX_SAFE_INTEGER;
  const rightPosition = right.position ?? Number.MAX_SAFE_INTEGER;
  if (leftPosition !== rightPosition) {
    return leftPosition - rightPosition;
  }

  return left.playlistItemId.localeCompare(right.playlistItemId);
}

function normalizeNonEmptyString(value: string | null | undefined) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeNullableString(value: string | null | undefined) {
  if (value == null) {
    return null;
  }

  return normalizeNonEmptyString(value);
}
