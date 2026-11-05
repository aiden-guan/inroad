import { describe, expect, it } from "vitest";
import type { Deal } from "@/lib/domain/types";
import { ageLabel, daysInStage, lastActivityDays } from "./lib";

/**
 * Ages on the board are local-day counts, like Revenue's (src/lib/revenue/stats.ts). Tests run in
 * America/Los_Angeles (vitest.config.mts), where 23:30 on Nov 4 is already Nov 5 in UTC.
 */

const deal = (patch: Partial<Deal>): Deal => ({ stage: "qualified", stageHistory: [], createdAt: "2026-10-01T17:00:00.000Z", ...patch }) as Deal;

describe("deal ages on the board", () => {
  it("counts days in stage by the local calendar, not the UTC date", () => {
    // Entered Qualified at 23:30 local on Nov 4 (07:30 UTC on Nov 5). On Nov 5 that's 1 day, not 0.
    const d = deal({ stageHistory: [{ stage: "talking", at: "2026-10-20T16:00:00.000Z" }, { stage: "qualified", at: "2026-11-05T07:30:00.000Z" }] });
    expect(daysInStage(d, "2026-11-05")).toBe(1);
    expect(daysInStage(d, "2026-11-04")).toBe(0);
  });

  it("falls back to when the deal was created, in local days", () => {
    expect(daysInStage(deal({ stageHistory: [] }), "2026-10-02")).toBe(1);
  });

  it("counts days since the last activity the same way", () => {
    expect(lastActivityDays(deal({ lastActivityAt: "2026-11-05T06:00:00.000Z" }), "2026-11-06")).toBe(2);
    expect(ageLabel("2026-11-05T06:00:00.000Z", "2026-11-06")).toBe("2d");
  });
});
