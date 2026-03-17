import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { AppContext } from "../app.js";
import { AppError, ValidationError } from "../lib/errors.js";
import { renderDashboard } from "../views/dashboard.js";

type FlashLevel = "success" | "error";

export async function registerRoutes(app: FastifyInstance, context: AppContext) {
  const basicAuthGuard = app.basicAuth;
  const redirectWithFlash = (reply: FastifyReply, message: string, level: FlashLevel = "success") =>
    reply.redirect(`/?message=${encodeURIComponent(message)}&level=${encodeURIComponent(level)}`);

  const handleDashboardAction = async <T>(
    reply: FastifyReply,
    action: () => Promise<T> | T,
    onSuccess: (result: T) => string,
  ) => {
    try {
      const result = await action();
      return redirectWithFlash(reply, onSuccess(result), "success");
    } catch (error) {
      if (error instanceof AppError) {
        return redirectWithFlash(reply, error.message, "error");
      }

      throw error;
    }
  };

  const syncSecretGuard = async (request: FastifyRequest, reply: FastifyReply) => {
    const authorization = request.headers.authorization;
    if (authorization !== `Bearer ${context.config.SYNC_TRIGGER_SECRET}`) {
      return reply.status(401).send({ error: "Unauthorized" });
    }
  };

  app.get("/", { onRequest: basicAuthGuard }, async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const message = typeof query.message === "string" ? query.message : undefined;
    const messageLevel: FlashLevel = query.level === "error" ? "error" : "success";
    const [summary, accounts] = await Promise.all([
      context.store.getDashboardSummary(),
      context.store.listOAuthAccounts(),
    ]);

    const html = renderDashboard({
      ...(message ? { message } : {}),
      ...(message ? { messageLevel } : {}),
      summary,
      accounts: accounts.map((account: any) => ({
        provider: account.provider,
        externalDisplayName: account.externalDisplayName,
        invalidatedAt: account.invalidatedAt,
        lastRefreshError: account.lastRefreshError,
      })),
    });

    reply.type("text/html; charset=utf-8").send(html);
  });

  app.get("/auth/spotify/start", { onRequest: basicAuthGuard }, async (_request, reply) => {
    const url = await context.oauthService.createAuthorizationUrl("spotify");
    return reply.redirect(url);
  });

  app.get("/auth/youtube/start", { onRequest: basicAuthGuard }, async (_request, reply) => {
    const url = await context.oauthService.createAuthorizationUrl("youtube");
    return reply.redirect(url);
  });

  app.get("/auth/spotify/callback", { onRequest: basicAuthGuard }, async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    if (query.error) {
      throw new AppError(`Spotify 인증에 실패했습니다: ${query.error}`, 400);
    }
    if (!query.code || !query.state) {
      throw new ValidationError("Spotify 콜백에 code 또는 state가 없습니다.");
    }

    await context.oauthService.handleSpotifyCallback(query.code, query.state);
    return redirectWithFlash(reply, "Spotify 계정이 연결되었습니다.");
  });

  app.get("/auth/youtube/callback", { onRequest: basicAuthGuard }, async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    if (query.error) {
      throw new AppError(`YouTube 인증에 실패했습니다: ${query.error}`, 400);
    }
    if (!query.code || !query.state) {
      throw new ValidationError("YouTube 콜백에 code 또는 state가 없습니다.");
    }

    await context.oauthService.handleYouTubeCallback(query.code, query.state);
    return redirectWithFlash(reply, "YouTube 계정이 연결되었습니다.");
  });

  app.post("/admin/sync", { onRequest: basicAuthGuard }, async (_request, reply) => {
    await context.syncService.run("manual");
    return redirectWithFlash(reply, "동기화를 완료했습니다.");
  });

  app.post(
    "/admin/connections/spotify/disconnect",
    { onRequest: basicAuthGuard },
    async (_request, reply) =>
      handleDashboardAction(
        reply,
        () => context.accountManagementService.disconnectSpotify(),
        (result) =>
          result.alreadyDisconnected
            ? "Spotify 계정은 이미 연결 해제된 상태입니다."
            : "Spotify 연결을 해제했습니다. Spotify 계정을 다시 연결하기 전까지 동기화는 진행되지 않습니다.",
      ),
  );

  app.post(
    "/admin/connections/youtube/disconnect",
    { onRequest: basicAuthGuard },
    async (_request, reply) =>
      handleDashboardAction(
        reply,
        () => context.accountManagementService.disconnectYouTube(),
        (result) =>
          result.alreadyDisconnected
            ? "YouTube 계정은 이미 연결 해제된 상태입니다."
            : "YouTube 연결을 해제했습니다. 관리 중이던 재생목록 상태도 함께 초기화되었습니다.",
      ),
  );

  app.post("/admin/reset", { onRequest: basicAuthGuard }, async (request, reply) => {
    const body = request.body as { confirmationText?: string } | undefined;
    if (body?.confirmationText !== "RESET") {
      return redirectWithFlash(reply, "전체 초기화를 진행하려면 RESET을 정확히 입력해 주세요.", "error");
    }

    return handleDashboardAction(
      reply,
      () => context.accountManagementService.resetAll(),
      () => "프로젝트 상태를 전체 초기화했습니다. 처음 연결하는 상태로 돌아갔습니다.",
    );
  });

  app.post(
    "/admin/tracks/:spotifyTrackId/review/accept",
    { onRequest: basicAuthGuard },
    async (request, reply) =>
      handleDashboardAction(
        reply,
        async () => {
          const params = request.params as { spotifyTrackId: string };
          return context.trackReviewService.acceptRecommendation(params.spotifyTrackId);
        },
        (result) => result.alreadySelected ? "이미 추천 영상을 사용 중입니다." : "추천 영상을 확정했습니다.",
      ),
  );

  app.post(
    "/admin/tracks/:spotifyTrackId/review/manual",
    { onRequest: basicAuthGuard },
    async (request, reply) =>
      handleDashboardAction(
        reply,
        async () => {
          const params = request.params as { spotifyTrackId: string };
          const body = request.body as { videoInput?: string };
          return context.trackReviewService.saveManualSelection(
            params.spotifyTrackId,
            body.videoInput ?? "",
          );
        },
        (result) => result.alreadySelected ? "같은 YouTube 영상을 이미 저장했습니다." : "수동 지정을 저장했습니다.",
      ),
  );

  app.post(
    "/admin/tracks/:spotifyTrackId/override",
    { onRequest: basicAuthGuard },
    async (request, reply) =>
      handleDashboardAction(
        reply,
        async () => {
          const params = request.params as { spotifyTrackId: string };
          const body = request.body as { videoInput?: string };
          return context.trackReviewService.saveManualSelection(
            params.spotifyTrackId,
            body.videoInput ?? "",
          );
        },
        (result) => result.alreadySelected ? "같은 YouTube 영상을 이미 저장했습니다." : "수동 지정을 저장했습니다.",
      ),
  );

  app.post("/internal/sync", { onRequest: syncSecretGuard }, async () => {
    const result = await context.syncService.run("schedule");
    return {
      ok: true,
      ...result,
    };
  });
}
