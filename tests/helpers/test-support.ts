import fs from "node:fs/promises";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";

import type { AppConfig } from "../../src/config.js";
import type { AppDatabase, QueryClientLike } from "../../src/db/client.js";
import { createAppStore } from "../../src/db/store.js";
import * as schema from "../../src/db/schema.js";

const TEST_DATABASE_URL = "postgres://test:test@localhost:5432/testdb";

export async function createTestStore() {
  const client = new PGlite();
  await applySqlMigrations(client, path.resolve("drizzle"));

  const pool: QueryClientLike = {
    query: async (text, params = []) => {
      const result = await client.query(text, params);
      return {
        rows: result.rows,
        rowCount: result.affectedRows ?? result.rows.length,
      };
    },
    end: async () => {
      await client.close();
    },
  };

  const database: AppDatabase = {
    pool,
    db: drizzle(client, { schema }),
    close: async () => {
      await client.close();
    },
  };

  const store = await createAppStore(database, "test-owner", "Test Owner");

  return {
    database,
    store,
    close: async () => {
      await database.close();
    },
  };
}

export function createTestConfig(
  overrides: Partial<AppConfig> = {},
): AppConfig {
  return {
    NODE_ENV: "test",
    HOST: "127.0.0.1",
    PORT: 3000,
    LOG_LEVEL: "silent",
    APP_BASE_URL: "http://127.0.0.1:3000",
    APP_BASIC_AUTH_USER: "admin",
    APP_BASIC_AUTH_PASS: "password",
    DATABASE_URL: TEST_DATABASE_URL,
    OWNER_USER_KEY: "test-owner",
    DATABASE_POOL_MAX: 2,
    DATABASE_SSL: false,
    TOKEN_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    SPOTIFY_CLIENT_ID: "spotify-id",
    SPOTIFY_CLIENT_SECRET: "spotify-secret",
    GOOGLE_CLIENT_ID: "google-id",
    GOOGLE_CLIENT_SECRET: "google-secret",
    YOUTUBE_API_KEY: "youtube-key",
    YOUTUBE_PLAYLIST_ID: undefined,
    YOUTUBE_PLAYLIST_TITLE: "Playlist",
    YOUTUBE_PLAYLIST_DESCRIPTION: "Desc",
    YOUTUBE_PLAYLIST_PRIVACY: "unlisted",
    YOUTUBE_DAILY_QUOTA_LIMIT: 10_000,
    YOUTUBE_SEARCH_PROVIDER: "hybrid",
    SYNC_LOCK_TTL_MINUTES: 55,
    SCHEDULER_POLL_INTERVAL_MS: 60_000,
    SPOTIFY_PAGE_SIZE: 50,
    YOUTUBE_FALLBACK_RESULT_LIMIT: 5,
    MATCH_THRESHOLD: 65,
    appBaseUrl: "http://127.0.0.1:3000",
    spotifyRedirectUri: "http://127.0.0.1:3000/auth/spotify/callback",
    youtubeRedirectUri: "http://127.0.0.1:3000/auth/youtube/callback",
    syncLockTtlMs: 55 * 60 * 1000,
    isProduction: false,
    ...overrides,
  };
}

async function applySqlMigrations(client: PGlite, migrationDirectoryPath: string) {
  const entries = (await fs.readdir(migrationDirectoryPath))
    .filter((entry) => entry.endsWith(".sql"))
    .sort((left, right) => left.localeCompare(right));

  for (const entry of entries) {
    const sql = await fs.readFile(path.join(migrationDirectoryPath, entry), "utf8");
    const statements = sql
      .split(/;\s*\r?\n/)
      .map((statement) => statement.trim())
      .filter(Boolean);

    for (const statement of statements) {
      await client.query(statement);
    }
  }
}
