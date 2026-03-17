import fastify from "fastify";
import basicAuth from "@fastify/basic-auth";
import formbody from "@fastify/formbody";

import { getConfig } from "./config.js";
import { createDatabase } from "./db/client.js";
import { runMigrations } from "./db/migrate.js";
import { createAppStore, type AppStore } from "./db/store.js";
import { YouTubeSearchService } from "./providers/search/youtube-search.js";
import { registerRoutes } from "./routes/index.js";
import { AccountManagementService } from "./services/account-management-service.js";
import { OAuthService } from "./services/oauth-service.js";
import { QuotaService } from "./services/quota-service.js";
import { ResumeScheduler } from "./services/sync/resume-scheduler.js";
import { SyncService } from "./services/sync/sync-service.js";
import { TrackReviewService } from "./services/track-review-service.js";

export interface AppContext {
  config: ReturnType<typeof getConfig>;
  store: AppStore;
  oauthService: OAuthService;
  quotaService: QuotaService;
  syncService: SyncService;
  trackReviewService: TrackReviewService;
  accountManagementService: AccountManagementService;
}

export async function buildApp() {
  const config = getConfig();
  const database = createDatabase({
    connectionString: config.DATABASE_URL,
    ssl: config.DATABASE_SSL,
    max: config.DATABASE_POOL_MAX,
  });
  await runMigrations(database.pool, "drizzle");
  const store = await createAppStore(database, config.OWNER_USER_KEY);
  const quotaService = new QuotaService(store, config.YOUTUBE_DAILY_QUOTA_LIMIT);
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
  const trackReviewService = new TrackReviewService(
    store,
    oauthService.getYouTubeClient(),
    quotaService,
  );
  const accountManagementService = new AccountManagementService(config, store);

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
    trackReviewService,
    accountManagementService,
  };

  const resumeScheduler = new ResumeScheduler(syncService, app.log);
  await resumeScheduler.start();

  app.get("/health", async () => ({
    ok: true,
    timestamp: new Date().toISOString(),
  }));

  app.addHook("onClose", async () => {
    await resumeScheduler.stop();
    await database.close();
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
