import { describe, expect, it } from "vitest";
import type { Deal, ForecastSnapshot, RevenueTarget, Workspace } from "@/lib/domain/types";
import { sampleWorkspace } from "@/lib/sample";
import { NOW, TODAY, at, day, makeAccount, makeDeal, makePerson, makeWorkspace } from "@/test/factories";
import { bySource, lossReasons } from "./attribution";
import { baseline, callDeal, chanceToReach, computeForecast, computePlan, forecastChanges, money, takeSnapshot } from "./forecast";
import { dealRisks, healthBand, healthOf } from "./risk";
import { blended, closeDateSlips, MIN_OBSERVED, periodOf, PRIORS, quarterOf, revenueStats } from "./stats";

const Q4: RevenueTarget = { amountUsd: 200_000, periodStart: "2026-10-01", periodEnd: "2026-12-31", label: "Q4 new ARR" };

/** A deal that walked the funnel to `stage`, started `startedAgo` days ago. */
function walked(id: string, stage: Deal["stage"], startedAgo: number, patch: Partial<Deal> = {}): Deal {
  const path: Deal["stage"][] = stage === "won" ? ["talking", "qualified", "proposal", "won"] : stage === "lost" ? ["talking", "qualified", "lost"] : ["talking"];
  const step = Math.max(1, Math.floor(startedAgo / path.length));
  return makeDeal(id, `${id}.example`, {
    stage,
    stageHistory: path.map((s, i) => ({ stage: s, at: at(-startedAgo + i * step) })),
    createdAt: at(-startedAgo),
    ...patch,
  });
}

/** A late-stage deal with everything a commit needs. */
function commitReady(id: string, patch: Partial<Deal> = {}): Deal {
  return makeDeal(id, `${id}.example`, {
    stage: "proposal",
    stageHistory: [
      { stage: "talking", at: at(-30) },
      { stage: "qualified", at: at(-20) },
      { stage: "proposal", at: at(-5) },
    ],
    amountUsd: 50_000,
    closeDate: day(20),
    nextStep: { what: "Order form signature call", date: day(3), buyerAgreed: true },
    contacts: [
      { personId: "per_a", role: "champion" },
      { personId: "per_b", role: "economic_buyer" },
      { personId: "per_c", role: "technical_approver" },
    ],
    card: {
      pain: { value: "Five-day close", quotes: [], status: "captured" },
      spend: { value: "A hire", quotes: [], status: "captured" },
      criticalEvent: { value: "Audit", quotes: [], status: "captured", date: day(60) },
      champion: { value: "Dana", quotes: [], status: "captured", name: "Dana Okafor", championStatus: "tested" },
      economicBuyer: { value: "CFO approves", quotes: [], status: "captured", name: "Marcus Lindqvist", engaged: true },
      fit: { value: "Strong", quotes: [], status: "captured" },
      decisionProcess: { value: "CFO signs, legal one week", quotes: [], status: "captured" },
    },
    lastActivityAt: at(-1),
    ...patch,
  });
}

function withDeals(...deals: Deal[]): Workspace {
  return makeWorkspace({ deals: Object.fromEntries(deals.map((d) => [d.id, d])), revenue: { target: Q4 } });
}

describe("periods", () => {
  it("finds the calendar quarter", () => {
    expect(quarterOf("2026-10-20")).toEqual({ start: "2026-10-01", end: "2026-12-31", label: "Q4 2026" });
    expect(quarterOf("2026-02-28")).toEqual({ start: "2026-01-01", end: "2026-03-31", label: "Q1 2026" });
  });

  it("counts what's left of the target period", () => {
    const p = periodOf(Q4, TODAY);
    expect(p).toMatchObject({ start: "2026-10-01", end: "2026-12-31", label: "Q4 new ARR", daysLeft: 73, weeksLeft: 11 });
    expect(periodOf(undefined, TODAY).label).toBe("Q4 2026");
    expect(periodOf(Q4, "2027-01-02").daysLeft).toBe(0);
  });
});

