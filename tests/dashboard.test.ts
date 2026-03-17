import { describe, expect, it } from "vitest";

import { renderDashboard } from "../src/views/dashboard.js";

describe("renderDashboard", () => {
  it("hides disconnect controls when nothing is connected", () => {
    const html = renderDashboard({
      language: "en",
      summary: createSummary({}),
      accounts: [],
    });

    expect(html).not.toContain('action="/admin/connections/spotify/disconnect"');
    expect(html).not.toContain('action="/admin/connections/youtube/disconnect"');
    expect(html).toContain('action="/admin/reset"');
    expect(html).toContain("Danger Zone");
  });

  it("shows the connected provider disconnect control", () => {
    const html = renderDashboard({
      language: "en",
      summary: createSummary({
        spotifyConnected: true,
      }),
      accounts: [
        {
          provider: "spotify",
          externalDisplayName: "Spotify User",
          invalidatedAt: null,
          lastRefreshError: null,
        },
      ],
    });

    expect(html).toContain('action="/admin/connections/spotify/disconnect"');
    expect(html).not.toContain('action="/admin/connections/youtube/disconnect"');
    expect(html).toContain("Live Sync Run");
  });

  it("renders recent runs as cards with log disclosures", () => {
    const html = renderDashboard({
      language: "en",
      summary: createSummary({
        recentRuns: [
          {
            id: 1,
            userId: "test-owner",
            trigger: "manual",
            status: "waiting_for_youtube_quota",
            startedAt: Date.parse("2026-03-17T00:00:00.000Z"),
            finishedAt: Date.parse("2026-03-17T00:05:00.000Z"),
            statsJson: JSON.stringify({
              insertedTracks: 0,
              skippedAlreadyInPlaylist: 14,
              failedCount: 1,
              quotaAbort: true,
            }),
            errorSummary: "quotaExceeded:" + "A".repeat(120),
          },
        ],
      }),
      accounts: [],
    });

    expect(html).toContain('class="runs"');
    expect(html).toContain('class="run-card"');
    expect(html).toContain("View stats");
    expect(html).toContain("View error");
    expect(html).toContain("quota wait");
    expect(html).toContain("Skipped 14");
    expect(html).toContain("quotaExceeded");
  });

  it("renders the live sync panel with active run progress", () => {
    const html = renderDashboard({
      language: "en",
      summary: createSummary({
        activeRun: {
          id: 11,
          userId: "test-owner",
          trigger: "manual",
          status: "waiting_for_youtube_quota",
          phase: "paused",
          statusMessage: "Paused until YouTube quota is available again",
          startedAt: Date.parse("2026-03-17T00:00:00.000Z"),
          finishedAt: null,
          totalTracks: 120,
          completedTracks: 90,
          remainingTracks: 30,
          currentSpotifyTrackId: "spotify-track-2",
          currentTrackName: "Track Two",
          nextRetryAt: Date.parse("2026-03-18T07:00:00.000Z"),
          pauseReason: "quotaExceeded",
          lastErrorSummary: "YouTube quota exceeded",
          lastHeartbeatAt: Date.parse("2026-03-17T00:10:00.000Z"),
          updatedAt: Date.parse("2026-03-17T00:10:00.000Z"),
          resumedFromRunId: null,
          spotifyScanOffset: 120,
          spotifyScanCompletedAt: Date.parse("2026-03-17T00:02:00.000Z"),
          playlistSnapshotCompletedAt: Date.parse("2026-03-17T00:03:00.000Z"),
          statsJson: null,
          errorSummary: "YouTube quota exceeded",
        },
        activeRunUpdatedAt: Date.parse("2026-03-17T00:10:00.000Z"),
        runSummary: {
          totalTracks: 120,
          completedTracks: 90,
          remainingTracks: 30,
          skippedExistingTracks: 10,
          insertedTracks: 80,
          reviewRequiredTracks: 0,
          failedTracks: 0,
          noMatchTracks: 0,
          waitingTracks: 0,
          scopedTotalTracks: 110,
          scopedCompletedTracks: 90,
          scopedRemainingTracks: 20,
          baselineReady: true,
        },
        activeRunTracks: [
          {
            spotifyTrackId: "spotify-track-1",
            trackName: "Track One",
            artistNames: ["Artist One"],
            status: "inserted",
            statusMessage: "Inserted into YouTube playlist",
            matchedVideoTitle: "Track One",
            playlistItemId: "playlist-item-1",
            lastError: null,
          },
          {
            spotifyTrackId: "spotify-track-2",
            trackName: "Track Two",
            artistNames: ["Artist Two"],
            status: "waiting_for_youtube_quota",
            statusMessage: "Waiting for YouTube quota",
            matchedVideoTitle: "Track Two",
            playlistItemId: null,
            lastError: "quota exceeded",
          },
        ],
        activeRunEvents: [
          {
            id: 1,
            userId: "test-owner",
            syncRunId: 11,
            level: "warn",
            stage: "pause",
            message: "Paused due to YouTube quota",
            spotifyTrackId: "spotify-track-2",
            payloadJson: { nextRetryAt: Date.parse("2026-03-18T07:00:00.000Z") },
            createdAt: Date.parse("2026-03-17T00:10:00.000Z"),
          },
        ],
      }),
      accounts: [],
    });

    expect(html).toContain("Live Sync Run");
    expect(html).toContain("Spotify track flow");
    expect(html).toContain("Recent timeline");
    expect(html).toContain("Track Two");
    expect(html).toContain("Paused due to YouTube quota");
    expect(html).toContain("track-page-note");
  });

  it("renders review cards with recommendation actions and manual entry controls", () => {
    const html = renderDashboard({
      language: "en",
      summary: createSummary({
        attentionTracks: [
          {
            spotifyTrackId: "spotify-track-review",
            trackName: "A Very Long Track Title ".repeat(8).trim(),
            artistNames: ["An Artist With A Very Long Name".repeat(4)],
            albumName: "An Album With A Very Long Name".repeat(3),
            searchStatus: "review_required",
            lastError: null,
            externalUrl: "https://open.spotify.com/track/spotify-track-review",
            manualVideoId: null,
            manualResolutionType: null,
            matchedVideoId: null,
            matchedVideoTitle: null,
            matchedChannelTitle: null,
            matchedScore: null,
            reviewVideoId: "review12345A",
            reviewVideoTitle: "A Recommended Video Title ".repeat(6).trim(),
            reviewChannelTitle: "A Recommended Channel Name ".repeat(5).trim(),
            reviewVideoUrl: "https://www.youtube.com/watch?v=review12345A&feature=share&list=" + "x".repeat(120),
            reviewSource: "youtube_api",
            reviewScore: 54,
            reviewReasons: ["title:0.55", "artist hits:1", "negative title marker"],
            reviewUpdatedAt: Date.parse("2026-03-17T02:00:00.000Z"),
            playlistVideoId: null,
            lastSyncedAt: null,
            updatedAt: Date.parse("2026-03-17T02:00:00.000Z"),
          },
        ],
      }),
      accounts: [],
    });

    expect(html).toContain('class="attention-card review-card"');
    expect(html).toContain('action="/admin/tracks/spotify-track-review/review/accept"');
    expect(html).toContain('action="/admin/tracks/spotify-track-review/review/manual"');
    expect(html).toContain("Score 54");
    expect(html).toContain("mqdefault.jpg");
    expect(html).toContain("Enter manual match");
  });

  it("embeds valid JSON state blocks for the client bootstrap script", () => {
    const html = renderDashboard({
      language: "en",
      summary: createSummary({}),
      accounts: [],
    });

    const liveDataMatch = html.match(
      /<script id="dashboard-live-data" type="application\/json">([\s\S]*?)<\/script>/,
    );
    const catalogMatch = html.match(
      /<script id="dashboard-message-catalog" type="application\/json">([\s\S]*?)<\/script>/,
    );

    expect(liveDataMatch?.[1]).toBeTruthy();
    expect(catalogMatch?.[1]).toBeTruthy();
    expect(() => JSON.parse(liveDataMatch?.[1] ?? "")).not.toThrow();
    expect(() => JSON.parse(catalogMatch?.[1] ?? "")).not.toThrow();
  });
});

function createSummary(partial: Record<string, unknown> = {}) {
  return {
    ...createBaseSummary(),
    ...partial,
  } as any;
}

function createBaseSummary() {
  return {
    spotifyConnected: false,
    youtubeConnected: false,
    playlistId: null,
    lastRunAt: null,
    librarySummary: {
      totalTracks: 0,
      syncedTracks: 0,
      pendingTracks: 0,
      reviewRequiredTracks: 0,
      failedTracks: 0,
      noMatchTracks: 0,
      manualMatchTracks: 0,
    },
    activeRun: null,
    activeRunUpdatedAt: null,
    runSummary: null,
    activeRunTracks: [],
    activeRunEvents: [],
    recentRuns: [],
    attentionTracks: [],
    lastLiveError: null,
  };
}
