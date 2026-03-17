import { ExternalApiError, QuotaExceededError } from "../../lib/errors.js";
import { requestJson } from "../../lib/http.js";
import type { AppConfig } from "../../config.js";
import type { SearchCandidate } from "../../types.js";

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API_BASE_URL = "https://www.googleapis.com/youtube/v3";

interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type: string;
}

interface ChannelListResponse {
  items: Array<{
    id: string;
    snippet?: {
      title?: string;
    };
  }>;
}

interface PlaylistListItemResponse {
  nextPageToken?: string;
  items: Array<{
    id: string;
    contentDetails?: {
      videoId?: string;
    };
    snippet?: {
      position?: number;
      title?: string;
      videoOwnerChannelTitle?: string;
      channelTitle?: string;
    };
  }>;
}

interface PlaylistInsertResponse {
  id: string;
}

interface SearchListResponse {
  items: Array<{
    id?: {
      videoId?: string;
    };
    snippet?: {
      title?: string;
      channelTitle?: string;
      description?: string;
      publishedAt?: string;
    };
  }>;
}

interface VideosListResponse {
  items: Array<{
    id: string;
    snippet?: {
      title?: string;
      channelTitle?: string;
      description?: string;
      publishedAt?: string;
    };
    contentDetails?: {
      duration?: string;
    };
    status?: {
      embeddable?: boolean;
      license?: string;
      privacyStatus?: string;
    };
  }>;
}

export class YouTubeClient {
  constructor(private readonly config: AppConfig) {}

