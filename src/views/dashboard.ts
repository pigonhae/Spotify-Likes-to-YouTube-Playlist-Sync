import { escapeHtml } from "../lib/strings.js";
import type { SyncStats } from "../types.js";

type MessageLevel = "success" | "error";
type DashboardLiveSummary = Awaited<ReturnType<import("../db/store.js").AppStore["getDashboardLiveData"]>>;
type DashboardSummary = Omit<DashboardLiveSummary, "activeRun" | "activeRunUpdatedAt" | "activeRunTracks" | "activeRunEvents"> & {
  activeRun?: DashboardLiveSummary["activeRun"] | null;
  activeRunUpdatedAt?: DashboardLiveSummary["activeRunUpdatedAt"] | null;
  activeRunTracks?: DashboardLiveSummary["activeRunTracks"];
  activeRunEvents?: DashboardLiveSummary["activeRunEvents"];
};
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
  const canRunSync = isSpotifyConnected && isYouTubeConnected;
  const reviewTracks = input.summary.attentionTracks.filter((track: DashboardAttentionTrack) => track.searchStatus === "review_required");
  const otherAttentionTracks = input.summary.attentionTracks.filter((track: DashboardAttentionTrack) => track.searchStatus !== "review_required");

  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Spotify Likes Sync</title>
  <style>${baseStyles()}</style>
</head>
<body>
  <main>
    <section class="stack" style="margin-bottom:16px;">
      <small class="muted">Spotify liked songs -> YouTube playlist sync</small>
      <h1 style="margin:0;">Spotify Likes Sync Dashboard</h1>
      <p class="note" style="margin:0;max-width:760px;">Run state is stored in PostgreSQL and refreshed with polling. Long titles, errors, and JSON stay wrapped or scroll internally so the layout does not break.</p>
    </section>
    ${input.message ? `<div class="message ${input.messageLevel === "error" ? "error" : "success"}">${escapeHtml(input.message)}</div>` : ""}
    <section class="grid">
      ${renderConnectionPanel("Spotify", isSpotifyConnected, spotifyAccount, "/auth/spotify/start", "/admin/connections/spotify/disconnect", "Disconnect Spotify and pause future sync work?")}
      ${renderConnectionPanel("YouTube", isYouTubeConnected, youtubeAccount, "/auth/youtube/start", "/admin/connections/youtube/disconnect", "Disconnect YouTube and clear managed playlist ownership state?")}
      ${renderSyncPanel(input.summary.playlistId, canRunSync)}
    </section>
    <section class="panel live" style="margin-top:16px;"><div id="live-sync-root">${renderLiveSection(input.summary)}</div></section>
    <section class="panel" style="margin-top:16px;"><h2 style="margin-top:0;">Recent Runs</h2><div class="runs" id="recent-runs-root">${renderRecentRuns(input.summary.recentRuns)}</div></section>
    <section class="panel" style="margin-top:16px;">
      <h2 style="margin-top:0;">Tracks Needing Attention</h2>
      ${input.summary.attentionTracks.length === 0 ? `<p class="muted">There are no tracks that currently need manual attention.</p>` : `${reviewTracks.length > 0 ? `<section style="margin-bottom:18px;"><h3 class="muted" style="margin:0 0 12px;">Review required</h3><div class="attention-list">${reviewTracks.map((track: DashboardAttentionTrack) => renderReviewTrackCard(track)).join("")}</div></section>` : ""}${otherAttentionTracks.length > 0 ? `<section><h3 class="muted" style="margin:0 0 12px;">Retry or confirm manually</h3><div class="attention-list">${otherAttentionTracks.map((track: DashboardAttentionTrack) => renderAttentionTrackCard(track)).join("")}</div></section>` : ""}`}
    </section>
    <section class="panel danger-zone" style="margin-top:16px;">
      <h2 style="margin-top:0;">Danger Zone</h2>
      <p class="note" style="margin-top:0;">Use this only when you intentionally want to wipe saved tokens, run history, cached mappings, playlist ownership, and sync progress.</p>
      <form method="post" action="/admin/reset" data-prompt-text="Type RESET to confirm a full reset.">
        <input type="hidden" name="confirmationText" value="" />
        <button type="submit" class="danger" data-loading-label="Resetting...">Reset all project state</button>
      </form>
    </section>
  </main>
  <script id="dashboard-live-data" type="application/json">${escapeHtml(JSON.stringify(input.summary))}</script>
  <script>${clientScript()}</script>
