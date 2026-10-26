import { describe, expect, it } from "vitest";
import { TODAY, consumerWorkspace, day, makeWeek } from "@/test/factories";
import { usersPerArm, viralMultiplier } from "./benchmarks";
import { hasLoggedLastWeek, lastWeekOf, readGrowth, sizeExperiment } from "./growth";

/** TODAY is Tuesday 2026-10-20, so last week starts Monday 2026-10-12. */
const LAST = "2026-10-12";

describe("readGrowth", () => {
  it("asks for numbers before it judges anything", () => {
    const g = readGrowth(consumerWorkspace(), TODAY);
    expect(g.latest).toBeUndefined();
    expect(g.focus).toBe("acquisition");
    expect(g.verdicts.map((v) => v.id)).toEqual(["no_numbers"]);
    expect(g.paidAllowed).toBe(false);
    expect(g.goal).toEqual({ current: null, target: 100, label: "weekly active users" });
  });

  it("holds paid spend while week-4 retention is under the bar", () => {
    const ws = consumerWorkspace({ growthLog: [makeWeek(LAST, { signups: 120, activated: 50, active: 300, retainedPct: 22, spendUsd: 400 })] });
    const g = readGrowth(ws, TODAY);
    // A subscription app is held to the consumer-subscription bar: 40% good, 70% great.
    expect(g.model.retention).toMatchObject({ metric: "w4", target: 40, good: 70 });
    expect(g.retentionStatus).toBe("below");
    expect(g.paidAllowed).toBe(false);
    expect(g.verdicts[0]).toMatchObject({ id: "paid_before_retention", severity: "block" });
    expect(g.verdicts.some((v) => v.id === "retention_below")).toBe(true);
    expect(g.focus).toBe("retention");
    expect(g.goal.current).toBe(300);
  });

  it("holds paid spend when there is no retention reading at all", () => {
    const g = readGrowth(consumerWorkspace({ growthLog: [makeWeek(LAST, { signups: 80, spendUsd: 150 })] }), TODAY);
    expect(g.verdicts[0].title).toBe("Hold paid spend until you can see week-4 retention");
  });

  it("flags activation under the median before retention", () => {
    const g = readGrowth(consumerWorkspace({ growthLog: [makeWeek(LAST, { signups: 100, activated: 15 })] }), TODAY);
    expect(g.activationRate).toBe(15);
    expect(g.verdicts.find((v) => v.id === "activation_low")?.title).toContain("15%");
    expect(g.focus).toBe("activation");
  });

  it("hides rates below 20 signups", () => {
    const g = readGrowth(consumerWorkspace({ growthLog: [makeWeek(LAST, { signups: 12, activated: 1, referred: 6 })] }), TODAY);
    expect(g.activationRate).toBeUndefined();
    expect(g.referredShare).toBeUndefined();
    expect(g.focus).toBe("acquisition");
  });

  it("says when retention holds and points at the loop", () => {
    const ws = consumerWorkspace({
      growthLog: [
        makeWeek(day(-22), { signups: 60, activated: 30, retainedPct: 72 }),
        makeWeek(day(-15), { signups: 70, activated: 35, retainedPct: 71 }),
        makeWeek(LAST, { signups: 80, activated: 40, retainedPct: 73, referred: 4 }),
      ],
    });
    const g = readGrowth(ws, TODAY);
    expect(g.retentionTrend).toBe("flat");
    expect(g.retentionHolds).toBe(true);
    expect(g.paidAllowed).toBe(true);
    expect(g.verdicts.some((v) => v.id === "retention_strong")).toBe(true);
    // 4 of 80 from a friend is 5%: under the 15% where referrals work, so the loop is the focus.
    expect(g.focus).toBe("referral");
  });

  it("catches falling retention even above the bar", () => {
    const ws = consumerWorkspace({
      growthLog: [makeWeek(day(-22), { retainedPct: 60 }), makeWeek(day(-15), { retainedPct: 52 }), makeWeek(LAST, { retainedPct: 45 })],
    });
    const g = readGrowth(ws, TODAY);
    expect(g.retentionTrend).toBe("falling");
    expect(g.retentionHolds).toBe(false);
    expect(g.verdicts.some((v) => v.id === "retention_falling")).toBe(true);
  });

  it("uses the 90-day repeat bar for DTC and counts customers for the goal", () => {
    const ws = consumerWorkspace({ growthLog: [makeWeek(LAST, { signups: 40, paying: 64, retainedPct: 14 })] }, "dtc");
    const g = readGrowth(ws, TODAY);
    expect(g.model.retention).toMatchObject({ metric: "m3_repeat", target: 12, good: 18.8 });
    expect(g.retentionStatus).toBe("at_bar");
    expect(g.goal.current).toBe(64);
  });

  it("computes quick ratio, CAC and payback in code", () => {
    // $1,000 for 10 new paying customers = $100 each; $2,400 a week across 400 paying ≈ $26/month each.
    const ws = consumerWorkspace({ growthLog: [makeWeek(LAST, { signups: 200, paying: 400, newPaying: 10, churnedPaying: 20, revenueUsd: 2400, spendUsd: 1000, retainedPct: 45 })] });
    const g = readGrowth(ws, TODAY);
    expect(g.quickRatio).toBe(0.5);
    expect(g.cac).toBe(100);
    expect(g.cacBasis).toBe("paying");
    expect(g.arpuMonthly).toBeCloseTo(26, 0);
    expect(g.paybackMonths).toBeCloseTo(3.85, 1);
    expect(g.verdicts.some((v) => v.id === "quick_ratio")).toBe(true);
    expect(g.verdicts.some((v) => v.id === "payback")).toBe(false);
  });

  it("reads the 40% survey only with enough answers", () => {
    const few = readGrowth(consumerWorkspace({ pmfSurveys: [{ id: "p1", on: TODAY, answers: 20, veryDisappointed: 12 }] }), TODAY);
    expect(few.pmf).toMatchObject({ score: 60, readable: false });
    expect(few.verdicts.some((v) => v.id === "pmf_survey")).toBe(false);
    const enough = readGrowth(consumerWorkspace({ pmfSurveys: [{ id: "p1", on: TODAY, answers: 50, veryDisappointed: 15 }] }), TODAY);
    expect(enough.verdicts.find((v) => v.id === "pmf_survey")).toMatchObject({ severity: "warn" });
  });

  it("ignores weeks logged for the future", () => {
    const g = readGrowth(consumerWorkspace({ growthLog: [makeWeek(day(7), { signups: 999 })] }), TODAY);
    expect(g.latest).toBeUndefined();
  });
});

