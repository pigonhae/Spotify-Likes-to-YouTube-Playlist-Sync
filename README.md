# Spotify Likes -> YouTube Playlist Sync

Spotify에서 좋아요한 곡을 읽어서 YouTube 재생목록에 자동으로 반영하는 단일 사용자용 서비스입니다.

- Spotify liked songs 전체를 주기적으로 스캔합니다.
- YouTube에서 공식 음원에 가까운 영상을 점수 기반으로 선택합니다.
- 이미 재생목록에 있는 영상은 중복으로 넣지 않습니다.
- Railway에 웹 서비스 1개로 배포할 수 있습니다.
- 기본 스케줄링은 GitHub Actions hourly trigger로 동작합니다.

## 핵심 설계

- 런타임: Node.js 22 + TypeScript
- 웹 서버: Fastify
- DB: SQLite + Drizzle ORM
- 저장소: Railway Volume의 SQLite 파일
- 스케줄링: GitHub Actions `schedule` -> Railway `/internal/sync`
- YouTube 검색: `@distube/ytsr` 우선, YouTube Data API fallback
- YouTube 쓰기/검증: 공식 YouTube Data API
- OAuth 토큰 저장: AES-256-GCM 암호화 후 SQLite 저장

삭제 동기화는 v1에서 비활성화되어 있습니다. Spotify에서 좋아요를 취소해도 YouTube 재생목록에서는 자동 삭제하지 않고, 내부 DB에만 “Spotify에서 제거됨” 상태로 남깁니다.

## 프로젝트 구조

```text
.
├─ .github/workflows/hourly-sync.yml
├─ drizzle/0000_initial.sql
├─ src/
│  ├─ app.ts
│  ├─ config.ts
│  ├─ server.ts
│  ├─ db/
│  ├─ lib/
│  ├─ providers/
│  │  ├─ spotify/
│  │  ├─ youtube/
│  │  └─ search/
│  ├─ routes/
│  ├─ services/
│  │  ├─ matching/
│  │  └─ sync/
│  ├─ views/
│  └─ scripts/migrate.ts
├─ tests/
├─ .env.example
├─ Dockerfile
├─ railway.toml
└─ README.md
```

## 환경 변수

`.env.example`를 기준으로 설정하세요.

- `APP_BASE_URL`: 로컬은 `http://127.0.0.1:3000`, Railway는 배포 URL
- `APP_BASIC_AUTH_USER`, `APP_BASIC_AUTH_PASS`: 관리자 대시보드 보호용
- `DATABASE_PATH`: 로컬 `./data/app.db`, Railway는 `/data/app.db` 권장
- `TOKEN_ENCRYPTION_KEY`: 64자리 hex 문자열
- `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `YOUTUBE_API_KEY`
- `SYNC_TRIGGER_SECRET`: GitHub Actions가 `/internal/sync`를 호출할 때 사용하는 Bearer secret
- `YOUTUBE_PLAYLIST_ID`: 기존 재생목록을 쓰고 싶을 때만 설정. 비워 두면 첫 sync 때 자동 생성
- `YOUTUBE_PLAYLIST_TITLE`, `YOUTUBE_PLAYLIST_DESCRIPTION`, `YOUTUBE_PLAYLIST_PRIVACY`

## 로컬 실행

1. `.env.example`를 `.env`로 복사하고 값을 채웁니다.
2. 의존성을 설치합니다.

```bash
npm install
```

3. 서버를 실행합니다.

```bash
npm run dev
```

4. 브라우저에서 `http://127.0.0.1:3000`에 접속합니다.
5. Basic Auth로 로그인합니다.
6. `Connect Spotify`, `Connect YouTube`를 순서대로 완료합니다.
7. `Run Sync Now`를 눌러 첫 동기화를 실행합니다.

## Spotify Developer 설정

1. Spotify Developer Dashboard에서 앱을 생성합니다.
2. Redirect URI를 아래처럼 등록합니다.
   - 로컬: `http://127.0.0.1:3000/auth/spotify/callback`
   - Railway: `https://<your-railway-domain>/auth/spotify/callback`
3. Client ID / Client Secret을 `.env` 또는 Railway 환경 변수에 넣습니다.
4. 필요한 scope는 `user-library-read` 하나입니다.

## Google Cloud / YouTube 설정

1. Google Cloud 프로젝트를 만듭니다.
2. YouTube Data API v3를 활성화합니다.
3. OAuth consent screen을 설정합니다.
   - 실제 운영 전에는 반드시 `In production`으로 전환하세요.
   - `Testing` 상태에서는 refresh token이 약 7일 뒤 만료될 수 있습니다.
4. OAuth 2.0 Web application client를 생성합니다.
5. Authorized redirect URI를 등록합니다.
   - 로컬: `http://127.0.0.1:3000/auth/youtube/callback`
   - Railway: `https://<your-railway-domain>/auth/youtube/callback`
6. 별도로 API Key도 만들어 `YOUTUBE_API_KEY`에 넣습니다.

이 앱은 playlist 생성/삽입을 위해 `https://www.googleapis.com/auth/youtube.force-ssl` scope를 사용합니다.