</body>
</html>`;
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
    button{background:var(--accent);color:#fff;cursor:pointer} button.secondary{background:#fff;color:var(--ink)} button.danger{background:var(--danger);border-color:var(--danger)} button.danger.secondary{background:#fff;color:var(--danger)} button:disabled{opacity:.55;cursor:not-allowed}
    .muted,.note{color:var(--muted)} .inline-note,.empty{padding:12px 14px;border-radius:12px;background:#faf7f1;border:1px solid var(--line)}
    .head,.split{display:grid;gap:10px;grid-template-columns:minmax(0,1fr) auto;align-items:start;min-width:0} .split>div,.head>div{min-width:0}
    .meta,.summary-grid{display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));min-width:0}
    .title,.subtitle,.text,.log,.current,.video-title,.video-channel,.video-meta{min-width:0;overflow-wrap:anywhere;word-break:break-word}
    .log{margin-top:10px;padding:12px;border-radius:12px;background:#faf7f1;border:1px solid var(--line);font:12px/1.55 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:pre-wrap;max-height:260px;overflow:auto}
    .video-card{display:grid;gap:12px;grid-template-columns:minmax(0,160px) minmax(0,1fr);padding:12px;border-radius:14px;border:1px solid var(--line);background:#faf7f1}
    .video-card img{display:block;width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:12px;border:1px solid var(--line)}
    .manual-row,.controls{display:grid;gap:10px;grid-template-columns:minmax(0,1fr) auto;align-items:start;min-width:0}
    .progress{display:grid;gap:8px}.bar{width:100%;height:10px;border-radius:999px;background:#ede7da;overflow:hidden}.bar>span{display:block;height:100%;background:linear-gradient(90deg,#0d7c66 0%,#27a77c 100%)}
    .scroll{max-height:520px;overflow:auto;padding-right:4px}.sticky{position:sticky;top:0;background:linear-gradient(180deg,var(--panel) 78%,rgba(255,253,248,0));padding-bottom:10px;z-index:1}
    .current-row{border-color:#9cc8ba;background:linear-gradient(180deg,#f6fff8 0%,rgba(255,255,255,.96) 100%)} .chips{display:flex;flex-wrap:wrap;gap:8px;min-width:0}
    @media (max-width:860px){.live-board,.video-card,.head,.split,.manual-row,.controls{grid-template-columns:1fr}} @media (max-width:640px){main{padding-left:14px;padding-right:14px}}
  `;
}

function renderConnectionPanel(title: string, connected: boolean, account: { externalDisplayName: string | null; lastRefreshError: string | null } | undefined, connectHref: string, disconnectAction: string, disconnectMessage: string) {
  return `<article class="panel"><h2 style="margin-top:0;">${escapeHtml(title)}</h2><p><span class="${connected ? "status" : "status warn"}">${escapeHtml(connected ? "Connected" : "Needs setup")}</span></p><p class="muted">${escapeHtml(account?.externalDisplayName ?? "Not connected")}</p>${account?.lastRefreshError ? `<p class="muted">Latest refresh error: ${escapeHtml(account.lastRefreshError)}</p>` : ""}<div class="actions"><a href="${escapeHtml(connectHref)}"><button type="button">${escapeHtml("Connect " + title)}</button></a>${connected ? `<form method="post" action="${escapeHtml(disconnectAction)}" data-confirm-message="${escapeHtml(disconnectMessage)}"><button type="submit" class="danger secondary" data-loading-label="Disconnecting...">${escapeHtml("Disconnect " + title)}</button></form>` : ""}</div></article>`;
}

function renderSyncPanel(playlistId: string | null, canRunSync: boolean) {
  return `<article class="panel"><h2 style="margin-top:0;">Playlist And Sync</h2><p class="muted">Managed playlist ID</p><p class="text"><strong>${playlistId ? escapeHtml(playlistId) : "Created automatically on the first successful sync"}</strong></p>${playlistId ? `<p><a href="https://www.youtube.com/playlist?list=${escapeHtml(playlistId)}" target="_blank" rel="noreferrer">Open playlist</a></p>` : ""}<form method="post" action="/admin/sync"><button type="submit" ${canRunSync ? "" : "disabled"} data-loading-label="Starting...">Run sync now</button></form>${canRunSync ? `<p class="note">Both accounts are connected, so a manual run can start immediately.</p>` : `<div class="inline-note"><strong>Waiting for setup</strong><br /><small>Both Spotify and YouTube must be connected before sync can run.</small></div>`}</article>`;
}

