import ytsr from "@distube/ytsr";

import type { AppConfig } from "../../config.js";
import { NoSearchResultsError, QuotaExceededError } from "../../lib/errors.js";
import type { SearchCandidate } from "../../types.js";
import { chooseBestMatch, type TrackForMatching } from "../../services/matching/matcher.js";
import { QuotaService } from "../../services/quota-service.js";
import { YouTubeClient } from "../youtube/client.js";

export class YouTubeSearchService {
  constructor(
    private readonly config: AppConfig,
    private readonly youtubeClient: YouTubeClient,
    private readonly quotaService: QuotaService,
  ) {}

  async findBestMatch(track: TrackForMatching) {
    const primaryQuery = `${track.trackName} ${track.artistNames.join(" ")} official audio`;
    const fallbackQuery = `${track.trackName} ${track.artistNames.join(" ")} ${track.albumName ?? ""}`.trim();

    let candidates: SearchCandidate[] = await this.searchWithYtsr(primaryQuery);
    const preview = candidates.length > 0 ? chooseBestMatch(track, candidates, 0).best : null;

    if (
      this.config.YOUTUBE_SEARCH_PROVIDER === "official" ||
      candidates.length === 0 ||
      (preview && preview.score < this.config.MATCH_THRESHOLD + 10)
    ) {
      if (!(await this.quotaService.hasRoom(100))) {
        throw new QuotaExceededError("Not enough YouTube quota remaining for search fallback");
      }

      const officialCandidates = await this.youtubeClient.searchVideos(
        candidates.length === 0 ? fallbackQuery : primaryQuery,
        this.config.YOUTUBE_FALLBACK_RESULT_LIMIT,
      );
      await this.quotaService.charge(100);
      candidates = dedupeCandidates([...candidates, ...officialCandidates]);
    }

    if (candidates.length === 0) {
      throw new NoSearchResultsError(`No YouTube candidates found for ${track.trackName}`);
    }

    if (!(await this.quotaService.hasRoom(1))) {
      throw new QuotaExceededError("Not enough YouTube quota remaining for candidate validation");
    }

    const validated = await this.youtubeClient.getVideos(
      dedupeCandidates(candidates)
        .slice(0, 8)
        .map((candidate) => candidate.videoId),
    );
    await this.quotaService.charge(1);

    const merged = mergeCandidates(candidates, validated);
    return chooseBestMatch(track, merged, this.config.MATCH_THRESHOLD);
  }

  private async searchWithYtsr(query: string) {
    const response = await ytsr(query, {
      limit: 8,
      type: "video",
      gl: "US",
      hl: "en",
    });

    return response.items.map((item): SearchCandidate => ({
      videoId: item.id,
      title: item.name,
      channelTitle: item.author?.name ?? "",
      durationSeconds: parseClockDuration(item.duration),
      source: "ytsr" as const,
      url: item.url,
    }));
  }
}

function dedupeCandidates(candidates: SearchCandidate[]) {
  const seen = new Set<string>();
  const result: SearchCandidate[] = [];

  for (const candidate of candidates) {
    if (seen.has(candidate.videoId)) {
      continue;
    }
    seen.add(candidate.videoId);
    result.push(candidate);
  }

  return result;
}

function mergeCandidates(baseCandidates: SearchCandidate[], validatedCandidates: SearchCandidate[]) {
  const validatedMap = new Map(validatedCandidates.map((candidate) => [candidate.videoId, candidate]));
  return dedupeCandidates(baseCandidates).map((candidate) => {
    const validated = validatedMap.get(candidate.videoId);
    return validated
      ? {
          ...candidate,
          ...validated,
          source: candidate.source,
        }
      : candidate;
  });
}

function parseClockDuration(value?: string) {
  if (!value) {
    return undefined;
  }

  const parts = value.split(":").map((part) => Number(part));
  if (parts.some((part) => Number.isNaN(part))) {
    return undefined;
  }

  if (parts.length === 2) {
    const [minutes = 0, seconds = 0] = parts;
    return minutes * 60 + seconds;
  }

  if (parts.length === 3) {
    const [hours = 0, minutes = 0, seconds = 0] = parts;
    return hours * 3600 + minutes * 60 + seconds;
  }

  return undefined;
}
