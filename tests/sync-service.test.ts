import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { AppConfig } from "../src/config.js";
import { createDatabase } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrate.js";
import { AppStore } from "../src/db/store.js";
import { QuotaService } from "../src/services/quota-service.js";
import { SyncService } from "../src/services/sync/sync-service.js";

describe("SyncService", () => {
  it("does not insert a duplicate when the video already exists in the playlist", async () => {
    const database = createDatabase(":memory:");
    runMigrations(database.sqlite, path.resolve("drizzle"));
    const store = new AppStore(database);

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

    const config = {
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
      YOUTUBE_PLAYLIST_ID: "playlist-123",
      YOUTUBE_PLAYLIST_TITLE: "Playlist",
      YOUTUBE_PLAYLIST_DESCRIPTION: "Desc",
      YOUTUBE_PLAYLIST_PRIVACY: "unlisted",
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
    } as AppConfig;

    const insertPlaylistItem = vi.fn();
    const oauthService = {
      getValidAccessToken: vi.fn(async (provider: string) => `${provider}-token`),
      getSpotifyClient: () => ({
        getAllSavedTracks: vi.fn(async () => [
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
        ]),
      }),
      getYouTubeClient: () => ({
        listPlaylistItems: vi.fn(async () => [
          {
            playlistItemId: "item-1",
            videoId: "dQw4w9WgXcQ",
            videoTitle: "Track One",
            channelTitle: "Artist One - Topic",
            position: 0,
          },
        ]),
        insertPlaylistItem,
        createPlaylist: vi.fn(),
      }),
    };
    const quotaService = new QuotaService(store);
    const youtubeSearchService = {
      findBestMatch: vi.fn(),
    };

    const syncService = new SyncService(
      config,
      store,
      oauthService as never,
      quotaService,
      youtubeSearchService as never,
    );

    const result = await syncService.run("test");

    expect(result.stats.insertedTracks).toBe(0);
    expect(result.stats.skippedAlreadyInPlaylist).toBe(1);
    expect(insertPlaylistItem).not.toHaveBeenCalled();
  });
});
