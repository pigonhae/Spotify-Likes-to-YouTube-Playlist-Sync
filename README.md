# Spotify Likes -> YouTube Playlist Sync

Spotify 좋아요 곡을 주기적으로 읽어서 YouTube 재생목록으로 동기화하는 개인용 서비스입니다.

이번 버전부터 핵심 상태는 모두 PostgreSQL에 저장됩니다. Railway 재배포, 재시작, 스케일링 이후에도 아래 데이터가 유지됩니다.

- Spotify / YouTube OAuth 토큰
- 연결 상태와 외부 계정 정보
- YouTube playlist ID
- Spotify track -> YouTube video 매핑
- 재생목록 캐시
- 동기화 실행 로그
- quota ledger와 앱 설정

## 기술 스택

- Node.js 22
- TypeScript
- Fastify
- PostgreSQL
- Drizzle ORM
- GitHub Actions hourly trigger

## 환경변수

`.env.example`을 복사해 `.env`를 만드세요.

핵심 값:

- `DATABASE_URL`
  - 예: `postgres://postgres:postgres@127.0.0.1:5432/spotifyplaylist`
- `OWNER_USER_KEY`
  - 단일 사용자 앱의 owner row 식별자
- `DATABASE_POOL_MAX`
  - 기본 5
- `DATABASE_SSL`
  - Railway Postgres를 외부 URL로 붙일 때는 보통 `true`
- `TOKEN_ENCRYPTION_KEY`
  - 64자리 hex 문자열

기존 `DATABASE_PATH`는 더 이상 사용하지 않습니다.

## 로컬 실행

```bash
npm install
npm run db:migrate
npm run dev
```

브라우저에서 `http://127.0.0.1:3000`에 접속한 뒤 Basic Auth로 로그인하고 Spotify/YouTube를 연결하세요.

## PostgreSQL 스키마

핵심 테이블:

- `users`
  - owner 사용자 1명 보관
- `oauth_accounts`
  - provider별 access token, refresh token, 만료시각, 외부 계정 식별자
- `oauth_states`
  - OAuth state nonce
- `user_settings`
  - playlist ID, quota ledger, 기타 설정
- `track_mappings`
  - Spotify 스냅샷, 검색 상태, 수동 override, 매핑 이력
- `playlist_videos`
  - YouTube playlist 캐시
- `sync_runs`
  - 최근 동기화 실행 로그, `stats_json`은 JSONB
- `sync_state`
  - 마지막 시작/성공/실패 시각과 마지막 오류
- `sync_lock`
  - DB 기반 동시 실행 방지 락

## 데이터가 유지되는 방식

앱은 더 이상 메모리나 로컬 SQLite 파일을 source of truth로 쓰지 않습니다.

- 서버 시작 시 PostgreSQL에 연결합니다.
- 마이그레이션을 적용합니다.
- `OWNER_USER_KEY`에 해당하는 owner 사용자를 보장합니다.
- 이후 OAuth, 동기화, 대시보드 렌더링은 모두 PostgreSQL만 읽고 씁니다.

그래서 Railway가 재배포되거나 재시작되어도:

- 연결 상태가 남아 있고
- refresh token이 유지되며
- playlist ID와 매핑 이력이 유지되고
- 중복 추가 방지가 계속 동작합니다.

## Railway 배포

1. Railway 프로젝트에 `PostgreSQL` 서비스를 추가합니다.
2. 앱 서비스에 아래 변수를 넣습니다.

```env
NODE_ENV=production
HOST=0.0.0.0
PORT=8080
APP_BASE_URL=https://YOUR-APP.up.railway.app
DATABASE_URL=${{ Postgres.DATABASE_URL }}
DATABASE_SSL=true
DATABASE_POOL_MAX=5
OWNER_USER_KEY=default-owner
```

3. 나머지 Spotify / Google / YouTube 환경변수도 설정합니다.
4. 배포 후 `npm run db:migrate`가 필요하면 한 번 실행합니다.
5. 대시보드에서 Spotify와 YouTube를 연결합니다.

## GitHub Actions

GitHub Secrets:

- `INTERNAL_SYNC_URL=https://YOUR-APP.up.railway.app/internal/sync`
- `SYNC_TRIGGER_SECRET=<same value as Railway>`

## 중요한 운영 메모

- 기존 SQLite 데이터는 자동 이전하지 않습니다.
- Postgres 전환 후에는 새 상태로 다시 연결해야 합니다.
- 토큰은 AES-256-GCM으로 암호화되어 DB에 저장됩니다.
- 민감한 토큰 값은 로그에 출력하지 않습니다.

## 검증 명령어

```bash
npm run check
npm test
npm run build
```
