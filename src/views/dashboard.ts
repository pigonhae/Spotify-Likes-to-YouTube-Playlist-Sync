import { escapeHtml } from "../lib/strings.js";
import type { SyncStats } from "../types.js";

type MessageLevel = "success" | "error";

type DashboardSummary = ReturnType<import("../db/store.js").AppStore["getDashboardSummary"]>;
type DashboardRun = DashboardSummary["recentRuns"][number];

export function renderDashboard(input: {
  message?: string;
  messageLevel?: MessageLevel;
  summary: DashboardSummary;
  accounts: Array<{
    provider: string;
    externalDisplayName: string | null;
    invalidatedAt: number | null;
    lastRefreshError: string | null;
  }>;
}) {
  const spotifyAccount = input.accounts.find((account) => account.provider === "spotify");
  const youtubeAccount = input.accounts.find((account) => account.provider === "youtube");
  const isSpotifyConnected = input.summary.spotifyConnected === true;
  const isYouTubeConnected = input.summary.youtubeConnected === true;
  const hasConnectedProvider = isSpotifyConnected || isYouTubeConnected;
  const canRunSync = isSpotifyConnected && isYouTubeConnected;

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
        --accent-strong: #0a6856;
        --danger: #b93a32;
        --danger-bg: #fff3f1;
        --danger-line: #f0b7b1;
        --success-bg: #eef8f4;
        --success-line: #b7dccd;
        --soft-bg: #faf7f1;
      }
      * { box-sizing: border-box; }
      html, body {
        max-width: 100%;
        overflow-x: hidden;
      }
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
        min-width: 0;
      }
      .hero {
        display: grid;
        gap: 12px;
        margin-bottom: 24px;
        min-width: 0;
      }
      .grid {
        display: grid;
        gap: 16px;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        min-width: 0;
      }
      .panel {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 18px;
        padding: 18px;
        box-shadow: 0 10px 35px rgba(60, 45, 20, 0.06);
        min-width: 0;
        overflow: hidden;
      }
      .panel.danger {
        border-color: var(--danger-line);
        background: linear-gradient(180deg, #fff8f6 0%, #fffdf8 100%);
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
      button:hover:not(:disabled) {
        background: var(--accent-strong);
      }
      button.secondary {
        background: white;
        color: var(--ink);
      }
      button.danger {
        background: var(--danger);
        border-color: var(--danger);
      }
      button.danger.secondary {
        background: white;
        color: var(--danger);
      }
      button:disabled {
        cursor: not-allowed;
        opacity: 0.55;
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
        min-width: 0;
      }
      small, .muted {
        color: var(--muted);
      }
      .message {
        margin-bottom: 16px;
        padding: 12px 14px;
        border-radius: 12px;
      }
      .message.success {
        background: var(--success-bg);
        border: 1px solid var(--success-line);
      }
      .message.error {
        background: var(--danger-bg);
        border: 1px solid var(--danger-line);
      }
      .danger-list {
        margin: 0;
        padding-left: 18px;
        color: var(--muted);
      }
      .danger-list li + li {
        margin-top: 6px;
      }
      .inline-note {
        padding: 12px 14px;
        border-radius: 12px;
        background: #faf7f1;
        border: 1px solid var(--line);
      }
      .runs {
        display: grid;
        gap: 12px;
        min-width: 0;
      }
      .run-card {
        border: 1px solid var(--line);
        border-radius: 16px;
        padding: 14px;
        background: rgba(255, 255, 255, 0.68);
        min-width: 0;
        overflow: hidden;
      }
      .run-card-head {
        display: grid;
        gap: 10px;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: start;
        min-width: 0;
      }
      .run-card-head > div {
        min-width: 0;
      }
      .run-meta {
        display: grid;
        gap: 8px;
        margin-top: 12px;
        grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
        min-width: 0;
      }
      .run-meta-item {
        min-width: 0;
      }
      .run-meta-label {
        display: block;
        margin-bottom: 4px;
        color: var(--muted);
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.02em;
      }
      .run-meta-value {
        min-width: 0;
        overflow-wrap: anywhere;
        word-break: break-word;
      }
      .run-tags {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        min-width: 0;
      }
      .run-tag {
        display: inline-flex;
        align-items: center;
        padding: 4px 10px;
        border-radius: 999px;
        background: #f4efe5;
        color: var(--ink);
        font-size: 12px;
        font-weight: 700;
      }
      .run-tag.error {
        background: #fff0ef;
        color: var(--danger);
      }
      .run-details {
        margin-top: 12px;
        display: grid;
        gap: 10px;
        min-width: 0;
      }
      .run-disclosure {
        min-width: 0;
      }
      .run-disclosure summary {
        cursor: pointer;
        font-weight: 700;
        color: var(--ink);
      }
      .run-disclosure summary::-webkit-details-marker {
        display: none;
      }
      .run-disclosure summary::before {
        content: "▸";
        display: inline-block;
        margin-right: 6px;
      }
      .run-disclosure[open] summary::before {
        content: "▾";
      }
      .run-log {
        margin-top: 10px;
        padding: 12px;
        border-radius: 12px;
        background: var(--soft-bg);
        border: 1px solid var(--line);
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 12px;
        line-height: 1.55;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        word-break: break-word;
        max-width: 100%;
        max-height: 260px;
        overflow: auto;
      }
      .run-empty {
        color: var(--muted);
      }
      @media (max-width: 720px) {
        table, thead, tbody, th, td, tr { display: block; }
        th { display: none; }
        td { padding: 8px 0; }
        .run-card-head {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <section class="hero">
        <small class="muted">Spotify 좋아요 목록 -> YouTube 공유 재생목록</small>
        <h1 style="margin:0;">Spotify Likes Sync 대시보드</h1>
        <p style="margin:0;max-width:680px;" class="muted">
          두 계정을 연결하면 1시간마다 YouTube 재생목록으로 동기화하고, 확인이 필요한 곡만 수동으로 보정할 수 있습니다.
        </p>
      </section>
      ${input.message ? `<div class="message ${input.messageLevel === "error" ? "error" : "success"}">${escapeHtml(input.message)}</div>` : ""}
      <section class="grid">
        <article class="panel">
          <h2 style="margin-top:0;">Spotify 연결 상태</h2>
          <p>
            <span class="status ${isSpotifyConnected ? "" : "warn"}">
              Spotify ${isSpotifyConnected ? "연결됨" : "설정 필요"}
            </span>
          </p>
          <p class="muted">${escapeHtml(spotifyAccount?.externalDisplayName ?? "연결되지 않음")}</p>
          ${spotifyAccount?.lastRefreshError ? `<p class="muted">최근 오류: ${escapeHtml(spotifyAccount.lastRefreshError)}</p>` : ""}
          <div class="actions">
            <a href="/auth/spotify/start"><button type="button">Spotify 연결</button></a>
            ${
              isSpotifyConnected
                ? `<form method="post" action="/admin/connections/spotify/disconnect" data-confirm-message="Spotify 연결을 해제할까요? 저장된 Spotify 토큰과 계정 정보가 제거되며, 다시 연결하기 전까지 동기화가 중단됩니다.">
                    <button type="submit" class="danger secondary" data-loading-label="해제 중...">Spotify 연결 해제</button>
                  </form>`
                : ""
            }
          </div>
        </article>
        <article class="panel">
          <h2 style="margin-top:0;">YouTube 연결 상태</h2>
          <p>
            <span class="status ${isYouTubeConnected ? "" : "warn"}">
              YouTube ${isYouTubeConnected ? "연결됨" : "설정 필요"}
            </span>
          </p>
          <p class="muted">${escapeHtml(youtubeAccount?.externalDisplayName ?? "연결되지 않음")}</p>
          ${youtubeAccount?.lastRefreshError ? `<p class="muted">최근 오류: ${escapeHtml(youtubeAccount.lastRefreshError)}</p>` : ""}
          <div class="actions">
            <a href="/auth/youtube/start"><button type="button">YouTube 연결</button></a>
            ${
              isYouTubeConnected
                ? `<form method="post" action="/admin/connections/youtube/disconnect" data-confirm-message="YouTube 연결을 해제할까요? 저장된 YouTube 토큰과 관리 중인 재생목록 상태가 초기화됩니다.">
                    <button type="submit" class="danger secondary" data-loading-label="해제 중...">YouTube 연결 해제</button>
                  </form>`
                : ""
            }
          </div>
        </article>
        <article class="panel">
          <h2 style="margin-top:0;">재생목록과 동기화</h2>
          <p class="muted">관리 중인 재생목록 ID</p>
          <p style="font-weight:700;">${input.summary.playlistId ? escapeHtml(input.summary.playlistId) : "첫 동기화 시 자동 생성됩니다"}</p>
          ${
            input.summary.playlistId
              ? `<p><a href="https://www.youtube.com/playlist?list=${escapeHtml(input.summary.playlistId)}" target="_blank" rel="noreferrer">재생목록 열기</a></p>`
              : ""
          }
          <form method="post" action="/admin/sync">
            <button type="submit" ${canRunSync ? "" : "disabled"} data-loading-label="동기화 중...">지금 동기화 실행</button>
          </form>
          ${
            canRunSync
              ? `<p class="muted">두 계정이 모두 연결되어 있으므로 수동 동기화를 바로 실행할 수 있습니다.</p>`
              : `<div class="inline-note"><strong>동기화 대기 중</strong><br /><small>Spotify와 YouTube를 모두 연결해야 동기화를 실행할 수 있습니다.</small></div>`
          }
        </article>
      </section>
      ${
        hasConnectedProvider
          ? `<section class="panel danger" style="margin-top:16px;">
              <h2 style="margin-top:0;">위험 작업</h2>
              <p class="muted">실수 방지를 위해 브라우저 확인창을 거친 뒤 실행됩니다. 전체 초기화는 되돌릴 수 없습니다.</p>
              <ul class="danger-list">
                <li>전체 초기화는 Spotify/YouTube 토큰, 계정 정보, 재생목록 ID, 곡 매핑, 실패 이력, 동기화 로그까지 모두 지웁니다.</li>
                <li>YouTube 연결 해제는 YouTube 계정 상태와 재생목록 귀속 정보만 지우고, 곡 검색 결과와 수동 매핑은 유지합니다.</li>
                <li>Spotify 연결 해제는 Spotify 계정 상태만 지우며, YouTube 상태와 기존 이력은 유지합니다.</li>
              </ul>
              <form method="post" action="/admin/reset" data-prompt-text="전체 초기화를 진행하려면 RESET을 입력하세요." data-confirm-message="정말 전체 초기화를 진행할까요? 저장된 프로젝트 상태가 모두 삭제됩니다.">
                <input type="hidden" name="confirmationText" value="" />
                <button type="submit" class="danger" data-loading-label="초기화 중...">전체 초기화</button>
              </form>
            </section>`
          : ""
      }
      <section class="panel" style="margin-top:16px;">
        <h2 style="margin-top:0;">최근 동기화 실행 내역</h2>
        <div class="runs">
          ${
            input.summary.recentRuns.length === 0
              ? `<p class="run-empty">아직 동기화 실행 내역이 없습니다.</p>`
              : input.summary.recentRuns.map((run) => renderRunCard(run)).join("")
          }
        </div>
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
                            <button type="submit" class="secondary" data-loading-label="저장 중...">수동 지정 저장</button>
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
    <script>
      document.addEventListener("submit", function (event) {
        const form = event.target;
        if (!(form instanceof HTMLFormElement)) {
          return;
        }

        const confirmMessage = form.dataset.confirmMessage;
        if (confirmMessage && !window.confirm(confirmMessage)) {
          event.preventDefault();
          return;
        }

        const promptText = form.dataset.promptText;
        if (promptText) {
          const answer = window.prompt(promptText, "");
          if (answer === null) {
            event.preventDefault();
            return;
          }

          const confirmationInput = form.querySelector('input[name="confirmationText"]');
          if (confirmationInput instanceof HTMLInputElement) {
            confirmationInput.value = answer;
          }
        }

        const submitter = event.submitter instanceof HTMLButtonElement
          ? event.submitter
          : form.querySelector('button[type="submit"]');
        const buttons = form.querySelectorAll("button");
        buttons.forEach((button) => {
          button.disabled = true;
        });

        if (submitter instanceof HTMLButtonElement) {
          submitter.dataset.originalLabel = submitter.textContent || "";
          submitter.textContent = submitter.dataset.loadingLabel || "처리 중...";
        }
      });
    </script>
  </body>
</html>`;
}

function renderRunCard(run: DashboardRun) {
  const parsedStats = safeParseJson(run.statsJson);
  const statsPreview = formatStatsPreview(parsedStats.value);
  const statsDetails = formatStructuredLog(parsedStats.value ?? run.statsJson ?? "-");
  const errorPreview = getPreviewText(run.errorSummary);
  const errorDetails = formatStructuredLog(run.errorSummary ?? "-");

  return `<article class="run-card">
    <div class="run-card-head">
      <div>
        <div class="run-tags">
          <span class="status ${run.status === "failed" ? "warn" : ""}">${escapeHtml(formatRunStatus(run.status))}</span>
          <span class="run-tag">${escapeHtml(formatRunTrigger(run.trigger))}</span>
        </div>
      </div>
      <div class="run-meta-item">
        <span class="run-meta-label">시작 시각</span>
        <div class="run-meta-value">${escapeHtml(formatDate(run.startedAt))}</div>
      </div>
    </div>
    <div class="run-meta">
      <div class="run-meta-item">
        <span class="run-meta-label">종료 시각</span>
        <div class="run-meta-value">${escapeHtml(run.finishedAt ? formatDate(run.finishedAt) : "실행 중")}</div>
      </div>
      <div class="run-meta-item">
        <span class="run-meta-label">통계 요약</span>
        <div class="run-meta-value">${escapeHtml(statsPreview)}</div>
      </div>
      <div class="run-meta-item">
        <span class="run-meta-label">오류 요약</span>
        <div class="run-meta-value">${escapeHtml(errorPreview)}</div>
      </div>
    </div>
    <div class="run-details">
      ${run.statsJson ? `<details class="run-disclosure"><summary>통계 상세 보기</summary><div class="run-log">${statsDetails}</div></details>` : ""}
      ${run.errorSummary ? `<details class="run-disclosure"><summary>오류 상세 보기</summary><div class="run-log">${errorDetails}</div></details>` : ""}
    </div>
  </article>`;
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

function safeParseJson(raw: string | null | undefined) {
  if (!raw) {
    return { value: null, parsed: false };
  }

  try {
    return {
      value: JSON.parse(raw) as unknown,
      parsed: true,
    };
  } catch {
    return {
      value: raw,
      parsed: false,
    };
  }
}

function formatStatsPreview(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return getPreviewText(typeof value === "string" ? value : "-");
  }

  const stats = value as Partial<SyncStats>;
  const previewItems = [
    `추가 ${formatStatNumber(stats.insertedTracks)}`,
    `중복 건너뜀 ${formatStatNumber(stats.skippedAlreadyInPlaylist)}`,
    `실패 ${formatStatNumber(stats.failedCount)}`,
    `미매칭 ${formatStatNumber(stats.noMatchCount)}`,
    `큐 ${formatStatNumber(stats.queuedTracks)}`,
  ];

  if (stats.quotaAbort === true) {
    previewItems.push("quota 중단");
  }

  return previewItems.join(" · ");
}

function formatStructuredLog(value: unknown) {
  if (value == null) {
    return "-";
  }

  if (typeof value === "string") {
    return escapeHtml(value);
  }

  try {
    return escapeHtml(JSON.stringify(value, null, 2));
  } catch {
    return escapeHtml(String(value));
  }
}

function getPreviewText(value: string | null | undefined, maxLength = 140) {
  if (!value) {
    return "-";
  }

  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function formatStatNumber(value: number | undefined) {
  return typeof value === "number" ? String(value) : "-";
}
