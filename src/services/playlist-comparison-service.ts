import { ExternalApiError } from "../lib/errors.js";
import { LocalizedError } from "../lib/localized-error.js";
import type { AppConfig } from "../config.js";
import type { AppStore } from "../db/store.js";
import type { OAuthService } from "./oauth-service.js";
import type { QuotaService } from "./quota-service.js";
import type {
  ManualResolutionType,
  PlaylistComparisonBucket,
  PlaylistComparisonBucketPage,
  PlaylistComparisonItem,
  PlaylistComparisonReasonCode,
  PlaylistComparisonReasonSummary,
  PlaylistComparisonResult,
  SyncRunTrackStatus,
  TrackSearchStatus,
} from "../types.js";

const DEFAULT_BUCKET: PlaylistComparisonBucket = "spotify_only";
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 50;

interface ComparisonTrackRow {
  spotifyTrackId: string;
  spotifyAddedAt: number;
  spotifyRemovedAt: number | null;
  trackName: string;
  artistNames: string[];
  albumName: string | null;
  manualVideoId: string | null;
  manualResolutionType: ManualResolutionType | null;
  matchedVideoId: string | null;
  matchedVideoTitle: string | null;
  matchedChannelTitle: string | null;
  reviewVideoId: string | null;
  reviewVideoTitle: string | null;
  reviewChannelTitle: string | null;
  searchStatus: TrackSearchStatus;
  lastError: string | null;
  playlistVideoId: string | null;
  lastSyncedAt: number | null;
}

interface ComparisonRunTrackRow {
  status: SyncRunTrackStatus;
  statusMessage: string | null;
  manualVideoId: string | null;
  manualResolutionType: ManualResolutionType | null;
  matchedVideoId: string | null;
  matchedVideoTitle: string | null;
  matchedChannelTitle: string | null;
  reviewVideoId: string | null;
  reviewVideoTitle: string | null;
  reviewChannelTitle: string | null;
  playlistItemId: string | null;
  lastError: string | null;
}

interface ComparisonRequest {
  bucket?: string | null | undefined;
  page?: number | null | undefined;
  pageSize?: number | null | undefined;
}

export class PlaylistComparisonService {
  constructor(
    private readonly config: AppConfig,
    private readonly store: AppStore,
    private readonly oauthService: OAuthService,
    private readonly quotaService: QuotaService,
  ) {}

