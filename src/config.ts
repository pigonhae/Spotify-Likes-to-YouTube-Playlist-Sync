import { config as loadEnv } from "dotenv";
import { z } from "zod";

loadEnv();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  APP_BASE_URL: z.string().url(),
  APP_BASIC_AUTH_USER: z.string().min(1),
  APP_BASIC_AUTH_PASS: z.string().min(1),
  DATABASE_PATH: z.string().min(1).default("./data/app.db"),
  TOKEN_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, "TOKEN_ENCRYPTION_KEY must be a 64-character hex string"),
  SPOTIFY_CLIENT_ID: z.string().min(1),
  SPOTIFY_CLIENT_SECRET: z.string().min(1),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  YOUTUBE_API_KEY: z.string().min(1),
  SYNC_TRIGGER_SECRET: z.string().min(24),
  YOUTUBE_PLAYLIST_ID: z.preprocess(
    (value) => {
      if (typeof value === "string" && value.trim() === "") {
        return undefined;
      }
      return value;
    },
    z.string().min(1).optional(),
  ),
  YOUTUBE_PLAYLIST_TITLE: z.string().min(1).default("Spotify Likes Sync"),
  YOUTUBE_PLAYLIST_DESCRIPTION: z
    .string()
    .default("Automatically synced from Spotify liked songs."),
  YOUTUBE_PLAYLIST_PRIVACY: z.enum(["public", "private", "unlisted"]).default("unlisted"),
  YOUTUBE_SEARCH_PROVIDER: z.enum(["hybrid", "official"]).default("hybrid"),
  SYNC_LOCK_TTL_MINUTES: z.coerce.number().int().positive().default(55),
  SPOTIFY_PAGE_SIZE: z.coerce.number().int().min(1).max(50).default(50),
  YOUTUBE_FALLBACK_RESULT_LIMIT: z.coerce.number().int().min(3).max(15).default(5),
  MATCH_THRESHOLD: z.coerce.number().int().min(1).max(100).default(65),
});

export interface AppConfig {
  NODE_ENV: "development" | "test" | "production";
  HOST: string;
  PORT: number;
  LOG_LEVEL: "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";
  APP_BASE_URL: string;
  APP_BASIC_AUTH_USER: string;
  APP_BASIC_AUTH_PASS: string;
  DATABASE_PATH: string;
  TOKEN_ENCRYPTION_KEY: string;
  SPOTIFY_CLIENT_ID: string;
  SPOTIFY_CLIENT_SECRET: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  YOUTUBE_API_KEY: string;
  SYNC_TRIGGER_SECRET: string;
  YOUTUBE_PLAYLIST_ID: string | undefined;
  YOUTUBE_PLAYLIST_TITLE: string;
  YOUTUBE_PLAYLIST_DESCRIPTION: string;
  YOUTUBE_PLAYLIST_PRIVACY: "public" | "private" | "unlisted";
  YOUTUBE_SEARCH_PROVIDER: "hybrid" | "official";
  SYNC_LOCK_TTL_MINUTES: number;
  SPOTIFY_PAGE_SIZE: number;
  YOUTUBE_FALLBACK_RESULT_LIMIT: number;
  MATCH_THRESHOLD: number;
  appBaseUrl: string;
  spotifyRedirectUri: string;
  youtubeRedirectUri: string;
  syncLockTtlMs: number;
  isProduction: boolean;
}

let cachedConfig: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const env = envSchema.parse(process.env);
  const appBaseUrl = env.APP_BASE_URL.replace(/\/+$/, "");

  cachedConfig = {
    ...env,
    YOUTUBE_PLAYLIST_ID: env.YOUTUBE_PLAYLIST_ID,
    appBaseUrl,
    spotifyRedirectUri: `${appBaseUrl}/auth/spotify/callback`,
    youtubeRedirectUri: `${appBaseUrl}/auth/youtube/callback`,
    syncLockTtlMs: env.SYNC_LOCK_TTL_MINUTES * 60 * 1000,
    isProduction: env.NODE_ENV === "production",
  };

  return cachedConfig!;
}
