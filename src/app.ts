import fastify from "fastify";
import basicAuth from "@fastify/basic-auth";
import formbody from "@fastify/formbody";

import { getConfig } from "./config.js";
import { createDatabase } from "./db/client.js";
import { runMigrations } from "./db/migrate.js";
import { AppStore } from "./db/store.js";
import { YouTubeSearchService } from "./providers/search/youtube-search.js";
import { registerRoutes } from "./routes/index.js";
import { OAuthService } from "./services/oauth-service.js";
import { QuotaService } from "./services/quota-service.js";
import { SyncService } from "./services/sync/sync-service.js";

export interface AppContext {
  config: ReturnType<typeof getConfig>;
  store: AppStore;
  oauthService: OAuthService;
  quotaService: QuotaService;
  syncService: SyncService;
}

export async function buildApp() {
  const config = getConfig();
  const database = createDatabase(config.DATABASE_PATH);
  runMigrations(database.sqlite, "drizzle");
  const store = new AppStore(database);
  const quotaService = new QuotaService(store);
  const oauthService = new OAuthService(config, store);
  const youtubeSearchService = new YouTubeSearchService(
    config,
    oauthService.getYouTubeClient(),
    quotaService,
  );
  const syncService = new SyncService(
    config,
    store,
    oauthService,
    quotaService,
    youtubeSearchService,
  );

  const app = fastify({
    logger: {
      level: config.LOG_LEVEL,
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
      if (username !== config.APP_BASIC_AUTH_USER || password !== config.APP_BASIC_AUTH_PASS) {
        throw new Error("Invalid credentials");
      }
    },
    authenticate: true,
  });

  const context: AppContext = {
    config,
    store,
    oauthService,
    quotaService,
    syncService,
  };

  app.get("/health", async () => ({
    ok: true,
    timestamp: new Date().toISOString(),
  }));

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
