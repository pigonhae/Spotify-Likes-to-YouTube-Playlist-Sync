# Spotify Likes -> YouTube Playlist Sync

[![Deploy on Railway](https://railway.app/button.svg)](YOUR_RAILWAY_TEMPLATE_OR_PROJECT_LINK)
[![Node.js](https://img.shields.io/badge/node-22%2B-339933?logo=nodedotjs&logoColor=white)](#prerequisites)

Sync a single Spotify account's liked songs into one managed YouTube playlist, with PostgreSQL-backed state, manual review for ambiguous matches, resumable sync runs, and a Railway-friendly web/worker deployment model.

하나의 Spotify 계정의 좋아요 곡을 하나의 관리형 YouTube 재생목록으로 동기화하는 서비스입니다. PostgreSQL 기반 영구 상태 저장, 애매한 매칭에 대한 수동 검토, 재개 가능한 동기화 실행, Railway에 맞춘 `web` / `worker` 배포 구조를 포함합니다.

## Short Description

This repository is a single-owner admin app. You log in with HTTP Basic Auth, connect one Spotify account and one YouTube account through OAuth, run a sync, review low-confidence matches, and let a worker resume paused runs after quota or retry windows.

이 저장소는 단일 관리자용 앱입니다. HTTP Basic Auth로 로그인한 뒤 Spotify 계정과 YouTube 계정을 OAuth로 연결하고, 동기화를 실행하고, 저유사도 매칭을 검토하고, quota 또는 재시도 대기 상태가 되면 worker가 중단된 실행을 다시 이어서 처리합니다.

## Overview

The current codebase syncs Spotify **liked songs only**. It does not sync arbitrary Spotify playlists. The app is designed around a single persistent owner row in PostgreSQL, a server-rendered Fastify dashboard, and a separate worker process that handles scheduled runs and run resumption.

현재 코드베이스는 Spotify의 **좋아요 곡만** 동기화합니다. 임의의 Spotify 재생목록은 동기화하지 않습니다. 앱은 PostgreSQL에 저장되는 단일 owner 사용자, Fastify 기반 서버 렌더링 대시보드, 그리고 예약 실행 및 paused run 재개를 담당하는 별도 worker 프로세스를 중심으로 구성되어 있습니다.

## Documented Feature Scope

The list below reflects features confirmed in the current source code and tests.

아래 목록은 현재 소스 코드와 테스트에서 확인된 기능만 정리한 것입니다.

- Connect one Spotify account via OAuth with the `user-library-read` scope.
- Connect one Google/YouTube account via OAuth with the `youtube.force-ssl` scope.
- Protect the dashboard and admin actions with HTTP Basic Auth.
- Scan Spotify liked songs page by page and store a persistent local snapshot in PostgreSQL.
- Reuse previous matches and manual mappings across restarts and future sync runs.
- Search YouTube candidates, score them, auto-accept high-confidence matches, and send low-confidence matches to a review queue.
- Accept a recommended match or enter a manual YouTube URL/video ID before insertion.
- Validate manual YouTube selections before saving them.
- Insert videos into one managed YouTube playlist and skip duplicates already present in that playlist.
- Auto-create the managed YouTube playlist if `YOUTUBE_PLAYLIST_ID` is not configured.
- Persist sync runs, per-track run status, run events, run progress, retry timestamps, and quota state.
- Pause runs for YouTube quota exhaustion, Spotify retryable failures, or OAuth reauthentication needs.
- Resume paused runs from the worker on startup and during scheduled polling.
- Run scheduled sync attempts from the worker once per hourly slot.
- Show live progress in the dashboard through polling APIs.
- Disconnect Spotify, disconnect YouTube, or fully reset project state from the dashboard.
- Support both English and Korean in the dashboard UI.

- Spotify OAuth를 `user-library-read` scope로 연결할 수 있습니다.
- Google/YouTube OAuth를 `youtube.force-ssl` scope로 연결할 수 있습니다.
- 대시보드와 관리자 동작은 HTTP Basic Auth로 보호됩니다.
- Spotify 좋아요 곡을 페이지 단위로 읽고 PostgreSQL에 영구 스냅샷을 저장합니다.
- 이전 매칭 결과와 수동 매핑을 재시작 이후나 다음 동기화에서도 재사용합니다.
- YouTube 후보를 검색하고 점수를 계산하여, 고신뢰 후보는 자동 확정하고 저신뢰 후보는 검토 큐로 보냅니다.
- 추천 후보를 승인하거나, 삽입 전에 YouTube URL/영상 ID를 수동 입력할 수 있습니다.
- 수동으로 입력한 YouTube 영상은 저장 전에 유효성 검사를 수행합니다.
- 하나의 관리형 YouTube 재생목록에 영상을 삽입하고, 이미 있는 영상은 중복 삽입하지 않습니다.
- `YOUTUBE_PLAYLIST_ID`가 없으면 관리형 YouTube 재생목록을 자동 생성할 수 있습니다.
- 동기화 실행, 실행별 트랙 상태, 이벤트 로그, 진행률, 재시도 시각, quota 상태를 모두 영구 저장합니다.
- YouTube quota 소진, Spotify 재시도 가능 오류, OAuth 재인증 필요 시 실행을 일시 중지합니다.
- worker가 시작될 때와 주기적으로 paused run을 다시 이어서 실행합니다.
- worker가 시간 단위 슬롯마다 예약 동기화를 시도합니다.
- 대시보드가 polling API를 통해 실시간 진행상황을 표시합니다.
- 대시보드에서 Spotify 연결 해제, YouTube 연결 해제, 전체 초기화를 수행할 수 있습니다.
- 대시보드는 영어와 한국어를 모두 지원합니다.

## Demo / Screenshots

<img width="1849" height="951" alt="image" src="https://github.com/user-attachments/assets/31a07bce-ea88-4063-b724-9fdb38ff8fb7" />


## Tech Stack

- Runtime: Node.js 22+
- Language: TypeScript
- Web framework: Fastify
- Auth: HTTP Basic Auth + Spotify OAuth + Google OAuth
- Database: PostgreSQL
- ORM / migrations: Drizzle ORM + SQL migrations in `drizzle/`
- Search sources: `@distube/ytsr` and YouTube Data API
- Testing: Vitest
- Deployment: Dockerfile-based Railway deployment

- 런타임: Node.js 22+
- 언어: TypeScript
- 웹 프레임워크: Fastify
- 인증: HTTP Basic Auth + Spotify OAuth + Google OAuth
- 데이터베이스: PostgreSQL
- ORM / 마이그레이션: Drizzle ORM + `drizzle/` SQL 마이그레이션
- 검색 소스: `@distube/ytsr`와 YouTube Data API
- 테스트: Vitest
- 배포: Dockerfile 기반 Railway 배포



## Architecture Overview

`web`

- Serves the dashboard, OAuth start/callback routes, manual review actions, reset/disconnect actions, and `/health`.

`worker`

- Starts an HTTP health host, polls on an interval, resumes paused runs first, and starts scheduled sync runs when the hourly slot has not been used yet.

`postgres`

- Stores OAuth tokens, OAuth states, playlist ownership, track mappings, review candidates, quota usage, sync runs, per-track sync state, run events, and lock state.

`web`

- 대시보드, OAuth 시작/콜백 라우트, 수동 검토 액션, reset/disconnect 액션, `/health`를 제공합니다.

`worker`

- HTTP health host를 먼저 띄우고, 주기적으로 폴링하며, 먼저 paused run을 재개한 뒤 아직 사용되지 않은 시간 슬롯이면 예약 동기화를 시작합니다.

`postgres`

- OAuth 토큰, OAuth state, 재생목록 소유 정보, 트랙 매핑, 검토 후보, quota 사용량, sync run, 트랙별 run 상태, 이벤트 로그, lock 상태를 저장합니다.

## How It Works

1. The web app creates one persistent owner user row using `OWNER_USER_KEY`.
2. You authenticate to the dashboard with `APP_BASIC_AUTH_USER` / `APP_BASIC_AUTH_PASS`.
3. You connect Spotify and YouTube through OAuth.
4. A sync run scans Spotify liked songs and snapshots the current YouTube playlist.
5. Existing manual mappings and cached matches are reused when possible.
6. New tracks are matched to YouTube candidates.
7. High-confidence matches are inserted automatically.
8. Low-confidence matches are marked `review_required`.
9. Quota waits and retry waits are persisted, then resumed by the worker later.

1. 웹 앱은 `OWNER_USER_KEY`를 사용해 하나의 영구 owner 사용자 row를 만듭니다.
2. `APP_BASIC_AUTH_USER` / `APP_BASIC_AUTH_PASS`로 대시보드에 로그인합니다.
3. Spotify와 YouTube를 OAuth로 연결합니다.
4. 동기화 실행은 Spotify 좋아요 곡을 스캔하고 현재 YouTube 재생목록 상태를 스냅샷으로 읽습니다.
5. 기존 수동 매핑과 캐시된 매칭 결과가 있으면 재사용합니다.
6. 새 트랙은 YouTube 후보와 매칭됩니다.
7. 신뢰도가 높은 매칭은 자동으로 삽입됩니다.
8. 신뢰도가 낮은 매칭은 `review_required` 상태가 됩니다.
9. quota 대기와 재시도 대기는 DB에 저장되고, 이후 worker가 다시 이어서 실행합니다.

## Sync Flow

1. Acquire the `hourly-sync` lock.
2. Resume an existing paused/stale run if one is due; otherwise create a new run.
3. Read Spotify liked songs in pages of up to `SPOTIFY_PAGE_SIZE` and persist them.
4. Mark Spotify tracks that disappeared from the library as removed in local state.
5. Resolve the target YouTube playlist ID.
6. Load the current YouTube playlist snapshot and mark already-present videos as `skipped_existing`.
7. For each remaining track, process in oldest-liked-first order.
8. Use an existing manual match if present.
9. Otherwise reuse a cached automatic match if present.
10. Otherwise search YouTube, validate top candidates, and classify the result as auto-match, review-required, or no-match.
11. Insert matched videos into the playlist.
12. Persist final stats and release the lock.

1. `hourly-sync` lock을 획득합니다.
2. 재개 가능한 paused/stale run이 있으면 먼저 이어서 실행하고, 없으면 새 run을 만듭니다.
3. `SPOTIFY_PAGE_SIZE` 크기만큼 Spotify 좋아요 곡을 페이지 단위로 읽어 저장합니다.
4. Spotify 라이브러리에서 사라진 트랙은 로컬 상태에서 removed로 표시합니다.
5. 대상 YouTube 재생목록 ID를 결정합니다.
6. 현재 YouTube 재생목록 스냅샷을 읽고 이미 들어 있는 영상은 `skipped_existing`로 표시합니다.
7. 남은 트랙은 가장 오래 전에 좋아요한 곡부터 처리합니다.
8. 수동 매핑이 있으면 우선 사용합니다.
9. 없으면 기존 자동 매칭 결과를 재사용합니다.
10. 그래도 없으면 YouTube를 검색하고 상위 후보를 검증한 뒤 자동 매칭, 검토 필요, 미매칭으로 분류합니다.
11. 매칭된 영상을 재생목록에 삽입합니다.
12. 최종 통계를 저장하고 lock을 해제합니다.

## YouTube Quota / Retry / Resume Behavior

The current implementation tracks YouTube quota usage in PostgreSQL by Pacific time day (`America/Los_Angeles`), not by your local server timezone.

현재 구현은 서버 로컬 시간이 아니라 태평양 시간대(`America/Los_Angeles`) 날짜 기준으로 YouTube quota 사용량을 PostgreSQL에 기록합니다.

### Quota units used by the app

| Action | Quota charged by the app |
| --- | --- |
| Official YouTube search fallback | `100` |
| `videos.list` validation for candidate/manual video checks | `1` |
| Playlist snapshot refresh | `max(1, ceil(items / 50))` |
| Playlist creation | `50` |
| Playlist item insertion | `50` |

| 동작 | 앱이 차감하는 quota |
| --- | --- |
| 공식 YouTube 검색 fallback | `100` |
| 후보/수동 영상 검증용 `videos.list` | `1` |
| 재생목록 스냅샷 갱신 | `max(1, ceil(items / 50))` |
| 재생목록 생성 | `50` |
| 재생목록 아이템 삽입 | `50` |

### Behavior

- If the app predicts there is not enough quota left, it pauses before the next expensive action.
- If the YouTube API itself returns a quota-style error, the run is paused with status `waiting_for_youtube_quota`.
- The app stores `nextRetryAt`.
- If the API provides `Retry-After`, that is used.
- Otherwise the app waits until the next Pacific-time quota day boundary.
- The worker resumes the run automatically when the stored retry time is due.

- 앱이 다음 고비용 작업에 필요한 quota가 부족하다고 판단하면, 그 작업 전에 실행을 일시 중지합니다.
- YouTube API가 직접 quota 관련 오류를 반환하면 run 상태가 `waiting_for_youtube_quota`로 전환됩니다.
- 앱은 `nextRetryAt`를 저장합니다.
- API가 `Retry-After`를 주면 그 값을 사용합니다.
- 그렇지 않으면 다음 태평양 시간 기준 quota 초기화 시점까지 대기합니다.
- worker는 저장된 재시도 시각이 도래하면 해당 run을 자동으로 재개합니다.

## Spotify Auth / Retry / Reauth Behavior

- Spotify OAuth uses the `user-library-read` scope.
- Spotify access tokens are refreshed automatically when they are near expiry.
- If refresh fails because the refresh token is missing or invalid, the account is marked invalid and the run moves to `needs_reauth`.
- Retryable Spotify API errors pause the run as `waiting_for_spotify_retry`.
- Retry timing uses the API `Retry-After` header when available.
- Otherwise the app uses an exponential-style backoff sequence of `30s`, `60s`, `120s`, `300s`, `600s`, `900s`.

- Spotify OAuth는 `user-library-read` scope를 사용합니다.
- Spotify access token은 만료 임박 시 자동 갱신됩니다.
- refresh token이 없거나 무효해서 갱신에 실패하면 계정은 invalid 상태가 되고, run은 `needs_reauth`로 전환됩니다.
- 재시도 가능한 Spotify API 오류는 run을 `waiting_for_spotify_retry` 상태로 일시 중지합니다.
- 재시도 시각은 API의 `Retry-After` 헤더가 있으면 그 값을 사용합니다.
- 그렇지 않으면 `30초`, `60초`, `120초`, `300초`, `600초`, `900초` 순서의 backoff를 사용합니다.

## Prerequisites

- Node.js `22` or newer
- An npm environment
- A PostgreSQL database
- A Spotify Developer app
- A Google Cloud project with YouTube Data API enabled
- A YouTube channel under the Google account you will connect
- A Railway account if you want hosted deployment

- Node.js `22` 이상
- npm 환경
- PostgreSQL 데이터베이스
- Spotify Developer 앱
- YouTube Data API가 활성화된 Google Cloud 프로젝트
- 연결할 Google 계정에 연결된 YouTube 채널
- 호스팅 배포를 원한다면 Railway 계정

## Environment Variables

Copy `.env.example` to `.env` first.

먼저 `.env.example`을 `.env`로 복사하세요.

```bash
cp .env.example .env
```

PowerShell:

```powershell
Copy-Item .env.example .env
```

| Variable | Required | Description |
| --- | --- | --- |
| `NODE_ENV` | No | App mode. Use `development`, `test`, or `production`. / 앱 실행 모드입니다. |
| `HOST` | No | Bind host for web/worker HTTP servers. / web·worker HTTP 서버 바인드 주소입니다. |
| `PORT` | No | HTTP port for the current process. Railway usually injects this. / 현재 프로세스의 HTTP 포트이며 Railway가 보통 자동 주입합니다. |
| `LOG_LEVEL` | No | Fastify log level. / Fastify 로그 레벨입니다. |
| `APP_BASE_URL` | Yes | Public base URL used to build OAuth callback URLs. Example: `https://your-web-app.up.railway.app`. / OAuth 콜백 URL 생성에 쓰이는 공개 기본 URL입니다. |
| `APP_BASIC_AUTH_USER` | Yes | Dashboard Basic Auth username. / 대시보드 Basic Auth 사용자명입니다. |
| `APP_BASIC_AUTH_PASS` | Yes | Dashboard Basic Auth password. / 대시보드 Basic Auth 비밀번호입니다. |
| `DATABASE_URL` | Yes | PostgreSQL connection string. / PostgreSQL 연결 문자열입니다. |
| `OWNER_USER_KEY` | Yes | Stable key for the single owner row. Keep it consistent across web and worker. / 단일 owner row를 식별하는 고정 키이며 web과 worker에서 동일해야 합니다. |
| `DATABASE_POOL_MAX` | No | PostgreSQL pool size per process. / 프로세스별 PostgreSQL 커넥션 풀 크기입니다. |
| `DATABASE_SSL` | No | Set `true` when your PostgreSQL provider requires SSL. / PostgreSQL 제공자가 SSL을 요구하면 `true`로 설정합니다. |
| `TOKEN_ENCRYPTION_KEY` | Yes | 64-character hex key used to encrypt stored OAuth tokens. / 저장된 OAuth 토큰 암호화에 사용하는 64자리 hex 키입니다. |
| `SPOTIFY_CLIENT_ID` | Yes | Spotify app client ID. / Spotify 앱 Client ID입니다. |
| `SPOTIFY_CLIENT_SECRET` | Yes | Spotify app client secret. / Spotify 앱 Client Secret입니다. |
| `GOOGLE_CLIENT_ID` | Yes | Google OAuth client ID. / Google OAuth Client ID입니다. |
| `GOOGLE_CLIENT_SECRET` | Yes | Google OAuth client secret. / Google OAuth Client Secret입니다. |
| `YOUTUBE_API_KEY` | Yes | API key used for YouTube search and video lookup endpoints. / YouTube 검색과 영상 조회 API에 사용하는 API Key입니다. |
| `YOUTUBE_PLAYLIST_ID` | No | Fixed target playlist ID. If empty, the app creates a playlist on first sync and stores its ID in the DB. / 비워 두면 첫 동기화 때 재생목록을 생성하고 DB에 ID를 저장합니다. |
| `YOUTUBE_PLAYLIST_TITLE` | No | Title used only when the app creates a new playlist. / 새 재생목록을 앱이 생성할 때만 사용하는 제목입니다. |
| `YOUTUBE_PLAYLIST_DESCRIPTION` | No | Description used only when the app creates a new playlist. / 새 재생목록 생성 시에만 사용하는 설명입니다. |
| `YOUTUBE_PLAYLIST_PRIVACY` | No | `public`, `private`, or `unlisted` for a newly created playlist. / 새로 생성할 재생목록의 공개 범위입니다. |
| `YOUTUBE_DAILY_QUOTA_LIMIT` | No | App-side daily quota limit used for pause decisions. / 앱이 quota 부족 여부를 판단할 때 사용하는 일일 한도입니다. |
| `YOUTUBE_SEARCH_PROVIDER` | No | `hybrid` or `official`. `hybrid` uses `ytsr` first; `official` always forces official API fallback too. / `hybrid`는 `ytsr` 우선, `official`은 공식 API fallback을 항상 수행합니다. |
| `SYNC_LOCK_TTL_MINUTES` | No | Lock TTL used for sync/account operations. / 동기화 및 계정 관리 작업에 사용하는 lock TTL입니다. |
| `SCHEDULER_POLL_INTERVAL_MS` | No | How often the worker wakes up to check for due work. / worker가 재개 대상 또는 예약 실행을 확인하는 주기입니다. |
| `SPOTIFY_PAGE_SIZE` | No | Spotify liked-song page size, max `50`. / Spotify 좋아요 곡 페이지 크기이며 최대 `50`입니다. |
| `YOUTUBE_FALLBACK_RESULT_LIMIT` | No | Max official API fallback candidates to fetch. / 공식 API fallback 시 가져올 최대 후보 수입니다. |
| `MATCH_THRESHOLD` | No | Score threshold for automatic acceptance. Lower scores become review candidates. / 자동 승인 점수 기준이며, 낮으면 검토 대상으로 분류됩니다. |

### Minimal local `.env` example

```env
NODE_ENV=development
HOST=0.0.0.0
PORT=3000
APP_BASE_URL=http://127.0.0.1:3000
APP_BASIC_AUTH_USER=admin
APP_BASIC_AUTH_PASS=change-me
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/spotifyplaylist
DATABASE_SSL=false
OWNER_USER_KEY=default-owner
DATABASE_POOL_MAX=5
TOKEN_ENCRYPTION_KEY=replace-with-64-char-hex-key
SPOTIFY_CLIENT_ID=replace-me
SPOTIFY_CLIENT_SECRET=replace-me
GOOGLE_CLIENT_ID=replace-me
GOOGLE_CLIENT_SECRET=replace-me
YOUTUBE_API_KEY=replace-me
YOUTUBE_PLAYLIST_ID=
YOUTUBE_PLAYLIST_TITLE=Spotify Likes Sync
YOUTUBE_PLAYLIST_DESCRIPTION=Automatically synced from Spotify liked songs.
YOUTUBE_PLAYLIST_PRIVACY=unlisted
YOUTUBE_DAILY_QUOTA_LIMIT=10000
YOUTUBE_SEARCH_PROVIDER=hybrid
SYNC_LOCK_TTL_MINUTES=55
SCHEDULER_POLL_INTERVAL_MS=60000
SPOTIFY_PAGE_SIZE=50
YOUTUBE_FALLBACK_RESULT_LIMIT=5
MATCH_THRESHOLD=65
```

위 예시는 실제 비밀값이 아닌 자리표시자 예시입니다. 민감한 값은 직접 생성해 입력해야 합니다.

## Local Development Setup

1. Install dependencies.
2. Prepare PostgreSQL and set `DATABASE_URL`.
3. Copy `.env.example` to `.env` and fill all required secrets.
4. Run database migrations.
5. Start the development server.
6. Open the app in a browser and sign in with Basic Auth.

```bash
npm install
npm run db:migrate
npm run dev
```

Visit `http://127.0.0.1:3000`.

1. 의존성을 설치합니다.
2. PostgreSQL을 준비하고 `DATABASE_URL`을 설정합니다.
3. `.env.example`을 `.env`로 복사한 뒤 필수 비밀값을 채웁니다.
4. 데이터베이스 마이그레이션을 실행합니다.
5. 개발 서버를 시작합니다.
6. 브라우저에서 앱을 열고 Basic Auth로 로그인합니다.

```bash
npm install
npm run db:migrate
npm run dev
```

접속 주소는 `http://127.0.0.1:3000`입니다.

## Database Setup

The source code uses PostgreSQL only. `data/` files in the repository are not the runtime database for the current implementation.

현재 구현은 PostgreSQL만 사용합니다. 저장소 안의 `data/` 파일은 현재 구현의 런타임 데이터베이스가 아닙니다.

### Example local PostgreSQL container

```bash
docker run --name spotifyplaylist-postgres ^
  -e POSTGRES_USER=postgres ^
  -e POSTGRES_PASSWORD=postgres ^
  -e POSTGRES_DB=spotifyplaylist ^
  -p 5432:5432 ^
  -d postgres:16
```

Windows PowerShell line continuation can use the backtick instead of `^` if you prefer.

PowerShell에서는 `^` 대신 백틱을 사용해 줄바꿈해도 됩니다.

### Apply migrations

```bash
npm run db:migrate
```

The app and worker also run migrations automatically on startup.

앱과 worker는 시작 시에도 자동으로 마이그레이션을 적용합니다.

## Spotify Developer Setup

1. Go to the Spotify Developer Dashboard.
2. Create an app.
3. Copy the app's client ID and client secret into `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET`.
4. Add the redirect URI:

```text
http://127.0.0.1:3000/auth/spotify/callback
```

5. For Railway, add your production callback too:

```text
https://your-web-app.up.railway.app/auth/spotify/callback
```

6. The app requests the `user-library-read` scope.

Common mistakes:

- `APP_BASE_URL` does not match the redirect URI registered in Spotify.
- You used the worker URL instead of the web URL.
- You changed the Railway domain but did not update Spotify redirect URIs.
- The browser reaches the callback route without Basic Auth credentials cached yet, so it prompts again. That is expected because callback routes are also Basic Auth protected.

1. Spotify Developer Dashboard로 이동합니다.
2. 앱을 생성합니다.
3. 발급된 Client ID와 Client Secret을 `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`에 넣습니다.
4. 아래 redirect URI를 등록합니다.

```text
http://127.0.0.1:3000/auth/spotify/callback
```

5. Railway 배포용 production callback도 추가합니다.

```text
https://your-web-app.up.railway.app/auth/spotify/callback
```

6. 앱은 `user-library-read` scope를 요청합니다.

자주 하는 실수:

- `APP_BASE_URL`과 Spotify에 등록한 redirect URI가 정확히 일치하지 않음
- web 서비스 URL 대신 worker URL을 넣음
- Railway 도메인이 바뀌었는데 Spotify redirect URI를 갱신하지 않음
- 콜백 라우트도 Basic Auth 보호 대상이라 브라우저가 다시 인증을 요구할 수 있음

## Google Cloud / YouTube API Setup

You need both OAuth credentials and an API key because the code uses:

- Google OAuth for account connection and playlist write access
- YouTube Data API key access for search and video lookup

코드상 다음 두 가지가 모두 필요하므로 OAuth 자격증명과 API Key를 둘 다 준비해야 합니다.

- 계정 연결 및 재생목록 쓰기 권한용 Google OAuth
- 검색 및 영상 조회용 YouTube Data API Key

### Steps

1. Create or select a Google Cloud project.
2. Enable **YouTube Data API v3**.
3. Configure the OAuth consent screen if Google requires it.
4. Create an OAuth Client ID for a web application.
5. Set these authorized redirect URIs:

```text
http://127.0.0.1:3000/auth/youtube/callback
https://your-web-app.up.railway.app/auth/youtube/callback
```

6. Put the OAuth client ID and secret into `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
7. Create an API key and put it into `YOUTUBE_API_KEY`.
8. Connect a Google account that has a usable YouTube channel.

### Scope used by the app

```text
https://www.googleapis.com/auth/youtube.force-ssl
```

### Common mistakes

- You created OAuth credentials but forgot the API key.
- The Google account has no usable YouTube channel.
- Redirect URIs do not exactly match `APP_BASE_URL`.
- The connected account cannot access the target playlist ID.
- The API key is restricted incorrectly and cannot call YouTube Data API v3.

### 설정 순서

1. Google Cloud 프로젝트를 생성하거나 선택합니다.
2. **YouTube Data API v3**를 활성화합니다.
3. 필요하면 OAuth 동의 화면을 설정합니다.
4. 웹 애플리케이션용 OAuth Client ID를 생성합니다.
5. 아래 redirect URI를 등록합니다.

```text
http://127.0.0.1:3000/auth/youtube/callback
https://your-web-app.up.railway.app/auth/youtube/callback
```

6. 생성된 OAuth Client ID/Secret을 `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`에 넣습니다.
7. API Key를 생성해 `YOUTUBE_API_KEY`에 넣습니다.
8. 실제 YouTube 채널을 사용할 수 있는 Google 계정으로 연결합니다.

### 앱이 사용하는 scope

```text
https://www.googleapis.com/auth/youtube.force-ssl
```

### 자주 하는 실수

- OAuth 자격증명만 만들고 API Key를 만들지 않음
- 연결한 Google 계정에 사용할 수 있는 YouTube 채널이 없음
- redirect URI가 `APP_BASE_URL`과 정확히 일치하지 않음
- 연결한 계정이 대상 재생목록 ID에 접근할 수 없음
- API Key 제한을 잘못 걸어 YouTube Data API v3 호출이 막힘

> **Recommended deployment target:** Railway  
> This project is optimized for Railway and the deployment guide below assumes Railway as the default hosting platform.  
> It can still be deployed in other environments (for example Docker, Render, or self-hosted servers), but you may need to configure the database, web/worker process split, scheduling, health checks, and environment variables manually.
>
> **권장 배포 환경:** Railway  
> 이 프로젝트는 Railway에 최적화되어 있으며, 아래 배포 가이드는 Railway를 기본 기준으로 작성되어 있습니다.  
> 다만 Docker, Render, 자체 서버 등 다른 환경에서도 배포할 수 있으며, 그 경우 데이터베이스, web/worker 분리, 스케줄러, 헬스체크, 환경 변수 설정을 직접 맞춰야 할 수 있습니다.

## Railway Deployment Guide

The codebase is built to run as **two Railway services from the same repository**:

- `web`: serves the UI and OAuth callbacks
- `worker`: runs the scheduler/resume loop and exposes `/health`

이 코드베이스는 **하나의 저장소에서 두 개의 Railway 서비스**로 실행하는 구성을 전제로 합니다.

- `web`: UI와 OAuth 콜백 제공
- `worker`: scheduler/resume 루프 실행 및 `/health` 제공

### 1. Create a PostgreSQL service

- Create Railway Postgres.
- Copy its connection string into `DATABASE_URL`.
- Set `DATABASE_SSL=true` unless your connection string/provider explicitly says otherwise.

### 2. Create the web service

- Connect this repository.
- Use the repository Dockerfile build.
- Start command:

```bash
npm run start:web
```

- Add a public domain.
- Set `APP_BASE_URL` to the final public HTTPS URL of this web service.
- Health check path: `/health`

### 3. Create the worker service

- Reuse the same repository.
- Use the same environment values as `web`, including `DATABASE_URL`, `OWNER_USER_KEY`, and `TOKEN_ENCRYPTION_KEY`.
- Start command:

```bash
npm run start:worker
```

- Health check path: `/health`

### 4. Set environment variables

Both services must share the same values for all app settings that affect stored state, especially:

- `DATABASE_URL`
- `DATABASE_SSL`
- `OWNER_USER_KEY`
- `TOKEN_ENCRYPTION_KEY`
- `YOUTUBE_DAILY_QUOTA_LIMIT`
- `YOUTUBE_PLAYLIST_ID` if you use a fixed playlist

### 5. Deploy and verify

- Confirm the web service opens and prompts for Basic Auth.
- Confirm `GET /health` on the web service returns `process: "web"`.
- Confirm the worker service boots successfully and exposes `process: "worker"` on `/health`.
- Complete Spotify and YouTube OAuth from the web service.
- Run the first manual sync from the dashboard.

### 6. Railway-specific notes

- `railway.toml` already points health checks to `/health`.
- The Dockerfile default command starts the web server; override the worker service start command to `npm run start:worker`.
- The worker also binds `PORT` and serves HTTP because Railway health checks expect an HTTP service.
- The web service needs the public URL used in `APP_BASE_URL`. The worker does not handle OAuth callbacks, but it still needs the same config schema to boot.

### 1. PostgreSQL 서비스 생성

- Railway Postgres를 생성합니다.
- 연결 문자열을 `DATABASE_URL`에 넣습니다.
- 특별한 이유가 없으면 `DATABASE_SSL=true`로 설정합니다.

### 2. web 서비스 생성

- 이 저장소를 연결합니다.
- 저장소의 Dockerfile 빌드를 사용합니다.
- 시작 명령:

```bash
npm run start:web
```

- 공개 도메인을 연결합니다.
- `APP_BASE_URL`을 이 web 서비스의 최종 공개 HTTPS URL로 설정합니다.
- 헬스체크 경로: `/health`

### 3. worker 서비스 생성

- 같은 저장소를 다시 사용합니다.
- `DATABASE_URL`, `OWNER_USER_KEY`, `TOKEN_ENCRYPTION_KEY`를 포함해 `web`과 동일한 환경 변수를 넣습니다.
- 시작 명령:

```bash
npm run start:worker
```

- 헬스체크 경로: `/health`

### 4. 환경 변수 설정

두 서비스는 저장 상태에 영향을 주는 모든 주요 값을 반드시 동일하게 써야 합니다. 특히 다음 값이 중요합니다.

- `DATABASE_URL`
- `DATABASE_SSL`
- `OWNER_USER_KEY`
- `TOKEN_ENCRYPTION_KEY`
- `YOUTUBE_DAILY_QUOTA_LIMIT`
- 고정 재생목록을 쓴다면 `YOUTUBE_PLAYLIST_ID`

### 5. 배포 후 확인

- web 서비스가 열리고 Basic Auth를 요구하는지 확인합니다.
- web 서비스의 `/health`가 `process: "web"`를 반환하는지 확인합니다.
- worker 서비스가 정상 부팅되고 `/health`에서 `process: "worker"`를 반환하는지 확인합니다.
- web 서비스에서 Spotify와 YouTube OAuth를 완료합니다.
- 대시보드에서 첫 수동 동기화를 실행합니다.

### 6. Railway 운영 메모

- `railway.toml`은 이미 헬스체크 경로를 `/health`로 지정합니다.
- Dockerfile 기본 실행 명령은 web 서버이므로, worker 서비스에서는 시작 명령을 `npm run start:worker`로 반드시 덮어써야 합니다.
- worker도 Railway 헬스체크를 위해 `PORT`에 바인드되는 HTTP 서비스를 띄웁니다.
- OAuth 콜백은 web 서비스에서만 처리되지만, worker도 동일한 설정 스키마를 만족해야 부팅됩니다.

## Scheduler / Worker / Web Service Explanation

`web`

- Receives all browser traffic.
- Renders the dashboard.
- Starts OAuth flows and handles callbacks.
- Accepts manual sync, manual review, disconnect, and reset actions.

`worker`

- Polls every `SCHEDULER_POLL_INTERVAL_MS`.
- On each tick, first tries to resume due paused runs.
- If nothing is due, it checks whether the current hourly schedule slot already has a `schedule` run.
- If not, it starts one scheduled run.
- The current code uses an hourly slot anchored at minute `17` UTC. This minute is not exposed as an environment variable.

`web`

- 모든 브라우저 요청을 받습니다.
- 대시보드를 렌더링합니다.
- OAuth 흐름을 시작하고 콜백을 처리합니다.
- 수동 동기화, 수동 검토, 연결 해제, 초기화 액션을 받습니다.

`worker`

- `SCHEDULER_POLL_INTERVAL_MS`마다 깨어납니다.
- 각 tick마다 먼저 재개 가능한 paused run이 있는지 확인합니다.
- 없으면 현재 시간 슬롯에 이미 `schedule` run이 있는지 검사합니다.
- 없다면 예약 동기화를 시작합니다.
- 현재 코드는 UTC 기준 매시 `17분` 슬롯을 기준으로 예약 실행하며, 이 분 값은 환경 변수로 노출되어 있지 않습니다.

## Usage Guide

1. Open the web app and enter the Basic Auth credentials.
2. Connect Spotify.
3. Connect YouTube.
4. Confirm the connection panels show both accounts as connected.
5. Click `Run sync now`.
6. Watch the live panel for active status, current track, run events, and track flow.
7. If tracks move to `review_required`, open the attention section and either accept the recommendation or enter a manual YouTube video.
8. Run sync again after resolving review items.
9. Leave the worker running so quota waits and retry waits can resume automatically.

1. 웹 앱을 열고 Basic Auth 자격증명을 입력합니다.
2. Spotify를 연결합니다.
3. YouTube를 연결합니다.
4. 연결 패널에서 두 계정이 모두 connected로 표시되는지 확인합니다.
5. `Run sync now`를 클릭합니다.
6. 라이브 패널에서 현재 상태, 현재 트랙, run 이벤트, 트랙 흐름을 확인합니다.
7. 트랙이 `review_required`로 이동하면 Attention 섹션에서 추천 후보를 승인하거나 수동으로 YouTube 영상을 입력합니다.
8. 검토 항목을 해결한 뒤 다시 동기화를 실행합니다.
9. quota 대기나 재시도 대기가 자동 재개되도록 worker를 계속 실행 상태로 둡니다.

## Dashboard / UI Explanation

The dashboard is server-rendered and live-updated by polling.

대시보드는 서버 렌더링 방식이며 polling으로 실시간 갱신됩니다.

### Main areas

- Connection panels for Spotify and YouTube
- Playlist and sync panel
- Live sync run panel
- Recent runs
- Needs attention list
- Danger zone

### Live update behavior

- Polls `/api/dashboard/live`
- Poll interval is `5s` while a run is active
- Poll interval is `20s` while idle
- On repeated fetch failure, the UI enters a stale mode and backs off up to `60s`
- Track pagination/filtering uses `/api/sync-runs/:runId/tracks`
- Language preference is stored in the `dashboard_lang` cookie

### 주요 영역

- Spotify / YouTube 연결 패널
- 재생목록 및 동기화 패널
- 라이브 sync run 패널
- 최근 실행 기록
- 조치가 필요한 트랙 목록
- Danger zone

### 실시간 갱신 동작

- `/api/dashboard/live`를 폴링합니다.
- 실행 중일 때는 `5초` 간격으로 갱신합니다.
- 유휴 상태일 때는 `20초` 간격으로 갱신합니다.
- 연속으로 갱신에 실패하면 stale mode에 들어가고 최대 `60초`까지 backoff합니다.
- 트랙 페이지네이션/필터링은 `/api/sync-runs/:runId/tracks`를 사용합니다.
- 언어 설정은 `dashboard_lang` 쿠키에 저장됩니다.

## Manual Sync Explanation

`Run sync now` does not blindly create duplicate runs.

`Run sync now`는 무조건 새 run을 만드는 방식이 아닙니다.

- If a run is already active and the sync lock is held, the app returns the existing run information.
- If a paused/stale run is resumable, the service resumes that run.
- Otherwise it starts a new run.

- 이미 active run이 있고 sync lock이 잡혀 있으면 기존 run 정보를 돌려줍니다.
- paused/stale run이 재개 가능하면 그 run을 이어서 실행합니다.
- 그 외의 경우에만 새 run을 시작합니다.

## Low-Confidence Match / Manual Mapping Explanation

When a search result score is below `MATCH_THRESHOLD`, the best candidate is stored as a review candidate instead of being inserted automatically.

검색 결과 점수가 `MATCH_THRESHOLD`보다 낮으면 자동 삽입하지 않고, 가장 좋은 후보를 review candidate로 저장합니다.

### What you can do

- Accept the stored recommendation
- Enter a manual YouTube URL
- Enter a raw YouTube video ID

### Validation rules

- The video must resolve through `videos.list`
- Private/unusable videos are rejected
- Non-embeddable videos are rejected
- Manual validation consumes quota

### Edit restrictions

- Tracks already inserted into the YouTube playlist cannot be edited
- Tracks removed from Spotify cannot be edited

### 가능한 작업

- 저장된 추천 후보 승인
- YouTube URL 직접 입력
- YouTube 영상 ID 직접 입력

### 검증 규칙

- `videos.list`로 실제 조회 가능한 영상이어야 합니다.
- 비공개 또는 사용할 수 없는 영상은 거부됩니다.
- 임베드 불가 영상은 거부됩니다.
- 수동 검증도 quota를 사용합니다.

### 수정 제한

- 이미 YouTube 재생목록에 삽입된 트랙은 수정할 수 없습니다.
- Spotify에서 제거된 트랙은 수정할 수 없습니다.

## Troubleshooting

### Spotify connection fails

- Verify `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET`.
- Verify the Spotify redirect URI exactly matches `${APP_BASE_URL}/auth/spotify/callback`.
- Make sure you are using the web service URL, not the worker URL.

### YouTube connection fails

- Verify `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `YOUTUBE_API_KEY`.
- Confirm YouTube Data API v3 is enabled.
- Verify the redirect URI exactly matches `${APP_BASE_URL}/auth/youtube/callback`.
- Confirm the Google account has an accessible YouTube channel.

### Redirect URI mismatch

- Update the provider console after every `APP_BASE_URL` change.
- Remove trailing slash confusion by copying the full callback URL directly.

### Managed playlist access error

- The service uses playlist ID, not playlist title.
- Renaming the playlist or changing privacy is normally fine.
- If the connected YouTube account no longer owns or can access that playlist ID, sync will fail until access is restored or YouTube is reconnected.

### Sync pauses on YouTube quota

- Check `YOUTUBE_DAILY_QUOTA_LIMIT`.
- Wait until the stored retry time or the next Pacific-time reset.
- Keep the worker running so the run can resume automatically.

### Sync pauses on Spotify retry

- This usually means a retryable Spotify API issue such as rate limiting or transient failure.
- Keep the worker running and let it resume automatically.

### Progress UI does not update

- Check that the browser can reach `/api/dashboard/live`.
- Check Basic Auth credentials.
- Check server logs for polling failures.
- The UI intentionally uses polling, not websockets.

### Railway health check fails

- Make sure the web service uses `npm run start:web`.
- Make sure the worker service uses `npm run start:worker`.
- Both services must bind `HOST` / `PORT` and expose `/health`.

### Database connection fails

- Re-check `DATABASE_URL`.
- On Railway Postgres, `DATABASE_SSL=true` is usually required.
- Run `npm run db:migrate` locally if the app cannot initialize your database.

### Existing OAuth tokens suddenly stop working

- If you changed `TOKEN_ENCRYPTION_KEY`, previously stored tokens can no longer be decrypted.
- Reconnect the affected accounts after restoring or replacing the key.

### Spotify 연결 실패

- `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`를 다시 확인합니다.
- Spotify redirect URI가 `${APP_BASE_URL}/auth/spotify/callback`와 정확히 일치하는지 확인합니다.
- worker URL이 아니라 web 서비스 URL을 사용했는지 확인합니다.

### YouTube 연결 실패

- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `YOUTUBE_API_KEY`를 확인합니다.
- YouTube Data API v3가 활성화되어 있는지 확인합니다.
- redirect URI가 `${APP_BASE_URL}/auth/youtube/callback`와 정확히 일치하는지 확인합니다.
- 연결한 Google 계정에 접근 가능한 YouTube 채널이 있는지 확인합니다.

### Redirect URI mismatch

- `APP_BASE_URL`을 변경할 때마다 각 제공자 콘솔의 redirect URI도 함께 갱신합니다.
- 전체 콜백 URL을 그대로 복사해 넣어 trailing slash 혼동을 줄입니다.

### 관리형 재생목록 접근 오류

- 이 서비스는 재생목록 제목이 아니라 재생목록 ID를 기준으로 동작합니다.
- 재생목록 이름 변경이나 공개 범위 변경은 보통 문제가 되지 않습니다.
- 하지만 연결된 YouTube 계정이 그 재생목록 ID에 더 이상 접근하지 못하면, 접근 권한을 복구하거나 YouTube를 다시 연결할 때까지 동기화가 실패합니다.

### YouTube quota로 동기화가 멈춤

- `YOUTUBE_DAILY_QUOTA_LIMIT` 값을 확인합니다.
- 저장된 retry 시각 또는 다음 태평양 시간 기준 quota reset까지 기다립니다.
- worker를 계속 실행해 자동 재개가 되도록 합니다.

### Spotify 재시도로 동기화가 멈춤

- 보통 Spotify rate limit 또는 일시적 API 장애입니다.
- worker를 계속 실행해 자동 재개를 기다리면 됩니다.

### 진행상황 UI가 갱신되지 않음

- 브라우저에서 `/api/dashboard/live`에 접근 가능한지 확인합니다.
- Basic Auth 자격증명을 확인합니다.
- 서버 로그에서 polling 실패를 확인합니다.
- 이 UI는 의도적으로 websocket이 아니라 polling을 사용합니다.

### Railway 헬스체크 실패

- web 서비스 시작 명령이 `npm run start:web`인지 확인합니다.
- worker 서비스 시작 명령이 `npm run start:worker`인지 확인합니다.
- 두 서비스 모두 `HOST` / `PORT`에 바인드되고 `/health`를 제공해야 합니다.

### 데이터베이스 연결 실패

- `DATABASE_URL`을 다시 확인합니다.
- Railway Postgres에서는 보통 `DATABASE_SSL=true`가 필요합니다.
- 로컬 DB 초기화가 안 되면 `npm run db:migrate`를 먼저 실행합니다.

### 기존 OAuth 토큰이 갑자기 동작하지 않음

- `TOKEN_ENCRYPTION_KEY`를 바꾸면 기존에 저장된 토큰을 더 이상 복호화할 수 없습니다.
- 키를 복구하거나, 해당 계정을 다시 연결해야 합니다.

## Known Limitations

- The app syncs Spotify liked songs only, not arbitrary Spotify playlists.
- The app is single-owner and not multi-tenant.
- Tracks removed from Spotify are marked as removed locally, but the code does not delete their videos from YouTube playlists.
- Playlist title, description, and privacy environment variables are used for playlist creation only; the app does not rename/update an existing playlist later.
- The schedule minute is fixed in code at minute `17` UTC.
- The UI uses polling instead of websockets or SSE.
- Manual review changes are blocked after a track has already been inserted into YouTube.
- If the worker is running before OAuth setup is finished, scheduled runs may fail until the accounts are connected.

- 이 앱은 Spotify 좋아요 곡만 동기화하며, 임의의 Spotify 재생목록은 지원하지 않습니다.
- 이 앱은 단일 owner 기반이며 멀티테넌트가 아닙니다.
- Spotify에서 제거된 트랙은 로컬에서 removed로 표시되지만, 현재 코드는 YouTube 재생목록에서 해당 영상을 삭제하지 않습니다.
- 재생목록 제목, 설명, 공개 범위 환경 변수는 재생목록 생성 시에만 사용되며, 기존 재생목록의 메타데이터를 나중에 갱신하지 않습니다.
- 스케줄 분 값은 코드에 고정되어 있으며 UTC `17분`입니다.
- UI는 websocket/SSE 대신 polling을 사용합니다.
- 트랙이 이미 YouTube에 삽입된 뒤에는 수동 검토 결과를 바꿀 수 없습니다.
- OAuth 설정이 끝나기 전에 worker가 먼저 실행 중이면, 계정 연결 전까지 예약 실행이 실패할 수 있습니다.

## Security Notes

- Do not expose this app publicly without strong Basic Auth credentials.
- Use HTTPS in production for OAuth callbacks.
- Keep `TOKEN_ENCRYPTION_KEY` secret and stable.
- `/health` is intentionally unauthenticated for infrastructure health checks.
- OAuth tokens are stored encrypted in PostgreSQL, but anyone with both DB access and the encryption key can still recover them.

- 강한 Basic Auth 자격증명 없이 이 앱을 공개적으로 노출하지 마세요.
- 운영 환경에서는 OAuth 콜백에 HTTPS를 사용하세요.
- `TOKEN_ENCRYPTION_KEY`는 비밀로 유지하고, 쉽게 바꾸지 마세요.
- `/health`는 인프라 헬스체크를 위해 의도적으로 인증 없이 열려 있습니다.
- OAuth 토큰은 PostgreSQL에 암호화 저장되지만, DB 접근 권한과 암호화 키를 모두 가진 사람은 복구할 수 있습니다.

## Development Notes

- Source of truth is in `src/` and `drizzle/`.
- `dist/` contains compiled output and should not be treated as the primary source when documenting behavior.
- Tests use PGlite/Drizzle for isolated database tests.
- Migrations are plain SQL files applied by the app on startup and by `npm run db:migrate`.

- 동작의 기준 소스는 `src/`와 `drizzle/`입니다.
- `dist/`는 빌드 산출물이므로 동작 문서화의 기준 소스로 보면 안 됩니다.
- 테스트는 PGlite/Drizzle 기반의 격리된 데이터베이스 테스트를 사용합니다.
- 마이그레이션은 SQL 파일로 관리되며, 앱 시작 시와 `npm run db:migrate` 실행 시 적용됩니다.

## Project Structure

```text
.
├─ src/
│  ├─ app.ts
│  ├─ server.ts
│  ├─ worker.ts
│  ├─ config.ts
│  ├─ runtime.ts
│  ├─ routes/
│  ├─ views/
│  ├─ services/
│  │  ├─ sync/
│  │  └─ matching/
│  ├─ providers/
│  │  ├─ spotify/
│  │  ├─ youtube/
│  │  └─ search/
│  ├─ db/
│  ├─ lib/
│  └─ scripts/
├─ drizzle/
├─ tests/
├─ Dockerfile
├─ railway.toml
├─ package.json
└─ .env.example
```

- `src/server.ts`: web entrypoint
- `src/worker.ts`: worker entrypoint
- `src/routes/index.ts`: dashboard routes and admin endpoints
- `src/views/dashboard.ts`: SSR dashboard HTML and client polling script
- `src/services/sync/sync-service.ts`: main sync engine
- `src/services/sync/railway-scheduler-worker.ts`: worker scheduler/resume loop
- `src/services/track-review-service.ts`: review/manual mapping logic
- `src/services/oauth-service.ts`: OAuth token storage and refresh
- `src/db/store.ts`: persistent state operations
- `drizzle/*.sql`: schema migrations
- `tests/`: behavior-level tests

- `src/server.ts`: web 진입점
- `src/worker.ts`: worker 진입점
- `src/routes/index.ts`: 대시보드 라우트와 관리자 엔드포인트
- `src/views/dashboard.ts`: SSR 대시보드 HTML과 클라이언트 polling 스크립트
- `src/services/sync/sync-service.ts`: 핵심 동기화 엔진
- `src/services/sync/railway-scheduler-worker.ts`: worker의 scheduler/resume 루프
- `src/services/track-review-service.ts`: 리뷰/수동 매핑 로직
- `src/services/oauth-service.ts`: OAuth 토큰 저장 및 갱신
- `src/db/store.ts`: 영구 상태 저장소 로직
- `drizzle/*.sql`: 스키마 마이그레이션
- `tests/`: 동작 검증 테스트

## Scripts

| Script | Description |
| --- | --- |
| `npm run dev` | Start the web server in watch mode. / web 개발 서버를 watch 모드로 실행합니다. |
| `npm run build` | Compile TypeScript to `dist/`. / TypeScript를 `dist/`로 빌드합니다. |
| `npm run start` | Start the compiled web server. / 빌드된 web 서버를 시작합니다. |
| `npm run start:web` | Start the compiled web server explicitly. / 빌드된 web 서버를 명시적으로 시작합니다. |
| `npm run start:worker` | Start the compiled worker process. / 빌드된 worker 프로세스를 시작합니다. |
| `npm run check` | Run TypeScript type-checking only. / TypeScript 타입 체크만 수행합니다. |
| `npm test` | Run the test suite once. / 테스트를 1회 실행합니다. |
| `npm run test:watch` | Run tests in watch mode. / 테스트 watch 모드를 실행합니다. |
| `npm run db:generate` | Generate Drizzle migration files. / Drizzle 마이그레이션 파일을 생성합니다. |
| `npm run db:migrate` | Apply SQL migrations to PostgreSQL. / PostgreSQL에 SQL 마이그레이션을 적용합니다. |

## License

No license file is present in the repository at the time of writing this README.

이 README 작성 시점 기준으로 저장소에는 별도의 라이선스 파일이 없습니다.

## Assumptions And External Notes

This README does not intentionally describe unimplemented product features. The only practical assumptions are about external platform UIs:

- Spotify Developer Dashboard labels may change over time.
- Google Cloud Console button names may change over time.
- Railway UI wording may change over time.

Application behavior, environment variables, routes, and deployment shape in this README were derived from the current source code and tests.

이 README는 의도적으로 구현되지 않은 제품 기능을 설명하지 않았습니다. 다만 외부 플랫폼 UI에 대해서만 실무적인 가정이 있습니다.

- Spotify Developer Dashboard의 메뉴 이름은 시간이 지나며 바뀔 수 있습니다.
- Google Cloud Console의 버튼/메뉴 이름은 바뀔 수 있습니다.
- Railway UI 문구도 바뀔 수 있습니다.

이 README의 애플리케이션 동작, 환경 변수, 라우트, 배포 구조는 현재 소스 코드와 테스트를 기준으로 작성했습니다.
