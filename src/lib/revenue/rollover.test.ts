import { describe, expect, it } from "vitest";
import { applyAction } from "@/lib/domain/actions";
import type { Deal, ForecastSnapshot, RevenueTarget, Workspace } from "@/lib/domain/types";
import { TODAY, at, day, makeDeal, makeWorkspace } from "@/test/factories";
import { baseline, computeForecast, computePlan, forecastChanges, takeSnapshot } from "./forecast";
import { endedTarget, liveTarget, nextPeriod, periodOf, quarterOf } from "./stats";
import { updateFacts } from "./update";

/** TODAY is Tue 20 Oct 2026, inside Q4. */
const Q3: RevenueTarget = { amountUsd: 150_000, periodStart: "2026-07-01", periodEnd: "2026-09-30", label: "Q3 new ARR", winRate: 0.3, coverageTarget: 4 };
const Q4: RevenueTarget = { amountUsd: 200_000, periodStart: "2026-10-01", periodEnd: "2026-12-31", label: "Q4 new ARR" };

function won(id: string, closed: string, amountUsd: number): Deal {
  return makeDeal(id, `${id}.example`, { stage: "won", amountUsd, stageHistory: [{ stage: "talking", at: at(-150) }, { stage: "won", at: `${closed}T19:00:00.000Z` }], createdAt: at(-150) });
}

describe("a target whose quarter is over", () => {
  it("rolls the forecast to the quarter running now, with no target until one is set", () => {
    const ws = makeWorkspace({ revenue: { target: Q3 }, deals: { a: won("a", "2026-09-10", 120_000), b: won("b", "2026-10-05", 30_000) } });
    const f = computeForecast(ws, TODAY);
    expect(f.period).toMatchObject({ start: "2026-10-01", end: "2026-12-31", label: "Q4 2026" });
    expect(f.hasTarget).toBe(false);
    expect(f.target).toBe(0);
    expect(f.coverage).toBeNull();
    expect(f.hitChance).toBeNull();
    // This quarter's closed won, not Q3's.
    expect(f.closedWon.usd).toBe(30_000);
    // Last quarter stays readable, and its assumptions still plan: 4× coverage carries over.
    expect(f.ended).toEqual({ target: Q3, wonUsd: 120_000, deals: 1 });
    expect(f.coverageNeeded).toBe(4);
  });

  it("asks for this quarter's target, saying how the last one ended", () => {
    const ws = makeWorkspace({ revenue: { target: Q3 }, deals: { a: won("a", "2026-09-10", 120_000) } });
    const f = computeForecast(ws, TODAY);
    const plan = computePlan(ws, f, new Date(2026, 9, 20, 9, 30));
    expect(plan.verdict).toBe("no_target");
    expect(plan.headline).toBe("Q3 new ARR ended Sep 30 with $120K won against $150K. Set Q4 2026's target and I'll work backward to the meetings it takes.");
    expect(updateFacts(ws, f, plan, new Date(2026, 9, 20, 9, 30)).facts[1]).toBe("No target is set for Q4 2026 yet. The last one, Q3 new ARR, ended Sep 30 with $120K won against $150K.");
  });

  it("keeps a target that's running or set ahead, and drops none that hasn't ended", () => {
    expect(liveTarget(Q4, TODAY)).toBe(Q4);
    expect(liveTarget(Q3, TODAY)).toBeUndefined();
    expect(endedTarget(Q3, TODAY)).toBe(Q3);
    expect(endedTarget(Q4, TODAY)).toBeUndefined();
    // Its last day still counts.
    expect(liveTarget(Q4, "2026-12-31")).toBe(Q4);
    const ahead: RevenueTarget = { amountUsd: 250_000, periodStart: "2027-01-01", periodEnd: "2027-03-31", label: "Q1 new ARR" };
    expect(periodOf(ahead, TODAY)).toMatchObject({ start: "2027-01-01", label: "Q1 new ARR", daysLeft: 90 });
    expect(computeForecast(makeWorkspace({ revenue: { target: Q4 } }), TODAY).ended).toBeNull();
  });

  it("keeps the replaced target as history when a new period's target is saved", () => {
    const ws = makeWorkspace({ revenue: { target: Q3 } });
    applyAction(ws, { type: "revenue.setTarget", target: Q4 });
    expect(ws.revenue).toMatchObject({ target: Q4, pastTargets: [Q3] });
    // Editing the same period's number isn't a new period: no extra history.
    applyAction(ws, { type: "revenue.setTarget", target: { ...Q4, amountUsd: 210_000 } });
    expect(ws.revenue?.pastTargets).toEqual([Q3]);
    // One entry per period, newest last, at most eight.
    for (let y = 2027; y < 2037; y++) applyAction(ws, { type: "revenue.setTarget", target: { ...Q4, periodStart: `${y}-01-01`, periodEnd: `${y}-03-31` } });
    expect(ws.revenue?.pastTargets).toHaveLength(8);
    expect(ws.revenue?.pastTargets?.at(-1)?.periodStart).toBe("2035-01-01");
  });
});