function renderLiveSection(summary: DashboardSummary) {
  if (!summary.activeRun) {
    return `<div class="empty">No active or waiting sync run. Start a manual sync or wait for the next scheduled resume.</div>`;
  }
  const activeRunTracks = summary.activeRunTracks ?? [];
  const activeRunEvents = summary.activeRunEvents ?? [];
  const total = Number(summary.activeRun.totalTracks ?? 0);
  const completed = Number(summary.activeRun.completedTracks ?? 0);
  const remaining = Number(summary.activeRun.remainingTracks ?? Math.max(0, total - completed));
  const pct = total > 0 ? Math.max(0, Math.min(100, Math.round((completed / total) * 100))) : 0;
  return `<div class="stack"><div class="head"><div><div class="chips"><span class="${statusClass(summary.activeRun.status)}">${escapeHtml(formatRunStatus(summary.activeRun.status))}</span><span class="tag">${escapeHtml(summary.activeRun.phase ?? "running")}</span>${summary.activeRun.pauseReason ? `<span class="tag">${escapeHtml(summary.activeRun.pauseReason)}</span>` : ""}</div><h2 style="margin:10px 0 0;">Live Sync Run</h2></div><div class="note">Updated ${escapeHtml(formatDate(summary.activeRunUpdatedAt ?? summary.activeRun.updatedAt ?? summary.activeRun.lastHeartbeatAt ?? summary.activeRun.startedAt))}</div></div><div class="summary-grid"><div><small class="muted">Status</small><div class="text">${escapeHtml(summary.activeRun.statusMessage ?? formatRunStatus(summary.activeRun.status))}</div></div><div><small class="muted">Progress</small><div class="text">${escapeHtml(`${completed} / ${total} complete`)}</div></div><div><small class="muted">Remaining</small><div class="text">${escapeHtml(String(remaining))}</div></div><div><small class="muted">Current track</small><div class="current">${escapeHtml(summary.activeRun.currentTrackName ?? "-")}</div></div><div><small class="muted">Next retry</small><div class="text">${escapeHtml(formatDate(summary.activeRun.nextRetryAt))}</div></div><div><small class="muted">Last error</small><div class="text">${escapeHtml(previewText(summary.activeRun.lastErrorSummary ?? summary.activeRun.errorSummary ?? "-", 200))}</div></div></div><div class="progress"><div class="note">Overall progress</div><div class="bar"><span style="width:${pct}%"></span></div><div class="text">${escapeHtml(`${pct}%`)}</div></div><div class="live-board"><section><div class="sticky"><h3 style="margin:0 0 8px;">Spotify track flow</h3><div class="note">${escapeHtml(activeRunTracks.length === 0 ? "Tracks will appear here as the run progresses." : `Showing ${activeRunTracks.length} track rows`)}</div></div><div class="scroll"><div class="track-list">${activeRunTracks.length === 0 ? `<div class="empty">No active track rows are available yet.</div>` : activeRunTracks.map((track: any) => renderActiveTrackRow(track, summary.activeRun?.currentSpotifyTrackId ?? null)).join("")}</div></div></section><section><div class="sticky"><h3 style="margin:0;">Recent timeline</h3><div class="note">Payload blocks wrap and scroll internally so long JSON and errors never stretch the page.</div></div><div class="scroll"><div class="event-list">${activeRunEvents.length === 0 ? `<div class="empty">No recent timeline entries yet.</div>` : activeRunEvents.map((event: any) => renderEventRow(event)).join("")}</div></div></section></div></div>`;
}

function renderActiveTrackRow(track: any, currentSpotifyTrackId: string | null) {
  return `<article class="track-row ${currentSpotifyTrackId === track.spotifyTrackId ? "current-row" : ""}"><div class="head"><div><div class="text"><strong>${escapeHtml(track.trackName)}</strong></div><div class="text muted">${escapeHtml(track.artistNames.join(", "))}</div></div><span class="${statusClass(track.status)}">${escapeHtml(formatTrackStatus(track.status))}</span></div><div class="chips">${track.statusMessage ? `<span class="tag">${escapeHtml(track.statusMessage)}</span>` : ""}${track.matchedVideoTitle ? `<span class="tag">YT: ${escapeHtml(track.matchedVideoTitle)}</span>` : ""}${track.playlistItemId ? `<span class="tag">Inserted</span>` : ""}</div>${track.lastError ? `<details><summary>Track error</summary><div class="log">${escapeHtml(track.lastError)}</div></details>` : ""}</article>`;
}

function renderEventRow(event: any) {
  return `<article class="event-row"><div class="head"><div><div class="text"><strong>${escapeHtml(event.message)}</strong></div><div class="text muted">${escapeHtml(event.stage)}</div></div><span class="${statusClass(event.level === "error" ? "failed" : event.level === "warn" ? "waiting_for_youtube_quota" : "running")}">${escapeHtml(String(event.level).toUpperCase())}</span></div><div class="chips"><span class="tag">${escapeHtml(formatDate(event.createdAt))}</span>${event.spotifyTrackId ? `<span class="tag">${escapeHtml(event.spotifyTrackId)}</span>` : ""}</div>${event.payloadJson ? `<details><summary>Payload</summary><div class="log">${formatStructuredLog(event.payloadJson)}</div></details>` : ""}</article>`;
}

