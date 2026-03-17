import { describe, expect, it } from "vitest";

import {
  appSettings,
  oauthAccounts,
  oauthStates,
  playlistVideos,
  syncLock,
  syncRuns,
  trackMappings,
} from "../src/db/schema.js";
import { AppError } from "../src/lib/errors.js";
import { AccountManagementService } from "../src/services/account-management-service.js";
import { createTestConfig, createTestStore } from "./helpers/test-support.js";

describe("AccountManagementService", () => {
  it("disconnects Spotify without touching YouTube state", async () => {
    const { store, close } = await createTestStore();
    await seedOAuthAccount(store, "spotify");
    await seedOAuthAccount(store, "youtube");
    await store.createOAuthState("spotify");
    await store.createOAuthState("youtube");

    const service = new AccountManagementService(createTestConfig(), store);

    const first = await service.disconnectSpotify();
    const second = await service.disconnectSpotify();

    expect(first.alreadyDisconnected).toBe(false);
    expect(second.alreadyDisconnected).toBe(true);

    const providers = (await store.listOAuthAccounts()).map((account: any) => account.provider);
    expect(providers).toEqual(["youtube"]);
    expect(
      (await store.db.select().from(oauthStates)).map((row: any) => row.provider).sort(),
    ).toEqual(["youtube"]);

    await close();
  });

  it("disconnects YouTube and clears playlist ownership state while keeping matches", async () => {
    const { store, close } = await createTestStore();
    await seedOAuthAccount(store, "spotify");
    await seedOAuthAccount(store, "youtube");
    await store.createOAuthState("youtube");
    await store.saveManagedPlaylistId("playlist-123");
    await store.saveSpotifySnapshot([
      {
        spotifyTrackId: "spotify-track-1",
        name: "Track One",
        artistNames: ["Artist One"],
        albumName: "Album One",
        albumReleaseDate: "2024-01-01",
        durationMs: 180_000,
        isrc: null,
        addedAt: Date.parse("2026-03-17T00:00:00.000Z"),
        externalUrl: "https://open.spotify.com/track/spotify-track-1",
      },
    ]);
    await store.setManualVideoId("spotify-track-1", "dQw4w9WgXcQ");
    await store.markTrackInserted("spotify-track-1", "playlist-item-1");
    await store.replacePlaylistVideos("playlist-123", [
      {
        playlistItemId: "playlist-item-1",
        videoId: "dQw4w9WgXcQ",
        videoTitle: "Track One",
        channelTitle: "Artist One - Topic",
        position: 0,
      },
    ]);

    const service = new AccountManagementService(createTestConfig(), store);
    const result = await service.disconnectYouTube();

    expect(result.alreadyDisconnected).toBe(false);
    expect((await store.listOAuthAccounts()).map((account: any) => account.provider)).toEqual(["spotify"]);
    expect(await store.getManagedPlaylistId()).toBeNull();
    expect(await store.db.select().from(playlistVideos)).toHaveLength(0);

    const track = await store.getTrackBySpotifyId("spotify-track-1");
    expect(track?.manualVideoId).toBe("dQw4w9WgXcQ");
    expect(track?.matchedVideoId).toBe("dQw4w9WgXcQ");
    expect(track?.playlistVideoId).toBeNull();
    expect(track?.lastSyncedAt).toBeNull();

    await close();
  });

  it("resets all project state but leaves lock metadata alone", async () => {
    const { store, close } = await createTestStore();
    await seedOAuthAccount(store, "spotify");
    await seedOAuthAccount(store, "youtube");
    await store.createOAuthState("spotify");
    await store.saveManagedPlaylistId("playlist-123");
    await store.incrementDailyQuotaUsage("2026-03-17", 101);
    await store.saveSpotifySnapshot([
      {
        spotifyTrackId: "spotify-track-1",
        name: "Track One",
        artistNames: ["Artist One"],
        albumName: "Album One",
        albumReleaseDate: "2024-01-01",
        durationMs: 180_000,
        isrc: null,
        addedAt: Date.parse("2026-03-17T00:00:00.000Z"),
        externalUrl: "https://open.spotify.com/track/spotify-track-1",
      },
    ]);
    await store.replacePlaylistVideos("playlist-123", [
      {
        playlistItemId: "playlist-item-1",
        videoId: "dQw4w9WgXcQ",
        videoTitle: "Track One",
        channelTitle: "Artist One - Topic",
        position: 0,
      },
    ]);
    const runId = await store.createSyncRun("manual");
    await store.finishSyncRun(runId, "success", { ok: true });

    const service = new AccountManagementService(createTestConfig(), store);
    await service.resetAll();

    expect(await store.db.select().from(oauthAccounts)).toHaveLength(0);
    expect(await store.db.select().from(oauthStates)).toHaveLength(0);
    expect(await store.db.select().from(appSettings)).toHaveLength(0);
    expect(await store.db.select().from(trackMappings)).toHaveLength(0);
    expect(await store.db.select().from(playlistVideos)).toHaveLength(0);
    expect(await store.db.select().from(syncRuns)).toHaveLength(0);

    const locks = await store.db.select().from(syncLock);
    expect(locks).toHaveLength(1);
    expect(locks[0]?.holder).toBeNull();

    await close();
  });

  it("refuses destructive actions while the sync lock is held", async () => {
    const { store, close } = await createTestStore();
    await seedOAuthAccount(store, "spotify");

    const acquired = await store.acquireLock("hourly-sync", "foreign-holder", 60_000);
    expect(acquired).toBe(true);

    const service = new AccountManagementService(createTestConfig(), store);

    await expect(service.disconnectSpotify()).rejects.toThrowError(AppError);
    await expect(service.disconnectSpotify()).rejects.toThrowError(
      "Another sync or account operation is already running. Please wait and try again.",
    );

    await close();
  });
});

async function seedOAuthAccount(store: Awaited<ReturnType<typeof createTestStore>>["store"], provider: "spotify" | "youtube") {
  await store.upsertOAuthAccount({
    provider,
    encryptedAccessToken: `encrypted-${provider}-access-token`,
    encryptedRefreshToken: `encrypted-${provider}-refresh-token`,
    tokenExpiresAt: Date.now() + 60_000,
    scope: provider === "spotify" ? "user-library-read" : "youtube.force-ssl",
    externalUserId: `${provider}-user`,
    externalDisplayName: `${provider.toUpperCase()} User`,
  });
}
