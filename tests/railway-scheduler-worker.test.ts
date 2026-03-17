import { eq } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import { describe, expect, it, vi, afterEach } from "vitest";

import { syncRuns } from "../src/db/schema.js";
import { AppError } from "../src/lib/errors.js";
import {
  RailwaySchedulerWorker,
  getLatestScheduledSlotWindow,
} from "../src/services/sync/railway-scheduler-worker.js";
import type { SyncRunResult, SyncStats } from "../src/types.js";
import { createTestStore } from "./helpers/test-support.js";

describe("RailwaySchedulerWorker", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not create a duplicate scheduled run in the same hourly slot", async () => {
    vi.useFakeTimers();

    const { store, close } = await createTestStore();
    const stats = createEmptyStats();
    const now = Date.parse("2026-03-18T01:17:30.000Z");
    vi.setSystemTime(now);
    const run = vi.fn(async (trigger: string) => {
      const runId = await store.createSyncRun(trigger);
      await store.finishSyncRun(runId, "success", stats);
      return {
        runId,
        status: "completed",
        stats,
      } satisfies SyncRunResult;
    });
    const resumeDueRuns = vi.fn(async () => null);
    const logger = createLogger();
    const slot = getLatestScheduledSlotWindow(now);

    const worker = new RailwaySchedulerWorker(
      { run, resumeDueRuns },
      store,
      logger,
      { now: () => now },
    );

    await worker.tick();
    await worker.tick();

    expect(run).toHaveBeenCalledTimes(1);
    expect(await store.hasSyncRunWithTriggerInWindow("schedule", slot.startAt, slot.endAt)).toBe(true);

    await close();
  });

  it("prioritizes resuming due work before starting a scheduled run", async () => {
    const { store, close } = await createTestStore();
    const resumeDueRuns = vi.fn(async () => ({
      runId: 99,
      status: "waiting_for_spotify_retry",
      stats: createEmptyStats(),
    } satisfies SyncRunResult));
    const run = vi.fn();
    const logger = createLogger();

    const worker = new RailwaySchedulerWorker(
      { run, resumeDueRuns },
      store,
      logger,
      { now: () => Date.parse("2026-03-18T01:17:30.000Z") },
    );

    await worker.tick();

    expect(resumeDueRuns).toHaveBeenCalledTimes(1);
    expect(run).not.toHaveBeenCalled();

    await close();
  });

  it("treats stale running runs as resumable but excludes needs_reauth", async () => {
    const { store, close } = await createTestStore();
    const now = Date.parse("2026-03-18T01:17:30.000Z");
    const staleRunId = await store.createSyncRun("manual");
    const reauthRunId = await store.createSyncRun("manual");

    await store.pauseSyncRun(reauthRunId, "needs_reauth", {
      phase: "paused",
      statusMessage: "Reconnect Spotify before retrying",
    });

    const staleHeartbeat = now - (6 * 60 * 1000);
    await store.db
      .update(syncRuns)
      .set({
        status: "running",
        phase: "processing_tracks",
        lastHeartbeatAt: staleHeartbeat,
        updatedAt: staleHeartbeat,
      })
      .where(eq(syncRuns.id, staleRunId));

    const resumable = await store.findResumableSyncRun(now, 5 * 60 * 1000);

    expect(resumable?.id).toBe(staleRunId);
    expect(resumable?.status).toBe("running");

    await store.db
      .update(syncRuns)
      .set({
        status: "completed",
        updatedAt: now,
      })
      .where(eq(syncRuns.id, staleRunId));

    const nothingDue = await store.findResumableSyncRun(now, 5 * 60 * 1000);
    expect(nothingDue).toBeNull();

    await close();
  });

  it("skips the tick cleanly when a manual run already holds the sync lock", async () => {
    const { store, close } = await createTestStore();
    const logger = createLogger();
    const worker = new RailwaySchedulerWorker(
      {
        resumeDueRuns: vi.fn(async () => null),
        run: vi.fn(async () => {
          throw new AppError("Sync is already running", 409);
        }),
      },
      store,
      logger,
      { now: () => Date.parse("2026-03-18T01:17:30.000Z") },
    );

    await expect(worker.tick()).resolves.toBeUndefined();
    expect(logger.info).toHaveBeenCalled();

    await close();
  });

  it("starts immediately and stops its polling loop cleanly", async () => {
    vi.useFakeTimers();

    const resumeDueRuns = vi.fn(async () => null);
    const run = vi.fn(async () => ({
      runId: 1,
      status: "completed",
      stats: createEmptyStats(),
    } satisfies SyncRunResult));
    const hasSyncRunWithTriggerInWindow = vi
      .fn<(...args: [string, number, number]) => Promise<boolean>>()
      .mockResolvedValue(true);
    const logger = createLogger();
    const worker = new RailwaySchedulerWorker(
      { run, resumeDueRuns },
      { hasSyncRunWithTriggerInWindow },
      logger,
      {
        pollIntervalMs: 1_000,
        now: () => Date.parse("2026-03-18T01:17:30.000Z"),
      },
    );

    await worker.start();
    expect(resumeDueRuns).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(resumeDueRuns).toHaveBeenCalledTimes(2);

    await worker.stop();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(resumeDueRuns).toHaveBeenCalledTimes(2);
  });
});

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

function createLogger() {
  return {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as FastifyBaseLogger;
}