function renderRecentRuns(runs: DashboardRun[]) {
  return runs.length === 0 ? `<p class="muted">No sync runs yet.</p>` : runs.map((run) => renderRunCard(run)).join("");
}

function renderRunCard(run: DashboardRun) {
  const parsedStats = safeParseJson(run.statsJson);
  return `<article class="run-card"><div class="head"><div><div class="chips"><span class="${statusClass(run.status)}">${escapeHtml(formatRunStatus(run.status))}</span><span class="tag">${escapeHtml(run.trigger)}</span></div></div><div><small class="muted">Started</small><div class="text">${escapeHtml(formatDate(run.startedAt))}</div></div></div><div class="meta"><div><small class="muted">Finished</small><div class="text">${escapeHtml(run.finishedAt ? formatDate(run.finishedAt) : "Still active")}</div></div><div><small class="muted">Stats</small><div class="text">${escapeHtml(formatStatsDisplay(parsedStats))}</div></div><div><small class="muted">Error</small><div class="text">${escapeHtml(previewText(run.errorSummary))}</div></div></div><div>${run.statsJson ? `<details><summary>View stats</summary><div class="log">${formatStructuredLog(parsedStats ?? run.statsJson ?? "-")}</div></details>` : ""}${run.errorSummary ? `<details><summary>View error</summary><div class="log">${formatStructuredLog(run.errorSummary ?? "-")}</div></details>` : ""}</div></article>`;
}

function renderReviewTrackCard(track: DashboardAttentionTrack) {
  return `<article class="attention-card review-card"><div class="head"><div><p class="title">${escapeHtml(track.trackName)}</p><div class="subtitle muted">${escapeHtml(formatTrackArtists(track))}</div></div><div class="chips"><span class="${statusClass(track.searchStatus)}">${escapeHtml(formatTrackStatus(track.searchStatus))}</span>${typeof track.reviewScore === "number" ? `<span class="pill">Score ${escapeHtml(String(track.reviewScore))}</span>` : ""}</div></div><div class="stack">${track.reviewVideoId ? renderRecommendationCard(track) : `<div class="inline-note">No recommended candidate was preserved for this track. Enter a manual YouTube URL or video ID below.</div>`}${track.reviewReasons.length > 0 ? `<div class="chips">${track.reviewReasons.slice(0, 4).map((reason: string) => `<span class="pill">${escapeHtml(reason)}</span>`).join("")}</div>` : ""}${track.lastError ? `<div class="text" style="color:var(--danger)">${escapeHtml(track.lastError)}</div>` : ""}<div class="actions">${track.reviewVideoId ? `<form method="post" action="/admin/tracks/${encodeURIComponent(track.spotifyTrackId)}/review/accept"><button type="submit" data-loading-label="Saving...">Accept recommendation</button></form>` : ""}${renderManualForm(track, "Enter manual match", !track.reviewVideoId, "Save manual match")}</div></div></article>`;
}

function renderAttentionTrackCard(track: DashboardAttentionTrack) {
  const currentVideoId = track.manualVideoId ?? track.matchedVideoId;
  return `<article class="attention-card"><div class="head"><div><p class="title">${escapeHtml(track.trackName)}</p><div class="subtitle muted">${escapeHtml(formatTrackArtists(track))}</div></div><div class="chips"><span class="${statusClass(track.searchStatus)}">${escapeHtml(formatTrackStatus(track.searchStatus))}</span></div></div><div class="stack">${currentVideoId ? renderResolvedVideo(track, currentVideoId) : `<div class="inline-note">No confirmed YouTube video is saved yet.</div>`}${track.lastError ? `<div class="text" style="color:var(--danger)">${escapeHtml(track.lastError)}</div>` : ""}${renderManualForm(track, track.searchStatus === "matched_manual" ? "Replace manual match" : "Enter manual match", track.searchStatus !== "matched_manual", "Save manual match")}</div></article>`;
}

function renderRecommendationCard(track: DashboardAttentionTrack) {
  const reviewUrl = track.reviewVideoUrl ?? getVideoWatchUrl(track.reviewVideoId ?? "");
  return `<div class="video-card"><a href="${escapeHtml(reviewUrl)}" target="_blank" rel="noreferrer"><img src="${escapeHtml(getThumbnailUrl(track.reviewVideoId ?? ""))}" alt="${escapeHtml(track.reviewVideoTitle ?? track.trackName)}" loading="lazy" /></a><div><div class="video-title">${escapeHtml(track.reviewVideoTitle ?? track.reviewVideoId ?? "")}</div><div class="video-channel">${escapeHtml(track.reviewChannelTitle ?? "Unknown channel")}</div><div class="video-meta"><a href="${escapeHtml(reviewUrl)}" target="_blank" rel="noreferrer">${escapeHtml(reviewUrl)}</a></div></div></div>`;
}

