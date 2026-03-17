import fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { buildWorkerHealthHost } from "../src/services/sync/worker-health-host.js";

describe("buildWorkerHealthHost", () => {
  const apps: FastifyInstance[] = [];

  afterEach(async () => {
    while (apps.length > 0) {
      const app = apps.pop();
      if (app) {
        await app.close();
      }
    }
  });

  it("returns a worker health payload even when the last tick failed", async () => {
    const loggerHost = fastify();
    const app = buildWorkerHealthHost(loggerHost.log, () => ({
      schedulerRunning: true,
      lastTickAt: Date.parse("2026-03-18T00:00:00.000Z"),
      lastTickError: "quota exceeded",
    }));
    apps.push(loggerHost);
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      process: "worker",
      schedulerRunning: true,
      lastTickAt: Date.parse("2026-03-18T00:00:00.000Z"),
      lastTickError: "quota exceeded",
    });
  });
});
