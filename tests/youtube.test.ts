import { describe, expect, it } from "vitest";

import { extractYouTubeVideoId } from "../src/lib/youtube.js";

describe("extractYouTubeVideoId", () => {
  it("extracts IDs from common YouTube URLs", () => {
    expect(extractYouTubeVideoId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(extractYouTubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(
      "dQw4w9WgXcQ",
    );
    expect(extractYouTubeVideoId("dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(extractYouTubeVideoId("not-a-video-id")).toBeNull();
  });
});
