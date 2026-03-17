import type { AppStore } from "../db/store.js";
import { LocalizedError } from "../lib/localized-error.js";
import { extractYouTubeVideoId } from "../lib/youtube.js";
import type { SearchCandidate } from "../types.js";
import { QuotaService } from "./quota-service.js";
import { YouTubeClient } from "../providers/youtube/client.js";

interface ReviewMutationResult {
  alreadySelected: boolean;
  videoId: string;
}

export class TrackReviewService {
  constructor(
    private readonly store: AppStore,
    private readonly youtubeClient: YouTubeClient,
    private readonly quotaService: QuotaService,
  ) {}

  async acceptRecommendation(spotifyTrackId: string): Promise<ReviewMutationResult> {
    const track = await this.store.getTrackBySpotifyId(spotifyTrackId);

    if (!track) {
      throw new LocalizedError("Track not found.", 404, "message.trackNotFound");
    }

    this.assertTrackCanBeEdited(track);

    const reviewVideoId = track.reviewVideoId;
    if (!reviewVideoId) {
      if (track.manualVideoId && track.searchStatus === "matched_manual") {
        return {
          alreadySelected: true,
          videoId: track.manualVideoId,
        };
      }

      throw new LocalizedError(
        "There is no recommendation to accept.",
        400,
        "message.noRecommendationAvailable",
      );
    }

    if (track.manualVideoId === reviewVideoId && track.searchStatus === "matched_manual") {
      return {
        alreadySelected: true,
        videoId: reviewVideoId,
      };
    }

    await this.store.setManualVideoId(spotifyTrackId, reviewVideoId, {
      matchedVideoTitle: track.reviewVideoTitle,
      matchedChannelTitle: track.reviewChannelTitle,
      matchedSource: track.reviewSource ?? "manual",
      matchedScore: track.reviewScore ?? 100,
      manualResolutionType: "recommended",
    });

    return {
      alreadySelected: false,
      videoId: reviewVideoId,
    };
  }

  async saveManualSelection(spotifyTrackId: string, videoInput: string): Promise<ReviewMutationResult> {
    const track = await this.store.getTrackBySpotifyId(spotifyTrackId);

    if (!track) {
      throw new LocalizedError("Track not found.", 404, "message.trackNotFound");
    }

    this.assertTrackCanBeEdited(track);

    const videoId = extractYouTubeVideoId(videoInput);
    if (!videoId) {
      throw new LocalizedError("Enter a valid YouTube URL or video ID.", 400, "message.invalidYouTubeInput");
    }

    if (track.manualVideoId === videoId && track.searchStatus === "matched_manual") {
      return {
        alreadySelected: true,
        videoId,
      };
    }

    if (!(await this.quotaService.hasRoom(1))) {
      throw new LocalizedError(
        "Not enough quota is available to validate that YouTube video.",
        429,
        "message.notEnoughQuotaForValidation",
      );
    }

    const [video] = await this.youtubeClient.getVideos([videoId]);
    await this.quotaService.charge(1);

    const candidate = this.validateManualCandidate(video);
    await this.store.setManualVideoId(spotifyTrackId, candidate.videoId, {
      matchedVideoTitle: candidate.title,
      matchedChannelTitle: candidate.channelTitle,
      matchedSource: "manual",
      matchedScore: 100,
      manualResolutionType: "manual_input",
    });

    return {
      alreadySelected: false,
      videoId: candidate.videoId,
    };
  }

  private assertTrackCanBeEdited(track: {
    spotifyRemovedAt: number | null;
    playlistVideoId: string | null;
    lastSyncedAt: number | null;
  }) {
    if (track.spotifyRemovedAt) {
      throw new LocalizedError(
        "Tracks removed from Spotify cannot be edited.",
        409,
        "message.trackRemovedFromSpotify",
      );
    }

    if (track.playlistVideoId || track.lastSyncedAt) {
      throw new LocalizedError(
        "Tracks already inserted into the YouTube playlist cannot be edited.",
        409,
        "message.trackAlreadyInserted",
      );
    }
  }

  private validateManualCandidate(candidate?: SearchCandidate) {
    if (!candidate) {
      throw new LocalizedError(
        "The requested YouTube video could not be found.",
        400,
        "message.manualVideoMissing",
      );
    }

    if (candidate.isSyndicated === false) {
      throw new LocalizedError(
        "That YouTube video is private or cannot be used in a playlist.",
        400,
        "message.manualVideoPrivate",
      );
    }

    if (candidate.isEmbeddable === false) {
      throw new LocalizedError(
        "That YouTube video cannot be used because embedding is disabled.",
        400,
        "message.manualVideoNotEmbeddable",
      );
    }

    return candidate;
  }
}
