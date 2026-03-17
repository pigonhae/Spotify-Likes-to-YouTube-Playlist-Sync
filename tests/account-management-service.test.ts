import path from "node:path";

import { describe, expect, it } from "vitest";

import type { AppConfig } from "../src/config.js";
import { createDatabase } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrate.js";
import {
  appSettings,
  oauthAccounts,
  oauthStates,
  playlistVideos,
  syncLock,
  syncRuns,
  trackMappings,
} from "../src/db/schema.js";
import { AppStore } from "../src/db/store.js";
import { AppError } from "../src/lib/errors.js";
import { AccountManagementService } from "../src/services/account-management-service.js";

describe("AccountManagementService", () => {
  it("disconnects Spotify without touching YouTube state", () => {
    const store = createStore();
    seedOAuthAccount(store, "spotify");
    seedOAuthAccount(store, "youtube");
    store.createOAuthState("spotify");
    store.createOAuthState("youtube");

    const service = new AccountManagementService(createConfig(), store);

    const first = service.disconnectSpotify();
    const second = service.disconnectSpotify();

    expect(first.alreadyDisconnected).toBe(false);
    expect(second.alreadyDisconnected).toBe(true);

    const providers = store.listOAuthAccounts().map((account) => account.provider);
    expect(providers).toEqual(["youtube"]);
    expect(
      store.db.select().from(oauthStates).all().map((row) => row.provider).sort(),
    ).toEqual(["youtube"]);
  });

  it("disconnects YouTube and clears playlist ownership state while keeping matches", () => {
    const store = createStore();
    seedOAuthAccount(store, "spotify");
    seedOAuthAccount(store, "youtube");
    store.createOAuthState("youtube");
    store.saveManagedPlaylistId("playlist-123");
    store.saveSpotifySnapshot([
      {
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
    ]);
    store.setManualVideoId("spotify-track-1", "dQw4w9WgXcQ");
    store.markTrackInserted("spotify-track-1", "playlist-item-1");
    store.replacePlaylistVideos("playlist-123", [
      {
        playlistItemId: "playlist-item-1",
        videoId: "dQw4w9WgXcQ",
        videoTitle: "Track One",
        channelTitle: "Artist One - Topic",
        position: 0,
      },
    ]);

    const service = new AccountManagementService(createConfig(), store);
    const result = service.disconnectYouTube();

    expect(result.alreadyDisconnected).toBe(false);
    expect(store.listOAuthAccounts().map((account) => account.provider)).toEqual(["spotify"]);
    expect(store.getManagedPlaylistId()).toBeNull();
    expect(store.db.select().from(playlistVideos).all()).toHaveLength(0);

    const track = store.getTrackBySpotifyId("spotify-track-1");
    expect(track?.manualVideoId).toBe("dQw4w9WgXcQ");
    expect(track?.matchedVideoId).toBe("dQw4w9WgXcQ");
    expect(track?.playlistVideoId).toBeNull();
    expect(track?.lastSyncedAt).toBeNull();
  });

  it("resets all project state but leaves lock metadata alone", () => {
    const store = createStore();
    seedOAuthAccount(store, "spotify");
    seedOAuthAccount(store, "youtube");
    store.createOAuthState("spotify");
    store.saveManagedPlaylistId("playlist-123");
    store.incrementDailyQuotaUsage("2026-03-17", 101);
    store.saveSpotifySnapshot([
      {
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
    ]);
    store.replacePlaylistVideos("playlist-123", [
      {
        playlistItemId: "playlist-item-1",
        videoId: "dQw4w9WgXcQ",
        videoTitle: "Track One",
        channelTitle: "Artist One - Topic",
        position: 0,
      },
    ]);
    const runId = store.createSyncRun("manual");
    store.finishSyncRun(runId, "success", { ok: true });

    const service = new AccountManagementService(createConfig(), store);
    service.resetAll();

    expect(store.db.select().from(oauthAccounts).all()).toHaveLength(0);
    expect(store.db.select().from(oauthStates).all()).toHaveLength(0);
    expect(store.db.select().from(appSettings).all()).toHaveLength(0);
    expect(store.db.select().from(trackMappings).all()).toHaveLength(0);
    expect(store.db.select().from(playlistVideos).all()).toHaveLength(0);
    expect(store.db.select().from(syncRuns).all()).toHaveLength(0);

    const locks = store.db.select().from(syncLock).all();
    expect(locks).toHaveLength(1);
    expect(locks[0]?.holder).toBeNull();
  });

  it("refuses destructive actions while the sync lock is held", () => {
    const store = createStore();
    seedOAuthAccount(store, "spotify");

    const acquired = store.acquireLock("hourly-sync", "foreign-holder", 60_000);
    expect(acquired).toBe(true);

    const service = new AccountManagementService(createConfig(), store);

    expect(() => service.disconnectSpotify()).toThrowError(AppError);
    expect(() => service.disconnectSpotify()).toThrowError(
      "동기화 작업이 실행 중이라 지금은 처리할 수 없습니다. 잠시 후 다시 시도해 주세요.",
    );
  });
});

function createStore() {
  const database = createDatabase(":memory:");
  runMigrations(database.sqlite, path.resolve("drizzle"));
  return new AppStore(database);
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

function seedOAuthAccount(store: AppStore, provider: "spotify" | "youtube") {
  store.upsertOAuthAccount({
    provider,
    encryptedAccessToken: `encrypted-${provider}-access-token`,
    encryptedRefreshToken: `encrypted-${provider}-refresh-token`,
    tokenExpiresAt: Date.now() + 60_000,
    scope: provider === "spotify" ? "user-library-read" : "youtube.force-ssl",
    externalUserId: `${provider}-user`,
    externalDisplayName: `${provider.toUpperCase()} User`,
  });
}
