import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { AppContext } from "../app.js";
import { AppError, ValidationError } from "../lib/errors.js";
import { parseCookies } from "../lib/cookies.js";
import {
  createLanguageCookie,
  decodeFlashPayload,
  getDefaultLanguage,
  normalizeLanguage,
  t,
  type FlashPayload,
} from "../lib/i18n.js";
import { LocalizedError } from "../lib/localized-error.js";
import { renderDashboard, renderDashboardSections } from "../views/dashboard.js";

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
  const redirectWithFlash = (
    reply: FastifyReply,
    payload: FlashPayload,
  ) =>
    reply.redirect(
      `/?messageKey=${encodeURIComponent(payload.key)}&level=${encodeURIComponent(payload.level ?? "success")}&messageParams=${encodeURIComponent(JSON.stringify(payload.params ?? {}))}`,
    );

  const handleDashboardAction = async <T>(
    request: FastifyRequest,
    reply: FastifyReply,
    action: () => Promise<T> | T,
    onSuccess: (result: T) => FlashPayload,
  ) => {
    try {
      const result = await action();
      return redirectWithFlash(reply, onSuccess(result));
    } catch (error) {
      if (error instanceof AppError) {
        return redirectWithFlash(reply, getFlashFromError(error, request));
      }

      throw error;
    }
  };

  app.get("/", { onRequest: basicAuthGuard }, async (request, reply) => {
    const language = getRequestLanguage(request);
    const query = request.query as Record<string, unknown>;
    const flashPayload = decodeFlashPayload(query);
    const payload = await buildDashboardPayload(context, language);

    const html = renderDashboard({
      language,
      summary: payload.summary,
      accounts: payload.accounts,
      message: flashPayload ? t(language, flashPayload.key, flashPayload.params) : undefined,
      messageLevel: flashPayload?.level ?? "success",
    });

    reply.type("text/html; charset=utf-8").send(html);
  });

  app.get("/api/dashboard/live", { onRequest: basicAuthGuard }, async (request) => {
    const language = getRequestLanguage(request);
    const payload = await buildDashboardPayload(context, language);

    return {
      ...payload,
      language,
      sections: renderDashboardSections({
        language,
        summary: payload.summary,
        accounts: payload.accounts,
      }),
    };
  });

  app.post("/api/preferences/language", { onRequest: basicAuthGuard }, async (request, reply) => {
    const body = request.body as { language?: string } | undefined;
    const language = normalizeLanguage(body?.language);

    reply.header("set-cookie", createLanguageCookie(language));
    return {
      ok: true,
      language,
    };
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
      return redirectWithFlash(reply, {
        key: "message.spotifyAuthFailed",
        level: "error",
        params: { reason: query.error },
      });
    }
    if (!query.code || !query.state) {
      return redirectWithFlash(reply, {
        key: "message.invalidSpotifyCallback",
        level: "error",
      });
    }

    await context.oauthService.handleSpotifyCallback(query.code, query.state);
    return redirectWithFlash(reply, { key: "message.spotifyConnected", level: "success" });
  });

  app.get("/auth/youtube/callback", { onRequest: basicAuthGuard }, async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    if (query.error) {
      return redirectWithFlash(reply, {
        key: "message.youtubeAuthFailed",
        level: "error",
        params: { reason: query.error },
      });
    }
    if (!query.code || !query.state) {
      return redirectWithFlash(reply, {
        key: "message.invalidYouTubeCallback",
        level: "error",
      });
    }

    await context.oauthService.handleYouTubeCallback(query.code, query.state);
    return redirectWithFlash(reply, { key: "message.youtubeConnected", level: "success" });
  });

  app.post("/admin/sync", { onRequest: basicAuthGuard }, async (request, reply) => {
    try {
      const result = await context.syncService.run("manual");
      return redirectWithFlash(reply, formatSyncFlashMessage(result));
    } catch (error) {
      if (error instanceof AppError) {
        return redirectWithFlash(reply, getFlashFromError(error, request));
      }

      throw error;
    }
  });

  app.post(
    "/admin/connections/spotify/disconnect",
    { onRequest: basicAuthGuard },
    async (request, reply) =>
      handleDashboardAction(
        request,
        reply,
        () => context.accountManagementService.disconnectSpotify(),
        (result) => ({
          key: result.alreadyDisconnected
            ? "message.spotifyAlreadyDisconnected"
            : "message.spotifyDisconnected",
          level: "success",
        }),
      ),
  );

  app.post(
    "/admin/connections/youtube/disconnect",
    { onRequest: basicAuthGuard },
    async (request, reply) =>
      handleDashboardAction(
        request,
        reply,
        () => context.accountManagementService.disconnectYouTube(),
        (result) => ({
          key: result.alreadyDisconnected
            ? "message.youtubeAlreadyDisconnected"
            : "message.youtubeDisconnected",
          level: "success",
        }),
      ),
  );

  app.post("/admin/reset", { onRequest: basicAuthGuard }, async (request, reply) => {
    const body = request.body as { confirmationText?: string } | undefined;
    if (body?.confirmationText !== "RESET") {
      return redirectWithFlash(reply, {
        key: "message.resetNeedsConfirmation",
        level: "error",
      });
    }

    return handleDashboardAction(
      request,
      reply,
      () => context.accountManagementService.resetAll(),
      () => ({
        key: "message.resetConfirmed",
        level: "success",
      }),
    );
  });

  app.post(
    "/admin/tracks/:spotifyTrackId/review/accept",
    { onRequest: basicAuthGuard },
    async (request, reply) =>
      handleDashboardAction(
        request,
        reply,
        async () => {
          const params = request.params as { spotifyTrackId: string };
          return context.trackReviewService.acceptRecommendation(params.spotifyTrackId);
        },
        (result) => ({
          key: result.alreadySelected
            ? "message.recommendationAlreadySelected"
            : "message.recommendationAccepted",
          level: "success",
        }),
      ),
  );

  app.post(
    "/admin/tracks/:spotifyTrackId/review/manual",
    { onRequest: basicAuthGuard },
    async (request, reply) =>
      handleDashboardAction(
        request,
        reply,
        async () => {
          const params = request.params as { spotifyTrackId: string };
          const body = request.body as { videoInput?: string };
          return context.trackReviewService.saveManualSelection(params.spotifyTrackId, body.videoInput ?? "");
        },
        (result) => ({
          key: result.alreadySelected
            ? "message.manualSelectionAlreadySelected"
            : "message.manualSelectionSaved",
          level: "success",
        }),
      ),
  );

  app.post(
    "/admin/tracks/:spotifyTrackId/override",
    { onRequest: basicAuthGuard },
    async (request, reply) =>
      handleDashboardAction(
        request,
        reply,
        async () => {
          const params = request.params as { spotifyTrackId: string };
          const body = request.body as { videoInput?: string };
          return context.trackReviewService.saveManualSelection(params.spotifyTrackId, body.videoInput ?? "");
        },
        (result) => ({
          key: result.alreadySelected
            ? "message.manualSelectionAlreadySelected"
            : "message.manualSelectionSaved",
          level: "success",
        }),
      ),
  );
}

