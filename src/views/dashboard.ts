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
<html lang="en">
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
        <small class="muted">Spotify liked songs -> YouTube share playlist</small>
        <h1 style="margin:0;">Spotify Likes Sync Dashboard</h1>
        <p style="margin:0;max-width:680px;" class="muted">
          Connect both accounts, keep one YouTube playlist updated every hour, and manually fix the few tracks that need help.
        </p>
      </section>
      ${input.message ? `<div class="message">${escapeHtml(input.message)}</div>` : ""}
      <section class="grid">
        <article class="panel">
          <h2 style="margin-top:0;">Connections</h2>
          <p>
            <span class="status ${spotifyAccount && !spotifyAccount.invalidatedAt ? "" : "warn"}">
              Spotify ${spotifyAccount && !spotifyAccount.invalidatedAt ? "Connected" : "Needs setup"}
            </span>
          </p>
          <p class="muted">${escapeHtml(spotifyAccount?.externalDisplayName ?? "Not connected")}</p>
          ${spotifyAccount?.lastRefreshError ? `<p class="muted">Last error: ${escapeHtml(spotifyAccount.lastRefreshError)}</p>` : ""}
          <div class="actions">
            <a href="/auth/spotify/start"><button type="button">Connect Spotify</button></a>
          </div>
        </article>
        <article class="panel">
          <h2 style="margin-top:0;">YouTube</h2>
          <p>
            <span class="status ${youtubeAccount && !youtubeAccount.invalidatedAt ? "" : "warn"}">
              YouTube ${youtubeAccount && !youtubeAccount.invalidatedAt ? "Connected" : "Needs setup"}
            </span>
          </p>
          <p class="muted">${escapeHtml(youtubeAccount?.externalDisplayName ?? "Not connected")}</p>
          ${youtubeAccount?.lastRefreshError ? `<p class="muted">Last error: ${escapeHtml(youtubeAccount.lastRefreshError)}</p>` : ""}
          <div class="actions">
            <a href="/auth/youtube/start"><button type="button">Connect YouTube</button></a>
          </div>
        </article>
        <article class="panel">
          <h2 style="margin-top:0;">Playlist</h2>
          <p class="muted">Managed playlist ID</p>
          <p style="font-weight:700;">${input.summary.playlistId ? escapeHtml(input.summary.playlistId) : "Will be created on first sync"}</p>
          ${
            input.summary.playlistId
              ? `<p><a href="https://www.youtube.com/playlist?list=${escapeHtml(input.summary.playlistId)}" target="_blank" rel="noreferrer">Open playlist</a></p>`
              : ""
          }
          <form method="post" action="/admin/sync">
            <button type="submit">Run Sync Now</button>
          </form>
        </article>
      </section>
      <section class="panel" style="margin-top:16px;">
        <h2 style="margin-top:0;">Recent Sync Runs</h2>
        <table>
          <thead>
            <tr><th>Status</th><th>Trigger</th><th>Started</th><th>Stats</th><th>Error</th></tr>
          </thead>
          <tbody>
            ${
              input.summary.recentRuns.length === 0
                ? `<tr><td colspan="5">No sync runs yet.</td></tr>`
                : input.summary.recentRuns
                    .map(
                      (run) => `<tr>
                        <td>${escapeHtml(run.status)}</td>
                        <td>${escapeHtml(run.trigger)}</td>
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
        <h2 style="margin-top:0;">Tracks Needing Attention</h2>
        <table>
          <thead>
            <tr><th>Track</th><th>Status</th><th>Last Error</th><th>Manual Override</th></tr>
          </thead>
          <tbody>
            ${
              input.summary.attentionTracks.length === 0
                ? `<tr><td colspan="4">No tracks need manual help right now.</td></tr>`
                : input.summary.attentionTracks
                    .map(
                      (track) => `<tr>
                        <td>
                          <strong>${escapeHtml(track.trackName)}</strong><br />
                          <small>${escapeHtml(track.artistNames.join(", "))}${track.albumName ? ` · ${escapeHtml(track.albumName)}` : ""}</small>
                        </td>
                        <td>${escapeHtml(track.searchStatus)}</td>
                        <td><small>${escapeHtml(track.lastError ?? "-")}</small></td>
                        <td>
                          <form method="post" action="/admin/tracks/${encodeURIComponent(track.spotifyTrackId)}/override">
                            <input name="videoInput" value="${escapeHtml(track.manualVideoId ?? track.matchedVideoId ?? "")}" placeholder="YouTube URL or video ID" />
                            <button type="submit" class="secondary">Save Override</button>
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

  return new Date(timestamp).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
