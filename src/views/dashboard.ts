import { escapeHtml } from "../lib/strings.js";
import {
  formatDateForLanguage,
  formatRelativeTimeForLanguage,
  serializeMessageCatalog,
  t,
} from "../lib/i18n.js";
import type { Language, SyncStats } from "../types.js";

type MessageLevel = "success" | "error";
type DashboardLiveSummary = Awaited<ReturnType<import("../db/store.js").AppStore["getDashboardLiveData"]>>;
type DashboardSummary = Omit<DashboardLiveSummary, "recentRunsPage">;
type DashboardRun = DashboardSummary["recentRuns"][number];
type DashboardRecentRunsPage = {
  items: DashboardRun[];
  hasMore: boolean;
  nextCursor: string | null;
};
type DashboardAttentionTrack = DashboardSummary["attentionTracks"][number];
type DashboardAccount = {
  provider: string;
  externalDisplayName: string | null;
  invalidatedAt: number | null;
  lastRefreshError: string | null;
};

export function renderDashboard(input: {
  language: Language;
  message?: string | undefined;
  messageLevel?: MessageLevel | undefined;
  summary: DashboardSummary;
  accounts: DashboardAccount[];
  recentRunsPage?: DashboardRecentRunsPage;
}) {
  const recentRunsPage = input.recentRunsPage ?? {
    items: input.summary.recentRuns,
    hasMore: false,
    nextCursor: null,
  };
  const sections = renderDashboardSections({
    language: input.language,
    summary: input.summary,
    accounts: input.accounts,
    recentRunsPage,
  });

  return `<!doctype html>
<html lang="${escapeHtml(input.language)}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(t(input.language, "app.title"))}</title>
  <style>${baseStyles()}</style>
</head>
<body>
  <main>
    <div id="live-alert-root"></div>
    <div id="header-root">${sections.header}</div>
    ${input.message ? `<div id="flash-root"><div class="message ${input.messageLevel === "error" ? "error" : "success"}">${escapeHtml(input.message)}</div></div>` : `<div id="flash-root"></div>`}
    <div id="overview-root">${sections.overview}</div>
    <div id="live-root">${sections.live}</div>
    <div id="attention-root">${sections.attention}</div>
    <div id="recent-runs-root">${sections.recentRuns}</div>
    <div id="danger-root">${sections.danger}</div>
  </main>
  <script id="dashboard-live-data" type="application/json">${serializeForScriptTag({ language: input.language, summary: input.summary, accounts: input.accounts, recentRunsPage })}</script>
  <script id="dashboard-message-catalog" type="application/json">${serializeForScriptTag(serializeMessageCatalog())}</script>
  <script>${clientScript()}</script>
</body>
</html>`;
}

export function renderDashboardSections(input: {
  language: Language;
  summary: DashboardSummary;
  accounts: DashboardAccount[];
  recentRunsPage?: DashboardRecentRunsPage;
}) {
  const recentRunsPage = input.recentRunsPage ?? {
    items: input.summary.recentRuns,
    hasMore: false,
    nextCursor: null,
  };
  const spotifyAccount = input.accounts.find((account) => account.provider === "spotify");
  const youtubeAccount = input.accounts.find((account) => account.provider === "youtube");
  const isSpotifyConnected = input.summary.spotifyConnected === true;
  const isYouTubeConnected = input.summary.youtubeConnected === true;
  const canRunSync = isSpotifyConnected && isYouTubeConnected;
  const reviewTracks = input.summary.attentionTracks.filter((track: DashboardAttentionTrack) => track.searchStatus === "review_required");
  const otherAttentionTracks = input.summary.attentionTracks.filter((track: DashboardAttentionTrack) => track.searchStatus !== "review_required");

  return {
    header: renderHeader(input.language),
    overview: `<section class="grid">${renderConnectionPanel(input.language, "Spotify", isSpotifyConnected, spotifyAccount, "/auth/spotify/start", "/admin/connections/spotify/disconnect", "connection.disconnectSpotifyConfirm", "connection.connectSpotify", "connection.disconnectSpotify")}${renderConnectionPanel(input.language, "YouTube", isYouTubeConnected, youtubeAccount, "/auth/youtube/start", "/admin/connections/youtube/disconnect", "connection.disconnectYouTubeConfirm", "connection.connectYouTube", "connection.disconnectYouTube")}${renderSyncPanel(input.language, input.summary, canRunSync)}</section>`,
    live: `<section class="panel live" style="margin-top:16px;"><div id="live-sync-root">${renderLiveSection(input.language, input.summary)}</div></section>`,
    attention: `<section class="panel" style="margin-top:16px;"><h2 style="margin-top:0;">${escapeHtml(t(input.language, "attention.title"))}</h2>${input.summary.attentionTracks.length === 0 ? `<p class="muted">${escapeHtml(t(input.language, "attention.empty"))}</p>` : `${reviewTracks.length > 0 ? `<section style="margin-bottom:18px;"><h3 class="muted" style="margin:0 0 12px;">${escapeHtml(t(input.language, "attention.reviewSection"))}</h3><div class="attention-list">${reviewTracks.map((track: DashboardAttentionTrack) => renderReviewTrackCard(input.language, track)).join("")}</div></section>` : ""}${otherAttentionTracks.length > 0 ? `<section><h3 class="muted" style="margin:0 0 12px;">${escapeHtml(t(input.language, "attention.retrySection"))}</h3><div class="attention-list">${otherAttentionTracks.map((track: DashboardAttentionTrack) => renderAttentionTrackCard(input.language, track)).join("")}</div></section>` : ""}`}</section>`,
    recentRuns: renderRecentRunsSection(input.language, recentRunsPage),
    danger: renderDangerSection(input.language),
  };
}

