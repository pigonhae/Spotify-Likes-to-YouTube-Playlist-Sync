import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { AppContext } from "../app.js";
import { AppError, ValidationError } from "../lib/errors.js";
import { renderDashboard } from "../views/dashboard.js";

type FlashLevel = "success" | "error";
type TrackFilter =
  | "all"
  | "active"
  | "discovered"
  | "searching"
  | "matched"
  | "review_required"
  | "ready_to_insert"
  | "inserting"
  | "inserted"
  | "skipped_existing"
  | "waiting_for_youtube_quota"
  | "waiting_for_spotify_retry"
  | "needs_reauth"
  | "no_match"
  | "failed";

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

  app.get("/", { onRequest: basicAuthGuard }, async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const message = typeof query.message === "string" ? query.message : undefined;
    const messageLevel: FlashLevel = query.level === "error" ? "error" : "success";
    const [summary, accounts] = await Promise.all([
      context.store.getDashboardLiveData(),
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

  app.get("/api/dashboard/live", { onRequest: basicAuthGuard }, async () => {
    return context.store.getDashboardLiveData();
  });

  app.get("/api/sync-runs/:runId/tracks", { onRequest: basicAuthGuard }, async (request) => {
    const params = request.params as { runId: string };
    const query = request.query as {
      page?: string;
      pageSize?: string;
      filter?: string;
    };
    const runId = Number(params.runId);
    if (!Number.isInteger(runId) || runId <= 0) {
      throw new ValidationError("Invalid sync run id");
    }

    const page = query.page ? Number(query.page) : 1;
    const pageSize = query.pageSize ? Number(query.pageSize) : 50;
    const filter = isTrackFilter(query.filter) ? query.filter : "all";

    const [run, items, total] = await Promise.all([
      context.store.getSyncRun(runId),
      context.store.listSyncRunTracks(runId, { page, pageSize, filter }),
      context.store.countSyncRunTracks(runId, filter),
    ]);

    if (!run) {
      throw new AppError("Sync run not found", 404);
    }

    return {
      run,
      page,
      pageSize,
      total,
      items,
    };
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
      throw new AppError(`Spotify authorization failed: ${query.error}`, 400);
    }
    if (!query.code || !query.state) {
      throw new ValidationError("Spotify callback is missing code or state.");
    }

    await context.oauthService.handleSpotifyCallback(query.code, query.state);
    return redirectWithFlash(reply, "Spotify account connected.");
  });

  app.get("/auth/youtube/callback", { onRequest: basicAuthGuard }, async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    if (query.error) {
      throw new AppError(`YouTube authorization failed: ${query.error}`, 400);
    }
    if (!query.code || !query.state) {
      throw new ValidationError("YouTube callback is missing code or state.");
    }

    await context.oauthService.handleYouTubeCallback(query.code, query.state);
    return redirectWithFlash(reply, "YouTube account connected.");
  });

  app.post("/admin/sync", { onRequest: basicAuthGuard }, async (_request, reply) => {
    const result = await context.syncService.run("manual");
    return redirectWithFlash(reply, formatSyncFlashMessage(result), "success");
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
            ? "Spotify is already disconnected."
            : "Spotify disconnected. Sync will stay paused until Spotify is connected again.",
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
            ? "YouTube is already disconnected."
            : "YouTube disconnected. Managed playlist ownership data was cleared.",
      ),
  );

  app.post("/admin/reset", { onRequest: basicAuthGuard }, async (request, reply) => {
    const body = request.body as { confirmationText?: string } | undefined;
    if (body?.confirmationText !== "RESET") {
      return redirectWithFlash(reply, "Type RESET to confirm a full reset.", "error");
    }

    return handleDashboardAction(
      reply,
      () => context.accountManagementService.resetAll(),
      () => "All project state was reset.",
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
        (result) => result.alreadySelected ? "That recommendation is already selected." : "Recommendation accepted.",
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
          return context.trackReviewService.saveManualSelection(params.spotifyTrackId, body.videoInput ?? "");
        },
        (result) => result.alreadySelected ? "That YouTube video is already selected." : "Manual selection saved.",
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
          return context.trackReviewService.saveManualSelection(params.spotifyTrackId, body.videoInput ?? "");
        },
        (result) => result.alreadySelected ? "That YouTube video is already selected." : "Manual selection saved.",
      ),
  );
}

function formatSyncFlashMessage(result: { status: string }) {
  switch (result.status) {
    case "waiting_for_youtube_quota":
      return "Paused for YouTube quota. The run will resume automatically.";
    case "waiting_for_spotify_retry":
      return "Paused for Spotify retry. The run will resume automatically.";
    case "needs_reauth":
      return "Paused until Spotify or YouTube is reconnected.";
    case "partially_completed":
      return "Automatic processing finished, but some tracks still need review.";
    case "completed":
      return "Sync completed successfully.";
    default:
      return "Sync started.";
  }
}

function isTrackFilter(value: string | undefined): value is TrackFilter {
  return value !== undefined && [
    "all",
    "active",
    "discovered",
    "searching",
    "matched",
    "review_required",
    "ready_to_insert",
    "inserting",
    "inserted",
    "skipped_existing",
    "waiting_for_youtube_quota",
    "waiting_for_spotify_retry",
    "needs_reauth",
    "no_match",
    "failed",
  ].includes(value);
}
