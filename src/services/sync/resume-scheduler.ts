import type { FastifyBaseLogger } from "fastify";

import type { SyncService } from "./sync-service.js";

export class ResumeScheduler {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly syncService: SyncService,
    private readonly logger: FastifyBaseLogger,
    private readonly intervalMs = 60_000,
  ) {}

  async start() {
    await this.tick("startup");
    this.timer = setInterval(() => {
      void this.tick("interval");
    }, this.intervalMs);
  }

  async stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick(trigger: "startup" | "interval") {
    try {
      const result = await this.syncService.resumeDueRuns(`scheduler:${trigger}`);
      if (result) {
        this.logger.info(
          {
            runId: result.runId,
            status: result.status,
          },
          "resume scheduler handled a due sync run",
        );
      }
    } catch (error) {
      this.logger.error({ err: error }, "resume scheduler failed");
    }
  }
}