describe("the next period", () => {
  it("is the next calendar quarter, not the same number of days", () => {
    expect(nextPeriod(quarterOf("2026-11-15"))).toEqual({ start: "2027-01-01", end: "2027-03-31" });
    expect(nextPeriod(quarterOf("2026-05-15"))).toEqual({ start: "2026-07-01", end: "2026-09-30" });
    expect(nextPeriod(quarterOf("2026-02-15"))).toEqual({ start: "2026-04-01", end: "2026-06-30" });
    expect(nextPeriod(quarterOf("2026-08-15"))).toEqual({ start: "2026-10-01", end: "2026-12-31" });
  });

  it("repeats whole months for a month-aligned period, and days only for one that isn't", () => {
    expect(nextPeriod({ start: "2026-11-01", end: "2027-01-31" })).toEqual({ start: "2027-02-01", end: "2027-04-30" });
    expect(nextPeriod({ start: "2026-01-01", end: "2026-01-31" })).toEqual({ start: "2026-02-01", end: "2026-02-28" });
    expect(nextPeriod({ start: "2026-10-15", end: "2026-11-14" })).toEqual({ start: "2026-11-15", end: "2026-12-15" });
  });

  it("counts next quarter's coverage over the real quarter", () => {
    const ws = makeWorkspace({
      revenue: { target: Q4 },
      deals: {
        q1: makeDeal("q1", "q1.example", { stage: "qualified", amountUsd: 40_000, closeDate: "2027-03-31" }),
        q2: makeDeal("q2", "q2.example", { stage: "qualified", amountUsd: 40_000, closeDate: "2027-04-02" }),
      },
    });
    expect(computeForecast(ws, TODAY).next).toMatchObject({ start: "2027-01-01", end: "2027-03-31", pipeline: 40_000 });
  });
});

describe("week over week with estimated close dates", () => {
  /** An undated deal past its stage's usual stay: code's estimate of its close slides later every day. */
  const undated = () =>
    makeDeal("est", "est.example", { stage: "qualified", amountUsd: 30_000, createdAt: at(-100), stageHistory: [{ stage: "talking", at: at(-100) }, { stage: "qualified", at: at(-30) }] });

  it("stores whether a close date was estimated", () => {
    const ws = makeWorkspace({ revenue: { target: Q4 }, deals: { est: undated() } });
    const snap = takeSnapshot(computeForecast(ws, TODAY), at(0));
    expect(snap.deals[0]).toMatchObject({ id: "est", closeEstimated: true });
  });

  it("never reports an estimate that slid later as a push", () => {
    const ws = makeWorkspace({ revenue: { target: Q4 }, deals: { est: undated() } });
    const snap: ForecastSnapshot = { ...takeSnapshot(computeForecast(ws, day(-7)), at(-7)), weekOf: "2026-10-12" };
    ws.revenue!.snapshots = [snap];
    const f = computeForecast(ws, TODAY);
    expect(f.calls[0].closeDate > snap.deals[0].closeDate!).toBe(true);
    expect(forecastChanges(ws, baseline(ws, TODAY), f).filter((c) => c.kind === "pushed")).toEqual([]);
  });

  it("reads older snapshots by the deal's own close-date record", () => {
    const ws: Workspace = makeWorkspace({ revenue: { target: Q4 }, deals: { est: undated(), real: makeDeal("real", "real.example", { stage: "qualified", amountUsd: 20_000, closeDate: day(40), closeDateHistory: [{ date: day(20), at: at(-20) }, { date: day(40), at: at(-2) }] }) } });
    const legacy: ForecastSnapshot = {
      weekOf: "2026-10-12",
      takenAt: at(-7),
      periodEnd: Q4.periodEnd,
      target: Q4.amountUsd,
      closedWon: 0,
      commit: 0,
      bestCase: 0,
      pipeline: 50_000,
      // Written before snapshots said which dates were estimates.
      deals: [
        { id: "est", name: "est", stage: "qualified", category: "pipeline", amountUsd: 30_000, closeDate: day(-3) },
        { id: "real", name: "real", stage: "qualified", category: "pipeline", amountUsd: 20_000, closeDate: day(20) },
      ],
    };
    ws.revenue!.snapshots = [legacy];
    const pushed = forecastChanges(ws, baseline(ws, TODAY), computeForecast(ws, TODAY)).filter((c) => c.kind === "pushed");
    expect(pushed.map((c) => c.dealId)).toEqual(["real"]);
  });
});
