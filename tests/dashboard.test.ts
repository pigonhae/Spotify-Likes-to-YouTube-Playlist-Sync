import { describe, expect, it } from "vitest";

import { renderDashboard } from "../src/views/dashboard.js";

describe("renderDashboard", () => {
  it("hides all destructive UI when nothing is connected", () => {
    const html = renderDashboard({
      summary: {
        spotifyConnected: false,
        youtubeConnected: false,
        playlistId: null,
        lastRunAt: null,
        recentRuns: [],
        attentionTracks: [],
      },
      accounts: [],
    });

    expect(html).not.toContain('action="/admin/connections/spotify/disconnect"');
    expect(html).not.toContain('action="/admin/connections/youtube/disconnect"');
    expect(html).not.toContain("위험 작업");
    expect(html).not.toContain('action="/admin/reset"');
  });

  it("shows only the Spotify disconnect control when only Spotify is connected", () => {
    const html = renderDashboard({
      summary: {
        spotifyConnected: true,
        youtubeConnected: false,
        playlistId: null,
        lastRunAt: null,
        recentRuns: [],
        attentionTracks: [],
      },
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
    expect(html).toContain("위험 작업");
    expect(html).toContain('action="/admin/reset"');
  });

  it("shows only the YouTube disconnect control when only YouTube is connected", () => {
    const html = renderDashboard({
      summary: {
        spotifyConnected: false,
        youtubeConnected: true,
        playlistId: null,
        lastRunAt: null,
        recentRuns: [],
        attentionTracks: [],
      },
      accounts: [
        {
          provider: "youtube",
          externalDisplayName: "YouTube User",
          invalidatedAt: null,
          lastRefreshError: null,
        },
      ],
    });

    expect(html).not.toContain('action="/admin/connections/spotify/disconnect"');
    expect(html).toContain('action="/admin/connections/youtube/disconnect"');
    expect(html).toContain("위험 작업");
    expect(html).toContain('action="/admin/reset"');
  });

  it("shows both disconnect controls and the destructive section when both are connected", () => {
    const html = renderDashboard({
      message: "테스트 메시지",
      messageLevel: "error",
      summary: {
        spotifyConnected: true,
        youtubeConnected: true,
        playlistId: null,
        lastRunAt: null,
        recentRuns: [],
        attentionTracks: [],
      },
      accounts: [
        {
          provider: "spotify",
          externalDisplayName: "Spotify User",
          invalidatedAt: null,
          lastRefreshError: null,
        },
        {
          provider: "youtube",
          externalDisplayName: "YouTube User",
          invalidatedAt: null,
          lastRefreshError: null,
        },
      ],
    });

    expect(html).toContain('action="/admin/connections/spotify/disconnect"');
    expect(html).toContain('action="/admin/connections/youtube/disconnect"');
    expect(html).toContain("위험 작업");
    expect(html).toContain('action="/admin/reset"');
    expect(html).toContain('class="message error"');
  });

  it("renders recent sync runs as cards with collapsible structured logs", () => {
    const longError = "quotaExceeded:".concat("A".repeat(300));
    const html = renderDashboard({
      summary: {
        spotifyConnected: true,
        youtubeConnected: true,
        playlistId: null,
        lastRunAt: null,
        recentRuns: [
          {
            id: 1,
            userId: "test-owner",
            trigger: "manual",
            status: "quota_exhausted",
            startedAt: Date.parse("2026-03-17T00:00:00.000Z"),
            finishedAt: Date.parse("2026-03-17T00:05:00.000Z"),
            statsJson: JSON.stringify({
              insertedTracks: 0,
              skippedAlreadyInPlaylist: 14,
              failedCount: 1,
              noMatchCount: 2,
              queuedTracks: 32,
              quotaAbort: true,
              raw: "https://example.com/" + "x".repeat(250),
            }),
            errorSummary: longError,
          },
        ],
        attentionTracks: [],
      },
      accounts: [],
    });
    const recentRunsStart = html.indexOf('<div class="runs">');
    const recentRunsEnd = html.indexOf("</section>", recentRunsStart);
    const recentRunsSection = html.slice(recentRunsStart, recentRunsEnd);

    expect(recentRunsStart).toBeGreaterThan(-1);
    expect(recentRunsSection).toContain('class="runs"');
    expect(recentRunsSection).toContain('class="run-card"');
    expect(recentRunsSection).not.toContain("<table>");
    expect(recentRunsSection).toContain("통계 상세 보기");
    expect(recentRunsSection).toContain("오류 상세 보기");
    expect(recentRunsSection).toContain('class="run-log"');
    expect(recentRunsSection).toContain("추가 0");
    expect(recentRunsSection).toContain("quota 중단");
    expect(recentRunsSection).toContain("quotaExceeded");
  });

  it("renders invalid stats JSON safely in the log disclosure", () => {
    const html = renderDashboard({
      summary: {
        spotifyConnected: false,
        youtubeConnected: false,
        playlistId: null,
        lastRunAt: null,
        recentRuns: [
          {
            id: 2,
            userId: "test-owner",
            trigger: "schedule",
            status: "failed",
            startedAt: Date.parse("2026-03-17T01:00:00.000Z"),
            finishedAt: Date.parse("2026-03-17T01:01:00.000Z"),
            statsJson: '{"broken": true',
            errorSummary: null,
          },
        ],
        attentionTracks: [],
      },
      accounts: [],
    });

    expect(html).toContain("통계 상세 보기");
    expect(html).toContain("{&quot;broken&quot;: true");
    expect(html).toContain("오류 요약");
  });

  it("renders review cards with recommendation actions and manual entry controls", () => {
    const html = renderDashboard({
      summary: {
        spotifyConnected: true,
        youtubeConnected: true,
        playlistId: null,
        lastRunAt: null,
        recentRuns: [],
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
      },
      accounts: [],
    });

    expect(html).toContain('class="attention-card review-card"');
    expect(html).toContain('action="/admin/tracks/spotify-track-review/review/accept"');
    expect(html).toContain('action="/admin/tracks/spotify-track-review/review/manual"');
    expect(html).toContain("추천 점수 54");
    expect(html).toContain("mqdefault.jpg");
    expect(html).toContain("수동 입력하기");
    expect(html).not.toContain("<table>");
  });
});