function baseStyles() {
  return `
    :root{--bg:#f6f3eb;--panel:#fffdf8;--ink:#1f1d1a;--muted:#6f675d;--line:#ded7cb;--accent:#0d7c66;--warn:#b86d1f;--danger:#b93a32}
    *{box-sizing:border-box} html,body{max-width:100%;overflow-x:hidden} body{margin:0;font-family:"Segoe UI",sans-serif;background:radial-gradient(circle at top,#fff8e7,var(--bg) 50%);color:var(--ink)}
    main{max-width:1120px;margin:0 auto;padding:32px 20px 56px;min-width:0} .grid,.runs,.attention-list,.stack,.live-board,.track-list,.event-list{display:grid;gap:12px;min-width:0}
    .grid{grid-template-columns:repeat(auto-fit,minmax(260px,1fr))} .live-board{grid-template-columns:minmax(0,1.02fr) minmax(0,1fr)}
    .panel,.run-card,.attention-card,.track-row,.event-row{background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:16px;min-width:0;overflow:hidden;box-shadow:0 10px 35px rgba(60,45,20,.06)}
    .attention-card.review-card{background:linear-gradient(180deg,#fffaf3 0%,rgba(255,255,255,.94) 100%)} .panel.live{background:linear-gradient(180deg,#fffef9 0%,#fffaf2 100%)} .danger-zone{border-color:#efc3bf;background:linear-gradient(180deg,#fff8f7 0%,rgba(255,255,255,.95) 100%)}
    .status,.tag,.pill{display:inline-flex;align-items:center;max-width:100%;padding:4px 10px;border-radius:999px;font-size:12px;font-weight:700;overflow-wrap:anywhere;word-break:break-word}
    .status{background:#ebf6f2;color:var(--accent)} .status.warn{background:#fff4e8;color:var(--warn)} .status.error{background:#fff0ef;color:var(--danger)} .tag,.pill{background:#f4efe5;color:var(--ink)}
    .message{margin-bottom:16px;padding:12px 14px;border-radius:12px}.message.success{background:#eef8f4;border:1px solid #b7dccd}.message.error{background:#fff3f1;border:1px solid #f0b7b1}
    form,.actions,.manual-form{display:grid;gap:10px;min-width:0} button,input,select{border-radius:12px;border:1px solid var(--line);padding:10px 12px;font:inherit}
    button{background:var(--accent);color:#fff;cursor:pointer} button.secondary{background:#fff;color:var(--ink)} button.secondary.active{border-color:var(--accent);color:var(--accent)} button.danger{background:var(--danger);border-color:var(--danger)} button.danger.secondary{background:#fff;color:var(--danger)} button:disabled{opacity:.55;cursor:not-allowed}
    .muted,.note{color:var(--muted)} .inline-note,.empty{padding:12px 14px;border-radius:12px;background:#faf7f1;border:1px solid var(--line)}
    .head,.split{display:grid;gap:10px;grid-template-columns:minmax(0,1fr) auto;align-items:start;min-width:0}.meta,.summary-grid{display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));min-width:0}
    .title,.subtitle,.text,.log,.current,.video-title,.video-channel,.video-meta,.recent-run-time{min-width:0;overflow-wrap:anywhere;word-break:break-word}.log{margin-top:10px;padding:12px;border-radius:12px;background:#faf7f1;border:1px solid var(--line);font:12px/1.55 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:pre-wrap;max-height:260px;overflow:auto}
    .video-card{display:grid;gap:12px;grid-template-columns:minmax(0,160px) minmax(0,1fr);padding:12px;border-radius:14px;border:1px solid var(--line);background:#faf7f1}.video-card img{display:block;width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:12px;border:1px solid var(--line)}
    .manual-row,.controls{display:grid;gap:10px;grid-template-columns:minmax(0,1fr) auto;align-items:start;min-width:0}.progress{display:grid;gap:8px}.bar{width:100%;height:10px;border-radius:999px;background:#ede7da;overflow:hidden}.bar>span{display:block;height:100%;background:linear-gradient(90deg,#0d7c66 0%,#27a77c 100%)}
    .scroll{max-height:520px;overflow:auto;padding-right:4px}.sticky{position:sticky;top:0;background:linear-gradient(180deg,var(--panel) 78%,rgba(255,253,248,0));padding-bottom:10px;z-index:1}.current-row{border-color:#9cc8ba;background:linear-gradient(180deg,#f6fff8 0%,rgba(255,255,255,.96) 100%)} .chips,.language-toggle{display:flex;flex-wrap:wrap;gap:8px;min-width:0}
    .recent-runs-footer{display:grid;gap:10px;min-height:44px;margin-top:12px;align-content:start;min-width:0}.recent-runs-actions{display:flex;flex-wrap:wrap;gap:10px;align-items:center;min-width:0}.recent-runs-error{margin:0}.spinner{display:inline-block;width:12px;height:12px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:spin .8s linear infinite;flex:0 0 auto}
    @keyframes spin{to{transform:rotate(360deg)}}
    @media (max-width:860px){.live-board,.video-card,.head,.split,.manual-row,.controls{grid-template-columns:1fr}} @media (max-width:640px){main{padding-left:14px;padding-right:14px}}
  `;
}
function renderHeader(language: Language) {
  return `<section class="stack" style="margin-bottom:16px;"><div class="head"><div><small class="muted">${escapeHtml(t(language, "app.tagline"))}</small><h1 style="margin:0;">${escapeHtml(t(language, "app.title"))}</h1><p class="note" style="margin:0;max-width:760px;">${escapeHtml(t(language, "app.subtitle"))}</p></div><div class="language-toggle" role="group" aria-label="${escapeHtml(t(language, "language.label"))}"><button type="button" class="secondary ${language === "ko" ? "active" : ""}" data-language-switch="ko">${escapeHtml(t(language, "language.ko"))}</button><button type="button" class="secondary ${language === "en" ? "active" : ""}" data-language-switch="en">${escapeHtml(t(language, "language.en"))}</button></div></div></section>`;
}

function renderConnectionPanel(language: Language, title: string, connected: boolean, account: DashboardAccount | undefined, connectHref: string, disconnectAction: string, disconnectMessageKey: string, connectKey: string, disconnectKey: string) {
  return `<article class="panel"><h2 style="margin-top:0;">${escapeHtml(title)}</h2><p><span class="${connected ? "status" : "status warn"}">${escapeHtml(t(language, connected ? "connection.connected" : "connection.needsSetup"))}</span></p><p class="muted text">${escapeHtml(account?.externalDisplayName ?? t(language, "connection.notConnected"))}</p>${account?.lastRefreshError ? `<p class="muted text">${escapeHtml(t(language, "connection.latestRefreshError"))}: ${escapeHtml(account.lastRefreshError)}</p>` : ""}<div class="actions"><a href="${escapeHtml(connectHref)}"><button type="button">${escapeHtml(t(language, connectKey))}</button></a>${connected ? `<form method="post" action="${escapeHtml(disconnectAction)}" data-confirm-message="${escapeHtml(t(language, disconnectMessageKey))}"><button type="submit" class="danger secondary" data-loading-label="${escapeHtml(t(language, disconnectKey))}...">${escapeHtml(t(language, disconnectKey))}</button></form>` : ""}</div></article>`;
}

