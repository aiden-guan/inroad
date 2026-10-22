import { describe, expect, it } from "vitest";
import type { Activity, ReviewProposal, Workspace } from "@/lib/domain/types";
import { at, makeActivity, makePackage, makeStep, makeWorkspace } from "@/test/factories";
import { BET_MIN_PER_ARM, activeBet, betArmFor, betEndsOn, betKey, betReadout, betSteer, betVerdict, inferDimension, nextArm, startedBets } from "./bets";

function addBet(ws: Workspace, id: string, bet: NonNullable<ReviewProposal["bet"]>, decidedAt: string, status: ReviewProposal["status"] = "applied") {
  const key = `${decidedAt.slice(0, 10)}:friday`;
  ws.briefs[key] ??= { date: decidedAt.slice(0, 10), kind: "friday", greeting: "", matters: [], generatedAt: decidedAt, proposals: [] };
  ws.briefs[key].proposals!.push({ id, kind: "message_bet", title: "bet", detail: "", bet, status, decidedAt });
}

const frameBet = { variable: "Advice ask vs 4T", control: "advice ask", variant: "4T", why: "", dimension: "frame" as const, controlKey: "founder_card", variantKey: "4t" };

describe("bet calendar", () => {
  it("runs to the end of the month after the one it started in", () => {
    expect(betEndsOn("2026-10-30")).toBe("2026-11-30");
    expect(betEndsOn("2026-12-02")).toBe("2027-01-31");
    expect(betEndsOn("2027-01-15")).toBe("2027-02-28");
  });

  it("only the newest started bet is active, and only while it lasts", () => {
    const ws = makeWorkspace();
    addBet(ws, "prop_old", frameBet, "2026-08-03T17:00:00.000Z");
    addBet(ws, "prop_open", frameBet, "2026-10-01T17:00:00.000Z", "open");
    expect(activeBet(ws, "2026-09-30")?.id).toBe("prop_old");
    expect(activeBet(ws, "2026-10-20")).toBeNull();
    addBet(ws, "prop_new", frameBet, "2026-10-16T17:00:00.000Z");
    expect(activeBet(ws, "2026-10-20")).toMatchObject({ id: "prop_new", startedOn: "2026-10-16", endsOn: "2026-11-30", controlKey: "founder_card", variantKey: "4t" });
    expect(startedBets(ws).map((b) => b.id)).toEqual(["prop_old", "prop_new"]);
  });
});

describe("dimensions and keys", () => {
  it("reads a dimension off an older bet's wording", () => {
    expect(inferDimension("Subject line: lowercase vs question")).toBe("subject_style");
    expect(inferDimension("advice ask vs observation frame")).toBe("frame");
    expect(inferDimension("VP Finance vs Controller persona")).toBe("persona");
    expect(inferDimension("Hiring trigger vs funding")).toBe("signal");
    expect(inferDimension("Something else entirely")).toBeUndefined();
  });

  it("keeps only keys code can match or force", () => {
    expect(betKey("persona", "Economic buyer")).toBe("economic_buyer");
    expect(betKey("signal", "first-hire")).toBe("first_hire");
    expect(betKey("channel", "LinkedIn")).toBe("linkedin");
    expect(betKey("frame", "4t")).toBe("4t");
    expect(betKey("frame", "referral")).toBeUndefined();
    expect(betKey("cta", "a question")).toBeUndefined();
  });
});