describe("revenueStats", () => {
  it("states priors until there is enough history", () => {
    const s = revenueStats(makeWorkspace(), TODAY);
    expect(s.winRate).toMatchObject({ source: "prior", value: 0.25, n: 0, need: MIN_OBSERVED });
    expect(s.cycleDays).toMatchObject({ source: "prior", value: PRIORS.cycleDays });
    expect(s.stageDays.proposal).toMatchObject({ source: "prior", value: PRIORS.stageDays.proposal });
  });

  it("shrinks a small sample toward the prior, and stands on its own at 30", () => {
    // 3 of 5 is not a 60% win rate: with the 25% prior counted as 10 deals it's 37%.
    expect(blended(0.25, 3, 5)).toMatchObject({ source: "blended", raw: 0.6 });
    expect(blended(0.25, 3, 5).value).toBeCloseTo(0.3667, 3);
    expect(blended(0.25, 12, 40)).toMatchObject({ source: "observed", value: 0.3 });
    expect(blended(0.25, 0, 0)).toMatchObject({ source: "prior", value: 0.25 });
  });

  it("uses the workspace's own medians once enough deals closed", () => {
    const deals = [
      ...[1, 2, 3, 4].map((i) => walked(`w${i}`, "won", 60, { amountUsd: 40_000 + i * 1000 })),
      walked("w5", "won", 40, { amountUsd: 30_000 }),
      ...[1, 2, 3, 4, 5, 6].map((i) => walked(`l${i}`, "lost", 50, { lossReason: "timing" })),
    ];
    const s = revenueStats(withDeals(...deals), TODAY);
    expect(s.winRate).toMatchObject({ source: "blended", n: 11, raw: 5 / 11 });
    expect(s.winRate.value).toBeCloseTo((5 + 2.5) / 21);
    expect(s.avgDealUsd).toMatchObject({ source: "observed", value: 42_000, n: 5 });
    expect(s.cycleDays.source).toBe("observed");
    expect(s.cycleDays.value).toBe(45);
  });
});

describe("deal risk", () => {
  it("finds nothing wrong with a deal that has everything", () => {
    const ws = withDeals(commitReady("ok"));
    const d = ws.deals.ok;
    expect(dealRisks(ws, d, revenueStats(ws, TODAY), TODAY)).toEqual([]);
    expect(healthOf([])).toBe(100);
  });

  it("names each gap, worst first, with a fix", () => {
    const deal = commitReady("risky", {
      closeDate: day(-3),
      closeDateHistory: [
        { date: day(-20), at: at(-30) },
        { date: day(-10), at: at(-21) },
        { date: day(-3), at: at(-11) },
      ],
      contacts: [{ personId: "per_a", role: "champion" }],
      nextStep: undefined,
      lastActivityAt: at(-8),
      card: { ...commitReady("x").card!, economicBuyer: { value: "CFO", quotes: [], status: "partial", name: "Marcus Lindqvist", engaged: false } },
    });
    const ws = withDeals(deal);
    const risks = dealRisks(ws, deal, revenueStats(ws, TODAY), TODAY);
    expect(risks.map((r) => `${r.code}:${r.severity}`)).toEqual([
      "close_passed:high",
      "close_slipped:high",
      "no_next_step:high",
      "single_threaded:high",
      "economic_buyer_not_engaged:high",
      "quiet:medium",
    ]);
    expect(closeDateSlips(deal)).toBe(2);
    expect(risks.every((r) => r.fix.label && (r.fix.href || r.fix.ask))).toBe(true);
    expect(healthBand(healthOf(risks), risks)).toBe("at_risk");
    // One medium risk is worth watching, even with a high score.
    expect(healthBand(85, [risks.find((r) => r.severity === "medium")!])).toBe("watch");
    expect(healthBand(95, [])).toBe("healthy");
  });

  it("calls a deal stalled against the typical time in its stage", () => {
    const deal = commitReady("slow", { stageHistory: [{ stage: "talking", at: at(-90) }, { stage: "qualified", at: at(-80) }, { stage: "proposal", at: at(-25) }] });
    const ws = withDeals(deal);
    const stalled = dealRisks(ws, deal, revenueStats(ws, TODAY), TODAY).find((r) => r.code === "stalled");
    // 25 days in Proposal against a 14-day prior: past 1.5× (21 days), short of 2× (28), so medium.
    expect(stalled).toMatchObject({ severity: "medium", label: "Stalled in Proposal" });
  });
});