function renderSyncPanel(language: Language, summary: DashboardSummary, canRunSync: boolean) {
  const playlistId = summary.playlistId;
  const librarySummary = summary.librarySummary;
  const pendingAttention = librarySummary.reviewRequiredTracks + librarySummary.failedTracks + librarySummary.noMatchTracks;
  const runSummary = summary.runSummary;
  const hasScopedProgress =
    runSummary !== null &&
    runSummary.scopedTotalTracks !== null &&
    runSummary.scopedCompletedTracks !== null;
  const runScopeText = !summary.activeRun
    ? t(language, "sync.runScopeIdle")
    : !summary.activeRun.playlistSnapshotCompletedAt || runSummary?.scopedTotalTracks === null
      ? t(language, "sync.runScopeScanning")
      : (runSummary?.scopedTotalTracks ?? 0) === 0
        ? t(language, "sync.runScopeDone")
        : t(language, "sync.runScopeReady", { count: runSummary?.scopedTotalTracks ?? 0 });

  return `<article class="panel"><h2 style="margin-top:0;">${escapeHtml(t(language, "sync.panelTitle"))}</h2><p class="muted">${escapeHtml(t(language, "sync.managedPlaylistId"))}</p><p class="text"><strong>${playlistId ? escapeHtml(playlistId) : escapeHtml(t(language, "sync.playlistAutoCreated"))}</strong></p>${playlistId ? `<p><a href="https://www.youtube.com/playlist?list=${escapeHtml(playlistId)}" target="_blank" rel="noreferrer">${escapeHtml(t(language, "sync.openPlaylist"))}</a></p>` : ""}<div class="stack" style="margin-bottom:12px;"><div class="inline-note"><strong>${escapeHtml(t(language, "sync.librarySummary"))}</strong><br /><small>${escapeHtml(t(language, "sync.librarySummaryValue", { synced: librarySummary.syncedTracks, total: librarySummary.totalTracks }))}</small>${pendingAttention > 0 ? `<br /><small>${escapeHtml(t(language, "sync.pendingSummaryValue", { count: pendingAttention }))}</small>` : ""}</div><div class="inline-note"><strong>${escapeHtml(t(language, "sync.runScopeTitle"))}</strong><br /><small>${escapeHtml(runScopeText)}</small>${hasScopedProgress ? `<br /><small>${escapeHtml(t(language, "sync.runScopeProgress", { completed: runSummary.scopedCompletedTracks, total: runSummary.scopedTotalTracks }))}</small>` : ""}</div><p class="note" style="margin:0;">${escapeHtml(t(language, "sync.playlistSafety"))}</p></div><form method="post" action="/admin/sync"><button type="submit" ${canRunSync ? "" : "disabled"} data-loading-label="${escapeHtml(t(language, "sync.starting"))}">${escapeHtml(t(language, "sync.runNow"))}</button></form>${canRunSync ? `<p class="note">${escapeHtml(t(language, "sync.canRunNow"))}</p>` : `<div class="inline-note"><strong>${escapeHtml(t(language, "sync.waitingForSetupTitle"))}</strong><br /><small>${escapeHtml(t(language, "sync.waitingForSetupBody"))}</small></div>`}</article>`;
}

function renderLiveSection(language: Language, summary: DashboardSummary) {
  if (!summary.activeRun) {
    return `<div class="empty">${escapeHtml(t(language, "live.none"))}</div>`;
  }

  const activeRunTracks = summary.activeRunTracks ?? [];
  const activeRunEvents = summary.activeRunEvents ?? [];
  const total = Number(summary.activeRun.totalTracks ?? 0);
  const completed = Number(summary.activeRun.completedTracks ?? 0);
  const remaining = Number(summary.activeRun.remainingTracks ?? Math.max(0, total - completed));
  const pct = total > 0 ? Math.max(0, Math.min(100, Math.round((completed / total) * 100))) : 0;
  const runSummary = summary.runSummary;
  const hasScopedProgress =
    runSummary !== null &&
    runSummary.scopedTotalTracks !== null &&
    runSummary.scopedCompletedTracks !== null;
  const scopedCompletedValue: number = hasScopedProgress ? Number(runSummary.scopedCompletedTracks) : 0;
  const scopedTotalValue: number = hasScopedProgress ? Number(runSummary.scopedTotalTracks) : 0;
  const scopedPct = hasScopedProgress
    ? Math.max(0, Math.min(100, Math.round((scopedCompletedValue / Math.max(1, scopedTotalValue)) * 100)))
    : 0;
  const scopedText = runSummary?.scopedTotalTracks === null
    ? t(language, "sync.runScopeScanning")
    : `${scopedCompletedValue} / ${hasScopedProgress ? scopedTotalValue : (runSummary?.scopedTotalTracks ?? 0)}`;

  return `<div class="stack"><div class="head"><div><div class="chips"><span class="${statusClass(summary.activeRun.status)}">${escapeHtml(formatRunStatus(language, summary.activeRun.status))}</span><span class="tag">${escapeHtml(t(language, `phase.${summary.activeRun.phase ?? "queued"}`))}</span>${summary.activeRun.pauseReason ? `<span class="tag">${escapeHtml(summary.activeRun.pauseReason)}</span>` : ""}</div><h2 style="margin:10px 0 0;">${escapeHtml(t(language, "live.title"))}</h2></div><div class="note">${escapeHtml(t(language, "live.updatedAt", { value: formatDate(language, summary.activeRunUpdatedAt ?? summary.activeRun.updatedAt ?? summary.activeRun.lastHeartbeatAt ?? summary.activeRun.startedAt) }))}</div></div><div class="summary-grid"><div><small class="muted">${escapeHtml(t(language, "live.status"))}</small><div class="text">${escapeHtml(summary.activeRun.statusMessage ?? formatRunStatus(language, summary.activeRun.status))}</div></div><div><small class="muted">${escapeHtml(t(language, "live.progress"))}</small><div class="text">${escapeHtml(`${completed} / ${total}`)}</div></div><div><small class="muted">${escapeHtml(t(language, "live.remaining"))}</small><div class="text">${escapeHtml(String(remaining))}</div></div><div><small class="muted">${escapeHtml(t(language, "live.currentTrack"))}</small><div class="current">${escapeHtml(summary.activeRun.currentTrackName ?? "-")}</div></div><div><small class="muted">${escapeHtml(t(language, "live.nextRetry"))}</small><div class="text">${escapeHtml(formatDate(language, summary.activeRun.nextRetryAt))}</div></div><div><small class="muted">${escapeHtml(t(language, "live.lastError"))}</small><div class="text">${escapeHtml(previewText(summary.lastLiveError ?? summary.activeRun.lastErrorSummary ?? summary.activeRun.errorSummary ?? "-", 200))}</div></div></div><div class="progress"><div class="note">${escapeHtml(t(language, "live.progress"))}</div><div class="bar"><span style="width:${pct}%"></span></div><div class="text">${escapeHtml(`${pct}%`)}</div></div><div class="progress"><div class="note">${escapeHtml(t(language, "live.processingScope"))}</div><div class="bar"><span style="width:${scopedPct}%"></span></div><div class="text">${escapeHtml(scopedText)}</div></div><div class="live-board"><section><div class="sticky"><h3 style="margin:0 0 8px;">${escapeHtml(t(language, "live.trackFlow"))}</h3><div class="controls"><select id="track-filter"><option value="all">${escapeHtml(t(language, "live.filter.all"))}</option><option value="active">${escapeHtml(t(language, "live.filter.active"))}</option><option value="waiting_for_youtube_quota">${escapeHtml(t(language, "live.filter.waitingYoutube"))}</option><option value="waiting_for_spotify_retry">${escapeHtml(t(language, "live.filter.waitingSpotify"))}</option><option value="review_required">${escapeHtml(t(language, "live.filter.review"))}</option><option value="failed">${escapeHtml(t(language, "live.filter.failed"))}</option></select><button type="button" class="secondary" id="track-refresh">${escapeHtml(t(language, "live.refreshTracks"))}</button></div><div class="note" id="track-page-note">${escapeHtml(activeRunTracks.length === 0 ? t(language, "live.trackFlowHint") : t(language, "live.trackPageRange", { start: 1, end: activeRunTracks.length, total }))}</div></div><div class="scroll"><div class="track-list" id="track-list-items">${activeRunTracks.length === 0 ? `<div class="empty">${escapeHtml(t(language, "live.noTracks"))}</div>` : activeRunTracks.map((track: any) => renderActiveTrackRow(language, track, summary.activeRun?.currentSpotifyTrackId ?? null)).join("")}</div></div><div class="controls" style="margin-top:10px;"><button type="button" class="secondary" id="track-prev">${escapeHtml(t(language, "live.previous"))}</button><button type="button" class="secondary" id="track-next">${escapeHtml(t(language, "live.next"))}</button></div></section><section><div class="sticky"><h3 style="margin:0;">${escapeHtml(t(language, "live.timeline"))}</h3><div class="note">${escapeHtml(t(language, "live.timelineHint"))}</div></div><div class="scroll"><div class="event-list">${activeRunEvents.length === 0 ? `<div class="empty">${escapeHtml(t(language, "live.noEvents"))}</div>` : activeRunEvents.map((event: any) => renderEventRow(language, event)).join("")}</div></div></section></div></div>`;
}

