import { describe, expect, it } from "vitest";

import { renderDashboard } from "../src/views/dashboard.js";

describe("renderDashboard", () => {
  it("renders disconnect controls, reset UI, and a disabled sync button when not fully connected", () => {
    const html = renderDashboard({
      message: "테스트 메시지",
      messageLevel: "error",
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

    expect(html).toContain("Spotify 연결 해제");
    expect(html).toContain("YouTube 연결 해제");
    expect(html).toContain("전체 초기화");
    expect(html).toContain('class="message error"');
    expect(html).toContain("Spotify Likes Sync 대시보드");
    expect(html).toContain("동기화 대기 중");
    expect(html).toContain("disabled");
    expect(html).toContain('data-prompt-text="전체 초기화를 진행하려면 RESET을 입력하세요."');
  });
});
