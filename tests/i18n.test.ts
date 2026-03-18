import { describe, expect, it } from "vitest";

import { formatRelativeTimeForLanguage } from "../src/lib/i18n.js";

describe("formatRelativeTimeForLanguage", () => {
  it("formats recent timestamps in English", () => {
    const now = Date.parse("2026-03-18T00:00:00.000Z");

    expect(formatRelativeTimeForLanguage("en", now - 10_000, now)).toBe("just now");
    expect(formatRelativeTimeForLanguage("en", now - 3 * 60_000, now)).toBe("3 minutes ago");
    expect(formatRelativeTimeForLanguage("en", now - 60 * 60_000, now)).toBe("1 hour ago");
    expect(formatRelativeTimeForLanguage("en", now - 2 * 24 * 60 * 60_000, now)).toBe("2 days ago");
  });

  it("formats recent timestamps in Korean", () => {
    const now = Date.parse("2026-03-18T00:00:00.000Z");

    expect(formatRelativeTimeForLanguage("ko", now - 10_000, now)).toBe("방금 전");
    expect(formatRelativeTimeForLanguage("ko", now - 3 * 60_000, now)).toBe("3분 전");
    expect(formatRelativeTimeForLanguage("ko", now - 60 * 60_000, now)).toBe("1시간 전");
    expect(formatRelativeTimeForLanguage("ko", now - 2 * 24 * 60 * 60_000, now)).toBe("2일 전");
  });
});
