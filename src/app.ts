import fastify from "fastify";
import basicAuth from "@fastify/basic-auth";
import formbody from "@fastify/formbody";

import { registerRoutes } from "./routes/index.js";
import { createRuntime, type AppContext } from "./runtime.js";

export type { AppContext } from "./runtime.js";

export async function buildApp() {
  const runtime = await createRuntime();

  const app = fastify({
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

  await app.register(formbody);
  await app.register(basicAuth, {
    validate: async (username, password) => {
      if (username !== runtime.config.APP_BASIC_AUTH_USER || password !== runtime.config.APP_BASIC_AUTH_PASS) {
        throw new Error("Invalid credentials");
      }
    },
    authenticate: true,
  });

  const context: AppContext = runtime;

  app.get("/health", async () => ({
    ok: true,
    timestamp: new Date().toISOString(),
  }));

  app.addHook("onClose", async () => {
    await runtime.close();
  });

  await registerRoutes(app, context);

  app.setErrorHandler((error, _request, reply) => {
    app.log.error({ err: error }, "request failed");

    const statusCode =
      typeof (error as { statusCode?: unknown }).statusCode === "number"
        ? Number((error as { statusCode?: number }).statusCode)
        : 500;

    if (!reply.sent) {
      reply.status(statusCode).send({
        error:
          statusCode >= 500
            ? "Internal Server Error"
            : error instanceof Error
              ? error.message
              : "Request failed",
      });
    }
  });

  return { app, context };
}
