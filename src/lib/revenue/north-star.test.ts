import { describe, expect, it } from "vitest";
import { sampleWorkspace } from "@/lib/sample";
import { NOW, TODAY, at, consumerWorkspace, makeAccount, makeDeal, makeWeek, makeWorkspace, day } from "@/test/factories";
import { computeForecast, money } from "./forecast";
import { northStar } from "./north-star";

const quarter = { amountUsd: 150_000, periodStart: "2026-10-01", periodEnd: "2026-12-31", label: "Q4 new ARR" };

describe("northStar", () => {
  it("reads the goal from the plan until a revenue target is set, and links to Revenue", () => {
    const ws = makeWorkspace();
    ws.goal = { ...ws.goal, target: 5 };
    ws.accounts["paid.io"] = makeAccount("paid.io", { status: "in_pipeline" });
    ws.deals.d1 = makeDeal("d1", "paid.io", { stage: "pilot", pilot: { criteria: "Closes the month in a day", paid: true } });
    expect(northStar(ws, TODAY)).toMatchObject({
      kind: "goal",
      text: "1 of 5 paid pilots",
      label: "Goal",
      value: 1,
      target: 5,
      progress: 0.2,
      href: "/revenue",
      description: "Your goal, from the plan: 1 of 5 paid pilots.",
    });
  });

  it("says one paid pilot in the singular", () => {
    const ws = makeWorkspace();
    ws.goal = { ...ws.goal, target: 1 };
    expect(northStar(ws, TODAY).text).toBe("0 of 1 paid pilot");
  });

  it("reads the revenue target as committed against the target, from the forecast code", () => {
    const ws = makeWorkspace({ revenue: { target: quarter } });
    ws.accounts["won.io"] = makeAccount("won.io", { status: "customer" });
    ws.deals.won = makeDeal("won", "won.io", { stage: "won", amountUsd: 30_000, stageHistory: [{ stage: "talking", at: at(-40) }, { stage: "won", at: at(-5) }] });
    ws.accounts["commit.io"] = makeAccount("commit.io", { status: "in_pipeline" });
    // Called commit by the owner of the number: it counts toward committed whatever code would call it.
    ws.deals.commit = makeDeal("commit", "commit.io", { stage: "proposal", amountUsd: 36_000, closeDate: day(20), forecastCall: { category: "commit", at: at(-1) } });
    const f = computeForecast(ws, TODAY);
    expect(f.commit).toBe(66_000);
    const star = northStar(ws, TODAY);
    expect(star).toMatchObject({ kind: "revenue", label: "Q4 new ARR", value: f.commit, target: 150_000, href: "/revenue" });
    expect(star.text).toBe(`${money(f.commit)} of $150K committed`);
    expect(star.description).toBe(`Q4 new ARR: ${star.text}, counted from your deals.`);
    expect(star.progress).toBeCloseTo(f.commit / 150_000);
  });

  it("caps progress at the target", () => {
    const ws = makeWorkspace({ revenue: { target: { ...quarter, amountUsd: 10_000 } } });
    ws.accounts["won.io"] = makeAccount("won.io", { status: "customer" });
    ws.deals.won = makeDeal("won", "won.io", { stage: "won", amountUsd: 30_000, stageHistory: [{ stage: "won", at: at(-5) }] });
    const star = northStar(ws, TODAY);
    expect(star.value).toBeGreaterThan(star.target);
    expect(star.progress).toBe(1);
  });

  it("matches the sample's forecast: commit of the $150K quarter", () => {
    const ws = sampleWorkspace(NOW);
    const star = northStar(ws, TODAY);
    expect(star.kind).toBe("revenue");
    expect(star.text).toBe(`${money(computeForecast(ws, TODAY).commit)} of $150K committed`);
  });

  it("keeps a consumer company on its growth goal, linked to Growth, even with a revenue target on file", () => {
    const ws = consumerWorkspace({ growthLog: [makeWeek(day(-14), { active: 22 }), makeWeek(day(-7), { active: 37 })], revenue: { target: quarter } });
    expect(northStar(ws, TODAY)).toMatchObject({ kind: "goal", text: "37 of 100 weekly active users", href: "/growth" });
  });
});
