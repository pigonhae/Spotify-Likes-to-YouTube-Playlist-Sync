import { getConfig } from "./config.js";
import { createDatabase } from "./db/client.js";
import { runMigrations } from "./db/migrate.js";
import { createAppStore, type AppStore } from "./db/store.js";
import { YouTubeSearchService } from "./providers/search/youtube-search.js";
import { AccountManagementService } from "./services/account-management-service.js";
import { OAuthService } from "./services/oauth-service.js";
import { QuotaService } from "./services/quota-service.js";
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

export interface AppRuntime extends AppContext {
  close: () => Promise<void>;
}

export async function createRuntime(): Promise<AppRuntime> {
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

  return {
    config,
    store,
    oauthService,
    quotaService,
    syncService,
    trackReviewService,
    accountManagementService,
    close: async () => {
      await database.close();
    },
  };
}