async function buildDashboardPayload(context: AppContext, language: "ko" | "en") {
  const [summary, accounts] = await Promise.all([
    context.store.getDashboardLiveData(),
    context.store.listOAuthAccounts(),
  ]);

  return {
    language,
    summary,
    accounts: accounts.map((account: any) => ({
      provider: account.provider,
      externalDisplayName: account.externalDisplayName,
      invalidatedAt: account.invalidatedAt,
      lastRefreshError: account.lastRefreshError,
    })),
  };
}

function getRequestLanguage(request: FastifyRequest) {
  const query = request.query as Record<string, unknown> | undefined;
  const queryLanguage =
    query && typeof query.language === "string" ? query.language : undefined;
  if (queryLanguage) {
    return normalizeLanguage(queryLanguage);
  }

  const cookies = parseCookies(request.headers.cookie);
  return normalizeLanguage(cookies.dashboard_lang ?? getDefaultLanguage());
}

function formatSyncFlashMessage(result: { status: string; disposition?: string }): FlashPayload {
  if (result.disposition === "already_running") {
    return { key: "sync.alreadyRunning", level: "success" };
  }

  if (result.status === "waiting_for_youtube_quota") {
    return { key: "sync.waitingYoutubeQuota", level: "success" };
  }

  if (result.status === "waiting_for_spotify_retry") {
    return { key: "sync.waitingSpotifyRetry", level: "success" };
  }

  if (result.status === "needs_reauth") {
    return { key: "sync.needsReauth", level: "error" };
  }

  if (result.status === "partially_completed") {
    return { key: "sync.partiallyCompleted", level: "success" };
  }

  if (result.status === "completed") {
    return {
      key: result.disposition === "resumed" ? "sync.resumed" : "sync.completed",
      level: "success",
    };
  }

  return {
    key: result.disposition === "resumed" ? "sync.resumed" : "sync.started",
    level: "success",
  };
}

function getFlashFromError(error: AppError, request: FastifyRequest): FlashPayload {
  if (error instanceof LocalizedError) {
    return {
      key: error.messageKey,
      level: "error",
      params: error.messageParams,
    };
  }

  const language = getRequestLanguage(request);
  return {
    key: inferFallbackErrorKey(error.message, language),
    level: "error",
    params: error.message ? { detail: error.message } : undefined,
  };
}

function inferFallbackErrorKey(message: string, language: "ko" | "en") {
  if (message.includes("playlist") && message.includes("access")) {
    return "message.playlistAccessIssue";
  }

  if (message.includes("lock") || message.includes("already running") || message.includes("already in progress")) {
    return "message.activeOperationConflict";
  }

  return language === "ko" ? "message.genericError" : "message.genericError";
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
