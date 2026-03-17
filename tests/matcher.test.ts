import { describe, expect, it } from "vitest";

import { classifyMatch } from "../src/services/matching/matcher.js";

describe("classifyMatch", () => {
  it("prefers official audio over lyric uploads", () => {
    const track = {
      spotifyTrackId: "track-1",
      trackName: "Bad Habit",
      artistNames: ["Steve Lacy"],
      albumName: "Gemini Rights",
      durationMs: 232_000,
    };

    const result = classifyMatch(
      track,
      [
        {
          videoId: "lyric111111",
          title: "Steve Lacy - Bad Habit Lyrics",
          channelTitle: "Lyrics Cloud",
          durationSeconds: 232,
          source: "youtube_api",
          url: "https://www.youtube.com/watch?v=lyric111111",
        },
        {
          videoId: "topic222222",
          title: "Bad Habit",
          channelTitle: "Steve Lacy - Topic",
          durationSeconds: 232,
          source: "youtube_api",
          url: "https://www.youtube.com/watch?v=topic222222",
        },
      ],
      50,
    );

    expect(result.disposition).toBe("matched_auto");
    expect(result.best?.candidate.videoId).toBe("topic222222");
    expect(result.best?.score ?? 0).toBeGreaterThan(70);
  });

  it("classifies below-threshold results as review_required while preserving the top recommendation", () => {
    const track = {
      spotifyTrackId: "track-2",
      trackName: "Satellite",
      artistNames: ["Artist X"],
      albumName: "Orbit",
      durationMs: 210_000,
    };

    const result = classifyMatch(
      track,
      [
        {
          videoId: "review11111",
          title: "Artist X - Satellite live at home",
          channelTitle: "Artist X Fan Archive",
          durationSeconds: 209,
          source: "youtube_api",
          url: "https://www.youtube.com/watch?v=review11111",
        },
      ],
      80,
    );

    expect(result.disposition).toBe("review_required");
    expect(result.best?.candidate.videoId).toBe("review11111");
    expect(result.best?.score ?? 0).toBeLessThan(80);
  });
});
