import { describe, expect, it } from "vitest";
import { applyAction } from "@/lib/domain/actions";
import type { Signal, Workspace } from "@/lib/domain/types";
import { computeMoves } from "@/lib/moves/rules";
import { sampleWorkspace } from "@/lib/sample";
import { NOW, TODAY, at, day, makeAccount, makeActivity, makeDeal, makePerson, makeWorkspace } from "@/test/factories";
import { PLAY_BY_ID, PLAYS, playEnabled, playForSignal, playMatches, playResults } from "./catalog";

function signal(id: string, type: Signal["type"], daysAgo: number, strength: Signal["strength"] = 2): Signal {
  return { id, type, headline: `${type} headline`, date: day(-daysAgo), url: `https://news.example/${id}`, host: "news.example", strength, usableInOutreach: true, implication: "" };
}

describe("the play catalog", () => {
  it("gives every play a trigger, a reason, coaching and an action", () => {
    expect(new Set(PLAYS.map((p) => p.id)).size).toBe(PLAYS.length);
    for (const p of PLAYS) {
      expect(p.trigger.length).toBeGreaterThan(20);
      expect(p.why.length).toBeGreaterThan(20);
      expect(p.coach.length).toBeGreaterThan(20);
      expect(p.action.label).toBeTruthy();
    }
  });

  it("maps each signal type to at most one play", () => {
    expect(playForSignal("new_leader")).toBe("new_leader");
    expect(playForSignal("jd_names_pain")).toBe("hiring_for_pain");
    expect(playForSignal("filing")).toBe("funding");
    expect(playForSignal("champion_job_change")).toBe("champion_moved");
    expect(playForSignal("sensitive")).toBeUndefined();
    const owners = PLAYS.flatMap((p) => p.signals ?? []);
    expect(new Set(owners).size).toBe(owners.length);
  });

  it("runs every play unless it was paused", () => {
    const ws = makeWorkspace();
    expect(playEnabled(ws, "funding")).toBe(true);
    applyAction(ws, { type: "play.set", id: "funding", enabled: false, at: at(0) });
    expect(playEnabled(ws, "funding")).toBe(false);
  });
});

describe("matching", () => {
  it("matches a fresh signal at an A or B prospect, and marks it worked once touched", () => {
    const ws = makeWorkspace({
      accounts: {
        "a.example": makeAccount("a.example", { signals: [signal("s1", "new_leader", 20)] }),
        "old.example": makeAccount("old.example", { signals: [signal("s2", "new_leader", 120)] }),
        "c.example": makeAccount("c.example", { tier: "C", signals: [signal("s3", "new_leader", 5)] }),
      },
    });
    const play = PLAY_BY_ID.new_leader;
    expect(playMatches(ws, play, TODAY).map((m) => [m.domain, m.worked])).toEqual([["a.example", false]]);
    ws.activities.push(makeActivity("t1", { kind: "touch_sent", accountDomain: "a.example", at: at(-2) }));
    expect(playMatches(ws, play, TODAY)[0].worked).toBe(true);
  });

  it("skips companies with an open deal", () => {
    const ws = makeWorkspace({
      accounts: { "a.example": makeAccount("a.example", { dealId: "d1", signals: [signal("s1", "funding", 10)] }) },
      deals: { d1: makeDeal("d1", "a.example", { stage: "qualified" }) },
    });
    expect(playMatches(ws, PLAY_BY_ID.funding, TODAY)).toEqual([]);
  });

  it("revisits losses to timing after 90 days, never losses to fit", () => {
    const lost = (id: string, reason: "timing" | "not_icp", daysAgo: number) =>
      makeDeal(id, `${id}.example`, { stage: "lost", lossReason: reason, stageHistory: [{ stage: "talking", at: at(-daysAgo - 30) }, { stage: "lost", at: at(-daysAgo) }] });
    const ws = makeWorkspace({
      deals: { a: lost("a", "timing", 120), b: lost("b", "timing", 30), c: lost("c", "not_icp", 120) },
      accounts: { "a.example": makeAccount("a.example"), "b.example": makeAccount("b.example"), "c.example": makeAccount("c.example") },
    });
    expect(playMatches(ws, PLAY_BY_ID.closed_lost_revisit, TODAY).map((m) => m.dealId)).toEqual(["a"]);
  });

  it("asks customers for a referral after first value, once", () => {
    const ws = makeWorkspace({
      deals: { w: makeDeal("w", "w.example", { stage: "won", stageHistory: [{ stage: "talking", at: at(-120) }, { stage: "won", at: at(-60) }], contacts: [{ personId: "per_w", role: "champion" }] }) },
      people: { per_w: makePerson("per_w", "w.example", { name: "Wren Example" }) },
    });
    expect(playMatches(ws, PLAY_BY_ID.customer_referral, TODAY)).toMatchObject([{ dealId: "w", personName: "Wren Example" }]);
    ws.activities.push(makeActivity("ask", { kind: "intro_requested", accountDomain: "w.example", at: at(-3) }));
    expect(playMatches(ws, PLAY_BY_ID.customer_referral, TODAY)).toEqual([]);
  });
});