function renderActiveTrackRow(language: Language, track: any, currentSpotifyTrackId: string | null) {
  return `<article class="track-row ${currentSpotifyTrackId === track.spotifyTrackId ? "current-row" : ""}"><div class="head"><div><div class="text"><strong>${escapeHtml(track.trackName)}</strong></div><div class="text muted">${escapeHtml(track.artistNames.join(", "))}</div></div><span class="${statusClass(track.status)}">${escapeHtml(formatTrackStatus(language, track.status))}</span></div><div class="chips">${track.statusMessage ? `<span class="tag">${escapeHtml(track.statusMessage)}</span>` : ""}${track.matchedVideoTitle ? `<span class="tag">YT: ${escapeHtml(track.matchedVideoTitle)}</span>` : ""}${track.playlistItemId ? `<span class="tag">${escapeHtml(formatTrackStatus(language, "inserted"))}</span>` : ""}</div>${track.lastError ? `<details><summary>${escapeHtml(t(language, "live.trackError"))}</summary><div class="log">${escapeHtml(track.lastError)}</div></details>` : ""}</article>`;
}
function renderEventRow(language: Language, event: any) {
  return `<article class="event-row"><div class="head"><div><div class="text"><strong>${escapeHtml(event.message)}</strong></div><div class="text muted">${escapeHtml(event.stage)}</div></div><span class="${statusClass(event.level === "error" ? "failed" : event.level === "warn" ? "waiting_for_youtube_quota" : "running")}">${escapeHtml(String(event.level).toUpperCase())}</span></div><div class="chips"><span class="tag">${escapeHtml(formatDate(language, event.createdAt))}</span>${event.spotifyTrackId ? `<span class="tag">${escapeHtml(event.spotifyTrackId)}</span>` : ""}</div>${event.payloadJson ? `<details><summary>${escapeHtml(t(language, "live.payload"))}</summary><div class="log">${formatStructuredLog(event.payloadJson)}</div></details>` : ""}</article>`;
}

function renderRecentRunsSection(language: Language, recentRunsPage: DashboardRecentRunsPage) {
  return `<section class="panel" style="margin-top:16px;"><h2 style="margin-top:0;">${escapeHtml(t(language, "runs.title"))}</h2><div class="runs" id="recent-runs-items">${renderRecentRuns(language, recentRunsPage.items)}</div><div class="recent-runs-footer" id="recent-runs-footer">${renderRecentRunsFooter(language, { hasMore: recentRunsPage.hasMore, isLoading: false, error: "" })}</div></section>`;
}

function renderRecentRuns(language: Language, runs: DashboardRun[]) {
  return runs.length === 0 ? `<p class="muted">${escapeHtml(t(language, "runs.empty"))}</p>` : runs.map((run) => renderRunCard(language, run)).join("");
}

function renderRecentRunsFooter(language: Language, input: {
  hasMore: boolean;
  isLoading: boolean;
  error: string;
}) {
  if (!input.hasMore && !input.error) {
    return "";
  }

  const buttonLabel = input.isLoading
    ? t(language, "runs.loadingMore")
    : input.error
      ? t(language, "runs.retry")
      : t(language, "runs.loadMore");

  return `<div class="recent-runs-actions">${input.error ? `<p class="inline-note recent-runs-error">${escapeHtml(input.error)}</p>` : ""}${input.hasMore || input.error ? `<button type="button" class="secondary" id="recent-runs-load-more" ${input.isLoading ? "disabled" : ""}>${input.isLoading ? `<span class="spinner" aria-hidden="true"></span> ` : ""}${escapeHtml(buttonLabel)}</button>` : ""}</div>`;
}

