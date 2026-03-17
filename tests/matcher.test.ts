import { describe, expect, it } from "vitest";

import { chooseBestMatch } from "../src/services/matching/matcher.js";

describe("chooseBestMatch", () => {
  it("prefers official audio over lyric uploads", () => {
    const track = {
      spotifyTrackId: "track-1",
      trackName: "Bad Habit",
      artistNames: ["Steve Lacy"],
      albumName: "Gemini Rights",
      durationMs: 232_000,
    };

    const result = chooseBestMatch(
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

    expect(result.best.candidate.videoId).toBe("topic222222");
    expect(result.best.score).toBeGreaterThan(70);
  });
});