## Railway 배포

1. Railway 프로젝트를 생성하고 이 저장소를 연결합니다.
2. Volume을 하나 만들고 서비스에 마운트합니다.
   - 예시 마운트 경로: `/data`
3. 환경 변수를 설정합니다.
   - `DATABASE_PATH=/data/app.db`
   - `APP_BASE_URL=https://<your-railway-domain>`
   - 나머지 OAuth/API 값들
4. 배포합니다.
5. 배포 후 브라우저에서 대시보드에 접속해 Spotify/YouTube 계정을 연결합니다.

`railway.toml`과 `Dockerfile`이 포함되어 있으므로 바로 배포 가능합니다.

## GitHub Actions 스케줄링

기본 방식은 Railway cron이 아니라 GitHub Actions입니다.

필요한 GitHub Secrets:

- `INTERNAL_SYNC_URL`
  - 예: `https://<your-railway-domain>/internal/sync`
- `SYNC_TRIGGER_SECRET`
  - 앱 환경 변수의 `SYNC_TRIGGER_SECRET`와 동일한 값

워크플로는 매시 `17분 UTC`에 호출되며, GitHub 스케줄 특성상 몇 분 정도 지연될 수 있습니다.

## 실제 동작 흐름

1. Spotify liked songs를 페이지네이션으로 전부 읽습니다.
2. DB에 저장된 곡 목록과 비교해 신규/제거 상태를 갱신합니다.
3. YouTube 재생목록 ID를 확인하거나 없으면 생성합니다.
4. 현재 재생목록의 video ID 목록을 읽어 중복을 방지합니다.
5. 각 곡에 대해:
   - 수동 override가 있으면 그것을 우선 사용
   - 기존 match 결과가 있으면 재검색하지 않고 재사용
   - 없으면 `ytsr` 검색 -> 필요 시 YouTube API search fallback
   - `videos.list`로 후보를 검증하고 점수화
6. threshold를 넘는 영상만 playlist에 추가합니다.
7. 실패/미매칭 곡은 DB에 남기고 대시보드에서 수동 override를 넣을 수 있습니다.

## 매칭 전략

점수 계산에 반영하는 요소:

- track title 유사도
- artist 이름이 제목/채널명에 들어있는지
- album 이름 포함 여부
- `official audio`, `Topic`, `VEVO`, `Provided to YouTube` 가점
- duration 차이
- `live`, `cover`, `karaoke`, `lyrics`, `remix`, `sped up`, `slowed`, `nightcore`, `8D` 감점
- embeddable / syndication 정보

## 중복 방지 방식

- Spotify `track_id` 기준으로 내부 row를 하나만 유지
- 이미 매칭된 YouTube `video_id` 재사용
- 매 sync 때 YouTube 재생목록 현재 항목을 다시 읽어 실제 상태와 맞춤
- 같은 `video_id`가 이미 재생목록에 있으면 다시 insert하지 않음
- 수동으로 재생목록을 수정해도 다음 sync에서 회복 가능

## 운영 팁

- 좋아요 곡이 많으면 초기 백필은 여러 번의 sync에 걸쳐 끝날 수 있습니다.
- YouTube Data API 기본 quota는 하루 10,000 units라서 `playlistItems.insert` 비용이 큽니다.
- `ytsr`를 먼저 쓰는 이유는 search quota를 아끼기 위해서입니다.
- 가능한 한 playlist를 하나만 관리하고, override는 정말 필요한 곡에만 쓰는 편이 운영이 편합니다.
- SQLite 파일은 Railway Volume에 있으므로 재배포 후에도 상태가 유지됩니다.

## 장애 대응

### Spotify / YouTube 토큰 만료

- access token은 자동 refresh 됩니다.
- refresh token이 무효화되면 대시보드에 오류가 남고 재연결이 필요합니다.

### YouTube quota 초과

- 동기화는 `quota_exhausted` 상태로 종료됩니다.
- 남은 곡은 다음 시간대 sync에서 이어서 처리됩니다.
- 초기 백필 시에는 하루에 너무 많은 곡이 한 번에 들어가지 않을 수 있습니다.

### 검색 결과가 이상함

- 대시보드의 `Tracks Needing Attention` 섹션에 YouTube URL 또는 video ID를 직접 넣으면 다음 sync부터 그 영상을 고정 사용합니다.

### Railway 재시작 / 재배포

- SQLite가 Volume에 있으면 데이터는 유지됩니다.
- 앱은 시작 시 마이그레이션을 적용하고 `/health`가 정상 응답하면 준비 완료입니다.

## 무료/저비용 운영 근거

- 외부 DB 없이 SQLite 단일 파일 사용
- worker/queue 없이 웹 서비스 1개만 유지
- 스케줄링은 GitHub Actions를 사용해 Railway cron 비용 회피
- YouTube 검색은 비공식 검색 우선으로 search quota 절감
- Railway Volume + 단일 프로세스 구조라 개인 프로젝트 관리 난이도가 낮음

## 명령어

```bash
npm run dev
npm run build
npm run start
npm run check
npm test
npm run db:migrate
```
