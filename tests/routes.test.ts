import path from "node:path";

import basicAuth from "@fastify/basic-auth";
import formbody from "@fastify/formbody";
import fastify from "fastify";
import { describe, expect, it } from "vitest";

import type { AppContext } from "../src/app.js";
import type { AppConfig } from "../src/config.js";
import { createDatabase } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrate.js";
import { AppStore } from "../src/db/store.js";
import { registerRoutes } from "../src/routes/index.js";
import { AccountManagementService } from "../src/services/account-management-service.js";
import { QuotaService } from "../src/services/quota-service.js";

describe("registerRoutes", () => {
  it("protects reset routes with basic auth", async () => {
    const { app } = await createTestApp();

    const response = await app.inject({
      method: "POST",
      url: "/admin/reset",
    });

    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("rejects full reset when RESET confirmation text is missing", async () => {
    const { app, store } = await createTestApp();
    seedSpotifyAccount(store);

    const response = await app.inject({
      method: "POST",
      url: "/admin/reset",
      headers: {
        authorization: createBasicAuthHeader("admin", "password"),
        "content-type": "application/x-www-form-urlencoded",
      },
      payload: "confirmationText=",
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toContain("level=error");
    expect(response.headers.location).toContain(encodeURIComponent("전체 초기화를 진행하려면 RESET을 정확히 입력해 주세요."));
    expect(store.listOAuthAccounts()).toHaveLength(1);

    await app.close();
  });
});

async function createTestApp() {
  const config = createConfig();
  const database = createDatabase(":memory:");
  runMigrations(database.sqlite, path.resolve("drizzle"));
  const store = new AppStore(database);
  const quotaService = new QuotaService(store, config.YOUTUBE_DAILY_QUOTA_LIMIT);
  const app = fastify();

  await app.register(formbody);
  await app.register(basicAuth, {
    validate: async (username, password) => {
      if (username !== config.APP_BASIC_AUTH_USER || password !== config.APP_BASIC_AUTH_PASS) {
        throw new Error("Invalid credentials");
      }
    },
    authenticate: true,
  });

  const context = {
    config,
    store,
    oauthService: {
      createAuthorizationUrl: () => "https://example.com/oauth",
      handleSpotifyCallback: async () => undefined,
      handleYouTubeCallback: async () => undefined,
    },
    quotaService,
    syncService: {
      run: async () => ({
        skipped: true,
        reason: "Spotify 계정 연결이 필요합니다.",
      }),
    },
    accountManagementService: new AccountManagementService(config, store),
  } as unknown as AppContext;

  await registerRoutes(app, context);
  return { app, store };
}

function createConfig(): AppConfig {
  return {
    NODE_ENV: "test",
    HOST: "127.0.0.1",
    PORT: 3000,
    LOG_LEVEL: "silent",
    APP_BASE_URL: "http://127.0.0.1:3000",
    APP_BASIC_AUTH_USER: "admin",
    APP_BASIC_AUTH_PASS: "password",
    DATABASE_PATH: ":memory:",
    TOKEN_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    SPOTIFY_CLIENT_ID: "spotify-id",
    SPOTIFY_CLIENT_SECRET: "spotify-secret",
    GOOGLE_CLIENT_ID: "google-id",
    GOOGLE_CLIENT_SECRET: "google-secret",
    YOUTUBE_API_KEY: "youtube-key",
    SYNC_TRIGGER_SECRET: "sync-secret-sync-secret",
    YOUTUBE_PLAYLIST_ID: undefined,
    YOUTUBE_PLAYLIST_TITLE: "Playlist",
    YOUTUBE_PLAYLIST_DESCRIPTION: "Desc",
    YOUTUBE_PLAYLIST_PRIVACY: "unlisted",
    YOUTUBE_DAILY_QUOTA_LIMIT: 10_000,
    YOUTUBE_SEARCH_PROVIDER: "hybrid",
    SYNC_LOCK_TTL_MINUTES: 55,
    SPOTIFY_PAGE_SIZE: 50,
    YOUTUBE_FALLBACK_RESULT_LIMIT: 5,
    MATCH_THRESHOLD: 65,
    appBaseUrl: "http://127.0.0.1:3000",
    spotifyRedirectUri: "http://127.0.0.1:3000/auth/spotify/callback",
    youtubeRedirectUri: "http://127.0.0.1:3000/auth/youtube/callback",
    syncLockTtlMs: 55 * 60 * 1000,
    isProduction: false,
  };
}

function seedSpotifyAccount(store: AppStore) {
  store.upsertOAuthAccount({
    provider: "spotify",
    encryptedAccessToken: "encrypted-spotify-access-token",
    encryptedRefreshToken: "encrypted-spotify-refresh-token",
    tokenExpiresAt: Date.now() + 60_000,
    scope: "user-library-read",
    externalUserId: "spotify-user",
    externalDisplayName: "Spotify User",
  });
}

function createBasicAuthHeader(username: string, password: string) {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}
