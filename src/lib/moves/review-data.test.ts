import { describe, expect, it } from "vitest";
import { applyAction } from "@/lib/domain/actions";
import { NOW, at, makeAccount, makeActivity, makeDossier, makePackage, makePerson, makeSignal, makeStep, makeWorkspace } from "@/test/factories";
import { betProposal } from "@/lib/learning/bets";
import { activeMessageBet, learningData } from "./review-data";

/** The Friday breakdowns read what was actually sent: approving a draft is what tags the touch. */
describe("learningData conversions from real sends", () => {
  function sent() {
    const ws = makeWorkspace();
    ws.accounts["acme.example"] = makeAccount("acme.example", {
      signals: [makeSignal("sig_jd", { type: "first_hire", evidenceId: "ev_jd" })],
      dossier: makeDossier({ angles: [{ id: "ang_1", title: "First hire", signal: "Hiring a founding finance engineer", interpretation: "", pressure: "", pov: "", proof: null, ask: "", evidenceIds: ["ev_jd"], bestFor: "champion", strength: 4 }] }),
    });
    ws.people.per_dana = makePerson("per_dana", "acme.example", { role: "champion" });
    ws.povs = [{ id: "pov_1", text: "Scripts outlive the person who wrote them", evidence: "30 calls", createdAt: at(-30), uses: 1 }];
    ws.outreach.out_1 = makePackage("out_1", "acme.example", {
      personId: "per_dana",
      angleId: "ang_1",
      steps: [makeStep(1, { frame: "founder_card", povId: "pov_1", subject: "your first finance hire", angleId: "ang_1" })],
    });
    applyAction(ws, { type: "outreach.approveStep", packageId: "out_1", step: 1, at: at(-2), activityId: "act_sent" });
    ws.activities.push(makeActivity("act_reply", { kind: "reply_received", personId: "per_dana", at: at(-1), sentiment: "positive", body: "Yes, let's talk." }));
    return ws;
  }

  it("breaks first touches down by signal, frame, POV and subject style", () => {
    const rows = learningData(sent(), NOW).conversions;
    const row = (dimension: string) => rows.filter((r) => r.dimension === dimension).map((r) => [r.key, r.sent, r.replies, r.positive]);
    expect(row("signal")).toEqual([["first_hire", 1, 1, 1]]);
    expect(row("frame")).toEqual([["advice ask (founder card)", 1, 1, 1]]);
    expect(row("pov")).toEqual([["POV: Scripts outlive the person who wrote them", 1, 1, 1]]);
    expect(row("subject_style")).toEqual([["subject names their trigger", 1, 1, 1]]);
    expect(row("persona")).toEqual([["champion", 1, 1, 1]]);
  });

  it("says when a touch went out untagged", () => {
    const ws = makeWorkspace();
    ws.activities.push(makeActivity("act_old", { kind: "touch_sent", personId: "per_x", at: at(-3) }));
    const keys = learningData(ws, NOW).conversions.filter((r) => ["signal", "frame", "pov"].includes(r.dimension)).map((r) => r.key);
    expect(keys.sort()).toEqual(["no POV tagged", "no frame tagged", "no signal tagged"]);
  });

  it("carries the running bet's counts per arm", () => {
    const ws = sent();
    ws.briefs["2026-10-12:friday"] = {
      date: "2026-10-16",
      kind: "friday",
      greeting: "",
      matters: [],
      generatedAt: at(-4),
      proposals: [{ id: "prop_bet", kind: "message_bet", title: "bet", detail: "", bet: { variable: "Champion vs CFO", control: "champion", variant: "CFO", why: "", dimension: "persona", controlKey: "champion", variantKey: "economic_buyer" }, status: "applied", decidedAt: at(-4) }],
    };
    // Sent before the bet started: the earlier approval carries no arm, so it isn't counted.
    expect(activeMessageBet(ws, "2026-10-20")?.readout).toMatchObject({ control: { sent: 0 }, variant: { sent: 0 } });
    ws.outreach.out_2 = makePackage("out_2", "acme.example", { personId: "per_dana", steps: [makeStep(1)] });
    ws.people.per_cfo = makePerson("per_cfo", "acme.example", { role: "economic_buyer" });
    ws.outreach.out_3 = makePackage("out_3", "acme.example", { personId: "per_cfo", steps: [makeStep(1)] });
    applyAction(ws, { type: "outreach.approveStep", packageId: "out_3", step: 1, at: at(0), activityId: "act_cfo" });
    expect(ws.activities.find((a) => a.id === "act_cfo")?.tags?.bet).toEqual({ id: "prop_bet", arm: "variant" });
    expect(activeMessageBet(ws, "2026-10-20")).toMatchObject({ id: "prop_bet", endsOn: "2026-11-30", readout: { variant: { sent: 1, replies: 0, positive: 0 }, enough: false } });
  });
});

describe("betProposal", () => {
  const base = { variable: "Champion vs economic buyer", control: "Controllers", variant: "CFOs", why: "Two CFO replies this week!" };

  it("keeps the dimension and normalized keys", () => {
    expect(betProposal({ ...base, dimension: "persona", controlKey: "champion", variantKey: "Economic buyer" })?.bet).toEqual({
      ...base,
      why: "Two CFO replies this week.",
      dimension: "persona",
      controlKey: "champion",
      variantKey: "economic_buyer",
    });
  });

  it("drops a who-or-why bet that names nothing code can match", () => {
    expect(betProposal({ ...base, dimension: "persona", controlKey: null, variantKey: null })).toBeNull();
    expect(betProposal({ ...base, dimension: "signal", controlKey: "funding", variantKey: "funding" })).toBeNull();
    // Writing bets need no keys: the composer writes each arm.
    expect(betProposal({ ...base, dimension: "cta", controlKey: null, variantKey: null })?.bet?.dimension).toBe("cta");
  });
});