function renderRunCard(language: Language, run: DashboardRun) {
  const parsedStats = safeParseJson(run.statsJson);
  return `<article class="run-card"><div class="head"><div><div class="chips"><span class="${statusClass(run.status)}">${escapeHtml(formatRunStatus(language, run.status))}</span><span class="tag">${escapeHtml(run.trigger)}</span></div></div><div><small class="muted">${escapeHtml(t(language, "runs.startedAt"))}</small><div class="text">${renderRelativeTime(language, run.startedAt)}</div></div></div><div class="meta"><div><small class="muted">${escapeHtml(t(language, "runs.finishedAt"))}</small><div class="text">${escapeHtml(run.finishedAt ? formatDate(language, run.finishedAt) : t(language, "runs.stillActive"))}</div></div><div><small class="muted">${escapeHtml(t(language, "runs.stats"))}</small><div class="text">${escapeHtml(formatStatsDisplay(parsedStats))}</div></div><div><small class="muted">${escapeHtml(t(language, "runs.error"))}</small><div class="text">${escapeHtml(previewText(run.errorSummary))}</div></div></div><div>${run.statsJson ? `<details><summary>${escapeHtml(t(language, "live.viewStats"))}</summary><div class="log">${formatStructuredLog(parsedStats ?? run.statsJson ?? "-")}</div></details>` : ""}${run.errorSummary ? `<details><summary>${escapeHtml(t(language, "live.viewError"))}</summary><div class="log">${formatStructuredLog(run.errorSummary ?? "-")}</div></details>` : ""}</div></article>`;
}

function renderReviewTrackCard(language: Language, track: DashboardAttentionTrack) {
  return `<article class="attention-card review-card"><div class="head"><div><p class="title">${escapeHtml(track.trackName)}</p><div class="subtitle muted">${escapeHtml(formatTrackArtists(track))}</div></div><div class="chips"><span class="${statusClass(track.searchStatus)}">${escapeHtml(formatTrackStatus(language, track.searchStatus))}</span>${typeof track.reviewScore === "number" ? `<span class="pill">Score ${escapeHtml(String(track.reviewScore))}</span>` : ""}</div></div><div class="stack">${track.reviewVideoId ? renderRecommendationCard(language, track) : `<div class="inline-note">${escapeHtml(t(language, "attention.noRecommendation"))}</div>`}${track.reviewReasons.length > 0 ? `<div class="chips">${track.reviewReasons.slice(0, 4).map((reason: string) => `<span class="pill">${escapeHtml(reason)}</span>`).join("")}</div>` : ""}${track.lastError ? `<div class="text" style="color:var(--danger)">${escapeHtml(track.lastError)}</div>` : ""}<div class="actions">${track.reviewVideoId ? `<form method="post" action="/admin/tracks/${encodeURIComponent(track.spotifyTrackId)}/review/accept"><button type="submit" data-loading-label="${escapeHtml(t(language, "attention.acceptRecommendation"))}...">${escapeHtml(t(language, "attention.acceptRecommendation"))}</button></form>` : ""}${renderManualForm(language, track, "attention.enterManualMatch", !track.reviewVideoId, "attention.saveManualMatch")}</div></div></article>`;
}

function renderAttentionTrackCard(language: Language, track: DashboardAttentionTrack) {
  const currentVideoId = track.manualVideoId ?? track.matchedVideoId;
  return `<article class="attention-card"><div class="head"><div><p class="title">${escapeHtml(track.trackName)}</p><div class="subtitle muted">${escapeHtml(formatTrackArtists(track))}</div></div><div class="chips"><span class="${statusClass(track.searchStatus)}">${escapeHtml(formatTrackStatus(language, track.searchStatus))}</span></div></div><div class="stack">${currentVideoId ? renderResolvedVideo(language, track, currentVideoId) : `<div class="inline-note">${escapeHtml(t(language, "attention.noResolvedVideo"))}</div>`}${track.lastError ? `<div class="text" style="color:var(--danger)">${escapeHtml(track.lastError)}</div>` : ""}${renderManualForm(language, track, track.searchStatus === "matched_manual" ? "attention.replaceManualMatch" : "attention.enterManualMatch", track.searchStatus !== "matched_manual", "attention.saveManualMatch")}</div></article>`;
}

function renderRecommendationCard(language: Language, track: DashboardAttentionTrack) {
  const reviewUrl = track.reviewVideoUrl ?? getVideoWatchUrl(track.reviewVideoId ?? "");
  return `<div class="video-card"><a href="${escapeHtml(reviewUrl)}" target="_blank" rel="noreferrer"><img src="${escapeHtml(getThumbnailUrl(track.reviewVideoId ?? ""))}" alt="${escapeHtml(track.reviewVideoTitle ?? track.trackName)}" loading="lazy" /></a><div><div class="video-title">${escapeHtml(track.reviewVideoTitle ?? track.reviewVideoId ?? "")}</div><div class="video-channel">${escapeHtml(track.reviewChannelTitle ?? t(language, "attention.unknownChannel"))}</div><div class="video-meta"><a href="${escapeHtml(reviewUrl)}" target="_blank" rel="noreferrer">${escapeHtml(reviewUrl)}</a></div></div></div>`;
}

function renderResolvedVideo(language: Language, track: DashboardAttentionTrack, videoId: string) {
  const sourceText = track.manualResolutionType === "recommended" ? t(language, "attention.resolvedRecommended") : track.manualResolutionType === "manual_input" ? t(language, "attention.resolvedManual") : t(language, "attention.resolvedVideo");
  return `<div class="inline-note"><div class="text">${escapeHtml(sourceText)}</div><div class="video-title">${escapeHtml(track.matchedVideoTitle ?? videoId)}</div><div class="video-channel">${escapeHtml(track.matchedChannelTitle ?? "")}</div><div class="video-meta"><a href="${escapeHtml(getVideoWatchUrl(videoId))}" target="_blank" rel="noreferrer">${escapeHtml(getVideoWatchUrl(videoId))}</a></div></div>`;
}

function renderManualForm(language: Language, track: DashboardAttentionTrack, labelKey: string, open: boolean, buttonLabelKey: string) {
  return `<details ${open ? "open" : ""}><summary>${escapeHtml(t(language, labelKey))}</summary><div class="log"><form class="manual-form" method="post" action="/admin/tracks/${encodeURIComponent(track.spotifyTrackId)}/review/manual"><div class="manual-row"><input name="videoInput" value="${escapeHtml(track.manualVideoId ?? "")}" placeholder="${escapeHtml(t(language, "manual.placeholder"))}" /><button type="submit" class="secondary" data-loading-label="${escapeHtml(t(language, buttonLabelKey))}...">${escapeHtml(t(language, buttonLabelKey))}</button></div></form></div></details>`;
}

