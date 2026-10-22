import { describe, expect, it } from "vitest";
import type { Move } from "@/lib/domain/types";
import { sampleWorkspace } from "@/lib/sample";
import { NOW, TODAY, day, makeMove } from "@/test/factories";
import { TOP_MOVES, visibleMoves } from "./rules";
import { todayCounts } from "./nav-counts";

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
