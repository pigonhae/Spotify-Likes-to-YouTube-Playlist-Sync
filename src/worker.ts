import fastify from "fastify";

import { createRuntime } from "./runtime.js";
import { RailwaySchedulerWorker } from "./services/sync/railway-scheduler-worker.js";
import { buildWorkerHealthHost } from "./services/sync/worker-health-host.js";

const runtime = await createRuntime();

const loggerHost = fastify({
  logger: {
    level: runtime.config.LOG_LEVEL,
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        "res.headers.set-cookie",
      ],
      remove: true,
    },
  },
});

const worker = new RailwaySchedulerWorker(
  runtime.syncService,
  runtime.store,
  loggerHost.log,
  {
    pollIntervalMs: runtime.config.SCHEDULER_POLL_INTERVAL_MS,
  },
);

const healthHost = buildWorkerHealthHost(
  loggerHost.log,
  () => worker.getHealthSnapshot(),
);

let shuttingDown = false;

const shutdown = async (signal: "SIGINT" | "SIGTERM") => {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  loggerHost.log.info({ signal }, "scheduler worker shutting down");

  try {
    await worker.stop();
    await healthHost.close();
    await runtime.close();
    await loggerHost.close();
    process.exit(0);
  } catch (error) {
    loggerHost.log.error({ err: error, signal }, "scheduler worker shutdown failed");
    process.exit(1);
  }
};

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});

process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});

await healthHost.listen({
  host: runtime.config.HOST,
  port: runtime.config.PORT,
});

void worker.start().then(() => {
  loggerHost.log.info(
    {
      pollIntervalMs: runtime.config.SCHEDULER_POLL_INTERVAL_MS,
    },
    "scheduler worker started",
  );
}).catch((error) => {
  loggerHost.log.error({ err: error }, "scheduler worker failed during startup");
});