describe("the forecast call", () => {
  it("commits only a late-stage deal with the evidence", () => {
    const ws = withDeals(commitReady("ok"));
    const f = computeForecast(ws, TODAY);
    expect(f.calls[0]).toMatchObject({ codeCategory: "commit", category: "commit", called: false, inPeriod: true, band: "healthy" });
    expect(f.commit).toBe(50_000);
  });

  it("drops to best case and says why", () => {
    const deal = commitReady("eb", { card: { ...commitReady("x").card!, economicBuyer: { value: "CFO", quotes: [], status: "partial", engaged: false } } });
    const call = computeForecast(withDeals(deal), TODAY).calls[0];
    expect(call.category).toBe("best_case");
    expect(call.why).toBe("Not commit: the economic buyer isn't engaged.");
  });

  it("keeps early and out-of-period deals out of commit", () => {
    const ws = withDeals(makeDeal("early", "early.example", { amountUsd: 20_000 }), commitReady("later", { closeDate: "2027-02-10" }));
    const f = computeForecast(ws, TODAY);
    const by = Object.fromEntries(f.calls.map((c) => [c.deal.id, c]));
    expect(by.early.category).toBe("pipeline");
    expect(by.later.category).toBe("omitted");
    expect(f.next.pipeline).toBe(50_000);
  });

  it("lets the owner of the number call it, and keeps the code's call beside it", () => {
    const ws = withDeals(commitReady("ok", { forecastCall: { category: "best_case", at: at(0) } }));
    const call = computeForecast(ws, TODAY).calls[0];
    expect(call).toMatchObject({ codeCategory: "commit", category: "best_case", called: true });
  });

  it("counts a late deal in the period that's running", () => {
    const ws = withDeals(commitReady("late", { closeDate: day(-5) }));
    const call = computeForecast(ws, TODAY).calls[0];
    expect(call.inPeriod).toBe(true);
    expect(call.category).toBe("best_case");
  });

  it("estimates an undated deal's close and amount from the typical deal", () => {
    const ws = withDeals(makeDeal("undated", "undated.example"));
    const call = callDeal(ws, ws.deals.undated, revenueStats(ws, TODAY), periodOf(Q4, TODAY), TODAY);
    expect(call.closeEstimated).toBe(true);
    expect(call.amount.source).toBe("average");
    expect(call.closeDate > TODAY).toBe(true);
  });

  it("adds up commit, best case, pipeline and coverage", () => {
    const won = walked("won", "won", 40, { amountUsd: 30_000, stageHistory: [{ stage: "talking", at: at(-40) }, { stage: "won", at: at(-5) }] });
    const ws = withDeals(won, commitReady("c1"), commitReady("b1", { contacts: [] }), makeDeal("p1", "p1.example", { amountUsd: 10_000 }));
    const f = computeForecast(ws, TODAY);
    expect(f.closedWon.usd).toBe(30_000);
    expect(f.commit).toBe(80_000);
    expect(f.bestCase).toBe(130_000);
    expect(f.pipeline).toBe(140_000);
    expect(f.remaining).toBe(170_000);
    expect(f.coverage).toBeCloseTo(110_000 / 170_000);
  });
});

describe("floor, call, ceiling and the odds", () => {
  it("weights each deal by its category and computes the chance of reaching the target", () => {
    const won = walked("won", "won", 40, { amountUsd: 30_000, stageHistory: [{ stage: "talking", at: at(-40) }, { stage: "won", at: at(-5) }] });
    const ws = withDeals(won, commitReady("c1"), commitReady("b1", { closeDate: day(25), contacts: [{ personId: "per_a", role: "champion" }] }));
    const f = computeForecast(ws, TODAY);
    // 30 won + 50 × .9 commit + 50 × .5 best case.
    expect(f.call).toBe(100_000);
    expect(f.hitChance).toBeCloseTo(0, 5);
    ws.revenue!.target = { ...Q4, amountUsd: 80_000 };
    // Needs 50K more: the commit alone (.9) or the best case alone (.5): 1 − .1 × .5.
    expect(computeForecast(ws, TODAY).hitChance).toBeCloseTo(0.95, 5);
  });

  it("computes the chance exactly for independent deals", () => {
    expect(chanceToReach(0, [])).toBe(1);
    expect(chanceToReach(10_000, [{ usd: 10_000, p: 0.5 }, { usd: 10_000, p: 0.5 }])).toBeCloseTo(0.75);
    expect(chanceToReach(20_000, [{ usd: 10_000, p: 0.5 }, { usd: 10_000, p: 0.5 }])).toBeCloseTo(0.25);
  });

  it("keeps a deal out of commit for 30 days after its close date moved", () => {
    const ws = withDeals(commitReady("moved", { closeDateHistory: [{ date: day(10), at: at(-20) }, { date: day(20), at: at(-5) }] }));
    const call = computeForecast(ws, TODAY).calls[0];
    expect(call.category).toBe("best_case");
    expect(call.why).toContain("the close date moved in the last 30 days");
  });

  it("scores how much of the pipeline can be trusted", () => {
    const ws = withDeals(commitReady("full"), makeDeal("bare", "bare.example"));
    expect(computeForecast(ws, TODAY).dataTrust).toEqual({ score: 50, complete: 1, open: 2 });
  });
});