describe("weekly logging", () => {
  it("asks for last week until it exists", () => {
    expect(lastWeekOf(TODAY)).toBe(LAST);
    expect(hasLoggedLastWeek(consumerWorkspace(), TODAY)).toBe(false);
    expect(hasLoggedLastWeek(consumerWorkspace({ growthLog: [makeWeek(LAST)] }), TODAY)).toBe(true);
  });
});

describe("experiment math", () => {
  it("sizes an A/B test with Lehr's rule", () => {
    // 16 · 0.1 · 0.9 ÷ 0.02² = 3,600 users per variant for a 10% → 12% change.
    expect(usersPerArm(0.1, 0.2)).toBe(3600);
    expect(usersPerArm(0, 0.2)).toBeNull();
    expect(usersPerArm(0.1, 0)).toBeNull();
  });

  it("calls a test unreadable when it would take more than two months of signups", () => {
    expect(sizeExperiment({ baseline: 0.1 }, 1000)).toEqual({ perArm: 3600, weeksToRead: 8, abReadable: true });
    expect(sizeExperiment({ baseline: 0.1 }, 100)).toEqual({ perArm: 3600, weeksToRead: 72, abReadable: false });
    expect(sizeExperiment({}, 100)).toEqual({ perArm: null, weeksToRead: null, abReadable: false });
  });

  it("turns K into the total each user brings", () => {
    expect(viralMultiplier(0.5)).toBe(2);
    expect(viralMultiplier(0)).toBe(1);
    expect(viralMultiplier(1.2)).toBeNull();
  });
});
