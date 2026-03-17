import { describe, expect, it, vi } from "vitest";

import { QuotaService } from "../src/services/quota-service.js";
import { TrackReviewService } from "../src/services/track-review-service.js";
import { createTestStore } from "./helpers/test-support.js";

describe("TrackReviewService", () => {
  it("saves a validated manual selection as a confirmed manual match", async () => {
    const { store, close } = await createTestStore();
    await seedTrack(store, "spotify-track-1");

    const service = new TrackReviewService(
      store,
      {
        getVideos: vi.fn(async () => [
          {
            videoId: "dQw4w9WgXcQ",
            title: "Track One",
            channelTitle: "Artist One - Topic",
            isEmbeddable: true,
            isSyndicated: true,
            source: "youtube_api" as const,
            url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
          },
        ]),
      } as never,
      new QuotaService(store),
    );

    const result = await service.saveManualSelection(
      "spotify-track-1",
      "https://youtu.be/dQw4w9WgXcQ",
    );
    const track = await store.getTrackBySpotifyId("spotify-track-1");

    expect(result.alreadySelected).toBe(false);
    expect(track?.manualVideoId).toBe("dQw4w9WgXcQ");
    expect(track?.matchedVideoTitle).toBe("Track One");
    expect(track?.matchedChannelTitle).toBe("Artist One - Topic");
    expect(track?.manualResolutionType).toBe("manual_input");
    expect(track?.searchStatus).toBe("matched_manual");

    await close();
  });

  it("accepts the stored recommendation as a manual confirmation", async () => {
    const { store, close } = await createTestStore();
    await seedTrack(store, "spotify-track-2");
    await store.saveReviewCandidate("spotify-track-2", {
      score: 58,
      reasons: ["title:0.55", "artist hits:1"],
      candidate: {
        videoId: "review12345A",
        title: "Track Two",
        channelTitle: "Artist Two - Topic",
        source: "youtube_api",
        url: "https://www.youtube.com/watch?v=review12345A",
      },
    });

    const service = new TrackReviewService(
      store,
      {
        getVideos: vi.fn(),
      } as never,
      new QuotaService(store),
    );

    const result = await service.acceptRecommendation("spotify-track-2");
    const track = await store.getTrackBySpotifyId("spotify-track-2");

    expect(result.alreadySelected).toBe(false);
    expect(track?.manualVideoId).toBe("review12345A");
    expect(track?.manualResolutionType).toBe("recommended");
    expect(track?.searchStatus).toBe("matched_manual");

    await close();
  });

  it("rejects malformed YouTube input before calling the API", async () => {
    const { store, close } = await createTestStore();
    await seedTrack(store, "spotify-track-3");
    const getVideos = vi.fn();

    const service = new TrackReviewService(
      store,
      {
        getVideos,
      } as never,
      new QuotaService(store),
    );

    await expect(service.saveManualSelection("spotify-track-3", "not-a-youtube-url")).rejects.toThrow(
      "올바른 YouTube URL 또는 video ID",
    );
    expect(getVideos).not.toHaveBeenCalled();

    await close();
  });

  it("refuses to edit a track that is already inserted into the playlist", async () => {
    const { store, close } = await createTestStore();
    await seedTrack(store, "spotify-track-4");
    await store.setManualVideoId("spotify-track-4", "dQw4w9WgXcQ");
    await store.markTrackInserted("spotify-track-4", "playlist-item-1");

    const service = new TrackReviewService(
      store,
      {
        getVideos: vi.fn(),
      } as never,
      new QuotaService(store),
    );

    await expect(service.saveManualSelection("spotify-track-4", "dQw4w9WgXcQ")).rejects.toThrow(
      "이미 YouTube 재생목록에 추가된 곡은 수정할 수 없습니다.",
    );

    await close();
  });
});

async function seedTrack(
  store: Awaited<ReturnType<typeof createTestStore>>["store"],
  spotifyTrackId: string,
) {
  await store.saveSpotifySnapshot([
    {
      spotifyTrackId,
      name: spotifyTrackId === "spotify-track-2" ? "Track Two" : "Track One",
      artistNames: spotifyTrackId === "spotify-track-2" ? ["Artist Two"] : ["Artist One"],
      albumName: "Album One",
      albumReleaseDate: "2024-01-01",
      durationMs: 180_000,
      isrc: null,
      addedAt: Date.parse("2026-03-17T00:00:00.000Z"),
      externalUrl: `https://open.spotify.com/track/${spotifyTrackId}`,
    },
  ]);
}
