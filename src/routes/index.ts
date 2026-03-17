import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { AppContext } from "../app.js";
import { AppError, ValidationError } from "../lib/errors.js";
import { extractYouTubeVideoId } from "../lib/youtube.js";
import { renderDashboard } from "../views/dashboard.js";

export async function registerRoutes(app: FastifyInstance, context: AppContext) {
  const basicAuthGuard = app.basicAuth;
  const redirectWithMessage = (reply: FastifyReply, message: string) =>
    reply.redirect(`/?message=${encodeURIComponent(message)}`);

  const syncSecretGuard = async (request: FastifyRequest, reply: FastifyReply) => {
    const authorization = request.headers.authorization;
    if (authorization !== `Bearer ${context.config.SYNC_TRIGGER_SECRET}`) {
      return reply.status(401).send({ error: "Unauthorized" });
    }
  };

  app.get("/", { onRequest: basicAuthGuard }, async (request, reply) => {
    const message = typeof (request.query as Record<string, unknown>).message === "string"
      ? String((request.query as Record<string, unknown>).message)
      : undefined;

    const html = renderDashboard({
      ...(message ? { message } : {}),
      summary: context.store.getDashboardSummary(),
      accounts: context.store.listOAuthAccounts().map((account) => ({
        provider: account.provider,
        externalDisplayName: account.externalDisplayName,
        invalidatedAt: account.invalidatedAt,
        lastRefreshError: account.lastRefreshError,
      })),
    });

    reply.type("text/html; charset=utf-8").send(html);
  });

  app.get("/auth/spotify/start", { onRequest: basicAuthGuard }, async (_request, reply) => {
    const url = context.oauthService.createAuthorizationUrl("spotify");
    return reply.redirect(url);
  });

  app.get("/auth/youtube/start", { onRequest: basicAuthGuard }, async (_request, reply) => {
    const url = context.oauthService.createAuthorizationUrl("youtube");
    return reply.redirect(url);
  });

  app.get("/auth/spotify/callback", { onRequest: basicAuthGuard }, async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    if (query.error) {
      throw new AppError(`Spotify 인증에 실패했습니다: ${query.error}`, 400);
    }
    if (!query.code || !query.state) {
      throw new ValidationError("Spotify 콜백에 code 또는 state가 없습니다");
    }

    await context.oauthService.handleSpotifyCallback(query.code, query.state);
    return redirectWithMessage(reply, "Spotify 계정이 연결되었습니다");
  });

  app.get("/auth/youtube/callback", { onRequest: basicAuthGuard }, async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    if (query.error) {
      throw new AppError(`YouTube 인증에 실패했습니다: ${query.error}`, 400);
    }
    if (!query.code || !query.state) {
      throw new ValidationError("YouTube 콜백에 code 또는 state가 없습니다");
    }

    await context.oauthService.handleYouTubeCallback(query.code, query.state);
    return redirectWithMessage(reply, "YouTube 계정이 연결되었습니다");
  });

  app.post("/admin/sync", { onRequest: basicAuthGuard }, async (_request, reply) => {
    await context.syncService.run("manual");
    return redirectWithMessage(reply, "동기화가 완료되었습니다");
  });

  app.post(
    "/admin/tracks/:spotifyTrackId/override",
    { onRequest: basicAuthGuard },
    async (request, reply) => {
      const params = request.params as { spotifyTrackId: string };
      const body = request.body as { videoInput?: string };
      const videoId = extractYouTubeVideoId(body.videoInput ?? "");

      if (!videoId) {
        throw new ValidationError("올바른 YouTube URL 또는 video ID를 입력해주세요");
      }

      const track = context.store.getTrackBySpotifyId(params.spotifyTrackId);
      if (!track) {
        throw new AppError("곡을 찾을 수 없습니다", 404);
      }

      context.store.setManualVideoId(params.spotifyTrackId, videoId);
      return redirectWithMessage(reply, "수동 지정이 저장되었습니다");
    },
  );

  app.post("/internal/sync", { onRequest: syncSecretGuard }, async () => {
    const result = await context.syncService.run("schedule");
    return {
      ok: true,
      ...result,
    };
  });
}
