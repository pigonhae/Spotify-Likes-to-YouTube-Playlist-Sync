import { describe, expect, it } from "vitest";

import { QuotaService } from "../src/services/quota-service.js";
import { createTestStore } from "./helpers/test-support.js";

describe("QuotaService", () => {
  it("tracks daily usage in the database", async () => {
    const { store, close } = await createTestStore();
    const quotaService = new QuotaService(store);

    expect(await quotaService.getUsage("2026-03-17")).toBe(0);
    await quotaService.charge(101, "2026-03-17");
    await quotaService.charge(50, "2026-03-17");

    expect(await quotaService.getUsage("2026-03-17")).toBe(151);
    expect(await quotaService.hasRoom(9_849, "2026-03-17")).toBe(true);
    expect(await quotaService.hasRoom(9_850, "2026-03-17")).toBe(false);

    await close();
  });

  it("uses the YouTube Pacific-time quota day boundary", async () => {
    const { store, close } = await createTestStore();
    const quotaService = new QuotaService(store);

    expect(quotaService.getDayKey(new Date("2026-03-17T06:59:59.000Z"))).toBe("2026-03-16");
    expect(quotaService.getDayKey(new Date("2026-03-17T07:00:00.000Z"))).toBe("2026-03-17");

    await close();
  });

  it("supports a custom daily quota limit", async () => {
    const { store, close } = await createTestStore();
    const quotaService = new QuotaService(store, 12_000);

    await quotaService.charge(11_950, "2026-03-17");

    expect(await quotaService.hasRoom(50, "2026-03-17")).toBe(true);
    expect(await quotaService.hasRoom(51, "2026-03-17")).toBe(false);

    await close();
  });
});
