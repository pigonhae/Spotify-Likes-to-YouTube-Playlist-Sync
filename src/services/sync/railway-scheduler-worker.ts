import type { FastifyBaseLogger } from "fastify";

import { AppError } from "../../lib/errors.js";
import type { AppStore } from "../../db/store.js";
import type { SyncRunResult } from "../../types.js";
import type { SyncService } from "./sync-service.js";

const DEFAULT_POLL_INTERVAL_MS = 60_000;
const DEFAULT_SCHEDULE_MINUTE = 17;
const HOUR_MS = 60 * 60 * 1000;

export interface SchedulerSlotWindow {
  startAt: number;
  endAt: number;
}

interface RailwaySchedulerWorkerOptions {
  pollIntervalMs?: number;
  scheduleMinute?: number;
  now?: () => number;
}

export function getLatestScheduledSlotWindow(
  now: number,
  scheduleMinute = DEFAULT_SCHEDULE_MINUTE,
): SchedulerSlotWindow {
  const slotStart = new Date(now);
  slotStart.setUTCMinutes(scheduleMinute, 0, 0);

  if (slotStart.getTime() > now) {
    slotStart.setUTCHours(slotStart.getUTCHours() - 1);
  }

  const startAt = slotStart.getTime();
  return {
    startAt,
    endAt: startAt + HOUR_MS,
  };
}

export class RailwaySchedulerWorker {
  private timer: NodeJS.Timeout | null = null;
  private inFlightTick: Promise<void> | null = null;
  private readonly pollIntervalMs: number;
  private readonly scheduleMinute: number;
  private readonly now: () => number;
  private schedulerRunning = false;
  private lastTickAt: number | null = null;
  private lastTickError: string | null = null;

  constructor(
    private readonly syncService: Pick<SyncService, "run" | "resumeDueRuns">,
    private readonly store: Pick<AppStore, "hasSyncRunWithTriggerInWindow">,
    private readonly logger: FastifyBaseLogger,
    options: RailwaySchedulerWorkerOptions = {},
  ) {
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.scheduleMinute = options.scheduleMinute ?? DEFAULT_SCHEDULE_MINUTE;
    this.now = options.now ?? Date.now;
  }

  async start() {
    this.schedulerRunning = true;
    await this.tick("startup");
    this.timer = setInterval(() => {
      void this.tick("interval");
    }, this.pollIntervalMs);
  }

  async stop() {
    this.schedulerRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    await this.inFlightTick;
  }

  async tick(trigger: "startup" | "interval" | "manual" = "manual") {
    if (this.inFlightTick) {
      this.logger.debug({ trigger }, "scheduler tick skipped because another tick is still running");
      return this.inFlightTick;
    }

    const task = this.runTick(trigger).finally(() => {
      if (this.inFlightTick === task) {
        this.inFlightTick = null;
      }
    });

    this.inFlightTick = task;
    return task;
  }

  private async runTick(trigger: "startup" | "interval" | "manual") {
    try {
      this.lastTickError = null;
      const resumed = await this.syncService.resumeDueRuns(`worker:${trigger}`);
      if (resumed) {
        this.logger.info(
          {
            runId: resumed.runId,
            status: resumed.status,
            trigger,
          },
          "worker resumed a due sync run",
        );
        return;
      }

      const slot = getLatestScheduledSlotWindow(this.now(), this.scheduleMinute);
      const alreadyStarted = await this.store.hasSyncRunWithTriggerInWindow(
        "schedule",
        slot.startAt,
        slot.endAt,
      );

      if (alreadyStarted) {
        return;
      }

      const result = await this.syncService.run("schedule");
      this.logScheduledRun(result, slot, trigger);
    } catch (error) {
      this.lastTickError = error instanceof Error ? error.message : String(error);
      if (error instanceof AppError && error.statusCode === 409) {
        this.logger.info(
          {
            trigger,
            error: error.message,
          },
          "worker skipped scheduler tick because the sync lock is already held",
        );
        return;
      }

      this.logger.error({ err: error, trigger }, "worker scheduler tick failed");
    } finally {
      this.lastTickAt = this.now();
    }
  }

  getHealthSnapshot() {
    return {
      schedulerRunning: this.schedulerRunning,
      lastTickAt: this.lastTickAt,
      lastTickError: this.lastTickError,
    };
  }

  private logScheduledRun(result: SyncRunResult, slot: SchedulerSlotWindow, trigger: string) {
    this.logger.info(
      {
        runId: result.runId,
        status: result.status,
        trigger,
        slotStartAt: slot.startAt,
        slotEndAt: slot.endAt,
      },
      "worker started the scheduled sync run",
    );
  }
}