  async getComparison(input: ComparisonRequest = {}): Promise<PlaylistComparisonResult> {
    const bucket = normalizeBucket(input.bucket);
    const pageSize = normalizePageSize(input.pageSize);
    const requestedPage = normalizePage(input.page);

    const [
      playlistId,
      activeTrackRows,
      removedTrackRows,
      activeRun,
      librarySummary,
      accounts,
      storedSnapshotAt,
    ] = await Promise.all([
      this.getComparisonPlaylistId(),
      this.store.listTracksForSync(),
      this.store.listRemovedTracks(),
      this.store.getActiveSyncRun(),
      this.store.getLibrarySummary(),
      this.store.listOAuthAccounts(),
      this.store.getPlaylistSnapshotRefreshedAt(),
    ]);

    const activeTracks: ComparisonTrackRow[] = activeTrackRows.map(normalizeTrackRow);
    const removedTracks: ComparisonTrackRow[] = removedTrackRows.map(normalizeTrackRow);
    const youtubeConnected = accounts.some((account: any) => account.provider === "youtube" && !account.invalidatedAt);
    const activeRunTracks = activeRun ? await this.store.listAllSyncRunTracks(activeRun.id) : [];
    const runTrackMap = new Map<string, ComparisonRunTrackRow>(
      activeRunTracks.map((track: any) => [track.spotifyTrackId, normalizeRunTrackRow(track)]),
    );
    const playlistRows = playlistId ? await this.store.listPlaylistVideos(playlistId) : [];
    const lastPlaylistSnapshotAt =
      storedSnapshotAt ??
      playlistRows.reduce(
        (latest: number | null, row: any) => latest === null ? row.syncedAt : Math.max(latest, row.syncedAt),
        null as number | null,
      );

    const playlistVideoMap = new Map<string, any>(
      playlistRows.map((row: any) => [row.videoId, row]),
    );
    const activeTargetSet = new Set<string>();
    for (const track of activeTracks) {
      const overlay = runTrackMap.get(track.spotifyTrackId);
      const targetVideoId = selectTargetVideoId(track, overlay);
      if (targetVideoId) {
        activeTargetSet.add(targetVideoId);
      }
    }

    const removedTargetMap = new Map<string, ComparisonTrackRow>();
    for (const track of removedTracks) {
      const targetVideoId = selectTargetVideoId(track, null);
      if (targetVideoId && !removedTargetMap.has(targetVideoId)) {
        removedTargetMap.set(targetVideoId, track);
      }
    }

    const spotifyOnlyItems = activeTracks
      .filter((track: ComparisonTrackRow) => {
        const overlay = runTrackMap.get(track.spotifyTrackId);
        const targetVideoId = selectTargetVideoId(track, overlay);
        return !targetVideoId || !playlistVideoMap.has(targetVideoId);
      })
      .map((track: ComparisonTrackRow) => {
        const overlay = runTrackMap.get(track.spotifyTrackId);
        return buildSpotifyOnlyItem(track, overlay);
      });

    const inBothItems = activeTracks
      .filter((track: ComparisonTrackRow) => {
        const overlay = runTrackMap.get(track.spotifyTrackId);
        const targetVideoId = selectTargetVideoId(track, overlay);
        return Boolean(targetVideoId && playlistVideoMap.has(targetVideoId));
      })
      .map((track: ComparisonTrackRow) => {
        const overlay = runTrackMap.get(track.spotifyTrackId);
        const playlistVideo = playlistVideoMap.get(selectTargetVideoId(track, overlay)!);
        return buildInBothItem(track, overlay, playlistVideo);
      });

    const youtubeOnlyItems = playlistRows
      .filter((row: any) => !activeTargetSet.has(row.videoId))
      .map((row: any) => buildYouTubeOnlyItem(row, removedTargetMap.get(row.videoId) ?? null));

    const summary = {
      spotifyTotal: activeTracks.length,
      youtubeTotal: playlistRows.length,
      inBoth: inBothItems.length,
      spotifyOnly: spotifyOnlyItems.length,
      youtubeOnly: youtubeOnlyItems.length,
      countDelta: playlistRows.length - activeTracks.length,
      reflectedCount: librarySummary.syncedTracks,
      spotifyOnlyReasons: summarizeReasons(spotifyOnlyItems),
      youtubeOnlyReasons: summarizeReasons(youtubeOnlyItems),
    };

    const bucketItems =
      bucket === "spotify_only"
        ? spotifyOnlyItems
        : bucket === "youtube_only"
          ? youtubeOnlyItems
          : inBothItems;
    const bucketPage = paginateItems(bucketItems, bucket, requestedPage, pageSize);

    return {
      meta: {
        playlistId,
        spotifyBasis: "active_source_tracks",
        youtubeBasis: "stored_playlist_snapshot",
        lastPlaylistSnapshotAt,
        canRefresh: Boolean(playlistId && youtubeConnected && !activeRun),
        refreshBlockedReason:
          !playlistId
            ? "missing_playlist_id"
            : !youtubeConnected
              ? "youtube_not_connected"
              : activeRun
                ? "active_sync_run"
                : null,
        activeRunId: activeRun?.id ?? null,
        activeRunStatus: activeRun?.status ?? null,
      },
      summary,
      bucketPage,
    };
  }

