import { describe, expect, it } from "vitest";
import type { Foundation, Move, Workspace } from "@/lib/domain/types";
import { at, makeAccount, makeActivity, makeDeal, makeMeeting, makeWorkspace } from "@/test/factories";
import { computeMoves } from "./rules";

/** The review loop on Today: the monthly review on the first open of the month, the refresh offer between, and what wakes the weekly reviews. */

const ofRule = (moves: Move[], rule: string) => moves.filter((m) => m.rule === `today.${rule}`);

function workspace(hiredAt: string): Workspace {
  const ws = makeWorkspace({ foundation: { version: 3, generatedAt: hiredAt, personas: [], positioning: { bestFit: [] }, icp: { criteria: [], hypothesis: { sentence: "" } }, messaging: {}, founderQuestions: [] } as unknown as Foundation });
  ws.onboarding = { status: "hired", hiredAt };
  ws.accounts["acme.example"] = makeAccount("acme.example");
  ws.deals.deal_acme = makeDeal("deal_acme", "acme.example");
  return ws;
}

describe("monthly review", () => {
  it("shows from the first open of the month, once a full month has passed since hiring", () => {
    const ws = workspace(new Date(2026, 8, 3).toISOString());
    const nov2 = new Date(2026, 10, 2, 9);
    const [m] = ofRule(computeMoves(ws, nov2), "review_monthly");
    expect(m).toMatchObject({ id: "mv_review_monthly_2026-11", kind: "review", title: "Monthly review", priority: 58 });
    expect(m.why).toBe("0 calls since the bet was last revised · pick next month's message bet");
    // A founder who first opens the app late in the month still gets it, lower down; same card, so a skip holds.
    const [late] = ofRule(computeMoves(ws, new Date(2026, 10, 20, 9)), "review_monthly");
    expect(late).toMatchObject({ id: "mv_review_monthly_2026-11", priority: 24 });
    // Hired this month: there's no month to review yet.
    expect(ofRule(computeMoves(workspace(new Date(2026, 10, 1, 8).toISOString()), nov2), "review_monthly")).toEqual([]);
  });
});

describe("refresh offer", () => {
  function withCalls(ws: Workspace, n: number) {
    for (let i = 0; i < n; i++) {
      ws.meetings[`m${i}`] = makeMeeting(`m${i}`, "deal_acme", { startsAt: at(-10 + i), debrief: { generatedAt: at(-10 + i) } as unknown as NonNullable<Workspace["meetings"][string]["debrief"]> });
    }
  }

  it("appears after five debriefed calls since the bet was last revised", () => {
    // Hired this month, so no monthly review covers it yet.
    const ws = workspace(at(-15));
    withCalls(ws, 4);
    const tuesday = new Date(2026, 9, 20, 9, 30);
    expect(ofRule(computeMoves(ws, tuesday), "refresh_bet")).toEqual([]);
    withCalls(ws, 5);
    const [m] = ofRule(computeMoves(ws, tuesday), "refresh_bet");
    expect(m).toMatchObject({ title: "Rebuild the bet from your last 5 calls", href: "/playbook#refresh", priority: 42 });
    expect(m.id).toBe(`mv_refresh_bet_${at(-15).slice(0, 10)}`);
  });

  it("stands down while the monthly review covers it", () => {
    const ws = workspace(new Date(2026, 8, 3).toISOString());
    withCalls(ws, 6);
    const moves = computeMoves(ws, new Date(2026, 10, 2, 9));
    expect(ofRule(moves, "review_monthly")).toHaveLength(1);
    expect(ofRule(moves, "refresh_bet")).toEqual([]);
    // Late in the month it keeps the rank of the offer it stands in for.
    expect(ofRule(computeMoves(ws, new Date(2026, 10, 25, 9)), "review_monthly")[0].priority).toBe(42);
  });

  it("comes back once the founder sets the monthly card aside", () => {
    const ws = workspace(new Date(2026, 8, 3).toISOString());
    withCalls(ws, 6);
    const tuesday = new Date(2026, 9, 20, 9, 30);
    expect(ofRule(computeMoves(ws, tuesday), "refresh_bet")).toEqual([]);
    ws.moves["mv_review_monthly_2026-10"] = { ...ofRule(computeMoves(ws, tuesday), "review_monthly")[0], status: "skipped", skipReason: "not_relevant_now" };
    expect(ofRule(computeMoves(ws, tuesday), "refresh_bet")).toHaveLength(1);
  });
});

describe("weekly reviews", () => {
  it("wake for sends on any channel, not only emails logged as sent", () => {
    const ws = makeWorkspace();
    const saturday = new Date(2026, 9, 24, 10);
    expect(ofRule(computeMoves(ws, saturday), "review_friday")).toEqual([]);
    // Drafts handed to a sequencer, and a LinkedIn note: the week had sends to learn from.
    ws.activities.push(makeActivity("act_push", { kind: "pushed", personId: "per_a", at: new Date(2026, 9, 21, 9).toISOString() }));
    ws.activities.push(makeActivity("act_li", { kind: "linkedin_dm", personId: "per_b", at: new Date(2026, 9, 22, 9).toISOString() }));
    const [friday] = ofRule(computeMoves(ws, saturday), "review_friday");
    expect(friday).toMatchObject({ id: "mv_review_friday_2026-10-19", why: "2 touches this week · no replies yet" });
    expect(ofRule(computeMoves(ws, saturday), "review_monday")).toHaveLength(1);
  });
});