function renderDangerSection(language: Language) {
  return `<section class="panel danger-zone" style="margin-top:16px;"><h2 style="margin-top:0;">${escapeHtml(t(language, "danger.title"))}</h2><p class="note" style="margin-top:0;">${escapeHtml(t(language, "danger.description"))}</p><form method="post" action="/admin/reset" data-prompt-text="${escapeHtml(t(language, "danger.confirmPrompt"))}"><input type="hidden" name="confirmationText" value="" /><button type="submit" class="danger" data-loading-label="${escapeHtml(t(language, "danger.resetting"))}">${escapeHtml(t(language, "danger.reset"))}</button></form></section>`;
}

function clientScript() {
  return `
    const stateNode=document.getElementById("dashboard-live-data");
    const catalogNode=document.getElementById("dashboard-message-catalog");
    let liveData=stateNode?JSON.parse(stateNode.textContent||"{}"):{};
    const catalog=catalogNode?JSON.parse(catalogNode.textContent||"{}"):{};
    let currentLanguage=liveData.language||"ko";
    const recentRunsState={
      items:Array.isArray(liveData.recentRunsPage?.items)?liveData.recentRunsPage.items.slice():Array.isArray(liveData.summary?.recentRuns)?liveData.summary.recentRuns.slice():[],
      isLoading:false,
      hasMore:liveData.recentRunsPage?.hasMore===true,
      nextCursor:typeof liveData.recentRunsPage?.nextCursor==="string"?liveData.recentRunsPage.nextCursor:null,
      error:"",
    };
    const trackState={page:1,pageSize:50,filter:"all",runId:liveData.summary?.activeRun?.id??null};
    let pollDelay=liveData.summary?.activeRun?5000:20000;
    let pollTimer=null;
    let staleMode=false;
    let relativeRunsTimer=null;
    const esc=(value)=>String(value??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\"/g,"&quot;").replace(/'/g,"&#39;");
    const tt=(key,params={})=>{const messages=catalog[currentLanguage]||catalog.ko||{}; const template=messages[key]||(catalog.en||{})[key]||key; return String(template).replace(/\\{(\\w+)\\}/g,(_,token)=>params[token]===undefined||params[token]===null?"":String(params[token]));};
    function replaceSection(id, html){ const node=document.getElementById(id); if(node && typeof html==="string"){ node.innerHTML=html; } }
    function setAlert(level,message){ const root=document.getElementById("live-alert-root"); if(!root) return; root.innerHTML=message?'<div class="message '+esc(level)+'">'+esc(message)+'</div>':""; }
    function locale(){ return currentLanguage==="en"?"en-US":"ko-KR"; }
    function formatDateValue(timestamp){ if(!timestamp) return "-"; return new Intl.DateTimeFormat(locale(),{dateStyle:"medium",timeStyle:"short"}).format(new Date(timestamp)); }
    function formatRelativeTimeValue(timestamp, nowValue=Date.now()){ if(!timestamp) return "-"; const diffMs=Number(timestamp)-Number(nowValue); const absMs=Math.abs(diffMs); if(absMs<45000) return tt("time.justNow"); const formatter=new Intl.RelativeTimeFormat(locale(),{numeric:"always"}); const units=[{limit:45*60000,valueMs:60000,unit:"minute"},{limit:22*60*60000,valueMs:60*60000,unit:"hour"},{limit:26*24*60*60000,valueMs:24*60*60000,unit:"day"},{limit:320*24*60*60000,valueMs:30*24*60*60000,unit:"month"},{limit:Number.POSITIVE_INFINITY,valueMs:365*24*60*60000,unit:"year"}]; const match=units.find((candidate)=>absMs<candidate.limit)||units[units.length-1]; return formatter.format(Math.round(diffMs/match.valueMs),match.unit); }
    function renderRelativeTimeNode(timestamp){ if(!timestamp) return esc(formatRelativeTimeValue(timestamp)); return '<time class="recent-run-time" datetime="'+esc(new Date(timestamp).toISOString())+'" data-relative-run-time="startedAt" data-timestamp="'+esc(String(timestamp))+'" title="'+esc(formatDateValue(timestamp))+'">'+esc(formatRelativeTimeValue(timestamp))+'</time>'; }
    function safeParse(value){ if(!value) return null; if(typeof value!=="string") return value; try{ return JSON.parse(value); }catch{ return value; } }
    function formatStructured(value){ if(value==null) return "-"; if(typeof value==="string") return esc(value); try{ return esc(JSON.stringify(value,null,2)); }catch{ return esc(String(value)); } }
    function previewText(value,maxLength=140){ if(!value) return "-"; return value.length>maxLength?value.slice(0,maxLength)+"...":value; }
    function formatStat(value){ return typeof value==="number"?String(value):"-"; }
    function formatStatsDisplay(value){ if(!value||typeof value!=="object"||Array.isArray(value)){ return previewText(typeof value==="string"?value:"-"); } const stats=value; const items=['Inserted '+formatStat(stats.insertedTracks),'Skipped '+formatStat(stats.skippedAlreadyInPlaylist),'Review '+formatStat(stats.reviewRequiredCount),'Failed '+formatStat(stats.failedCount)]; if(stats.quotaAbort===true){ items.push('quota wait'); } return items.join(' | '); }
    function runStatusClass(status){ return status==="failed"||status==="needs_reauth"?"status error":status==="waiting_for_youtube_quota"||status==="waiting_for_spotify_retry"||status==="review_required"||status==="no_match"||status==="quota_exhausted"?"status warn":"status"; }
    function mergeRecentRuns(items){ const merged=[]; const seen=new Set(); for(const item of items){ const key=String(item?.id??""); if(!key||seen.has(key)) continue; seen.add(key); merged.push(item); } return merged; }
    function recentRunCard(run){ const parsedStats=safeParse(run.statsJson); return '<article class="run-card"><div class="head"><div><div class="chips"><span class="'+runStatusClass(run.status)+'">'+esc(tt("status.run."+run.status))+'</span><span class="tag">'+esc(run.trigger)+'</span></div></div><div><small class="muted">'+esc(tt("runs.startedAt"))+'</small><div class="text">'+renderRelativeTimeNode(run.startedAt)+'</div></div></div><div class="meta"><div><small class="muted">'+esc(tt("runs.finishedAt"))+'</small><div class="text">'+esc(run.finishedAt?formatDateValue(run.finishedAt):tt("runs.stillActive"))+'</div></div><div><small class="muted">'+esc(tt("runs.stats"))+'</small><div class="text">'+esc(formatStatsDisplay(parsedStats))+'</div></div><div><small class="muted">'+esc(tt("runs.error"))+'</small><div class="text">'+esc(previewText(run.errorSummary))+'</div></div></div><div>'+(run.statsJson?'<details><summary>'+esc(tt("live.viewStats"))+'</summary><div class="log">'+formatStructured(parsedStats??run.statsJson??"-")+'</div></details>':'')+(run.errorSummary?'<details><summary>'+esc(tt("live.viewError"))+'</summary><div class="log">'+formatStructured(run.errorSummary??"-")+'</div></details>':'')+'</div></article>'; }
    function recentRunsMarkup(){ return recentRunsState.items.length===0?'<p class="muted">'+esc(tt("runs.empty"))+'</p>':recentRunsState.items.map((run)=>recentRunCard(run)).join(""); }
    function recentRunsFooterMarkup(){ if(!recentRunsState.hasMore&&!recentRunsState.error) return ""; const label=recentRunsState.isLoading?tt("runs.loadingMore"):recentRunsState.error?tt("runs.retry"):tt("runs.loadMore"); return '<div class="recent-runs-actions">'+(recentRunsState.error?'<p class="inline-note recent-runs-error">'+esc(recentRunsState.error)+'</p>':'')+((recentRunsState.hasMore||recentRunsState.error)?'<button type="button" class="secondary" id="recent-runs-load-more" '+(recentRunsState.isLoading?'disabled':'')+'>'+(recentRunsState.isLoading?'<span class="spinner" aria-hidden="true"></span> ':'')+esc(label)+'</button>':'')+'</div>'; }
    function refreshRelativeRunTimes(){ document.querySelectorAll('[data-relative-run-time="startedAt"]').forEach((node)=>{ if(!(node instanceof HTMLElement)) return; const raw=node.getAttribute("data-timestamp"); const timestamp=raw?Number(raw):NaN; if(!Number.isFinite(timestamp)) return; node.textContent=formatRelativeTimeValue(timestamp); node.setAttribute("title", formatDateValue(timestamp)); }); }
    function renderRecentRunsState(){ const itemsRoot=document.getElementById("recent-runs-items"); const footerRoot=document.getElementById("recent-runs-footer"); if(itemsRoot){ itemsRoot.innerHTML=recentRunsMarkup(); } if(footerRoot){ footerRoot.innerHTML=recentRunsFooterMarkup(); } refreshRelativeRunTimes(); }
    function startRelativeRunsTimer(){ if(relativeRunsTimer){ clearInterval(relativeRunsTimer); } relativeRunsTimer=setInterval(refreshRelativeRunTimes,60000); }
    async function loadMoreRecentRuns(){ if(recentRunsState.isLoading||(!recentRunsState.hasMore&&!recentRunsState.error)) return; recentRunsState.isLoading=true; recentRunsState.error=""; renderRecentRunsState(); try{ const url='/api/sync-runs?limit=5'+(recentRunsState.nextCursor?'&cursor='+encodeURIComponent(recentRunsState.nextCursor):''); const res=await fetch(url,{headers:{accept:'application/json'}}); if(!res.ok) throw new Error('recent runs load failed'); const payload=await res.json(); const items=Array.isArray(payload.items)?payload.items:[]; recentRunsState.items=mergeRecentRuns(recentRunsState.items.concat(items)); recentRunsState.hasMore=payload.hasMore===true; recentRunsState.nextCursor=typeof payload.nextCursor==='string'?payload.nextCursor:null; recentRunsState.error=""; }catch(_error){ recentRunsState.error=tt("runs.loadMoreError"); }finally{ recentRunsState.isLoading=false; renderRecentRunsState(); } }
    function trackRow(track,currentId){ const statusClass=["failed","needs_reauth"].includes(track.status)?"status error":["waiting_for_youtube_quota","waiting_for_spotify_retry","review_required","no_match","quota_exhausted"].includes(track.status)?"status warn":"status"; return '<article class="track-row '+(currentId&&track.spotifyTrackId===currentId?'current-row':'')+'"><div class="head"><div><div class="text"><strong>'+esc(track.trackName)+'</strong></div><div class="text muted">'+esc((track.artistNames||[]).join(", "))+'</div></div><span class="'+statusClass+'">'+esc(tt("status.track."+track.status))+'</span></div><div class="chips">'+(track.statusMessage?'<span class="tag">'+esc(track.statusMessage)+'</span>':'')+(track.matchedVideoTitle?'<span class="tag">YT: '+esc(track.matchedVideoTitle)+'</span>':'')+(track.playlistItemId?'<span class="tag">'+esc(tt("status.track.inserted"))+'</span>':'')+'</div>'+(track.lastError?'<details><summary>'+esc(tt("live.trackError"))+'</summary><div class="log">'+esc(track.lastError)+'</div></details>':'')+'</article>'; }
    async function loadTrackPage(){ if(!trackState.runId) return 0; const res=await fetch('/api/sync-runs/'+encodeURIComponent(String(trackState.runId))+'/tracks?page='+encodeURIComponent(String(trackState.page))+'&pageSize='+encodeURIComponent(String(trackState.pageSize))+'&filter='+encodeURIComponent(trackState.filter),{headers:{accept:"application/json"}}); if(!res.ok) return 0; const payload=await res.json(); const items=Array.isArray(payload.items)?payload.items:[]; const root=document.getElementById("track-list-items"); const note=document.getElementById("track-page-note"); if(root){ root.innerHTML=items.length===0?'<div class="empty">'+esc(tt("live.noMatchingTracks"))+'</div>':items.map((item)=>trackRow(item,payload.run?.currentSpotifyTrackId||null)).join(""); } if(note){ if(items.length===0){ note.textContent=tt("live.trackPageEmpty"); }else{ const start=(trackState.page-1)*trackState.pageSize+1; const end=(trackState.page-1)*trackState.pageSize+items.length; note.textContent=tt("live.trackPageRange",{start,end,total:payload.total}); } } const filter=document.getElementById("track-filter"); if(filter instanceof HTMLSelectElement){ filter.value=trackState.filter; } return items.length; }
    async function refreshLive(showRecovered,forcedLanguage,refreshRecentRuns){ const language=forcedLanguage||currentLanguage; const liveUrl='/api/dashboard/live?language='+encodeURIComponent(language); const res=await fetch(liveUrl,{headers:{accept:'application/json'}}); if(!res.ok) throw new Error('live refresh failed'); liveData=await res.json(); currentLanguage=liveData.language||language||currentLanguage; document.documentElement.lang=currentLanguage; replaceSection('header-root', liveData.sections?.header); replaceSection('overview-root', liveData.sections?.overview); replaceSection('live-root', liveData.sections?.live); replaceSection('attention-root', liveData.sections?.attention); replaceSection('danger-root', liveData.sections?.danger); trackState.runId=liveData.summary?.activeRun?.id??null; const filter=document.getElementById('track-filter'); if(filter instanceof HTMLSelectElement){ filter.value=trackState.filter; } if(trackState.runId && (trackState.filter!=="all" || trackState.page!==1)){ await loadTrackPage(); } if(refreshRecentRuns){ renderRecentRunsState(); } setAlert(showRecovered?'success':'', showRecovered?tt('live.restoredBanner'):''); staleMode=false; pollDelay=liveData.summary?.activeRun?5000:20000; }
    function loop(){ if(pollTimer){ clearTimeout(pollTimer); } pollTimer=setTimeout(async()=>{ try{ await refreshLive(staleMode,undefined,false); }catch(_error){ staleMode=true; pollDelay=Math.min(60000,pollDelay*2); setAlert('error', tt('live.staleBanner')); }finally{ loop(); } }, pollDelay); }
    async function switchLanguage(language){ if(language===currentLanguage) return; setAlert('success', tt('language.switching')); const res=await fetch('/api/preferences/language',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded',accept:'application/json'},body:new URLSearchParams({language}).toString()}); if(!res.ok){ setAlert('error', tt('live.loadingError')); return; } const payload=await res.json(); currentLanguage=payload.language||language; document.documentElement.lang=currentLanguage; await refreshLive(false,currentLanguage,true); }
    document.addEventListener('click',(event)=>{ const target=event.target; if(!(target instanceof HTMLElement)) return; const nextLanguage=target.getAttribute('data-language-switch'); if(nextLanguage){ event.preventDefault(); void switchLanguage(nextLanguage); return; } if(target.id==='recent-runs-load-more'){ event.preventDefault(); void loadMoreRecentRuns(); return; } if(target.id==='track-refresh'){ event.preventDefault(); void loadTrackPage(); return; } if(target.id==='track-prev'){ event.preventDefault(); if(trackState.page<=1) return; trackState.page-=1; void loadTrackPage(); return; } if(target.id==='track-next'){ event.preventDefault(); trackState.page+=1; void loadTrackPage().then((count)=>{ if(count===0){ trackState.page=Math.max(1,trackState.page-1); } }); } });
    document.addEventListener('change',(event)=>{ const target=event.target; if(target instanceof HTMLSelectElement && target.id==='track-filter'){ trackState.filter=target.value; trackState.page=1; void loadTrackPage(); } });
    document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='visible'){ void refreshLive(staleMode,currentLanguage,false); } });
    document.addEventListener("submit",(event)=>{ const form=event.target; if(!(form instanceof HTMLFormElement)) return; const confirmMessage=form.dataset.confirmMessage; if(confirmMessage && !window.confirm(confirmMessage)){ event.preventDefault(); return; } const promptText=form.dataset.promptText; if(promptText){ const answer=window.prompt(promptText,""); if(answer===null){ event.preventDefault(); return; } const input=form.querySelector('input[name="confirmationText"]'); if(input instanceof HTMLInputElement) input.value=answer; } const submitter=event.submitter instanceof HTMLButtonElement?event.submitter:form.querySelector('button[type="submit"]'); form.querySelectorAll("button").forEach((button)=>{button.disabled=true}); if(submitter instanceof HTMLButtonElement){ submitter.textContent=submitter.dataset.loadingLabel||"Working..."; } });
    renderRecentRunsState();
    startRelativeRunsTimer();
    loop();
  `;
}
function formatTrackArtists(track: DashboardAttentionTrack) {
  return `${track.artistNames.join(", ")}${track.albumName ? ` / ${track.albumName}` : ""}`;
}

