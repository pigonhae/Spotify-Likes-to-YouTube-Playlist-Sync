import type { AppStore } from "../db/store.js";
import { AppError, QuotaExceededError, ValidationError } from "../lib/errors.js";
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
      throw new AppError("곡을 찾을 수 없습니다.", 404);
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

      throw new ValidationError("채택할 추천 영상이 없습니다.");
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
      throw new AppError("곡을 찾을 수 없습니다.", 404);
    }

    this.assertTrackCanBeEdited(track);

    const videoId = extractYouTubeVideoId(videoInput);
    if (!videoId) {
      throw new ValidationError("올바른 YouTube URL 또는 video ID를 입력해 주세요.");
    }

    if (track.manualVideoId === videoId && track.searchStatus === "matched_manual") {
      return {
        alreadySelected: true,
        videoId,
      };
    }

    if (!(await this.quotaService.hasRoom(1))) {
      throw new QuotaExceededError("YouTube 영상 유효성을 확인할 quota가 부족합니다.");
    }

    const [video] = await this.youtubeClient.getVideos([videoId]);
    await this.quotaService.charge(1);

    const candidate = this.validateManualCandidate(videoId, video);
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
      throw new AppError("Spotify에서 이미 제거된 곡은 수정할 수 없습니다.", 409);
    }

    if (track.playlistVideoId || track.lastSyncedAt) {
      throw new AppError("이미 YouTube 재생목록에 추가된 곡은 수정할 수 없습니다.", 409);
    }
  }

  private validateManualCandidate(videoId: string, candidate?: SearchCandidate) {
    if (!candidate) {
      throw new ValidationError("입력한 YouTube 영상이 존재하지 않거나 확인할 수 없습니다.");
    }

    if (candidate.isSyndicated === false) {
      throw new ValidationError("비공개이거나 재생목록에 사용할 수 없는 YouTube 영상입니다.");
    }

    if (candidate.isEmbeddable === false) {
      throw new ValidationError("삽입이 제한된 YouTube 영상은 사용할 수 없습니다.");
    }

    return candidate;
  }
}
