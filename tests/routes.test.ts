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
    const response = await app.inject({ method: "POST", url: "/admin/reset" });
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
    expect(response.headers.location).toContain(encodeURIComponent("Type RESET to confirm a full reset."));
    expect(await store.listOAuthAccounts()).toHaveLength(1);

    await close();
  });

  it("serves the live dashboard API and manual review endpoint", async () => {
    const { app, close } = await createTestApp();

    const liveResponse = await app.inject({
      method: "GET",
      url: "/api/dashboard/live",
      headers: {
        authorization: createBasicAuthHeader("admin", "password"),
      },
    });

    expect(liveResponse.statusCode).toBe(200);
    expect(liveResponse.json()).toMatchObject({
      spotifyConnected: false,
      youtubeConnected: false,
      recentRuns: [],
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/tracks/spotify-track-1/review/manual",
      headers: {
        authorization: createBasicAuthHeader("admin", "password"),
        "content-type": "application/x-www-form-urlencoded",
      },
      payload: "videoInput=dQw4w9WgXcQ",
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toContain(encodeURIComponent("Manual selection saved."));

    await close();
  });

  it("serves paginated sync run tracks for live polling", async () => {
    const { app, store, close } = await createTestApp();
    const runId = await store.createSyncRun("manual");

    await store.upsertSyncRunTrackFromSpotify({
      syncRunId: runId,
      trackOrder: 0,
      track: {
        spotifyTrackId: "spotify-track-1",
        name: "Track One",
        artistNames: ["Artist One"],
        albumName: "Album One",
        albumReleaseDate: "2024-01-01",
        durationMs: 180_000,
        isrc: null,
        addedAt: Date.parse("2026-03-17T00:00:00.000Z"),
        externalUrl: "https://open.spotify.com/track/spotify-track-1",
      },
    });
    await store.upsertSyncRunTrackFromSpotify({
      syncRunId: runId,
      trackOrder: 1,
      track: {
        spotifyTrackId: "spotify-track-2",
        name: "Track Two",
        artistNames: ["Artist Two"],
        albumName: "Album Two",
        albumReleaseDate: "2024-01-02",
        durationMs: 181_000,
        isrc: null,
        addedAt: Date.parse("2026-03-17T00:01:00.000Z"),
        externalUrl: "https://open.spotify.com/track/spotify-track-2",
      },
    });
    await store.updateSyncRunTrack(runId, "spotify-track-2", {
      status: "failed",
      statusMessage: "Search failed",
      lastError: "youtube search returned 500",
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/sync-runs/${runId}/tracks?page=1&pageSize=1&filter=failed`,
      headers: {
        authorization: createBasicAuthHeader("admin", "password"),
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      run: { id: runId },
      page: 1,
      pageSize: 1,
      total: 1,
      items: [
        {
          spotifyTrackId: "spotify-track-2",
          status: "failed",
          statusMessage: "Search failed",
        },
      ],
    });

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
        runId: 1,
        status: "completed",
        stats: {
          scannedSpotifyTracks: 0,
          newlySeenTracks: 0,
          removedFromSpotify: 0,
          playlistItemsSeen: 0,
          queuedTracks: 0,
          insertedTracks: 0,
          skippedAlreadyInPlaylist: 0,
          reusedCachedMatches: 0,
          manualOverridesApplied: 0,
          reviewRequiredCount: 0,
          noMatchCount: 0,
          failedCount: 0,
          quotaAbort: false,
        },
      }),
    },
    trackReviewService: {
      acceptRecommendation: async () => ({
        alreadySelected: false,
        videoId: "review12345A",
      }),
      saveManualSelection: async () => ({
        alreadySelected: false,
        videoId: "dQw4w9WgXcQ",
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
