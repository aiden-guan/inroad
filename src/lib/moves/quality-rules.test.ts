import { describe, expect, it } from "vitest";
import { applyAction } from "@/lib/domain/actions";
import { NOW, at, makePackage, makeWorkspace } from "@/test/factories";
import { computeMoves } from "./rules";

/** "Show me what bad looks like" (SPEC §4.0): optional, from day 3 to day 14 after hiring, once there's a cold draft. */
describe("bad examples card", () => {
  const card = (hiredDaysAgo: number, cold = true) => {
    const ws = makeWorkspace();
    ws.onboarding = { status: "hired", hiredAt: at(-hiredDaysAgo) };
    if (cold) ws.outreach.o1 = makePackage("o1", "a.example");
    return { ws, moves: computeMoves(ws, NOW).filter((m) => m.rule === "today.bad_examples") };
  };

  it("shows on day 3 with a cold draft, and not before, after day 14 or without one", () => {
    expect(card(3).moves).toEqual([expect.objectContaining({ id: "mv_bad_examples", title: "Show me what bad looks like", priority: 28, kind: "setup" })]);
    expect(card(2).moves).toEqual([]);
    expect(card(15).moves).toEqual([]);
    expect(card(5, false).moves).toEqual([]);
  });

  it("goes once the founder pasted some", () => {
    const { ws } = card(4);
    applyAction(ws, { type: "voice.addBadExamples", texts: ["Hi Dana, I hope this email finds you well and that you are having a great week so far, truly."], at: at(0) });
    expect(computeMoves(ws, NOW).filter((m) => m.rule === "today.bad_examples")).toEqual([]);
  });
});