function formatRunStatus(language: Language, status: string) {
  return t(language, `status.run.${status}`);
}

function formatTrackStatus(language: Language, status: string) {
  return t(language, `status.track.${status}`);
}

function statusClass(status: string) {
  return status === "failed" || status === "needs_reauth"
    ? "status error"
    : status === "waiting_for_youtube_quota" ||
        status === "waiting_for_spotify_retry" ||
        status === "review_required" ||
        status === "no_match" ||
        status === "quota_exhausted"
      ? "status warn"
      : "status";
}

function getVideoWatchUrl(videoId: string) {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

function getThumbnailUrl(videoId: string) {
  return `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
}

function formatDate(language: Language, timestamp: number | null | undefined) {
  return formatDateForLanguage(language, timestamp);
}

function renderRelativeTime(language: Language, timestamp: number | null | undefined) {
  if (!timestamp) {
    return escapeHtml(formatRelativeTimeForLanguage(language, timestamp));
  }

  const iso = new Date(timestamp).toISOString();
  return `<time class="recent-run-time" datetime="${escapeHtml(iso)}" data-relative-run-time="startedAt" data-timestamp="${escapeHtml(String(timestamp))}" title="${escapeHtml(formatDate(language, timestamp))}">${escapeHtml(formatRelativeTimeForLanguage(language, timestamp))}</time>`;
}

function serializeForScriptTag(value: unknown) {
  return JSON.stringify(value)
    .replace(/<\//g, "<\\/")
    .replace(/<!--/g, "<\\!--")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function safeParseJson(raw: unknown) {
  if (!raw) return null;
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

function formatStructuredLog(value: unknown) {
  if (value == null) return "-";
  if (typeof value === "string") return escapeHtml(value);
  try {
    return escapeHtml(JSON.stringify(value, null, 2));
  } catch {
    return escapeHtml(String(value));
  }
}

function previewText(value: string | null | undefined, maxLength = 140) {
  if (!value) return "-";
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function formatStat(value: number | undefined) {
  return typeof value === "number" ? String(value) : "-";
}

function formatStatsDisplay(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return previewText(typeof value === "string" ? value : "-");
  }

  const stats = value as Partial<SyncStats>;
  const items = [
    `Inserted ${formatStat(stats.insertedTracks)}`,
    `Skipped ${formatStat(stats.skippedAlreadyInPlaylist)}`,
    `Review ${formatStat(stats.reviewRequiredCount)}`,
    `Failed ${formatStat(stats.failedCount)}`,
  ];

  if (stats.quotaAbort === true) {
    items.push("quota wait");
  }

  return items.join(" | ");
}
