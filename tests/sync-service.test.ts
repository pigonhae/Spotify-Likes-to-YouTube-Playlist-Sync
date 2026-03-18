import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { playlistVideos, syncRuns } from "../src/db/schema.js";
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

  it("deduplicates duplicate playlist snapshot rows before writing playlist_videos", async () => {
    const { store, close } = await createTestStore();

    await store.saveSpotifySnapshot([
      {
        spotifyTrackId: "spotify-track-dup",
        name: "Duplicate Track",
        artistNames: ["Artist Dup"],
        albumName: "Album Dup",
        albumReleaseDate: "2024-01-01",
        durationMs: 180_000,
        isrc: null,
        addedAt: Date.parse("2026-03-17T00:00:00.000Z"),
        externalUrl: "https://open.spotify.com/track/spotify-track-dup",
      },
    ]);
    await store.setManualVideoId("spotify-track-dup", "duplicate-video-123");

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
            spotifyTrackId: "spotify-track-dup",
            name: "Duplicate Track",
            artistNames: ["Artist Dup"],
            albumName: "Album Dup",
            albumReleaseDate: "2024-01-01",
            durationMs: 180_000,
            isrc: null,
            addedAt: Date.parse("2026-03-17T00:00:00.000Z"),
            externalUrl: "https://open.spotify.com/track/spotify-track-dup",
          },
        ]),
      }),
      getYouTubeClient: () => ({
        listPlaylistItems: vi.fn(async () => [
          {
            playlistItemId: "item-1",
            videoId: "duplicate-video-123",
            videoTitle: "Duplicate Track",
            channelTitle: "Artist Dup - Topic",
            position: 0,
          },
          {
            playlistItemId: "item-2",
            videoId: "duplicate-video-123",
            videoTitle: "Duplicate Track",
            channelTitle: "Artist Dup - Topic",
            position: 3,
          },
        ]),
        insertPlaylistItem,
        createPlaylist: vi.fn(),
      }),
    };

    const syncService = new SyncService(
      config,
      store,
      oauthService as never,
      new QuotaService(store, config.YOUTUBE_DAILY_QUOTA_LIMIT),
      {
        findBestMatch: vi.fn(),
      } as never,
    );

    const result = await syncService.run("test");
    const snapshotRows = await store.db.select().from(playlistVideos);
    const events = await store.listSyncRunEvents(result.runId, 20);

    expect(result.status).toBe("completed");
    expect(result.stats.insertedTracks).toBe(0);
    expect(result.stats.skippedAlreadyInPlaylist).toBe(1);
    expect(insertPlaylistItem).not.toHaveBeenCalled();
    expect(snapshotRows).toHaveLength(1);
    expect(snapshotRows[0]?.videoId).toBe("duplicate-video-123");
    expect(events.some((event: any) => event.stage === "playlist_snapshot" && event.level === "warn")).toBe(true);

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

  it("marks only the failing track as failed when playlist_videos persistence fails and continues the run", async () => {
    const { store, close } = await createTestStore();
    const config = createTestConfig({
      YOUTUBE_DAILY_QUOTA_LIMIT: 10_000,
      YOUTUBE_PLAYLIST_ID: "playlist-123",
    });

    const spotifyTracks = [
      createSpotifyTrack("spotify-track-fail", "Fail Track", Date.parse("2026-03-17T00:00:00.000Z")),
      createSpotifyTrack("spotify-track-ok", "Okay Track", Date.parse("2026-03-17T00:01:00.000Z")),
    ];

    const oauthService = {
      getValidAccessToken: vi.fn(async (provider: string) => `${provider}-token`),
      getSpotifyClient: () => ({
        getAllSavedTracks: vi.fn(async () => spotifyTracks),
      }),
      getYouTubeClient: () => ({
        listPlaylistItems: vi.fn(async () => []),
        insertPlaylistItem: vi.fn(async (_token: string, _playlistId: string, videoId: string) => `item-${videoId}`),
        createPlaylist: vi.fn(),
      }),
    };
    const youtubeSearchService = {
      findBestMatch: vi.fn(async ({ spotifyTrackId }: { spotifyTrackId: string }) => ({
        disposition: "matched_auto" as const,
        best: {
          score: 99,
          reasons: [],
          candidate: {
            videoId: `video-for-${spotifyTrackId}`,
            title: `Video for ${spotifyTrackId}`,
            channelTitle: "Matched Channel",
            source: "youtube_api" as const,
            url: `https://www.youtube.com/watch?v=video-for-${spotifyTrackId}`,
          },
        },
      })),
    };

    const originalSavePlaylistVideo = store.savePlaylistVideo.bind(store);
    vi.spyOn(store, "savePlaylistVideo").mockImplementation(async (playlistId, video) => {
      if (video.videoId === "video-for-spotify-track-fail") {
        const error = new Error("duplicate key value violates unique constraint");
        Object.assign(error, {
          code: "23505",
          constraint: "playlist_videos_user_playlist_video_uidx",
        });
        throw error;
      }

      return originalSavePlaylistVideo(playlistId, video);
    });

    const syncService = new SyncService(
      config,
      store,
      oauthService as never,
      new QuotaService(store, config.YOUTUBE_DAILY_QUOTA_LIMIT),
      youtubeSearchService as never,
    );

    const result = await syncService.run("manual");
    const runTracks = await store.listSyncRunTracks(result.runId, { page: 1, pageSize: 10 });
    const failedTrack = runTracks.find((track: any) => track.spotifyTrackId === "spotify-track-fail");
    const insertedTrack = runTracks.find((track: any) => track.spotifyTrackId === "spotify-track-ok");
    const events = await store.listSyncRunEvents(result.runId, 20);

    expect(result.status).toBe("partially_completed");
    expect(result.stats.failedCount).toBe(1);
    expect(result.stats.insertedTracks).toBe(1);
    expect(failedTrack?.status).toBe("failed");
    expect(failedTrack?.lastError).toContain("video_id=video-for-spotify-track-fail");
    expect(failedTrack?.lastError).toContain("constraint=playlist_videos_user_playlist_video_uidx");
    expect(failedTrack?.lastError).toContain("duplicate=true");
    expect(insertedTrack?.status).toBe("inserted");
    expect(events.some((event: any) => event.stage === "track_failed" && event.spotifyTrackId === "spotify-track-fail")).toBe(true);

    await close();
  });

  it("returns the active run instead of pretending to start from zero when a manual sync is already running", async () => {
    const { store, close } = await createTestStore();
    const config = createTestConfig({
      YOUTUBE_DAILY_QUOTA_LIMIT: 10_000,
      YOUTUBE_PLAYLIST_ID: "playlist-123",
    });

    const activeRunId = await store.createSyncRun("manual");
    await store.markSyncRunRunning(activeRunId, "processing_tracks", "Still working");
    await store.acquireLock("hourly-sync", "other-holder", config.syncLockTtlMs);

    const syncService = new SyncService(
      config,
      store,
      {
        getValidAccessToken: vi.fn(),
        getSpotifyClient: vi.fn(),
        getYouTubeClient: vi.fn(),
      } as never,
      new QuotaService(store, config.YOUTUBE_DAILY_QUOTA_LIMIT),
      {
        findBestMatch: vi.fn(),
      } as never,
    );

    const result = await syncService.run("manual");

    expect(result.runId).toBe(activeRunId);
    expect(result.disposition).toBe("already_running");
    expect(result.status).toBe("running");

    await close();
  });

  it("inserts tracks in oldest-liked-first order while still using the managed playlist ID", async () => {
    const { store, close } = await createTestStore();
    const config = createTestConfig({
      YOUTUBE_DAILY_QUOTA_LIMIT: 10_000,
      YOUTUBE_PLAYLIST_ID: "playlist-managed-123",
    });

    const spotifyTracks = [
      createSpotifyTrack("spotify-track-newest", "Newest Track", Date.parse("2026-03-17T00:02:00.000Z")),
      createSpotifyTrack("spotify-track-middle", "Middle Track", Date.parse("2026-03-17T00:01:00.000Z")),
      createSpotifyTrack("spotify-track-oldest", "Oldest Track", Date.parse("2026-03-17T00:00:00.000Z")),
    ];

    const insertPlaylistItem = vi.fn(async (_token: string, playlistId: string, videoId: string) => {
      return `${playlistId}:${videoId}`;
    });
    const createPlaylist = vi.fn();
    const oauthService = {
      getValidAccessToken: vi.fn(async (provider: string) => `${provider}-token`),
      getSpotifyClient: () => ({
        getAllSavedTracks: vi.fn(async () => spotifyTracks),
      }),
      getYouTubeClient: () => ({
        listPlaylistItems: vi.fn(async () => [
          {
            playlistItemId: "existing-1",
            videoId: "unrelated-video",
            videoTitle: "Renamed Playlist Item",
            channelTitle: "Changed Channel",
            position: 0,
          },
        ]),
        insertPlaylistItem,
        createPlaylist,
      }),
    };
    const youtubeSearchService = {
      findBestMatch: vi.fn(async ({ spotifyTrackId }: { spotifyTrackId: string }) => ({
        disposition: "matched_auto" as const,
        best: {
          score: 99,
          reasons: [],
          candidate: {
            videoId: `video-for-${spotifyTrackId}`,
            title: `Video for ${spotifyTrackId}`,
            channelTitle: "Matched Channel",
            source: "youtube_api" as const,
            url: `https://www.youtube.com/watch?v=video-for-${spotifyTrackId}`,
          },
        },
      })),
    };

    const syncService = new SyncService(
      config,
      store,
      oauthService as never,
      new QuotaService(store, config.YOUTUBE_DAILY_QUOTA_LIMIT),
      youtubeSearchService as never,
    );

    const result = await syncService.run("manual");
    const insertedVideoIds = insertPlaylistItem.mock.calls.map((call) => call[2]);
    const insertedPlaylistIds = new Set(insertPlaylistItem.mock.calls.map((call) => call[1]));

    expect(result.status).toBe("completed");
    expect(insertedVideoIds).toEqual([
      "video-for-spotify-track-oldest",
      "video-for-spotify-track-middle",
      "video-for-spotify-track-newest",
    ]);
    expect(insertedPlaylistIds).toEqual(new Set(["playlist-managed-123"]));
    expect(createPlaylist).not.toHaveBeenCalled();

    await close();
  });
});

function createSpotifyTrack(spotifyTrackId: string, name: string, addedAt: number) {
  return {
    spotifyTrackId,
    name,
    artistNames: [`${name} Artist`],
    albumName: `${name} Album`,
    albumReleaseDate: "2024-01-01",
    durationMs: 180_000,
    isrc: null,
    addedAt,
    externalUrl: `https://open.spotify.com/track/${spotifyTrackId}`,
  };
}
