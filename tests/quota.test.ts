import path from "node:path";

import { describe, expect, it } from "vitest";

import { createDatabase } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrate.js";
import { AppStore } from "../src/db/store.js";
import { QuotaService } from "../src/services/quota-service.js";

describe("QuotaService", () => {
  it("tracks daily usage in the database", () => {
    const database = createDatabase(":memory:");
    runMigrations(database.sqlite, path.resolve("drizzle"));
    const store = new AppStore(database);
    const quotaService = new QuotaService(store);

    expect(quotaService.getUsage("2026-03-17")).toBe(0);
    quotaService.charge(101, "2026-03-17");
    quotaService.charge(50, "2026-03-17");

    expect(quotaService.getUsage("2026-03-17")).toBe(151);
    expect(quotaService.hasRoom(9_849, "2026-03-17")).toBe(true);
    expect(quotaService.hasRoom(9_850, "2026-03-17")).toBe(false);
  });

  it("uses the YouTube Pacific-time quota day boundary", () => {
    const database = createDatabase(":memory:");
    runMigrations(database.sqlite, path.resolve("drizzle"));
    const store = new AppStore(database);
    const quotaService = new QuotaService(store);

    expect(quotaService.getDayKey(new Date("2026-03-17T06:59:59.000Z"))).toBe("2026-03-16");
    expect(quotaService.getDayKey(new Date("2026-03-17T07:00:00.000Z"))).toBe("2026-03-17");
  });

  it("supports a custom daily quota limit", () => {
    const database = createDatabase(":memory:");
    runMigrations(database.sqlite, path.resolve("drizzle"));
    const store = new AppStore(database);
    const quotaService = new QuotaService(store, 12_000);

    quotaService.charge(11_950, "2026-03-17");

    expect(quotaService.hasRoom(50, "2026-03-17")).toBe(true);
    expect(quotaService.hasRoom(51, "2026-03-17")).toBe(false);
  });
});
