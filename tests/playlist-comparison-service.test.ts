import { describe, expect, it, vi } from "vitest";

import { PlaylistComparisonService } from "../src/services/playlist-comparison-service.js";
import { QuotaService } from "../src/services/quota-service.js";
import { createTestConfig, createTestStore } from "./helpers/test-support.js";

describe("PlaylistComparisonService", () => {
  it("classifies spotify-only, youtube-only, and in-both items with source and run-state diagnostics", async () => {
    const { store, close } = await createTestStore();
    const config = createTestConfig({
      YOUTUBE_PLAYLIST_ID: "playlist-123",
      YOUTUBE_DAILY_QUOTA_LIMIT: 10_000,
    });

    const activeTracks = [
      createSpotifyTrack("spotify-track-auto", "Auto Match", Date.parse("2026-03-17T00:00:00.000Z")),
      createSpotifyTrack("spotify-track-manual", "Manual Match", Date.parse("2026-03-17T00:01:00.000Z")),
      createSpotifyTrack("spotify-track-review", "Needs Review", Date.parse("2026-03-17T00:02:00.000Z")),
      createSpotifyTrack("spotify-track-mapped-missing", "Mapped Missing", Date.parse("2026-03-17T00:03:00.000Z")),
      createSpotifyTrack("spotify-track-prev-missing", "Previously Synced Missing", Date.parse("2026-03-17T00:04:00.000Z")),
      createSpotifyTrack("spotify-track-waiting", "Waiting Track", Date.parse("2026-03-17T00:05:00.000Z")),
      createSpotifyTrack("spotify-track-no-match", "No Match Track", Date.parse("2026-03-17T00:06:00.000Z")),
      createSpotifyTrack("spotify-track-failed", "Failed Track", Date.parse("2026-03-17T00:07:00.000Z")),
    ];
    const removedTrack = createSpotifyTrack("spotify-track-removed", "Removed Track", Date.parse("2026-03-17T00:08:00.000Z"));

    await store.saveSpotifySnapshot([...activeTracks, removedTrack]);

    await store.saveMatchResult("spotify-track-auto", createMatchResult("video-auto", "Auto Match Video", "Auto Channel"));
    await store.markTrackInserted("spotify-track-auto", "playlist-item-auto");

    await store.setManualVideoId("spotify-track-manual", "video-manual", {
      matchedVideoTitle: "Manual Match Video",
      matchedChannelTitle: "Manual Channel",
      matchedSource: "manual",
      matchedScore: 100,
      manualResolutionType: "manual_input",
    });
    await store.markTrackInserted("spotify-track-manual", "playlist-item-manual");

    await store.saveReviewCandidate("spotify-track-review", createMatchResult("review-video", "Review Candidate", "Review Channel"));

    await store.setManualVideoId("spotify-track-mapped-missing", "video-missing", {
      matchedVideoTitle: "Mapped Missing Video",
      matchedChannelTitle: "Mapped Missing Channel",
      matchedSource: "manual",
      matchedScore: 100,
      manualResolutionType: "manual_input",
    });

    await store.setManualVideoId("spotify-track-prev-missing", "video-prev-missing", {
      matchedVideoTitle: "Previous Missing Video",
      matchedChannelTitle: "Previous Missing Channel",
      matchedSource: "manual",
      matchedScore: 100,
      manualResolutionType: "manual_input",
    });
    await store.markTrackInserted("spotify-track-prev-missing", "playlist-item-prev-missing");

    await store.setManualVideoId("spotify-track-waiting", "video-waiting", {
      matchedVideoTitle: "Waiting Video",
      matchedChannelTitle: "Waiting Channel",
      matchedSource: "manual",
      matchedScore: 100,
      manualResolutionType: "manual_input",
    });

    await store.markTrackSearchFailure("spotify-track-no-match", "no_match", "No suitable YouTube candidate found");
    await store.markTrackSearchFailure("spotify-track-failed", "failed", "playlist insert failed");

    await store.setManualVideoId("spotify-track-removed", "video-removed", {
      matchedVideoTitle: "Removed Video",
      matchedChannelTitle: "Removed Channel",
      matchedSource: "manual",
      matchedScore: 100,
      manualResolutionType: "manual_input",
    });
    await store.markTrackInserted("spotify-track-removed", "playlist-item-removed");

    await store.saveSpotifySnapshot(activeTracks);

    await store.replacePlaylistVideos("playlist-123", [
      {
        playlistItemId: "playlist-item-auto",
        videoId: "video-auto",
        videoTitle: "Auto Match Video",
        channelTitle: "Auto Channel",
        position: 0,
      },
      {
        playlistItemId: "playlist-item-manual",
        videoId: "video-manual",
        videoTitle: "Manual Match Video",
        channelTitle: "Manual Channel",
        position: 1,
      },
      {
        playlistItemId: "playlist-item-removed",
        videoId: "video-removed",
        videoTitle: "Removed Video",
        channelTitle: "Removed Channel",
        position: 2,
      },
      {
        playlistItemId: "playlist-item-unmanaged",
        videoId: "video-unmanaged",
        videoTitle: "Unmanaged Upload",
        channelTitle: "Outside Channel",
        position: 3,
      },
    ]);

    const waitingRunId = await store.createSyncRun("manual");
    await store.markSyncRunRunning(waitingRunId, "processing_tracks", "Still processing");
    await store.upsertSyncRunTrackFromSpotify({
      syncRunId: waitingRunId,
      trackOrder: 0,
      track: activeTracks.find((track) => track.spotifyTrackId === "spotify-track-waiting")!,
    });
    await store.updateSyncRunTrack(waitingRunId, "spotify-track-waiting", {
      status: "waiting_for_youtube_quota",
      statusMessage: "Waiting for YouTube quota",
      matchedVideoId: "video-waiting",
      matchedVideoTitle: "Waiting Video",
      matchedChannelTitle: "Waiting Channel",
      lastError: "quota exhausted",
    });

    const service = new PlaylistComparisonService(
      config,
      store,
      {
        getValidAccessToken: vi.fn(),
        getYouTubeClient: vi.fn(),
      } as never,
      new QuotaService(store, config.YOUTUBE_DAILY_QUOTA_LIMIT),
    );

    const spotifyOnly = await service.getComparison({ bucket: "spotify_only", page: 1, pageSize: 25 });
    const youtubeOnly = await service.getComparison({ bucket: "youtube_only", page: 1, pageSize: 25 });
    const inBoth = await service.getComparison({ bucket: "in_both", page: 1, pageSize: 25 });

    expect(spotifyOnly.summary).toMatchObject({
      spotifyTotal: 8,
      youtubeTotal: 4,
      inBoth: 2,
      spotifyOnly: 6,
      youtubeOnly: 2,
    });
    expect(spotifyOnly.summary.spotifyOnlyReasons.map((item) => item.reasonCode)).toEqual(expect.arrayContaining([
      "review_required",
      "mapped_not_in_playlist",
      "previously_synced_missing_now",
      "waiting_for_youtube_quota",
      "no_match",
      "failed",
    ]));
    expect(spotifyOnly.bucketPage.items.map((item) => item.reasonCode)).toEqual(expect.arrayContaining([
      "review_required",
      "mapped_not_in_playlist",
      "previously_synced_missing_now",
      "waiting_for_youtube_quota",
      "no_match",
      "failed",
    ]));

    expect(youtubeOnly.bucketPage.items.map((item) => item.reasonCode)).toEqual(expect.arrayContaining([
      "source_removed_from_spotify",
      "unmanaged_or_added_outside_app",
    ]));
    expect(youtubeOnly.bucketPage.items.find((item) => item.reasonCode === "source_removed_from_spotify")?.spotifyTrackId)
      .toBe("spotify-track-removed");

    expect(inBoth.bucketPage.items.map((item) => item.reasonCode)).toEqual(expect.arrayContaining([
      "manual_match_in_playlist",
      "automatic_match_in_playlist",
    ]));
    expect(inBoth.bucketPage.items.find((item) => item.spotifyTrackId === "spotify-track-manual")?.matchSource)
      .toBe("manual");

    await close();
  });

  it("refreshes the stored playlist snapshot manually and deduplicates playlist videos", async () => {
    const { store, close } = await createTestStore();
    const config = createTestConfig({
      YOUTUBE_PLAYLIST_ID: "playlist-123",
      YOUTUBE_DAILY_QUOTA_LIMIT: 10_000,
    });
    const quotaService = new QuotaService(store, config.YOUTUBE_DAILY_QUOTA_LIMIT);
    const chargeSpy = vi.spyOn(quotaService, "charge");
    await store.upsertOAuthAccount({
      provider: "youtube",
      encryptedAccessToken: "encrypted-youtube-access-token",
      encryptedRefreshToken: "encrypted-youtube-refresh-token",
      tokenExpiresAt: Date.now() + 60_000,
      scope: "youtube.force-ssl",
      externalUserId: "youtube-user",
      externalDisplayName: "YouTube User",
    });

    const service = new PlaylistComparisonService(
      config,
      store,
      {
        getValidAccessToken: vi.fn(async () => "youtube-token"),
        getYouTubeClient: () => ({
          listPlaylistItems: vi.fn(async () => [
            {
              playlistItemId: "item-1",
              videoId: "video-dup",
              videoTitle: "Duplicate Video",
              channelTitle: "Topic Channel",
              position: 0,
            },
            {
              playlistItemId: "item-2",
              videoId: "video-dup",
              videoTitle: "Duplicate Video",
              channelTitle: "Topic Channel",
              position: 3,
            },
            {
              playlistItemId: "item-3",
              videoId: "video-unique",
              videoTitle: "Unique Video",
              channelTitle: "Unique Channel",
              position: 1,
            },
          ]),
        }),
      } as never,
      quotaService,
    );

    const comparison = await service.refreshComparison({ bucket: "youtube_only", page: 1, pageSize: 25 });
    const playlistRows = await store.listPlaylistVideos("playlist-123");

    expect(chargeSpy).toHaveBeenCalledWith(1);
    expect(playlistRows).toHaveLength(2);
    expect(comparison.meta.lastPlaylistSnapshotAt).toBeTypeOf("number");
    expect(comparison.summary.youtubeOnly).toBe(2);

    await close();
  });

  it("blocks manual refresh while a sync run is active", async () => {
    const { store, close } = await createTestStore();
    const config = createTestConfig({
      YOUTUBE_PLAYLIST_ID: "playlist-123",
      YOUTUBE_DAILY_QUOTA_LIMIT: 10_000,
    });
    const runId = await store.createSyncRun("manual");
    await store.markSyncRunRunning(runId, "processing_tracks", "Still processing");
    await store.upsertOAuthAccount({
      provider: "youtube",
      encryptedAccessToken: "encrypted-youtube-access-token",
      encryptedRefreshToken: "encrypted-youtube-refresh-token",
      tokenExpiresAt: Date.now() + 60_000,
      scope: "youtube.force-ssl",
      externalUserId: "youtube-user",
      externalDisplayName: "YouTube User",
    });

    const service = new PlaylistComparisonService(
      config,
      store,
      {
        getValidAccessToken: vi.fn(async () => "youtube-token"),
        getYouTubeClient: vi.fn(),
      } as never,
      new QuotaService(store, config.YOUTUBE_DAILY_QUOTA_LIMIT),
    );

    await expect(service.refreshComparison()).rejects.toThrow(
      "Finish or resume the current sync run before refreshing the playlist snapshot.",
    );

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

function createMatchResult(videoId: string, title: string, channelTitle: string) {
  return {
    score: 99,
    reasons: ["title:0.99"],
    candidate: {
      videoId,
      title,
      channelTitle,
      source: "youtube_api" as const,
      url: `https://www.youtube.com/watch?v=${videoId}`,
    },
  };
}
