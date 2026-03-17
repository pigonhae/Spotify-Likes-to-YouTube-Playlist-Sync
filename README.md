# Spotify Likes -> YouTube Playlist Sync

Sync Spotify liked songs into a managed YouTube playlist with persistent PostgreSQL-backed state, resumable jobs, manual review for ambiguous matches, and Railway-friendly web/worker deployment.

## What This Service Does

- Connects one Spotify account and one YouTube account
- Scans Spotify liked songs
- Matches tracks to YouTube videos
- Inserts matched videos into one managed YouTube playlist
- Stores progress, mappings, retries, quota pauses, and review-needed tracks in PostgreSQL
- Lets you review low-confidence matches or override them manually from the dashboard

## Current Architecture

- `web`
  - Fastify HTTP server
  - SSR dashboard in `src/views/dashboard.ts`
  - OAuth callbacks, manual actions, live dashboard API, `/health`
- `worker`
  - Railway scheduler loop
  - Resumes quota-paused / retry-paused runs
  - Starts scheduled sync work
  - Exposes its own `/health` endpoint for Railway health checks
- `PostgreSQL`
  - OAuth accounts
  - managed playlist ownership
  - track mappings and review candidates
  - sync runs, run tracks, run events, sync state, and lock state

## UX / Behavior Notes

- The dashboard supports Korean and English. The selected language is stored in a cookie.
- Live progress updates use polling, not SSE/websockets. This keeps the implementation simple and stable on Railway.
- `Run sync now` is idempotent from a UX perspective:
  - if a run is already active, the UI focuses on the existing run
  - if a paused run is resumable, the service resumes it
  - progress shows both library-wide status and the actual scope of work for the current run
- The sync logic works from the managed YouTube playlist ID, not the playlist title or privacy setting.
- If the user renames the playlist or changes privacy between `public`, `unlisted`, and `private`, the service should still work as long as the authenticated YouTube account can still access that playlist ID.
- Spotify liked songs are processed oldest-first during insertion so the YouTube playlist order more closely matches original Spotify like order.

## Environment Variables

Required:

- `DATABASE_URL`
- `TOKEN_ENCRYPTION_KEY`
- `APP_BASIC_AUTH_USER`
- `APP_BASIC_AUTH_PASS`
- `SPOTIFY_CLIENT_ID`
- `SPOTIFY_CLIENT_SECRET`
- `SPOTIFY_REDIRECT_URI`
- `YOUTUBE_CLIENT_ID`
- `YOUTUBE_CLIENT_SECRET`
- `YOUTUBE_REDIRECT_URI`
- `APP_BASE_URL`

Common optional values:

- `HOST`
  - defaults to `0.0.0.0` in production
- `PORT`
  - Railway should provide this automatically
- `DATABASE_SSL`
  - usually `true` on Railway Postgres
- `DATABASE_POOL_MAX`
  - defaults to `5`
- `OWNER_USER_KEY`
  - defaults to a single owner row
- `SCHEDULER_POLL_INTERVAL_MS`
  - defaults to `60000`
- `YOUTUBE_DAILY_QUOTA_LIMIT`
  - defaults to the standard daily quota
- `YOUTUBE_PLAYLIST_ID`
  - optional fixed managed playlist ID

## Local Development

```bash
npm install
npm run db:migrate
npm run dev
```

Open `http://127.0.0.1:3000` and log in with basic auth.

## Railway Deployment

Use two Railway services from the same repo.

### Web service

- Start command: `npm run start:web`
- Must expose HTTP and bind `PORT`
- Health check path: `/health`

### Worker service

- Start command: `npm run start:worker`
- Runs the scheduler loop
- Also exposes HTTP for Railway health checks
- Health check path: `/health`

### Why health checks were failing before

The worker process was not acting like an HTTP service, while Railway health checks were still targeting `/health`. That means Railway could mark the service unhealthy even though the scheduler code itself was valid. The worker now boots a minimal Fastify host first, exposes `/health`, and only then starts the long-running scheduler loop asynchronously.

### Recommended Railway variables

```env
NODE_ENV=production
HOST=0.0.0.0
PORT=8080
DATABASE_SSL=true
DATABASE_POOL_MAX=5
OWNER_USER_KEY=default-owner
SCHEDULER_POLL_INTERVAL_MS=60000
```

`railway.toml` contains shared build and health-check defaults. Role separation is handled by Railway service start commands.

## Playlist Metadata Safety

The sync engine uses playlist ID as the durable key.

- Safe:
  - rename the playlist
  - change privacy between `public`, `unlisted`, and `private`
- Not safe:
  - deleting the playlist
  - removing access for the connected YouTube account

If access is lost, the service now surfaces that as a playlist access problem instead of implying that the title/privacy change itself broke sync.

## Live Progress Model

The dashboard now separates:

- `librarySummary`
  - cumulative state across the managed library
- `runSummary`
  - actual work scope for the active run

That prevents the UX problem where pressing `Run sync now` looked like a full reset back to `0%` even when most tracks were already synced or already present in the playlist.

## Important Scripts

```bash
npm run check
npm test
npm run build
npm run start:web
npm run start:worker
```

## Test Coverage Added For This Stabilization Work

- dashboard rendering in both old and new layout paths
- live dashboard API shape
- language preference persistence
- manual review flows
- sync duplicate prevention
- resumable/manual sync conflict behavior
- oldest-first insertion ordering
- worker `/health` endpoint behavior

## Operational Notes

- Sync state survives Railway restarts because state lives in PostgreSQL.
- Quota waits and Spotify retry waits resume from persisted run state.
- Manual mappings and review-required tracks are preserved across restarts.
- The system avoids duplicate inserts by checking cached mappings and playlist contents.
