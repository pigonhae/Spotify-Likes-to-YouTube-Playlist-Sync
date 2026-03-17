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
});