  async refreshComparison(input: ComparisonRequest = {}) {
    const playlistId = await this.getComparisonPlaylistId();
    const activeRun = await this.store.getActiveSyncRun();
    if (activeRun) {
      throw new LocalizedError(
        "Finish or resume the current sync run before refreshing the playlist snapshot.",
        409,
        "message.comparisonRefreshBlockedBySync",
      );
    }

    if (!playlistId) {
      throw new LocalizedError(
        "There is no managed playlist ID to compare yet.",
        400,
        "message.comparisonNoPlaylist",
      );
    }

    const accounts = await this.store.listOAuthAccounts();
    const youtubeConnected = accounts.some((account: any) => account.provider === "youtube" && !account.invalidatedAt);
    if (!youtubeConnected) {
      throw new LocalizedError(
        "Connect YouTube before refreshing the stored playlist snapshot.",
        400,
        "message.comparisonYouTubeRequired",
      );
    }

    const youtubeToken = await this.oauthService.getValidAccessToken("youtube");
    const playlistItems = await this.withPlaylistAccessHandling(
      playlistId,
      () => this.oauthService.getYouTubeClient().listPlaylistItems(youtubeToken, playlistId),
    );
    await this.quotaService.charge(Math.max(1, Math.ceil(playlistItems.length / 50)));
    await this.store.replacePlaylistVideos(playlistId, playlistItems);
    return this.getComparison(input);
  }

  private async getComparisonPlaylistId() {
    return this.config.YOUTUBE_PLAYLIST_ID ?? await this.store.getManagedPlaylistId();
  }

  private async withPlaylistAccessHandling<T>(playlistId: string, action: () => Promise<T>) {
    try {
      return await action();
    } catch (error) {
      if (
        error instanceof ExternalApiError &&
        error.provider === "youtube" &&
        (error.status === 403 || error.status === 404)
      ) {
        throw new LocalizedError(
          `Managed playlist ${playlistId} could not be accessed. Title/privacy changes are not the problem; please check playlist ownership, permissions, or reconnect YouTube.`,
          502,
          "message.playlistAccessIssue",
        );
      }

      throw error;
    }
  }
}

function normalizeBucket(value: string | null | undefined): PlaylistComparisonBucket {
  return value === "youtube_only" || value === "in_both" ? value : DEFAULT_BUCKET;
}

function normalizePage(value: number | null | undefined) {
  if (!value || !Number.isFinite(value)) {
    return 1;
  }

  return Math.max(1, Math.floor(value));
}

function normalizePageSize(value: number | null | undefined) {
  if (!value || !Number.isFinite(value)) {
    return DEFAULT_PAGE_SIZE;
  }

  return Math.max(1, Math.min(MAX_PAGE_SIZE, Math.floor(value)));
}

function normalizeTrackRow(row: any): ComparisonTrackRow {
  return {
    spotifyTrackId: row.spotifyTrackId,
    spotifyAddedAt: row.spotifyAddedAt,
    spotifyRemovedAt: row.spotifyRemovedAt ?? null,
    trackName: row.trackName,
    artistNames: JSON.parse(row.artistNamesJson) as string[],
    albumName: row.albumName ?? null,
    manualVideoId: row.manualVideoId ?? null,
    manualResolutionType: row.manualResolutionType ?? null,
    matchedVideoId: row.matchedVideoId ?? null,
    matchedVideoTitle: row.matchedVideoTitle ?? null,
    matchedChannelTitle: row.matchedChannelTitle ?? null,
    reviewVideoId: row.reviewVideoId ?? null,
    reviewVideoTitle: row.reviewVideoTitle ?? null,
    reviewChannelTitle: row.reviewChannelTitle ?? null,
    searchStatus: row.searchStatus,
    lastError: row.lastError ?? null,
    playlistVideoId: row.playlistVideoId ?? null,
    lastSyncedAt: row.lastSyncedAt ?? null,
  };
}

function normalizeRunTrackRow(row: any): ComparisonRunTrackRow {
  return {
    status: row.status,
    statusMessage: row.statusMessage ?? null,
    manualVideoId: row.manualVideoId ?? null,
    manualResolutionType: row.manualResolutionType ?? null,
    matchedVideoId: row.matchedVideoId ?? null,
    matchedVideoTitle: row.matchedVideoTitle ?? null,
    matchedChannelTitle: row.matchedChannelTitle ?? null,
    reviewVideoId: row.reviewVideoId ?? null,
    reviewVideoTitle: row.reviewVideoTitle ?? null,
    reviewChannelTitle: row.reviewChannelTitle ?? null,
    playlistItemId: row.playlistItemId ?? null,
    lastError: row.lastError ?? null,
  };
}

function selectTargetVideoId(track: ComparisonTrackRow, overlay: ComparisonRunTrackRow | null | undefined) {
  return overlay?.manualVideoId ?? overlay?.matchedVideoId ?? track.manualVideoId ?? track.matchedVideoId ?? null;
}