describe("the plan behind the number", () => {
  it("asks for a target first", () => {
    const plan = computePlan(makeWorkspace(), computeForecast(makeWorkspace(), TODAY), NOW);
    expect(plan.verdict).toBe("no_target");
  });

  it("works backward from the gap to first meetings, with the cutoff", () => {
    const ws = withDeals(commitReady("c1"));
    const f = computeForecast(ws, TODAY);
    const plan = computePlan(ws, f, NOW);
    // 200K target; one 50K proposal at 65% → 32.5K expected; gap 167.5K at a 35K typical deal.
    expect(plan.expected).toBe(32_500);
    expect(plan.gap).toBe(167_500);
    expect(plan.dealsNeeded).toBe(5);
    expect(plan.qualifiedNeeded).toBe(20);
    // The open proposal counts as a first meeting that qualified: (1 + 0.5 × 10) ÷ 11 ≈ 55%.
    expect(plan.meetingsNeeded).toBe(37);
    expect(plan.cutoff).toBe("2026-11-01");
    expect(plan.weeksToCutoff).toBe(2);
    expect(plan.verdict).toBe("behind");
    expect(plan.headline).toContain("37 first meetings by Nov 1");
    expect(plan.levers.length).toBeGreaterThan(0);
  });

  it("says when new pipeline can't land in time", () => {
    const ws = withDeals(commitReady("c1"));
    ws.revenue!.target = { ...Q4, periodEnd: "2026-11-30" };
    const plan = computePlan(ws, computeForecast(ws, TODAY), NOW);
    expect(plan.verdict).toBe("too_late");
  });

  it("calls the period once the target is closed", () => {
    const won = walked("won", "won", 40, { amountUsd: 250_000, stageHistory: [{ stage: "talking", at: at(-40) }, { stage: "won", at: at(-5) }] });
    const ws = withDeals(won);
    expect(computePlan(ws, computeForecast(ws, TODAY), NOW).verdict).toBe("hit");
  });
});

describe("week over week", () => {
  it("explains what moved since the last snapshot", () => {
    const ws = withDeals(commitReady("slip"), commitReady("down"), commitReady("gone"), commitReady("fresh"));
    const before = computeForecast(ws, TODAY);
    const snap: ForecastSnapshot = { ...takeSnapshot(before, at(-7)), weekOf: "2026-10-12", deals: takeSnapshot(before, at(-7)).deals.filter((d) => d.id !== "fresh") };
    ws.revenue!.snapshots = [snap];
    ws.deals.slip.closeDate = "2027-01-20";
    ws.deals.down.contacts = [];
    ws.deals.gone.stage = "won";
    ws.deals.gone.stageHistory.push({ stage: "won", at: at(0) });
    const changes = forecastChanges(ws, baseline(ws, TODAY), computeForecast(ws, TODAY));
    const kinds = Object.fromEntries(changes.map((c) => [c.dealId, c.kind]));
    expect(kinds).toEqual({ slip: "pushed", down: "down", gone: "won", fresh: "new" });
    expect(changes.find((c) => c.dealId === "slip")?.text).toContain("out of this period");
  });

  it("has no baseline in the first week", () => {
    expect(baseline(makeWorkspace(), TODAY)).toBeUndefined();
  });
});

describe("what's working", () => {
  it("groups deals by source and losses by reason", () => {
    const ws = withDeals(
      walked("w1", "won", 60, { amountUsd: 40_000, source: "warm_intro" }),
      walked("l1", "lost", 50, { source: "signal_cold", lossReason: "build" }),
      walked("l2", "lost", 50, { source: "signal_cold", lossReason: "build" }),
      commitReady("o1", { source: "signal_cold" }),
    );
    const stats = revenueStats(ws, TODAY);
    const rows = Object.fromEntries(bySource(ws, stats).map((r) => [r.key, r]));
    expect(rows.warm_intro).toMatchObject({ deals: 1, won: 1, wonUsd: 40_000, winRate: { value: 1, n: 1 } });
    expect(rows.signal_cold).toMatchObject({ deals: 3, lost: 2, open: 1, openUsd: 50_000, winRate: { value: 0, n: 2 } });
    expect(lossReasons(ws, stats)[0]).toMatchObject({ reason: "build", count: 2, stage: "qualified" });
  });
});

describe("on the sample workspace", () => {
  it("calls every open deal and keeps the numbers consistent", () => {
    const ws = sampleWorkspace(NOW);
    ws.revenue = { target: Q4 };
    ws.people.per_a = makePerson("per_a", "a.example");
    ws.accounts["a.example"] = makeAccount("a.example");
    const f = computeForecast(ws, TODAY);
    expect(f.calls.map((c) => c.deal.stage).sort()).toEqual(["pilot", "proposal", "qualified", "talking"]);
    expect(f.commit).toBeLessThanOrEqual(f.bestCase);
    expect(f.bestCase).toBeLessThanOrEqual(f.pipeline);
    expect(f.closedWon.usd).toBe(30_000);
    expect(money(f.pipeline)).toMatch(/^\$\d+K$/);
  });
});
