import { Buffer } from "node:buffer";

import { ExternalApiError } from "../../lib/errors.js";
import { requestJson } from "../../lib/http.js";
import type { SpotifyTrack } from "../../types.js";
import type { AppConfig } from "../../config.js";

const AUTHORIZE_URL = "https://accounts.spotify.com/authorize";
const TOKEN_URL = "https://accounts.spotify.com/api/token";
const API_BASE_URL = "https://api.spotify.com/v1";

interface SpotifyTokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
  expires_in: number;
  refresh_token?: string;
}

interface SpotifyProfileResponse {
  id: string;
  display_name: string | null;
}

interface SpotifySavedTracksResponse {
  items: Array<{
    added_at: string;
    track: {
      id: string | null;
      name: string;
      duration_ms: number;
      external_urls?: {
        spotify?: string;
      };
      external_ids?: {
        isrc?: string;
      };
      album: {
        name: string;
        release_date?: string;
      };
      artists: Array<{
        name: string;
      }>;
    };
  }>;
  next: string | null;
}

export class SpotifyClient {
  constructor(private readonly config: AppConfig) {}

  buildAuthorizationUrl(state: string) {
    const url = new URL(AUTHORIZE_URL);
    url.searchParams.set("client_id", this.config.SPOTIFY_CLIENT_ID);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("redirect_uri", this.config.spotifyRedirectUri);
    url.searchParams.set("scope", "user-library-read");
    url.searchParams.set("state", state);
    return url.toString();
  }

  async exchangeCodeForToken(code: string) {
    return this.requestToken({
      grant_type: "authorization_code",
      code,
      redirect_uri: this.config.spotifyRedirectUri,
    });
  }

  async refreshAccessToken(refreshToken: string) {
    return this.requestToken({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });
  }

  async getCurrentUser(accessToken: string) {
    const response = await requestJson<SpotifyProfileResponse>(`${API_BASE_URL}/me`, {
      provider: "spotify",
      headers: {
        authorization: `Bearer ${accessToken}`,
      },
    });

    return {
      id: response.id,
      displayName: response.display_name ?? response.id,
    };
  }

  async getAllSavedTracks(accessToken: string) {
    const tracks: SpotifyTrack[] = [];
    let url: URL | null = new URL(`${API_BASE_URL}/me/tracks`);
    url.searchParams.set("limit", String(this.config.SPOTIFY_PAGE_SIZE));
    url.searchParams.set("offset", "0");

    while (url) {
      const response: SpotifySavedTracksResponse = await requestJson<SpotifySavedTracksResponse>(
        url.toString(),
        {
        provider: "spotify",
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      },
      );

      for (const item of response.items) {
        if (!item.track.id) {
          continue;
        }

        tracks.push({
          spotifyTrackId: item.track.id,
          name: item.track.name,
          artistNames: item.track.artists.map((artist: { name: string }) => artist.name),
          albumName: item.track.album.name,
          albumReleaseDate: item.track.album.release_date ?? null,
          durationMs: item.track.duration_ms,
          isrc: item.track.external_ids?.isrc ?? null,
          addedAt: new Date(item.added_at).getTime(),
          externalUrl: item.track.external_urls?.spotify ?? null,
        });
      }

      url = response.next ? new URL(response.next) : null;
    }

    return tracks;
  }

  private async requestToken(payload: Record<string, string>) {
    const response = await requestJson<SpotifyTokenResponse>(TOKEN_URL, {
      provider: "spotify",
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(
          `${this.config.SPOTIFY_CLIENT_ID}:${this.config.SPOTIFY_CLIENT_SECRET}`,
        ).toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(payload).toString(),
      retries: 0,
    });

    if (!response.access_token) {
      throw new ExternalApiError("Spotify token response did not include an access token", "spotify");
    }

    return response;
  }
}