function renderResolvedVideo(track: DashboardAttentionTrack, videoId: string) {
  const sourceText = track.manualResolutionType === "recommended" ? "Accepted recommended candidate" : track.manualResolutionType === "manual_input" ? "Manual selection saved" : "Resolved video";
  return `<div class="inline-note"><div class="text">${escapeHtml(sourceText)}</div><div class="video-title">${escapeHtml(track.matchedVideoTitle ?? videoId)}</div><div class="video-channel">${escapeHtml(track.matchedChannelTitle ?? "")}</div><div class="video-meta"><a href="${escapeHtml(getVideoWatchUrl(videoId))}" target="_blank" rel="noreferrer">${escapeHtml(getVideoWatchUrl(videoId))}</a></div></div>`;
}

function renderManualForm(track: DashboardAttentionTrack, label: string, open: boolean, buttonLabel: string) {
  return `<details ${open ? "open" : ""}><summary>${escapeHtml(label)}</summary><div class="log"><form class="manual-form" method="post" action="/admin/tracks/${encodeURIComponent(track.spotifyTrackId)}/review/manual"><div class="manual-row"><input name="videoInput" value="${escapeHtml(track.manualVideoId ?? "")}" placeholder="YouTube URL or video ID" /><button type="submit" class="secondary" data-loading-label="Saving...">${escapeHtml(buttonLabel)}</button></div></form></div></details>`;
}

function formatTrackArtists(track: DashboardAttentionTrack) {
  return `${track.artistNames.join(", ")}${track.albumName ? ` / ${track.albumName}` : ""}`;
}

function formatRunStatus(status: string) {
  return ({queued:"Queued",running:"Running",waiting_for_youtube_quota:"Waiting for YouTube quota",waiting_for_spotify_retry:"Waiting for Spotify retry",needs_reauth:"Needs reauth",partially_completed:"Partially completed",completed:"Completed",success:"Completed",failed:"Failed",quota_exhausted:"Waiting for YouTube quota"} as Record<string,string>)[status] ?? status;
}

function formatTrackStatus(status: string) {
  return ({pending:"Pending",matched_auto:"Matched automatically",matched_manual:"Matched manually",review_required:"Review required",no_match:"No match",failed:"Failed",discovered:"Discovered",searching:"Searching",matched:"Matched",ready_to_insert:"Ready to insert",inserting:"Inserting",inserted:"Inserted",skipped_existing:"Already in playlist",waiting_for_youtube_quota:"Waiting for YouTube quota",waiting_for_spotify_retry:"Waiting for Spotify retry",needs_reauth:"Needs reauth"} as Record<string,string>)[status] ?? status;
}

function statusClass(status: string) {
  return status === "failed" || status === "needs_reauth" ? "status error" : status === "waiting_for_youtube_quota" || status === "waiting_for_spotify_retry" || status === "review_required" || status === "no_match" || status === "quota_exhausted" ? "status warn" : "status";
}