describe("event follow-up", () => {
  it("follows up guests within two weeks, leaving guests from open deals to the deal", () => {
    const ws = makeWorkspace({
      accounts: { "g.example": makeAccount("g.example"), "d.example": makeAccount("d.example", { dealId: "d" }) },
      people: { per_g: makePerson("per_g", "g.example", { name: "Gia Guest" }), per_d: makePerson("per_d", "d.example") },
      deals: { d: makeDeal("d", "d.example", { stage: "qualified" }) },
      activities: [
        makeActivity("a1", { kind: "event_attended", personId: "per_g", accountDomain: "g.example", at: at(-3) }),
        makeActivity("a2", { kind: "event_attended", personId: "per_d", accountDomain: "d.example", at: at(-3) }),
      ],
    });
    expect(playMatches(ws, PLAY_BY_ID.event_follow_up, TODAY).map((m) => m.personName)).toEqual(["Gia Guest"]);
    ws.activities.push(makeActivity("t", { kind: "touch_sent", personId: "per_g", accountDomain: "g.example", at: at(-1) }));
    expect(playMatches(ws, PLAY_BY_ID.event_follow_up, TODAY)).toEqual([]);
  });
});

describe("plays on Today", () => {
  it("takes a paused play's cards off Today", () => {
    const ws: Workspace = sampleWorkspace(NOW);
    const ids = () => computeMoves(ws, NOW).map((m) => m.id);
    expect(ids()).toContain("mv_signal_glassmoor.example_sig_gm_job");
    expect(computeMoves(ws, NOW).find((m) => m.id === "mv_signal_glassmoor.example_sig_gm_job")?.playId).toBe("champion_moved");
    applyAction(ws, { type: "play.set", id: "champion_moved", enabled: false, at: at(0) });
    expect(ids().filter((id) => id.startsWith("mv_signal_glassmoor") || id.startsWith("mv_signal_hollowpine"))).toEqual([]);
  });

  it("puts a play's best unworked match on Today", () => {
    const ws: Workspace = sampleWorkspace(NOW);
    const cards = computeMoves(ws, NOW).filter((m) => m.rule === "today.play");
    expect(cards.map((m) => [m.playId, m.kind, m.ref?.id])).toEqual([
      ["closed_lost_revisit", "follow_up", "deal_larkspur"],
      ["lookalike", "research", "quayside.example"],
    ]);
    applyAction(ws, { type: "play.set", id: "lookalike", enabled: false, at: at(0) });
    expect(computeMoves(ws, NOW).some((m) => m.playId === "lookalike")).toBe(false);
  });
});

describe("results", () => {
  it("attributes touches, replies and deals after the play worked an account", () => {
    const ws = makeWorkspace({ deals: { d: makeDeal("d", "a.example", { stage: "qualified", amountUsd: 24_000, stageHistory: [{ stage: "talking", at: at(-4) }, { stage: "qualified", at: at(-2) }] }) } });
    applyAction(ws, { type: "play.run", id: "funding", domains: ["a.example", "b.example"], at: at(-10) });
    ws.activities.push(
      makeActivity("t", { kind: "touch_sent", accountDomain: "a.example", at: at(-9) }),
      makeActivity("r", { kind: "reply_received", accountDomain: "a.example", at: at(-8) }),
      makeActivity("old", { kind: "touch_sent", accountDomain: "b.example", at: at(-20) }),
    );
    expect(playResults(ws, PLAY_BY_ID.funding)).toEqual({ worked: 2, touched: 1, replied: 1, meetings: 0, pipeline: 1, pipelineUsd: 24_000, won: 0, wonUsd: 0 });
  });
});