function selectTargetVideoTitle(track: ComparisonTrackRow, overlay: ComparisonRunTrackRow | null | undefined) {
  return overlay?.matchedVideoTitle ?? track.matchedVideoTitle ?? null;
}

function selectTargetChannelTitle(track: ComparisonTrackRow, overlay: ComparisonRunTrackRow | null | undefined) {
  return overlay?.matchedChannelTitle ?? track.matchedChannelTitle ?? null;
}

function determineComparisonStatus(
  track: ComparisonTrackRow,
  overlay: ComparisonRunTrackRow | null | undefined,
): PlaylistComparisonItem["status"] {
  if (overlay?.status) {
    return overlay.status;
  }

  if (track.lastSyncedAt) {
    return "synced";
  }

  return track.searchStatus ?? "pending";
}

function determineMatchSource(
  track: ComparisonTrackRow,
  overlay: ComparisonRunTrackRow | null | undefined,
): PlaylistComparisonItem["matchSource"] {
  if (overlay?.manualVideoId || track.manualVideoId) {
    return "manual";
  }

  if (selectTargetVideoId(track, overlay)) {
    return "automatic";
  }

  return null;
}

function buildBaseItem(
  bucket: PlaylistComparisonBucket,
  reasonCode: PlaylistComparisonReasonCode,
  track: ComparisonTrackRow,
  overlay: ComparisonRunTrackRow | null | undefined,
): PlaylistComparisonItem {
  const targetVideoId = selectTargetVideoId(track, overlay);
  return {
    bucket,
    reasonCode,
    status: determineComparisonStatus(track, overlay),
    statusMessage: overlay?.statusMessage ?? null,
    spotifyTrackId: track.spotifyTrackId,
    spotifyTrackName: track.trackName,
    spotifyArtistNames: track.artistNames,
    spotifyAlbumName: track.albumName,
    spotifyAddedAt: track.spotifyAddedAt,
    spotifyRemovedAt: track.spotifyRemovedAt,
    targetVideoId,
    targetVideoTitle: selectTargetVideoTitle(track, overlay),
    targetChannelTitle: selectTargetChannelTitle(track, overlay),
    reviewVideoId: overlay?.reviewVideoId ?? track.reviewVideoId,
    reviewVideoTitle: overlay?.reviewVideoTitle ?? track.reviewVideoTitle,
    reviewChannelTitle: overlay?.reviewChannelTitle ?? track.reviewChannelTitle,
    playlistVideoId: null,
    playlistVideoTitle: null,
    playlistChannelTitle: null,
    playlistItemId: overlay?.playlistItemId ?? null,
    playlistPosition: null,
    matchSource: determineMatchSource(track, overlay),
    manualResolutionType: overlay?.manualResolutionType ?? track.manualResolutionType,
    searchStatus: track.searchStatus,
    lastSyncedAt: track.lastSyncedAt,
    lastError: overlay?.lastError ?? track.lastError,
    detail: null,
  };
}

function buildSpotifyOnlyItem(
  track: ComparisonTrackRow,
  overlay: ComparisonRunTrackRow | null | undefined,
): PlaylistComparisonItem {
  const reasonCode = determineSpotifyOnlyReason(track, overlay);
  return buildBaseItem("spotify_only", reasonCode, track, overlay);
}

function determineSpotifyOnlyReason(
  track: ComparisonTrackRow,
  overlay: ComparisonRunTrackRow | null | undefined,
): PlaylistComparisonReasonCode {
  if (overlay?.status === "waiting_for_youtube_quota") {
    return "waiting_for_youtube_quota";
  }

  if (overlay?.status === "waiting_for_spotify_retry") {
    return "waiting_for_spotify_retry";
  }

  if (overlay?.status === "needs_reauth") {
    return "needs_reauth";
  }

  const targetVideoId = selectTargetVideoId(track, overlay);
  if (track.lastSyncedAt && targetVideoId) {
    return "previously_synced_missing_now";
  }

  if (targetVideoId) {
    return "mapped_not_in_playlist";
  }

  if (track.searchStatus === "review_required") {
    return "review_required";
  }

  if (track.searchStatus === "no_match") {
    return "no_match";
  }

  if (track.searchStatus === "failed") {
    return "failed";
  }

  return "pending_sync";
}