describe("arms", () => {
  it("alternates writing-bet drafts, control first", () => {
    const ws = makeWorkspace();
    addBet(ws, "prop_b", frameBet, at(-1));
    const bet = activeBet(ws, "2026-10-20")!;
    expect(nextArm(ws, bet)).toBe("control");
    ws.outreach.o1 = makePackage("o1", "a.example", { steps: [makeStep(1, { bet: { id: "prop_b", arm: "control" } })] });
    expect(nextArm(ws, bet)).toBe("variant");
    ws.outreach.o2 = makePackage("o2", "b.example", { steps: [makeStep(1, { bet: { id: "prop_b", arm: "variant" } })] });
    // Another bet's drafts don't count.
    ws.outreach.o3 = makePackage("o3", "c.example", { steps: [makeStep(1, { bet: { id: "prop_other", arm: "control" } })] });
    expect(nextArm(ws, bet)).toBe("control");
  });

  it("forces the arm's frame only when the peer-proof rule allows it", () => {
    const ws = makeWorkspace();
    addBet(ws, "prop_b", frameBet, at(-1));
    const bet = activeBet(ws, "2026-10-20")!;
    const steer = betSteer(bet, "variant", ["founder_card", "4t", "mouse_trap"]);
    expect(steer.frames).toEqual(["4t"]);
    expect(steer.block).toContain('arm="variant"');
    expect(steer.block).toContain("VARIANT arm: 4T");
    expect(steer.block).toContain("Never mention the test");
    // No peer proof: founder_card is the only frame allowed, so the variant is written by instruction only.
    expect(betSteer(bet, "variant", ["founder_card"]).frames).toEqual(["founder_card"]);
  });

  it("sorts targeting-bet sends by the matching tag", () => {
    const ws = makeWorkspace();
    addBet(ws, "prop_ch", { variable: "Email vs LinkedIn", control: "email", variant: "LinkedIn", why: "", dimension: "channel", controlKey: "email", variantKey: "linkedin" }, at(-1));
    const bet = activeBet(ws, "2026-10-20");
    expect(betArmFor(bet, { channel: "linkedin" })).toEqual({ id: "prop_ch", arm: "variant" });
    expect(betArmFor(bet, { channel: "email" })).toEqual({ id: "prop_ch", arm: "control" });
    expect(betArmFor(bet, { channel: "intro" })).toBeUndefined();
    expect(betArmFor(null, { channel: "email" })).toBeUndefined();
  });
});

describe("readout", () => {
  function sends(ws: Workspace, arm: "control" | "variant", n: number, positiveEvery = 0) {
    for (let i = 0; i < n; i++) {
      const personId = `per_${arm}_${i}`;
      ws.activities.push(makeActivity(`act_${arm}_${i}`, { kind: "touch_sent", personId, at: at(-5), tags: { bet: { id: "prop_b", arm } } }));
      if (positiveEvery && i % positiveEvery === 0) ws.activities.push(makeActivity(`rep_${arm}_${i}`, { kind: "reply_received", personId, at: at(-3), sentiment: "positive" }));
    }
  }

  it("counts first sends per person, with replies and positive ones", () => {
    const ws = makeWorkspace();
    sends(ws, "control", 4, 2);
    sends(ws, "variant", 3);
    // A second touch to the same person, and a send marked "didn't send", don't add a send.
    ws.activities.push(makeActivity("act_again", { kind: "touch_sent", personId: "per_control_0", at: at(-4), tags: { bet: { id: "prop_b", arm: "control" } } }));
    ws.activities.push(makeActivity("act_unsent", { kind: "touch_sent", personId: "per_x", at: at(-4), outcome: "not_sent", tags: { bet: { id: "prop_b", arm: "variant" } } } as Partial<Activity>));
    const r = betReadout(ws, "prop_b");
    expect(r).toEqual({ control: { sent: 4, replies: 2, positive: 2 }, variant: { sent: 3, replies: 0, positive: 0 }, enough: false });
  });

  it("keeps the verdict inconclusive below 100 sends per arm, whatever was suggested", () => {
    const ws = makeWorkspace();
    sends(ws, "control", BET_MIN_PER_ARM, 10);
    sends(ws, "variant", BET_MIN_PER_ARM - 1, 5);
    expect(betVerdict(betReadout(ws, "prop_b"), "keep")).toBe("inconclusive");
    // The hundredth variant send, to someone new.
    ws.activities.push(makeActivity("act_v_last", { kind: "touch_sent", personId: "per_variant_last", at: at(-5), tags: { bet: { id: "prop_b", arm: "variant" } } }));
    const r = betReadout(ws, "prop_b");
    expect(r.enough).toBe(true);
    expect(betVerdict(r, "keep")).toBe("keep");
    expect(betVerdict(r, null)).toBe("inconclusive");
  });
});
