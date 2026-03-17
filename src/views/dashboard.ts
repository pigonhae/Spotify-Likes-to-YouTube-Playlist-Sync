import { escapeHtml } from "../lib/strings.js";
import type { SyncStats } from "../types.js";

type MessageLevel = "success" | "error";

type DashboardSummary = Awaited<ReturnType<import("../db/store.js").AppStore["getDashboardSummary"]>>;
type DashboardRun = DashboardSummary["recentRuns"][number];
type DashboardAttentionTrack = DashboardSummary["attentionTracks"][number];

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
  const reviewTracks = input.summary.attentionTracks.filter(
    (track: DashboardAttentionTrack) => track.searchStatus === "review_required",
  );
  const otherAttentionTracks = input.summary.attentionTracks.filter(
    (track: DashboardAttentionTrack) => track.searchStatus !== "review_required",
  );

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
      .attention-group + .attention-group {
        margin-top: 18px;
        padding-top: 18px;
        border-top: 1px solid var(--line);
      }
      .attention-heading {
        margin: 0 0 12px;
        font-size: 14px;
        color: var(--muted);
      }
      .attention-list {
        display: grid;
        gap: 12px;
        min-width: 0;
      }
      .attention-card {
        border: 1px solid var(--line);
        border-radius: 16px;
        padding: 14px;
        background: rgba(255, 255, 255, 0.7);
        min-width: 0;
        overflow: hidden;
      }
      .attention-card.review-card {
        background: linear-gradient(180deg, #fffaf3 0%, rgba(255, 255, 255, 0.92) 100%);
      }
      .attention-head {
        display: grid;
        gap: 10px;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: start;
        min-width: 0;
      }
      .attention-head > div {
        min-width: 0;
      }
      .attention-title {
        margin: 0;
        font-size: 16px;
        min-width: 0;
        overflow-wrap: anywhere;
        word-break: break-word;
      }
      .attention-subtitle,
      .attention-note,
      .attention-link,
      .attention-error,
      .video-meta,
      .video-title,
      .video-channel,
      .manual-current {
        min-width: 0;
        overflow-wrap: anywhere;
        word-break: break-word;
      }
      .attention-subtitle {
        margin-top: 4px;
        color: var(--muted);
      }
      .attention-status-row {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        min-width: 0;
      }
      .score-pill {
        display: inline-flex;
        align-items: center;
        padding: 4px 10px;
        border-radius: 999px;
        background: #f4efe5;
        color: var(--ink);
        font-size: 12px;
        font-weight: 700;
      }
      .attention-body {
        display: grid;
        gap: 12px;
        margin-top: 12px;
        min-width: 0;
      }
      .video-card {
        display: grid;
        gap: 12px;
        grid-template-columns: minmax(0, 168px) minmax(0, 1fr);
        padding: 12px;
        border-radius: 14px;
        border: 1px solid var(--line);
        background: var(--soft-bg);
        min-width: 0;
      }
      .video-thumb {
        display: block;
        min-width: 0;
        max-width: 168px;
        width: 100%;
      }
      .video-thumb img {
        display: block;
        width: 100%;
        aspect-ratio: 16 / 9;
        object-fit: cover;
        border-radius: 12px;
        border: 1px solid var(--line);
        background: #ece5d8;
      }
      .video-text {
        display: grid;
        gap: 8px;
        min-width: 0;
      }
      .video-title {
        font-weight: 700;
      }
      .video-channel,
      .video-meta {
        color: var(--muted);
        font-size: 13px;
      }
      .reason-list {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        min-width: 0;
      }
      .reason-pill {
        display: inline-flex;
        align-items: center;
        max-width: 100%;
        padding: 4px 10px;
        border-radius: 999px;
        background: white;
        border: 1px solid var(--line);
        font-size: 12px;
      }
      .review-actions,
      .attention-actions,
      .manual-form {
        display: grid;
        gap: 10px;
        min-width: 0;
      }
      .manual-form-row {
        display: grid;
        gap: 10px;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: start;
        min-width: 0;
      }
      .manual-form-row input {
        min-width: 0;
        width: 100%;
      }
      .manual-disclosure,
      .manual-disclosure[open] {
        min-width: 0;
      }
      .manual-disclosure summary {
        cursor: pointer;
        font-weight: 700;
      }
      .manual-disclosure summary::-webkit-details-marker {
        display: none;
      }
      .manual-disclosure summary::before {
        content: "▸";
        display: inline-block;
        margin-right: 6px;
      }
      .manual-disclosure[open] summary::before {
        content: "▾";
      }
      .manual-panel {
        margin-top: 10px;
        padding-top: 10px;
        border-top: 1px dashed var(--line);
        min-width: 0;
      }
      .manual-current {
        font-size: 13px;
        color: var(--muted);
      }
      .attention-note {
        color: var(--muted);
        font-size: 13px;
      }
      .attention-error {
        color: var(--danger);
        font-size: 13px;
      }
      @media (max-width: 720px) {
        table, thead, tbody, th, td, tr { display: block; }
        th { display: none; }
        td { padding: 8px 0; }
        .run-card-head {
          grid-template-columns: 1fr;
        }
        .attention-head,
        .video-card,
        .manual-form-row {
          grid-template-columns: 1fr;
        }
        .video-thumb {
          max-width: none;
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
              : input.summary.recentRuns.map((run: DashboardRun) => renderRunCard(run)).join("")
          }
        </div>
      </section>
      <section class="panel" style="margin-top:16px;">
        <h2 style="margin-top:0;">확인이 필요한 곡</h2>
        ${
          input.summary.attentionTracks.length === 0
            ? `<p class="run-empty">지금은 수동 확인이 필요한 곡이 없습니다.</p>`
            : `
                ${
                  reviewTracks.length > 0
                    ? `<section class="attention-group">
                        <h3 class="attention-heading">검토가 필요한 추천 후보</h3>
                        <div class="attention-list">
                          ${reviewTracks.map((track: DashboardAttentionTrack) => renderReviewTrackCard(track)).join("")}
                        </div>
                      </section>`
                    : ""
                }
                ${
                  otherAttentionTracks.length > 0
                    ? `<section class="attention-group">
                        <h3 class="attention-heading">직접 확인하거나 다시 시도할 곡</h3>
                        <div class="attention-list">
                          ${otherAttentionTracks.map((track: DashboardAttentionTrack) => renderAttentionTrackCard(track)).join("")}
                        </div>
                      </section>`
                    : ""
                }
              `
        }
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

function renderReviewTrackCard(track: DashboardAttentionTrack) {
  return `<article class="attention-card review-card">
    <div class="attention-head">
      <div>
        <p class="attention-title">${escapeHtml(track.trackName)}</p>
        <div class="attention-subtitle">${escapeHtml(formatTrackArtists(track))}</div>
      </div>
      <div class="attention-status-row">
        <span class="status warn">${escapeHtml(formatTrackStatus(track.searchStatus))}</span>
        ${typeof track.reviewScore === "number" ? `<span class="score-pill">추천 점수 ${escapeHtml(String(track.reviewScore))}</span>` : ""}
      </div>
    </div>
    <div class="attention-body">
      ${track.reviewVideoId ? renderRecommendationCard(track) : `<div class="inline-note attention-note">추천 후보를 자동으로 고르지 못했습니다. 아래에서 직접 YouTube 영상을 입력해 주세요.</div>`}
      ${track.reviewReasons.length > 0 ? `<div class="reason-list">${track.reviewReasons.slice(0, 4).map((reason: string) => `<span class="reason-pill">${escapeHtml(formatReviewReason(reason))}</span>`).join("")}</div>` : ""}
      ${track.lastError ? `<div class="attention-error">${escapeHtml(track.lastError)}</div>` : ""}
      <div class="review-actions">
        ${
          track.reviewVideoId
            ? `<form method="post" action="/admin/tracks/${encodeURIComponent(track.spotifyTrackId)}/review/accept">
                <button type="submit" data-loading-label="확정 중...">이 영상 사용</button>
              </form>`
            : ""
        }
        ${renderManualForm(track, {
          label: "수동 입력하기",
          open: !track.reviewVideoId,
          buttonLabel: "수동 지정 저장",
        })}
      </div>
    </div>
  </article>`;
}

function renderAttentionTrackCard(track: DashboardAttentionTrack) {
  const showManualFormOpen = track.searchStatus !== "matched_manual";
  const currentVideoId = track.manualVideoId ?? track.matchedVideoId;

  return `<article class="attention-card">
    <div class="attention-head">
      <div>
        <p class="attention-title">${escapeHtml(track.trackName)}</p>
        <div class="attention-subtitle">${escapeHtml(formatTrackArtists(track))}</div>
      </div>
      <div class="attention-status-row">
        <span class="status ${track.searchStatus === "failed" || track.searchStatus === "no_match" ? "warn" : ""}">${escapeHtml(formatTrackStatus(track.searchStatus))}</span>
      </div>
    </div>
    <div class="attention-body">
      ${
        currentVideoId
          ? renderResolvedVideo(track, currentVideoId)
          : `<div class="attention-note">아직 확정된 YouTube 영상이 없습니다.</div>`
      }
      ${track.lastError ? `<div class="attention-error">${escapeHtml(track.lastError)}</div>` : ""}
      ${renderManualForm(track, {
        label: track.searchStatus === "matched_manual" ? "다른 영상으로 바꾸기" : "수동 입력하기",
        open: showManualFormOpen,
        buttonLabel: "수동 지정 저장",
      })}
    </div>
  </article>`;
}

function renderRecommendationCard(track: DashboardAttentionTrack) {
  if (!track.reviewVideoId) {
    return "";
  }

  const reviewUrl = track.reviewVideoUrl ?? getVideoWatchUrl(track.reviewVideoId);
  return `<div class="video-card">
    <a class="video-thumb" href="${escapeHtml(reviewUrl)}" target="_blank" rel="noreferrer">
      <img src="${escapeHtml(getThumbnailUrl(track.reviewVideoId))}" alt="${escapeHtml(track.reviewVideoTitle ?? track.trackName)}" loading="lazy" />
    </a>
    <div class="video-text">
      <div class="video-title">${escapeHtml(track.reviewVideoTitle ?? track.reviewVideoId)}</div>
      <div class="video-channel">${escapeHtml(track.reviewChannelTitle ?? "채널 정보 없음")}</div>
      <div class="video-meta">추천 후보 링크: <a class="attention-link" href="${escapeHtml(reviewUrl)}" target="_blank" rel="noreferrer">${escapeHtml(reviewUrl)}</a></div>
    </div>
  </div>`;
}

function renderResolvedVideo(track: DashboardAttentionTrack, videoId: string) {
  const sourceText =
    track.manualResolutionType === "recommended"
      ? "추천 채택 완료"
      : track.manualResolutionType === "manual_input"
        ? "수동 입력 완료"
        : "확정된 영상";

  return `<div class="inline-note">
    <div class="manual-current">${escapeHtml(sourceText)}</div>
    <div class="video-title">${escapeHtml(track.matchedVideoTitle ?? videoId)}</div>
    <div class="video-channel">${escapeHtml(track.matchedChannelTitle ?? "")}</div>
    <div class="video-meta"><a class="attention-link" href="${escapeHtml(getVideoWatchUrl(videoId))}" target="_blank" rel="noreferrer">${escapeHtml(getVideoWatchUrl(videoId))}</a></div>
  </div>`;
}

function renderManualForm(
  track: DashboardAttentionTrack,
  options: {
    label: string;
    open: boolean;
    buttonLabel: string;
  },
) {
  const currentValue = track.manualVideoId ?? "";

  return `<details class="manual-disclosure" ${options.open ? "open" : ""}>
    <summary>${escapeHtml(options.label)}</summary>
    <div class="manual-panel">
      <form class="manual-form" method="post" action="/admin/tracks/${encodeURIComponent(track.spotifyTrackId)}/review/manual">
        <div class="manual-form-row">
          <input name="videoInput" value="${escapeHtml(currentValue)}" placeholder="YouTube URL 또는 video ID" />
          <button type="submit" class="secondary" data-loading-label="저장 중...">${escapeHtml(options.buttonLabel)}</button>
        </div>
      </form>
    </div>
  </details>`;
}

function formatTrackArtists(track: DashboardAttentionTrack) {
  return `${track.artistNames.join(", ")}${track.albumName ? ` / ${track.albumName}` : ""}`;
}

function formatReviewReason(reason: string) {
  if (reason.startsWith("title:")) {
    return `제목 유사도 ${reason.slice("title:".length)}`;
  }

  if (reason === "contains track title") {
    return "제목 일치";
  }

  if (reason.startsWith("artist hits:")) {
    return `아티스트 단서 ${reason.slice("artist hits:".length)}개`;
  }

  if (reason === "contains album") {
    return "앨범명 포함";
  }

  if (reason === "official marker") {
    return "공식 업로드 단서";
  }

  if (reason === "topic channel") {
    return "토픽 채널";
  }

  if (reason === "vevo channel") {
    return "VEVO 채널";
  }

  if (reason === "duration <=5s") {
    return "길이 차이 5초 이하";
  }

  if (reason === "duration <=15s") {
    return "길이 차이 15초 이하";
  }

  if (reason === "duration <=30s") {
    return "길이 차이 30초 이하";
  }

  if (reason === "duration mismatch") {
    return "길이 차이 큼";
  }

  if (reason === "not embeddable") {
    return "삽입 제한";
  }

  if (reason === "not syndicated") {
    return "공개 상태 제한";
  }

  if (reason === "negative title marker") {
    return "비공식 키워드 감점";
  }

  if (reason === "negative channel marker") {
    return "채널 감점";
  }

  return reason;
}

function getVideoWatchUrl(videoId: string) {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

function getThumbnailUrl(videoId: string) {
  return `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
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
    case "review_required":
      return "검토 필요";
    case "matched_manual":
      return "수동 지정 완료";
    case "failed":
      return "실패";
    case "no_match":
      return "검색 결과 없음";
    default:
      return status;
  }
}

function safeParseJson(raw: unknown) {
  if (!raw) {
    return { value: null, parsed: false };
  }

  if (typeof raw !== "string") {
    return {
      value: raw,
      parsed: true,
    };
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
    `검토 ${formatStatNumber(stats.reviewRequiredCount)}`,
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
