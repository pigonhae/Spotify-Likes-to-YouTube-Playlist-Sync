import type { AppStore } from "../db/store.js";

const DEFAULT_DAILY_LIMIT = 10_000;

export class QuotaService {
  constructor(private readonly store: AppStore) {}

  getDayKey(date = new Date()) {
    return date.toISOString().slice(0, 10);
  }

  getUsage(dayKey = this.getDayKey()) {
    return this.store.getDailyQuotaUsage(dayKey);
  }

  charge(amount: number, dayKey = this.getDayKey()) {
    return this.store.incrementDailyQuotaUsage(dayKey, amount);
  }

  hasRoom(estimatedAmount: number, dayKey = this.getDayKey()) {
    return this.getUsage(dayKey) + estimatedAmount <= DEFAULT_DAILY_LIMIT;
  }
}
