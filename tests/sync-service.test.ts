import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { syncRuns } from "../src/db/schema.js";
import { QuotaService } from "../src/services/quota-service.js";
import { SyncService } from "../src/services/sync/sync-service.js";
import { createTestConfig, createTestStore } from "./helpers/test-support.js";

describe("SyncService", () => {
  it("does not insert a duplicate when the video already exists in the playlist", async () => {
    const { store, close } = await createTestStore();

    await store.saveSpotifySnapshot([
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
    await store.setManualVideoId("spotify-track-1", "dQw4w9WgXcQ");

    const config = createTestConfig({
      YOUTUBE_DAILY_QUOTA_LIMIT: 10_000,
      YOUTUBE_PLAYLIST_ID: "playlist-123",
    });

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
    const quotaService = new QuotaService(store, config.YOUTUBE_DAILY_QUOTA_LIMIT);
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

    await close();
  });

  it("pauses for YouTube quota instead of failing when insertion quota runs out", async () => {
    const { store, close } = await createTestStore();

    const config = createTestConfig({
      YOUTUBE_DAILY_QUOTA_LIMIT: 50,
      YOUTUBE_PLAYLIST_ID: "playlist-123",
    });

    const trackAddedAt = Date.parse("2026-03-17T00:00:00.000Z");
    const spotifyTracks = [
      {
        spotifyTrackId: "spotify-track-1",
        name: "Track One",
        artistNames: ["Artist One"],
        albumName: "Album One",
        albumReleaseDate: "2024-01-01",
        durationMs: 180_000,
        isrc: null,
        addedAt: trackAddedAt,
        externalUrl: "https://open.spotify.com/track/spotify-track-1",
      },
      {
        spotifyTrackId: "spotify-track-2",
        name: "Track Two",
        artistNames: ["Artist Two"],
        albumName: "Album Two",
        albumReleaseDate: "2024-02-01",
        durationMs: 181_000,
        isrc: null,
        addedAt: trackAddedAt + 1,
        externalUrl: "https://open.spotify.com/track/spotify-track-2",
      },
    ];

    const insertPlaylistItem = vi.fn();
    const oauthService = {
      getValidAccessToken: vi.fn(async (provider: string) => `${provider}-token`),
      getSpotifyClient: () => ({
        getAllSavedTracks: vi.fn(async () => spotifyTracks),
      }),
      getYouTubeClient: () => ({
        listPlaylistItems: vi.fn(async () => []),
        insertPlaylistItem,
        createPlaylist: vi.fn(),
      }),
    };
    const quotaService = new QuotaService(store, config.YOUTUBE_DAILY_QUOTA_LIMIT);
    const youtubeSearchService = {
      findBestMatch: vi.fn(async ({ spotifyTrackId }: { spotifyTrackId: string }) => ({
        disposition: "matched_auto" as const,
        best: {
          score: 99,
          reasons: [],
          candidate: {
            videoId: `video-for-${spotifyTrackId}`,
            title: "Matched Video",
            channelTitle: "Matched Channel",
            source: "manual" as const,
            url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
          },
        },
      })),
    };

    const syncService = new SyncService(
      config,
      store,
      oauthService as never,
      quotaService,
      youtubeSearchService as never,
    );

    const result = await syncService.run("manual");

    expect(result.status).toBe("waiting_for_youtube_quota");
    expect(result.error).toContain("playlist insertion");
    expect(result.stats.quotaAbort).toBe(true);
    expect(result.stats.insertedTracks).toBe(0);
    expect(insertPlaylistItem).not.toHaveBeenCalled();

    const run =
      (
        await store.db
          .select()
          .from(syncRuns)
          .where(eq(syncRuns.id, result.runId))
          .limit(1)
      )[0] ?? null;
    expect(run?.status).toBe("waiting_for_youtube_quota");
    expect(run?.lastErrorSummary).toContain("playlist insertion");
    expect(run?.nextRetryAt).toBeTypeOf("number");

    await close();
  });

  it("stores low-confidence matches for review without inserting them", async () => {
    const { store, close } = await createTestStore();
    const config = createTestConfig({
      YOUTUBE_DAILY_QUOTA_LIMIT: 10_000,
      YOUTUBE_PLAYLIST_ID: "playlist-123",
    });

    await store.saveSpotifySnapshot([
      {
        spotifyTrackId: "spotify-track-review",
        name: "Review Track",
        artistNames: ["Review Artist"],
        albumName: "Review Album",
        albumReleaseDate: "2024-03-01",
        durationMs: 200_000,
        isrc: null,
        addedAt: Date.parse("2026-03-17T00:00:00.000Z"),
        externalUrl: "https://open.spotify.com/track/spotify-track-review",
      },
    ]);

    const insertPlaylistItem = vi.fn();
    const oauthService = {
      getValidAccessToken: vi.fn(async (provider: string) => `${provider}-token`),
      getSpotifyClient: () => ({
        getAllSavedTracks: vi.fn(async () => [
          {
            spotifyTrackId: "spotify-track-review",
            name: "Review Track",
            artistNames: ["Review Artist"],
            albumName: "Review Album",
            albumReleaseDate: "2024-03-01",
            durationMs: 200_000,
            isrc: null,
            addedAt: Date.parse("2026-03-17T00:00:00.000Z"),
            externalUrl: "https://open.spotify.com/track/spotify-track-review",
          },
        ]),
      }),
      getYouTubeClient: () => ({
        listPlaylistItems: vi.fn(async () => []),
        insertPlaylistItem,
        createPlaylist: vi.fn(),
      }),
    };
    const quotaService = new QuotaService(store, config.YOUTUBE_DAILY_QUOTA_LIMIT);
    const youtubeSearchService = {
      findBestMatch: vi.fn(async () => ({
        disposition: "review_required" as const,
        best: {
          score: 57,
          reasons: ["title:0.58", "artist hits:1"],
          candidate: {
            videoId: "review12345A",
            title: "Review Track (Live)",
            channelTitle: "Review Artist Fan Uploads",
            source: "youtube_api" as const,
            url: "https://www.youtube.com/watch?v=review12345A",
          },
        },
        all: [],
      })),
    };

    const syncService = new SyncService(
      config,
      store,
      oauthService as never,
      quotaService,
      youtubeSearchService as never,
    );

    const result = await syncService.run("manual");
    const track = await store.getTrackBySpotifyId("spotify-track-review");

    expect(result.status).toBe("partially_completed");
    expect(result.stats.insertedTracks).toBe(0);
    expect(result.stats.reviewRequiredCount).toBe(1);
    expect(insertPlaylistItem).not.toHaveBeenCalled();
    expect(track?.searchStatus).toBe("review_required");
    expect(track?.reviewVideoId).toBe("review12345A");
    expect(track?.matchedVideoId).toBeNull();

    await close();
  });
});
