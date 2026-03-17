import type { AppStore } from "../db/store.js";

const DEFAULT_DAILY_LIMIT = 10_000;
const YOUTUBE_QUOTA_TIME_ZONE = "America/Los_Angeles";

export class QuotaService {
  constructor(
    private readonly store: AppStore,
    private readonly dailyLimit = DEFAULT_DAILY_LIMIT,
  ) {}

  getDayKey(date = new Date()) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: YOUTUBE_QUOTA_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);

    const year = parts.find((part) => part.type === "year")?.value;
    const month = parts.find((part) => part.type === "month")?.value;
    const day = parts.find((part) => part.type === "day")?.value;

    if (!year || !month || !day) {
      throw new Error("Unable to format YouTube quota day key");
    }

    return `${year}-${month}-${day}`;
  }

  getUsage(dayKey = this.getDayKey()) {
    return this.store.getDailyQuotaUsage(dayKey);
  }

  charge(amount: number, dayKey = this.getDayKey()) {
    return this.store.incrementDailyQuotaUsage(dayKey, amount);
  }

  hasRoom(estimatedAmount: number, dayKey = this.getDayKey()) {
    return this.getUsage(dayKey) + estimatedAmount <= this.dailyLimit;
  }
}
