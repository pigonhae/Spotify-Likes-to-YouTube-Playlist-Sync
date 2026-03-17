import fastify, { type FastifyBaseLogger } from "fastify";

export function buildWorkerHealthHost(
  logger: FastifyBaseLogger,
  getHealthSnapshot: () => {
    schedulerRunning: boolean;
    lastTickAt: number | null;
    lastTickError: string | null;
  },
) {
  const app = fastify({
    loggerInstance: logger,
  });

  app.get("/health", async () => ({
    ok: true,
    process: "worker",
    timestamp: new Date().toISOString(),
    ...getHealthSnapshot(),
  }));

  return app;
}
