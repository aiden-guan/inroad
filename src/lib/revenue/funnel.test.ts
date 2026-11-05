import { describe, expect, it } from "vitest";
import { makeCompany, makeDeal } from "@/test/factories";
import { emptyWorkspace } from "@/lib/store/workspace";
import type { Stage } from "@/lib/domain/types";
import { knownDealValue, pipelinePulse } from "./funnel";

const NOW = new Date("2026-10-30T19:00:00Z");
const event = (stage: Stage, date: string) => ({ stage, at: `${date}T18:00:00.000Z` });
const workspace = () => ({ ...emptyWorkspace(), company: makeCompany() });

describe("pipeline creation and stage cohorts", () => {
  it("counts first qualification once across equally sized calendar windows, without guessing prices", () => {
    const ws = workspace();
    ws.deals = {
      recent: makeDeal("recent", "recent.com", { stage: "qualified", amountUsd: 12000, stageHistory: [event("talking", "2026-10-01"), event("qualified", "2026-10-02"), event("talking", "2026-10-03"), event("qualified", "2026-10-20")] }),
      previous: makeDeal("previous", "previous.com", { stage: "won", priceQuotes: [{ at: "2026-09-15", amountUsd: 5000 }], stageHistory: [event("qualified", "2026-09-01"), event("won", "2026-09-10")] }),
      missing: makeDeal("missing", "missing.com", { stage: "qualified", stageHistory: [event("qualified", "2026-10-15")] }),
      old: makeDeal("old", "old.com", { stage: "qualified", amountUsd: 9000, stageHistory: [event("qualified", "2026-08-31")] }),
      future: makeDeal("future", "future.com", { stage: "talking", stageHistory: [event("qualified", "2026-10-31")] }),
    };
    const pulse = pipelinePulse(ws, NOW);
    expect(pulse.from).toBe("2026-10-01");
    expect(pulse.previousFrom).toBe("2026-09-01");
    expect(pulse.recent).toEqual({ count: 2, knownUsd: 12000, missingValues: 1 });
    expect(pulse.previous).toEqual({ count: 1, knownUsd: 5000, missingValues: 0 });
    expect(pulse.openQualified).toBe(3);
  });

  it("uses the first decided exit, including losses that were later reopened", () => {
    const ws = workspace();
    ws.deals.a = makeDeal("a", "a.com", { stage: "proposal", stageHistory: [event("qualified", "2026-10-01"), event("lost", "2026-10-04"), event("qualified", "2026-10-08"), event("proposal", "2026-10-12")] });
    const row = pipelinePulse(ws, NOW).rows.find((r) => r.stage === "qualified")!;
    expect(row).toMatchObject({ entered: 1, advanced: 0, lost: 1, waiting: 0, unknown: 0, conversion: null });
  });

  it("counts skipped stages as forward moves without inventing entries in the skipped stage", () => {
    const ws = workspace();
    ws.deals.a = makeDeal("a", "a.com", { stage: "won", stageHistory: [event("qualified", "2026-10-01"), event("won", "2026-10-11")] });
    const pulse = pipelinePulse(ws, NOW);
    expect(pulse.rows.find((r) => r.stage === "qualified")).toMatchObject({ entered: 1, advanced: 1, medianDays: 10 });
    expect(pulse.rows.find((r) => r.stage === "pilot")?.entered).toBe(0);
  });

  it("excludes unresolved and missing-date outcomes from the rate denominator", () => {
    const ws = workspace();
    for (let i = 0; i < 10; i++) ws.deals[`d${i}`] = makeDeal(`d${i}`, `${i}.com`, { stage: i < 6 ? "proposal" : "lost", stageHistory: [event("qualified", "2026-10-01"), event(i < 6 ? "proposal" : "lost", "2026-10-11")] });
    ws.deals.waiting = makeDeal("waiting", "waiting.com", { stage: "qualified", stageHistory: [event("qualified", "2026-10-05")] });
    ws.deals.undated = makeDeal("undated", "undated.com", { stage: "won", stageHistory: [event("qualified", "2026-10-07")] });
    const row = pipelinePulse(ws, NOW).rows.find((r) => r.stage === "qualified")!;
    expect(row).toMatchObject({ entered: 12, advanced: 6, lost: 4, waiting: 1, unknown: 1, conversion: 0.6, medianDays: 10 });
    expect(row.waitingDeals[0].id).toBe("waiting");
    expect(row.entered).toBe(row.advanced + row.lost + row.waiting + row.unknown);
  });

  it("does not publish a rate below ten decided exits, or infer an entry from the current stage", () => {
    const ws = workspace();
    ws.deals.a = makeDeal("a", "a.com", { stage: "qualified", stageHistory: [] });
    const pulse = pipelinePulse(ws, NOW);
    expect(pulse.recent.count).toBe(0);
    expect(pulse.undatedQualified).toBe(1);
    expect(pulse.rows.every((r) => r.conversion === null)).toBe(true);
  });

  it("ignores invalid and future transitions and preserves the input history order", () => {
    const ws = workspace();
    ws.deals.a = makeDeal("a", "a.com", { stage: "proposal", stageHistory: [event("proposal", "2026-10-25"), event("qualified", "2026-10-01"), { stage: "won", at: "invalid" }, event("won", "2026-11-01")] });
    const before = structuredClone(ws.deals);
    expect(pipelinePulse(ws, NOW).rows.find((r) => r.stage === "qualified")?.medianDays).toBe(24);
    expect(ws.deals).toEqual(before);
  });

  it("does not treat a same-time event preceding entry as a later exit", () => {
    const ws = workspace();
    ws.deals.a = makeDeal("a", "a.com", { stage: "qualified", stageHistory: [event("proposal", "2026-10-01"), event("qualified", "2026-10-01")] });
    expect(pipelinePulse(ws, NOW).rows.find((r) => r.stage === "qualified")?.advanced).toBe(0);
  });

  it("counts a move to nurture as a decided exit that didn't move forward, not a loss", () => {
    const ws = workspace();
    for (let i = 0; i < 6; i++) ws.deals[`f${i}`] = makeDeal(`f${i}`, `f${i}.com`, { stage: "proposal", stageHistory: [event("qualified", "2026-10-01"), event("proposal", "2026-10-11")] });
    for (let i = 0; i < 2; i++) ws.deals[`l${i}`] = makeDeal(`l${i}`, `l${i}.com`, { stage: "lost", stageHistory: [event("qualified", "2026-10-01"), event("lost", "2026-10-09")] });
    for (let i = 0; i < 2; i++) ws.deals[`n${i}`] = makeDeal(`n${i}`, `n${i}.com`, { stage: "nurture", stageHistory: [event("qualified", "2026-10-01"), event("nurture", "2026-10-09")] });
    // Back from nurture later: the first exit still decided it.
    ws.deals.back = makeDeal("back", "back.com", { stage: "proposal", stageHistory: [event("qualified", "2026-10-02"), event("nurture", "2026-10-05"), event("proposal", "2026-10-20")] });
    // Parked with no dated move: an outcome without a date, never "waiting".
    ws.deals.undated = makeDeal("undated", "undated.com", { stage: "nurture", stageHistory: [event("qualified", "2026-10-03")] });
    const row = pipelinePulse(ws, NOW).rows.find((r) => r.stage === "qualified")!;
    expect(row).toMatchObject({ entered: 12, advanced: 6, lost: 2, nurtured: 3, decided: 11, waiting: 0, unknown: 1 });
    // 6 of 11, not the 6 of 8 that leaving nurture out would claim.
    expect(row.conversion).toBeCloseTo(6 / 11);
    expect(row.entered).toBe(row.decided + row.waiting + row.unknown);
  });

  it("leaves out stage entries a file couldn't date", () => {
    const ws = workspace();
    const imported = "2026-10-28T17:03:11.123Z";
    ws.deals.a = makeDeal("a", "a.com", { stage: "proposal", stageHistory: [{ stage: "proposal", at: imported }], imported: { at: imported, from: "deals.csv", stage: "proposal", unknown: ["created", "stage_date"] } });
    ws.deals.b = makeDeal("b", "b.com", { stage: "qualified", stageHistory: [event("talking", "2026-09-20"), { stage: "qualified", at: imported }], imported: { at: imported, from: "deals.csv", stage: "qualified", unknown: ["stage_date"] } });
    const pulse = pipelinePulse(ws, NOW);
    // Learning of two deals today isn't two new qualified deals today.
    expect(pulse.recent.count).toBe(0);
    expect(pulse.undatedQualified).toBe(2);
    expect(pulse.rows.find((r) => r.stage === "proposal")?.entered).toBe(0);
    // b's dated start counts; its exit has no date, so its outcome is unknown rather than waiting.
    expect(pulse.rows.find((r) => r.stage === "talking")).toMatchObject({ entered: 1, unknown: 1, waiting: 0 });
  });

  it("never substitutes an average or a later quote for an explicitly stated zero", () => {
    expect(knownDealValue(makeDeal("a", "a.com", { amountUsd: 0, priceQuotes: [{ at: "2026-10-01", amountUsd: 100 }] }))).toBe(0);
    expect(knownDealValue(makeDeal("a", "a.com", { amountUsd: -1 }))).toBeNull();
    expect(knownDealValue(makeDeal("a", "a.com", {}))).toBeNull();
  });
});
