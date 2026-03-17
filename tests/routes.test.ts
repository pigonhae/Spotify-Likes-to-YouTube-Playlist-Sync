import basicAuth from "@fastify/basic-auth";
import formbody from "@fastify/formbody";
import fastify from "fastify";
import { describe, expect, it } from "vitest";

import type { AppContext } from "../src/app.js";
import { registerRoutes } from "../src/routes/index.js";
import { AccountManagementService } from "../src/services/account-management-service.js";
import { QuotaService } from "../src/services/quota-service.js";
import { createTestConfig, createTestStore } from "./helpers/test-support.js";

describe("registerRoutes", () => {
  it("protects reset routes with basic auth", async () => {
    const { app, close } = await createTestApp();

    const response = await app.inject({
      method: "POST",
      url: "/admin/reset",
    });

    expect(response.statusCode).toBe(401);
    await close();
  });

  it("rejects full reset when RESET confirmation text is missing", async () => {
    const { app, store, close } = await createTestApp();
    await seedSpotifyAccount(store);

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
    expect(response.headers.location).toContain(
      encodeURIComponent("전체 초기화를 진행하려면 RESET을 정확히 입력해 주세요."),
    );
    expect(await store.listOAuthAccounts()).toHaveLength(1);

    await close();
  });
});

async function createTestApp() {
  const config = createTestConfig();
  const { store, close: closeStore } = await createTestStore();
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
      createAuthorizationUrl: async () => "https://example.com/oauth",
      handleSpotifyCallback: async () => undefined,
      handleYouTubeCallback: async () => undefined,
    },
    quotaService,
    syncService: {
      run: async () => ({
        skipped: true,
        reason: "Spotify 怨꾩젙 ?곌껐???꾩슂?⑸땲??",
      }),
    },
    accountManagementService: new AccountManagementService(config, store),
  } as unknown as AppContext;

  await registerRoutes(app, context);
  return {
    app,
    store,
    close: async () => {
      await app.close();
      await closeStore();
    },
  };
}

async function seedSpotifyAccount(store: Awaited<ReturnType<typeof createTestStore>>["store"]) {
  await store.upsertOAuthAccount({
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
