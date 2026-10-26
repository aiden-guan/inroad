import { describe, expect, it } from "vitest";
import type { Move } from "@/lib/domain/types";
import { sampleWorkspace } from "@/lib/sample";
import { NOW, TODAY, day, makeAccount, makeDeal, makeMove, makeWorkspace } from "@/test/factories";
import { TOP_MOVES, visibleMoves } from "./rules";
import { customerCount, goalLine, todayCounts } from "./nav-counts";

const moves = (list: Move[]) => Object.fromEntries(list.map((m) => [m.id, m]));

describe("todayCounts", () => {
  it("never says more are ready than Today shows as cards; the rest are Later", () => {
    const twelve = moves(Array.from({ length: 12 }, (_, i) => makeMove(`mv_${i}`)));
    expect(todayCounts(twelve, TODAY)).toEqual({ ready: TOP_MOVES, later: 12 - TOP_MOVES });
    expect(todayCounts(moves([makeMove("a"), makeMove("b")]), TODAY)).toEqual({ ready: 2, later: 0 });
    expect(todayCounts({}, TODAY)).toEqual({ ready: 0, later: 0 });
  });

  it("counts exactly the moves Today lists: due today, open or back from a snooze", () => {
    const list = moves([
      makeMove("open"),
      makeMove("tomorrow", { dueOn: day(1) }),
      makeMove("done", { status: "done" }),
      makeMove("skipped", { status: "skipped" }),
      makeMove("back", { status: "snoozed", snoozedUntil: TODAY }),
      makeMove("still_snoozed", { status: "snoozed", snoozedUntil: day(2) }),
    ]);
    const { ready, later } = todayCounts(list, TODAY);
    expect(ready + later).toBe(visibleMoves(list, TODAY).length);
    expect(ready).toBe(2);
  });

  it("matches Today on the sample workspace", () => {
    const ws = sampleWorkspace(NOW);
    const visible = visibleMoves(ws.moves, TODAY).length;
    expect(todayCounts(ws.moves, TODAY)).toEqual({ ready: Math.min(visible, TOP_MOVES), later: Math.max(0, visible - TOP_MOVES) });
  });
});

describe("goalLine", () => {
  it("reads paid pilots against the goal and customers against the long arc", () => {
    const ws = makeWorkspace();
    ws.goal = { ...ws.goal, target: 5, longArcCustomers: 20 };
    expect(goalLine(ws)).toEqual({ pilots: [0, 5], customers: [0, 20] });

    ws.accounts["won.io"] = makeAccount("won.io", { status: "customer" });
    ws.deals.d1 = makeDeal("d1", "won.io", { stage: "won" });
    ws.accounts["paid.io"] = makeAccount("paid.io", { status: "in_pipeline" });
    ws.deals.d2 = makeDeal("d2", "paid.io", { stage: "pilot", pilot: { criteria: "Closes the month in a day", paid: true } });
    // A customer that came in without a deal (an import, a known user) counts as a customer, not a pilot.
    ws.accounts["imported.io"] = makeAccount("imported.io", { status: "customer" });
    expect(goalLine(ws)).toEqual({ pilots: [2, 5], customers: [2, 20] });
  });

  it("counts a company once however many deals it won", () => {
    const ws = makeWorkspace();
    ws.accounts["acme.io"] = makeAccount("acme.io", { status: "customer" });
    ws.deals.a = makeDeal("a", "acme.io", { stage: "won" });
    ws.deals.b = makeDeal("b", "acme.io", { stage: "won" });
    expect(customerCount(ws)).toBe(1);
  });
});
