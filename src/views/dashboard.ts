import { escapeHtml } from "../lib/strings.js";

export function renderDashboard(input: {
  message?: string;
  summary: ReturnType<import("../db/store.js").AppStore["getDashboardSummary"]>;
  accounts: Array<{
    provider: string;
    externalDisplayName: string | null;
    invalidatedAt: number | null;
    lastRefreshError: string | null;
  }>;
}) {
  const spotifyAccount = input.accounts.find((account) => account.provider === "spotify");
  const youtubeAccount = input.accounts.find((account) => account.provider === "youtube");

  return `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Spotify Likes Sync</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f6f3eb;
        --panel: #fffdf8;
        --ink: #1f1d1a;
        --muted: #6f675d;
        --line: #ded7cb;
        --accent: #0d7c66;
        --danger: #b93a32;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "Segoe UI", sans-serif;
        background: radial-gradient(circle at top, #fff8e7, var(--bg) 50%);
        color: var(--ink);
      }
      main {
        max-width: 1080px;
        margin: 0 auto;
        padding: 32px 20px 56px;
      }
      .hero {
        display: grid;
        gap: 12px;
        margin-bottom: 24px;
      }
      .grid {
        display: grid;
        gap: 16px;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      }
      .panel {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 18px;
        padding: 18px;
        box-shadow: 0 10px 35px rgba(60, 45, 20, 0.06);
      }
      .status {
        display: inline-block;
        padding: 4px 10px;
        border-radius: 999px;
        font-size: 12px;
        font-weight: 700;
        background: #ebf6f2;
        color: var(--accent);
      }
      .status.warn {
        background: #fff0ef;
        color: var(--danger);
      }
      form, .actions {
        display: grid;
        gap: 10px;
      }
      button, input {
        border-radius: 12px;
        border: 1px solid var(--line);
        padding: 10px 12px;
        font: inherit;
      }
      button {
        background: var(--accent);
        color: white;
        cursor: pointer;
      }
      button.secondary {
        background: white;
        color: var(--ink);
      }
      table {
        width: 100%;
        border-collapse: collapse;
      }
      th, td {
        text-align: left;
        padding: 10px 0;
        border-bottom: 1px solid var(--line);
        vertical-align: top;
      }
      small, .muted {
        color: var(--muted);
      }
      .message {
        margin-bottom: 16px;
        padding: 12px 14px;
        border-radius: 12px;
        background: #eef6ff;
        border: 1px solid #d0e3ff;
      }
      @media (max-width: 720px) {
        table, thead, tbody, th, td, tr { display: block; }
        th { display: none; }
        td { padding: 8px 0; }
      }
    </style>
  </head>
  <body>
    <main>
      <section class="hero">
        <small class="muted">Spotify 좋아요 목록 -> YouTube 공유 재생목록</small>
        <h1 style="margin:0;">Spotify Likes Sync 대시보드</h1>
        <p style="margin:0;max-width:680px;" class="muted">
          두 계정을 연결하면 1시간마다 YouTube 재생목록을 자동으로 동기화하고, 필요한 곡만 수동으로 보정할 수 있습니다.
        </p>
      </section>
      ${input.message ? `<div class="message">${escapeHtml(input.message)}</div>` : ""}
      <section class="grid">
        <article class="panel">
          <h2 style="margin-top:0;">연결 상태</h2>
          <p>
            <span class="status ${spotifyAccount && !spotifyAccount.invalidatedAt ? "" : "warn"}">
              Spotify ${spotifyAccount && !spotifyAccount.invalidatedAt ? "연결됨" : "설정 필요"}
            </span>
          </p>
          <p class="muted">${escapeHtml(spotifyAccount?.externalDisplayName ?? "연결되지 않음")}</p>
          ${spotifyAccount?.lastRefreshError ? `<p class="muted">최근 오류: ${escapeHtml(spotifyAccount.lastRefreshError)}</p>` : ""}
          <div class="actions">
            <a href="/auth/spotify/start"><button type="button">Spotify 연결</button></a>
          </div>
        </article>
        <article class="panel">
          <h2 style="margin-top:0;">YouTube</h2>
          <p>
            <span class="status ${youtubeAccount && !youtubeAccount.invalidatedAt ? "" : "warn"}">
              YouTube ${youtubeAccount && !youtubeAccount.invalidatedAt ? "연결됨" : "설정 필요"}
            </span>
          </p>
          <p class="muted">${escapeHtml(youtubeAccount?.externalDisplayName ?? "연결되지 않음")}</p>
          ${youtubeAccount?.lastRefreshError ? `<p class="muted">최근 오류: ${escapeHtml(youtubeAccount.lastRefreshError)}</p>` : ""}
          <div class="actions">
            <a href="/auth/youtube/start"><button type="button">YouTube 연결</button></a>
          </div>
        </article>
        <article class="panel">
          <h2 style="margin-top:0;">재생목록</h2>
          <p class="muted">관리 중인 재생목록 ID</p>
          <p style="font-weight:700;">${input.summary.playlistId ? escapeHtml(input.summary.playlistId) : "첫 동기화 시 자동 생성됩니다"}</p>
          ${
            input.summary.playlistId
              ? `<p><a href="https://www.youtube.com/playlist?list=${escapeHtml(input.summary.playlistId)}" target="_blank" rel="noreferrer">재생목록 열기</a></p>`
              : ""
          }
          <form method="post" action="/admin/sync">
            <button type="submit">지금 동기화 실행</button>
          </form>
        </article>
      </section>
      <section class="panel" style="margin-top:16px;">
        <h2 style="margin-top:0;">최근 동기화 실행 내역</h2>
        <table>
          <thead>
            <tr><th>상태</th><th>실행 방식</th><th>시작 시각</th><th>통계</th><th>오류</th></tr>
          </thead>
          <tbody>
            ${
              input.summary.recentRuns.length === 0
                ? `<tr><td colspan="5">아직 동기화 실행 내역이 없습니다.</td></tr>`
                : input.summary.recentRuns
                    .map(
                      (run) => `<tr>
                        <td>${escapeHtml(formatRunStatus(run.status))}</td>
                        <td>${escapeHtml(formatRunTrigger(run.trigger))}</td>
                        <td>${escapeHtml(formatDate(run.startedAt))}</td>
                        <td><small>${escapeHtml(run.statsJson ?? "-")}</small></td>
                        <td><small>${escapeHtml(run.errorSummary ?? "-")}</small></td>
                      </tr>`,
                    )
                    .join("")
            }
          </tbody>
        </table>
      </section>
      <section class="panel" style="margin-top:16px;">
        <h2 style="margin-top:0;">확인이 필요한 곡</h2>
        <table>
          <thead>
            <tr><th>곡</th><th>상태</th><th>최근 오류</th><th>수동 지정</th></tr>
          </thead>
          <tbody>
            ${
              input.summary.attentionTracks.length === 0
                ? `<tr><td colspan="4">지금은 수동 확인이 필요한 곡이 없습니다.</td></tr>`
                : input.summary.attentionTracks
                    .map(
                      (track) => `<tr>
                        <td>
                          <strong>${escapeHtml(track.trackName)}</strong><br />
                          <small>${escapeHtml(track.artistNames.join(", "))}${track.albumName ? ` / ${escapeHtml(track.albumName)}` : ""}</small>
                        </td>
                        <td>${escapeHtml(formatTrackStatus(track.searchStatus))}</td>
                        <td><small>${escapeHtml(track.lastError ?? "-")}</small></td>
                        <td>
                          <form method="post" action="/admin/tracks/${encodeURIComponent(track.spotifyTrackId)}/override">
                            <input name="videoInput" value="${escapeHtml(track.manualVideoId ?? track.matchedVideoId ?? "")}" placeholder="YouTube URL 또는 video ID" />
                            <button type="submit" class="secondary">수동 지정 저장</button>
                          </form>
                        </td>
                      </tr>`,
                    )
                    .join("")
            }
          </tbody>
        </table>
      </section>
    </main>
  </body>
</html>`;
}

function formatDate(timestamp: number | null) {
  if (!timestamp) {
    return "-";
  }

  return new Date(timestamp).toLocaleString("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatRunStatus(status: string) {
  switch (status) {
    case "running":
      return "실행 중";
    case "success":
      return "성공";
    case "failed":
      return "실패";
    case "quota_exhausted":
      return "쿼터 소진";
    default:
      return status;
  }
}

function formatRunTrigger(trigger: string) {
  switch (trigger) {
    case "manual":
      return "수동 실행";
    case "schedule":
      return "예약 실행";
    case "test":
      return "테스트";
    default:
      return trigger;
  }
}

function formatTrackStatus(status: string) {
  switch (status) {
    case "pending":
      return "대기 중";
    case "matched_auto":
      return "자동 매칭 완료";
    case "matched_manual":
      return "수동 지정 완료";
    case "failed":
      return "실패";
    case "no_match":
      return "검색 결과 없음";
    case "needs_manual":
      return "수동 확인 필요";
    default:
      return status;
  }
}