  buildAuthorizationUrl(state: string) {
    const url = new URL(AUTHORIZE_URL);
    url.searchParams.set("client_id", this.config.GOOGLE_CLIENT_ID);
    url.searchParams.set("redirect_uri", this.config.youtubeRedirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("scope", "https://www.googleapis.com/auth/youtube.force-ssl");
    url.searchParams.set("state", state);
    return url.toString();
  }

  async exchangeCodeForToken(code: string) {
    return this.requestToken({
      code,
      client_id: this.config.GOOGLE_CLIENT_ID,
      client_secret: this.config.GOOGLE_CLIENT_SECRET,
      redirect_uri: this.config.youtubeRedirectUri,
      grant_type: "authorization_code",
    });
  }

  async refreshAccessToken(refreshToken: string) {
    return this.requestToken({
      client_id: this.config.GOOGLE_CLIENT_ID,
      client_secret: this.config.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    });
  }

  async getCurrentChannel(accessToken: string) {
    const response = await this.requestAuthed<ChannelListResponse>(
      `${API_BASE_URL}/channels?part=id,snippet&mine=true`,
      accessToken,
    );

    const channel = response.items[0];
    return {
      id: channel?.id ?? null,
      displayName: channel?.snippet?.title ?? channel?.id ?? null,
    };
  }

  async searchVideos(query: string, limit: number) {
    const url = new URL(`${API_BASE_URL}/search`);
    url.searchParams.set("key", this.config.YOUTUBE_API_KEY);
    url.searchParams.set("part", "snippet");
    url.searchParams.set("type", "video");
    url.searchParams.set("maxResults", String(limit));
    url.searchParams.set("q", query);
    url.searchParams.set("videoCategoryId", "10");
    url.searchParams.set("videoEmbeddable", "true");

    const response = await this.requestWithQuota<SearchListResponse>(url.toString());

    const candidates: SearchCandidate[] = [];
    for (const item of response.items) {
      const videoId = item.id?.videoId;
      if (!videoId) {
        continue;
      }

      candidates.push({
        videoId,
        title: item.snippet?.title ?? videoId,
        channelTitle: item.snippet?.channelTitle ?? "",
        description: item.snippet?.description ?? "",
        publishedAt: item.snippet?.publishedAt,
        source: "youtube_api",
        url: `https://www.youtube.com/watch?v=${videoId}`,
      });
    }

    return candidates;
  }

  async getVideos(videoIds: string[]) {
    if (videoIds.length === 0) {
      return [];
    }

    const url = new URL(`${API_BASE_URL}/videos`);
    url.searchParams.set("key", this.config.YOUTUBE_API_KEY);
    url.searchParams.set("part", "snippet,contentDetails,status");
    url.searchParams.set("id", videoIds.join(","));
    url.searchParams.set("maxResults", String(videoIds.length));

    const response = await this.requestWithQuota<VideosListResponse>(url.toString());

    return response.items.map((item) => ({
      videoId: item.id,
      title: item.snippet?.title ?? item.id,
      channelTitle: item.snippet?.channelTitle ?? "",
      description: item.snippet?.description ?? "",
      publishedAt: item.snippet?.publishedAt,
      durationSeconds: parseIsoDuration(item.contentDetails?.duration),
      isEmbeddable: item.status?.embeddable ?? true,
      isSyndicated: item.status?.privacyStatus !== "private",
      source: "youtube_api" as const,
      url: `https://www.youtube.com/watch?v=${item.id}`,
    }));
  }

  async listPlaylistItems(accessToken: string, playlistId: string) {
    const items: Array<{
      playlistItemId: string;
      videoId: string;
      videoTitle: string | null;
      channelTitle: string | null;
      position: number | null;
    }> = [];

    let pageToken: string | undefined;

    do {
      const url = new URL(`${API_BASE_URL}/playlistItems`);
      url.searchParams.set("part", "snippet,contentDetails,status");
      url.searchParams.set("playlistId", playlistId);
      url.searchParams.set("maxResults", "50");
      if (pageToken) {
        url.searchParams.set("pageToken", pageToken);
      }

      const response = await this.requestAuthed<PlaylistListItemResponse>(url.toString(), accessToken);
      for (const item of response.items) {
        const videoId = item.contentDetails?.videoId;
        if (!videoId) {
          continue;
        }

        items.push({
          playlistItemId: item.id,
          videoId,
          videoTitle: item.snippet?.title ?? null,
          channelTitle: item.snippet?.videoOwnerChannelTitle ?? item.snippet?.channelTitle ?? null,
          position: item.snippet?.position ?? null,
        });
      }

      pageToken = response.nextPageToken;
    } while (pageToken);

    return items;
  }

  async createPlaylist(accessToken: string, title: string, description: string, privacyStatus: string) {
    const response = await this.requestAuthed<PlaylistInsertResponse>(
      `${API_BASE_URL}/playlists?part=snippet,status`,
      accessToken,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          snippet: {
            title,
            description,
          },
          status: {
            privacyStatus,
          },
        }),
      },
    );

    return response.id;
  }

  async insertPlaylistItem(accessToken: string, playlistId: string, videoId: string) {
    const response = await this.requestAuthed<PlaylistInsertResponse>(
      `${API_BASE_URL}/playlistItems?part=snippet`,
      accessToken,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          snippet: {
            playlistId,
            resourceId: {
              kind: "youtube#video",
              videoId,
            },
          },
        }),
      },
    );

    return response.id;
  }

  private async requestToken(payload: Record<string, string>) {
    return requestJson<GoogleTokenResponse>(TOKEN_URL, {
      provider: "youtube",
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(payload).toString(),
      retries: 0,
    });
  }

  private async requestAuthed<T>(url: string, accessToken: string, init: RequestInit = {}) {
    try {
      return await requestJson<T>(url, {
        provider: "youtube",
        ...init,
        headers: {
          authorization: `Bearer ${accessToken}`,
          ...(init.headers ?? {}),
        },
      });
    } catch (error) {
      maybeThrowQuota(error);
      throw error;
    }
  }

  private async requestWithQuota<T>(url: string) {
    try {
      return await requestJson<T>(url, {
        provider: "youtube",
      });
    } catch (error) {
      maybeThrowQuota(error);
      throw error;
    }
  }
}

function maybeThrowQuota(error: unknown): never | void {
  if (error instanceof QuotaExceededError) {
    throw error;
  }

  if (error instanceof ExternalApiError) {
    const reasonCode = error.reasonCode?.toLowerCase();
    const isQuotaLike =
      reasonCode === "quotaexceeded" ||
      reasonCode === "dailylimitexceeded" ||
      reasonCode === "ratelimitexceeded" ||
      reasonCode === "userratelimitexceeded" ||
      reasonCode === "servinglimitexceeded" ||
      /quota/i.test(error.message);

    if (isQuotaLike) {
      throw new QuotaExceededError(error.message, error.retryAfterSeconds, error.reasonCode);
    }
  }

  if (error instanceof Error && /quota/i.test(error.message)) {
    throw new QuotaExceededError(error.message);
  }
}

function parseIsoDuration(value?: string) {
  if (!value) {
    return undefined;
  }

  const match =
    /^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i.exec(value) ??
    /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i.exec(value);

  if (!match) {
    return undefined;
  }

  const [, days, hours, minutes, seconds] = match;
  return (
    Number(days ?? 0) * 86400 +
    Number(hours ?? 0) * 3600 +
    Number(minutes ?? 0) * 60 +
    Number(seconds ?? 0)
  );
}
