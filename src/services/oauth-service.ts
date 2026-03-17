import { TokenCipher } from "../lib/crypto.js";
import { AppError } from "../lib/errors.js";
import { SpotifyClient } from "../providers/spotify/client.js";
import { YouTubeClient } from "../providers/youtube/client.js";
import type { AppConfig } from "../config.js";
import type { Provider } from "../types.js";
import type { AppStore } from "../db/store.js";

const REFRESH_BUFFER_MS = 60_000;

export class OAuthService {
  private readonly cipher: TokenCipher;
  private readonly spotifyClient: SpotifyClient;
  private readonly youtubeClient: YouTubeClient;

  constructor(
    private readonly config: AppConfig,
    private readonly store: AppStore,
  ) {
    this.cipher = new TokenCipher(config.TOKEN_ENCRYPTION_KEY);
    this.spotifyClient = new SpotifyClient(config);
    this.youtubeClient = new YouTubeClient(config);
  }

  getSpotifyClient() {
    return this.spotifyClient;
  }

  getYouTubeClient() {
    return this.youtubeClient;
  }

  async createAuthorizationUrl(provider: Provider) {
    await this.store.cleanupExpiredStates();
    const state = await this.store.createOAuthState(provider);
    if (provider === "spotify") {
      return this.spotifyClient.buildAuthorizationUrl(state);
    }
    return this.youtubeClient.buildAuthorizationUrl(state);
  }

  async handleSpotifyCallback(code: string, state: string) {
    if (!(await this.store.consumeOAuthState("spotify", state))) {
      throw new AppError("Invalid or expired Spotify OAuth state", 400);
    }

    const token = await this.spotifyClient.exchangeCodeForToken(code);
    const profile = await this.spotifyClient.getCurrentUser(token.access_token);
    await this.store.upsertOAuthAccount({
      provider: "spotify",
      encryptedAccessToken: this.cipher.encrypt(token.access_token),
      encryptedRefreshToken: token.refresh_token ? this.cipher.encrypt(token.refresh_token) : null,
      tokenExpiresAt: Date.now() + token.expires_in * 1000 - REFRESH_BUFFER_MS,
      scope: token.scope ?? null,
      externalUserId: profile.id,
      externalDisplayName: profile.displayName,
    });
  }

  async handleYouTubeCallback(code: string, state: string) {
    if (!(await this.store.consumeOAuthState("youtube", state))) {
      throw new AppError("Invalid or expired YouTube OAuth state", 400);
    }

    const token = await this.youtubeClient.exchangeCodeForToken(code);
    const channel = await this.youtubeClient.getCurrentChannel(token.access_token);
    await this.store.upsertOAuthAccount({
      provider: "youtube",
      encryptedAccessToken: this.cipher.encrypt(token.access_token),
      encryptedRefreshToken: token.refresh_token ? this.cipher.encrypt(token.refresh_token) : null,
      tokenExpiresAt: Date.now() + token.expires_in * 1000 - REFRESH_BUFFER_MS,
      scope: token.scope ?? null,
      externalUserId: channel.id,
      externalDisplayName: channel.displayName,
    });
  }

  async getValidAccessToken(provider: Provider) {
    const account = await this.store.getOAuthAccount(provider);
    if (!account) {
      throw new AppError(`${provider} account is not connected`, 400);
    }

    if (account.invalidatedAt) {
      throw new AppError(`${provider} account needs to be reconnected`, 400);
    }

    if (!account.tokenExpiresAt || account.tokenExpiresAt > Date.now()) {
      return this.cipher.decrypt(account.encryptedAccessToken);
    }

    const refreshToken = account.encryptedRefreshToken
      ? this.cipher.decrypt(account.encryptedRefreshToken)
      : null;

    if (!refreshToken) {
      await this.store.markOAuthAccountInvalid(provider, "Missing refresh token");
      throw new AppError(`${provider} account cannot be refreshed`, 400);
    }

    try {
      if (provider === "spotify") {
        const refreshed = await this.spotifyClient.refreshAccessToken(refreshToken);
        await this.store.upsertOAuthAccount({
          provider,
          encryptedAccessToken: this.cipher.encrypt(refreshed.access_token),
          encryptedRefreshToken: refreshed.refresh_token
            ? this.cipher.encrypt(refreshed.refresh_token)
            : account.encryptedRefreshToken,
          tokenExpiresAt: Date.now() + refreshed.expires_in * 1000 - REFRESH_BUFFER_MS,
          scope: refreshed.scope ?? account.scope,
          externalUserId: account.externalUserId,
          externalDisplayName: account.externalDisplayName,
        });
        return refreshed.access_token;
      }

      const refreshed = await this.youtubeClient.refreshAccessToken(refreshToken);
      await this.store.upsertOAuthAccount({
        provider,
        encryptedAccessToken: this.cipher.encrypt(refreshed.access_token),
        encryptedRefreshToken: refreshed.refresh_token
          ? this.cipher.encrypt(refreshed.refresh_token)
          : account.encryptedRefreshToken,
        tokenExpiresAt: Date.now() + refreshed.expires_in * 1000 - REFRESH_BUFFER_MS,
        scope: refreshed.scope ?? account.scope,
        externalUserId: account.externalUserId,
        externalDisplayName: account.externalDisplayName,
      });
      return refreshed.access_token;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.store.markOAuthAccountInvalid(provider, message);
      throw new AppError(`${provider} account refresh failed: ${message}`, 400);
    }
  }
}