function buildInBothItem(
  track: ComparisonTrackRow,
  overlay: ComparisonRunTrackRow | null | undefined,
  playlistVideo: any,
): PlaylistComparisonItem {
  const matchSource = determineMatchSource(track, overlay);
  const item = buildBaseItem(
    "in_both",
    matchSource === "manual" ? "manual_match_in_playlist" : "automatic_match_in_playlist",
    track,
    overlay,
  );
  return {
    ...item,
    playlistVideoId: playlistVideo.videoId,
    playlistVideoTitle: playlistVideo.videoTitle ?? selectTargetVideoTitle(track, overlay),
    playlistChannelTitle: playlistVideo.channelTitle ?? selectTargetChannelTitle(track, overlay),
    playlistItemId: playlistVideo.playlistItemId ?? item.playlistItemId,
    playlistPosition: typeof playlistVideo.position === "number" ? playlistVideo.position : null,
  };
}

function buildYouTubeOnlyItem(
  playlistVideo: any,
  removedTrack: ComparisonTrackRow | null,
): PlaylistComparisonItem {
  const matchSource: PlaylistComparisonItem["matchSource"] =
    removedTrack?.manualVideoId ? "manual" : removedTrack ? "automatic" : null;

  return {
    bucket: "youtube_only",
    reasonCode: removedTrack ? "source_removed_from_spotify" : "unmanaged_or_added_outside_app",
    status: removedTrack?.searchStatus ?? null,
    statusMessage: null,
    spotifyTrackId: removedTrack?.spotifyTrackId ?? null,
    spotifyTrackName: removedTrack?.trackName ?? null,
    spotifyArtistNames: removedTrack?.artistNames ?? [],
    spotifyAlbumName: removedTrack?.albumName ?? null,
    spotifyAddedAt: removedTrack?.spotifyAddedAt ?? null,
    spotifyRemovedAt: removedTrack?.spotifyRemovedAt ?? null,
    targetVideoId: removedTrack ? selectTargetVideoId(removedTrack, null) : playlistVideo.videoId,
    targetVideoTitle: removedTrack?.matchedVideoTitle ?? null,
    targetChannelTitle: removedTrack?.matchedChannelTitle ?? null,
    reviewVideoId: removedTrack?.reviewVideoId ?? null,
    reviewVideoTitle: removedTrack?.reviewVideoTitle ?? null,
    reviewChannelTitle: removedTrack?.reviewChannelTitle ?? null,
    playlistVideoId: playlistVideo.videoId,
    playlistVideoTitle: playlistVideo.videoTitle ?? null,
    playlistChannelTitle: playlistVideo.channelTitle ?? null,
    playlistItemId: playlistVideo.playlistItemId,
    playlistPosition: typeof playlistVideo.position === "number" ? playlistVideo.position : null,
    matchSource,
    manualResolutionType: removedTrack?.manualResolutionType ?? null,
    searchStatus: removedTrack?.searchStatus ?? null,
    lastSyncedAt: removedTrack?.lastSyncedAt ?? null,
    lastError: removedTrack?.lastError ?? null,
    detail: null,
  };
}

function summarizeReasons(items: PlaylistComparisonItem[]): PlaylistComparisonReasonSummary[] {
  const counts = new Map<PlaylistComparisonReasonCode, number>();
  for (const item of items) {
    counts.set(item.reasonCode, (counts.get(item.reasonCode) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([reasonCode, count]) => ({ reasonCode, count }))
    .sort((left, right) => right.count - left.count || left.reasonCode.localeCompare(right.reasonCode));
}

function paginateItems(
  items: PlaylistComparisonItem[],
  bucket: PlaylistComparisonBucket,
  requestedPage: number,
  pageSize: number,
): PlaylistComparisonBucketPage {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(Math.max(1, total) / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const start = (page - 1) * pageSize;
  return {
    bucket,
    page,
    pageSize,
    total,
    items: items.slice(start, start + pageSize),
  };
}