function getVideoWatchUrl(videoId: string) {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

function getThumbnailUrl(videoId: string) {
  return `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
}

function formatDate(timestamp: number | null | undefined) {
  if (!timestamp) return "-";
  return new Date(timestamp).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" });
}

function safeParseJson(raw: unknown) {
  if (!raw) return null;
  if (typeof raw !== "string") return raw;
  try { return JSON.parse(raw) as unknown; } catch { return raw; }
}

function formatStatsPreview(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return previewText(typeof value === "string" ? value : "-");
  const stats = value as Partial<SyncStats>;
  const items = [`Inserted ${formatStat(stats.insertedTracks)}`, `Skipped ${formatStat(stats.skippedAlreadyInPlaylist)}`, `Review ${formatStat(stats.reviewRequiredCount)}`, `Failed ${formatStat(stats.failedCount)}`];
  if (stats.quotaAbort === true) items.push("quota wait");
  return items.join(" · ");
}

function formatStructuredLog(value: unknown) {
  if (value == null) return "-";
  if (typeof value === "string") return escapeHtml(value);
  try { return escapeHtml(JSON.stringify(value, null, 2)); } catch { return escapeHtml(String(value)); }
}

function previewText(value: string | null | undefined, maxLength = 140) {
  if (!value) return "-";
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function formatStat(value: number | undefined) {
  return typeof value === "number" ? String(value) : "-";
}

function formatStatsDisplay(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return previewText(typeof value === "string" ? value : "-");
  const stats = value as Partial<SyncStats>;
  const items = [
    `Inserted ${formatStat(stats.insertedTracks)}`,
    `Skipped ${formatStat(stats.skippedAlreadyInPlaylist)}`,
    `Review ${formatStat(stats.reviewRequiredCount)}`,
    `Failed ${formatStat(stats.failedCount)}`,
  ];
  if (stats.quotaAbort === true) items.push("quota wait");
  return items.join(" | ");
}

function clientScript() {
  return `
    const liveRoot=document.getElementById("live-sync-root"), recentRunsRoot=document.getElementById("recent-runs-root"), stateNode=document.getElementById("dashboard-live-data");
    let liveData=stateNode?JSON.parse(stateNode.textContent||"{}"):{}; const trackState={page:1,pageSize:50,filter:"all",runId:null};
    const esc=(v)=>String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
    const fmtDate=(v)=>!v?"-":new Date(v).toLocaleString("ko-KR",{dateStyle:"medium",timeStyle:"short"});
    const preview=(v,m=140)=>!v?"-":String(v).length>m?String(v).slice(0,m)+"...":String(v);
    const safeParse=(v)=>{if(!v)return null;if(typeof v!=="string")return v;try{return JSON.parse(v)}catch{return v}};
    const fmtLog=(v)=>{if(v==null)return "-";if(typeof v==="string")return esc(v);try{return esc(JSON.stringify(v,null,2))}catch{return esc(String(v))}};
    const runStatus=(s)=>({queued:"Queued",running:"Running",waiting_for_youtube_quota:"Waiting for YouTube quota",waiting_for_spotify_retry:"Waiting for Spotify retry",needs_reauth:"Needs reauth",partially_completed:"Partially completed",completed:"Completed",success:"Completed",failed:"Failed",quota_exhausted:"Waiting for YouTube quota"}[s]||s);
    const trackStatus=(s)=>({pending:"Pending",matched_auto:"Matched automatically",matched_manual:"Matched manually",review_required:"Review required",no_match:"No match",failed:"Failed",discovered:"Discovered",searching:"Searching",matched:"Matched",ready_to_insert:"Ready to insert",inserting:"Inserting",inserted:"Inserted",skipped_existing:"Already in playlist",waiting_for_youtube_quota:"Waiting for YouTube quota",waiting_for_spotify_retry:"Waiting for Spotify retry",needs_reauth:"Needs reauth"}[s]||s);
    const cls=(s)=>["failed","needs_reauth"].includes(s)?"status error":["waiting_for_youtube_quota","waiting_for_spotify_retry","review_required","no_match","quota_exhausted"].includes(s)?"status warn":"status";
    const statPreview=(v)=>{if(!v||typeof v!=="object"||Array.isArray(v))return preview(typeof v==="string"?v:"-"); return ["Inserted "+(v.insertedTracks??"-"),"Skipped "+(v.skippedAlreadyInPlaylist??"-"),"Review "+(v.reviewRequiredCount??"-"),"Failed "+(v.failedCount??"-")].concat(v.quotaAbort===true?["quota wait"]:[]).join(" · ")};
    const safeStatPreview=(v)=>{if(!v||typeof v!=="object"||Array.isArray(v))return preview(typeof v==="string"?v:"-"); return ["Inserted "+(v.insertedTracks??"-"),"Skipped "+(v.skippedAlreadyInPlaylist??"-"),"Review "+(v.reviewRequiredCount??"-"),"Failed "+(v.failedCount??"-")].concat(v.quotaAbort===true?["quota wait"]:[]).join(" | ")};
    const runCard=(run)=>{const stats=safeParse(run.statsJson); return '<article class="run-card"><div class="head"><div><div class="chips"><span class="'+cls(run.status)+'">'+esc(runStatus(run.status))+'</span><span class="tag">'+esc(run.trigger)+'</span></div></div><div><small class="muted">Started</small><div class="text">'+esc(fmtDate(run.startedAt))+'</div></div></div><div class="meta"><div><small class="muted">Finished</small><div class="text">'+esc(run.finishedAt?fmtDate(run.finishedAt):"Still active")+'</div></div><div><small class="muted">Stats</small><div class="text">'+esc(safeStatPreview(stats))+'</div></div><div><small class="muted">Error</small><div class="text">'+esc(preview(run.errorSummary))+'</div></div></div><div>'+(run.statsJson?'<details><summary>View stats</summary><div class="log">'+fmtLog(stats??run.statsJson??"-")+'</div></details>':'')+(run.errorSummary?'<details><summary>View error</summary><div class="log">'+fmtLog(run.errorSummary)+'</div></details>':'')+'</div></article>'};
    const trackRow=(track,currentId)=>'<article class="track-row '+(currentId&&track.spotifyTrackId===currentId?'current-row':'')+'"><div class="head"><div><div class="text"><strong>'+esc(track.trackName)+'</strong></div><div class="text muted">'+esc((track.artistNames||[]).join(", "))+'</div></div><span class="'+cls(track.status)+'">'+esc(trackStatus(track.status))+'</span></div><div class="chips">'+(track.statusMessage?'<span class="tag">'+esc(track.statusMessage)+'</span>':'')+(track.matchedVideoTitle?'<span class="tag">YT: '+esc(track.matchedVideoTitle)+'</span>':'')+(track.playlistItemId?'<span class="tag">Inserted</span>':'')+'</div>'+(track.lastError?'<details><summary>Track error</summary><div class="log">'+esc(track.lastError)+'</div></details>':'')+'</article>';
    const eventRow=(event)=>'<article class="event-row"><div class="head"><div><div class="text"><strong>'+esc(event.message)+'</strong></div><div class="text muted">'+esc(event.stage)+'</div></div><span class="'+cls(event.level==="error"?"failed":event.level==="warn"?"waiting_for_youtube_quota":"running")+'">'+esc(String(event.level).toUpperCase())+'</span></div><div class="chips"><span class="tag">'+esc(fmtDate(event.createdAt))+'</span>'+(event.spotifyTrackId?'<span class="tag">'+esc(event.spotifyTrackId)+'</span>':'')+'</div>'+(event.payloadJson?'<details><summary>Payload</summary><div class="log">'+fmtLog(event.payloadJson)+'</div></details>':'')+'</article>';
    function renderLive(data){ if(!liveRoot) return; const run=data.activeRun; if(!run){ liveRoot.innerHTML='<div class="empty">No active or waiting sync run. Start a manual sync or wait for the next scheduled resume.</div>'; return; } const total=Number(run.totalTracks||0), completed=Number(run.completedTracks||0), remaining=Number(run.remainingTracks||Math.max(0,total-completed)), pct=total>0?Math.max(0,Math.min(100,Math.round(completed/total*100))):0; const currentId=run.currentSpotifyTrackId||null; const tracks=(data.activeRunTracks||[]).map((t)=>trackRow(t,currentId)).join("")||'<div class="empty">No active track rows are available yet.</div>'; const events=(data.activeRunEvents||[]).map(eventRow).join("")||'<div class="empty">No recent timeline entries yet.</div>'; liveRoot.innerHTML='<div class="stack"><div class="head"><div><div class="chips"><span class="'+cls(run.status)+'">'+esc(runStatus(run.status))+'</span><span class="tag">'+esc(run.phase||"running")+'</span>'+(run.pauseReason?'<span class="tag">'+esc(run.pauseReason)+'</span>':'')+'</div><h2 style="margin:10px 0 0;">Live Sync Run</h2></div><div class="note">Updated '+esc(fmtDate(data.activeRunUpdatedAt||run.updatedAt||run.lastHeartbeatAt||run.startedAt))+'</div></div><div class="summary-grid"><div><small class="muted">Status</small><div class="text">'+esc(run.statusMessage||runStatus(run.status))+'</div></div><div><small class="muted">Progress</small><div class="text">'+esc(completed+" / "+total+" complete")+'</div></div><div><small class="muted">Remaining</small><div class="text">'+esc(String(remaining))+'</div></div><div><small class="muted">Current track</small><div class="current">'+esc(run.currentTrackName||"-")+'</div></div><div><small class="muted">Next retry</small><div class="text">'+esc(fmtDate(run.nextRetryAt))+'</div></div><div><small class="muted">Last error</small><div class="text">'+esc(preview(run.lastErrorSummary||run.errorSummary||"-",200))+'</div></div></div><div class="progress"><div class="note">Overall progress</div><div class="bar"><span style="width:'+pct+'%"></span></div><div class="text">'+esc(String(pct)+"%")+'</div></div><div class="live-board"><section><div class="sticky"><h3 style="margin:0 0 8px;">Spotify track flow</h3><div class="controls"><select id="track-filter"><option value="all">All tracks</option><option value="active">Only active states</option><option value="waiting_for_youtube_quota">Waiting for YouTube quota</option><option value="waiting_for_spotify_retry">Waiting for Spotify retry</option><option value="review_required">Review required</option><option value="failed">Failed</option></select><button type="button" class="secondary" id="track-refresh">Refresh tracks</button></div><div class="note" id="track-page-note"></div></div><div class="scroll"><div class="track-list" id="track-list-items">'+tracks+'</div></div><div class="controls" style="margin-top:10px;"><button type="button" class="secondary" id="track-prev">Previous</button><button type="button" class="secondary" id="track-next">Next</button></div></section><section><div class="sticky"><h3 style="margin:0;">Recent timeline</h3><div class="note">Payload blocks wrap and scroll internally so long JSON and errors never stretch the page.</div></div><div class="scroll"><div class="event-list">'+events+'</div></div></section></div></div>'; trackState.runId=run.id; attachTrackControls(total); }
    async function loadTrackPage(){ if(!trackState.runId) return 0; const res=await fetch('/api/sync-runs/'+encodeURIComponent(String(trackState.runId))+'/tracks?page='+encodeURIComponent(String(trackState.page))+'&pageSize='+encodeURIComponent(String(trackState.pageSize))+'&filter='+encodeURIComponent(trackState.filter),{headers:{accept:"application/json"}}); if(!res.ok) return 0; const payload=await res.json(), items=Array.isArray(payload.items)?payload.items:[], root=document.getElementById("track-list-items"), note=document.getElementById("track-page-note"); if(root){ root.innerHTML=items.length===0?'<div class="empty">No tracks match this filter.</div>':items.map((t)=>trackRow(t,payload.run?.currentSpotifyTrackId||liveData.activeRun?.currentSpotifyTrackId||null)).join(""); } if(note){ const start=items.length===0?0:(trackState.page-1)*trackState.pageSize+1, end=(trackState.page-1)*trackState.pageSize+items.length; note.textContent=items.length===0?"No tracks on this page":"Showing "+start+" - "+end+" of "+payload.total; } return items.length; }
    function attachTrackControls(total){ const filter=document.getElementById("track-filter"), prev=document.getElementById("track-prev"), next=document.getElementById("track-next"), refresh=document.getElementById("track-refresh"), note=document.getElementById("track-page-note"); if(filter instanceof HTMLSelectElement){ filter.value=trackState.filter; filter.onchange=async()=>{ trackState.filter=filter.value; trackState.page=1; await loadTrackPage(); }; } if(prev instanceof HTMLButtonElement){ prev.onclick=async()=>{ if(trackState.page<=1) return; trackState.page-=1; await loadTrackPage(); }; } if(next instanceof HTMLButtonElement){ next.onclick=async()=>{ trackState.page+=1; const count=await loadTrackPage(); if(count===0) trackState.page=Math.max(1,trackState.page-1); }; } if(refresh instanceof HTMLButtonElement){ refresh.onclick=async()=>{ await loadTrackPage(); }; } if(note && Array.isArray(liveData.activeRunTracks)){ note.textContent=liveData.activeRunTracks.length===0?"Tracks will appear here as the run progresses.":"Showing 1 - "+liveData.activeRunTracks.length+" of "+total; } }
    async function refreshLive(){ const res=await fetch("/api/dashboard/live",{headers:{accept:"application/json"}}); if(!res.ok) return; liveData=await res.json(); if(recentRunsRoot){ recentRunsRoot.innerHTML=Array.isArray(liveData.recentRuns)&&liveData.recentRuns.length>0?liveData.recentRuns.map(runCard).join(""):'<p class="muted">No sync runs yet.</p>'; } renderLive(liveData); }
    function loop(){ const delay=liveData&&liveData.activeRun?5000:20000; setTimeout(async()=>{ await refreshLive(); loop(); },delay); }
    document.addEventListener("submit",(event)=>{ const form=event.target; if(!(form instanceof HTMLFormElement)) return; const confirmMessage=form.dataset.confirmMessage; if(confirmMessage && !window.confirm(confirmMessage)){ event.preventDefault(); return; } const promptText=form.dataset.promptText; if(promptText){ const answer=window.prompt(promptText,""); if(answer===null){ event.preventDefault(); return; } const input=form.querySelector('input[name="confirmationText"]'); if(input instanceof HTMLInputElement) input.value=answer; } const submitter=event.submitter instanceof HTMLButtonElement?event.submitter:form.querySelector('button[type="submit"]'); form.querySelectorAll("button").forEach((button)=>{button.disabled=true}); if(submitter instanceof HTMLButtonElement){ submitter.textContent=submitter.dataset.loadingLabel||"Working..."; } });
    renderLive(liveData); if(recentRunsRoot){ recentRunsRoot.innerHTML=Array.isArray(liveData.recentRuns)&&liveData.recentRuns.length>0?liveData.recentRuns.map(runCard).join(""):'<p class="muted">No sync runs yet.</p>'; } loop();
  `;
}
