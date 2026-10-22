import { describe, expect, it } from "vitest";
import type { Foundation, ReviewProposal, Workspace } from "@/lib/domain/types";
import { at, day, makeAccount, makeDossier, makePackage, makePerson, makeSignal, makeStep, makeWorkspace } from "@/test/factories";
import { personaRole, signalTypeFor, subjectStyle, touchTags } from "./tags";

const angle = {
  id: "ang_1",
  title: "First finance hire inherits the script",
  signal: "Hiring a founding finance engineer to own reconciliation",
  interpretation: "Someone new will own month-end close",
  pressure: "Close slips while the spreadsheet breaks",
  pov: "Scripts outlive the person who wrote them",
  proof: null,
  ask: "",
  evidenceIds: ["ev_jd"],
  bestFor: "champion" as const,
  strength: 4 as const,
};

function withBet(ws: Workspace, bet: NonNullable<ReviewProposal["bet"]>, decidedAt = at(-2)) {
  ws.briefs["2026-10-12:friday"] = {
    date: "2026-10-16",
    kind: "friday",
    greeting: "",
    matters: [],
    generatedAt: at(-4),
    proposals: [{ id: "prop_bet", kind: "message_bet", title: "Next month's bet", detail: "", bet, status: "applied", decidedAt }],
  };
}

describe("signalTypeFor", () => {
  const acc = makeAccount("acme.example", {
    signals: [
      makeSignal("sig_jd", { type: "jd_names_pain", evidenceId: "ev_jd", strength: 2 }),
      makeSignal("sig_raise", { type: "funding", evidenceId: "ev_raise", strength: 3, date: day(-1) }),
      makeSignal("sig_hidden", { type: "sensitive", evidenceId: "ev_s", strength: 3 }),
    ],
    dossier: makeDossier({ angles: [angle] }),
  });

  it("reads the angle drafted straight from a signal", () => {
    expect(signalTypeFor(acc, "sig_sig_raise")).toBe("funding");
  });

  it("finds the signal a dossier angle's evidence shows, even when a stronger one exists", () => {
    expect(signalTypeFor(acc, "ang_1")).toBe("jd_names_pain");
  });

  it("falls back to the strongest usable signal, never a sensitive one", () => {
    expect(signalTypeFor(acc, undefined)).toBe("funding");
    expect(signalTypeFor(makeAccount("x.example", { signals: [makeSignal("s", { type: "sensitive" })] }), undefined)).toBeUndefined();
    expect(signalTypeFor(undefined, "ang_1")).toBeUndefined();
  });
});

describe("subjectStyle", () => {
  it("tells a trigger subject from a problem subject", () => {
    expect(subjectStyle("your finance engineer hire", angle)).toBe("trigger");
    expect(subjectStyle("after the Series A", angle)).toBe("trigger");
    expect(subjectStyle("close slipping", angle)).toBe("problem");
    expect(subjectStyle("quick thought", angle)).toBe("other");
    expect(subjectStyle(null, angle)).toBeUndefined();
  });
});

describe("personaRole", () => {
  it("uses the person's role, else the persona their title matches", () => {
    const ws = makeWorkspace({ foundation: { personas: [{ id: "per_x", role: "economic_buyer", titles: ["CFO", "VP Finance"] }] } as unknown as Foundation });
    expect(personaRole(ws, makePerson("per_a", "acme.example", { role: "champion" }))).toBe("champion");
    expect(personaRole(ws, makePerson("per_b", "acme.example", { title: "VP Finance, EMEA" }))).toBe("economic_buyer");
    expect(personaRole(ws, makePerson("per_c", "acme.example", { title: "Office manager" }))).toBeUndefined();
  });
});

describe("touchTags", () => {
  function setup() {
    const ws = makeWorkspace();
    ws.accounts["acme.example"] = makeAccount("acme.example", { signals: [makeSignal("sig_jd", { type: "jd_names_pain", evidenceId: "ev_jd" })], dossier: makeDossier({ angles: [angle] }) });
    ws.people.per_dana = makePerson("per_dana", "acme.example", { role: "champion" });
    return ws;
  }

  it("stamps the signal, frame, POV, persona and subject style of a first touch", () => {
    const ws = setup();
    const pkg = makePackage("out_1", "acme.example", { personId: "per_dana", angleId: "ang_1" });
    const step = makeStep(1, { frame: "founder_card", povId: "pov_1", subject: "your finance engineer hire", angleId: "ang_1" });
    expect(touchTags(ws, pkg, step, at(0))).toEqual({
      signalType: "jd_names_pain",
      tags: { frame: "founder_card", povId: "pov_1", persona: "champion", subjectStyle: "trigger" },
    });
  });

  it("keeps the signal stamped at draft time and leaves follow-ups' subject alone", () => {
    const ws = setup();
    const pkg = makePackage("out_1", "acme.example", { personId: "per_dana" });
    const step = makeStep(2, { frame: "mouse_trap", signalType: "funding" });
    expect(touchTags(ws, pkg, step, at(0))).toEqual({ signalType: "funding", tags: { frame: "mouse_trap", persona: "champion" } });
  });

  it("gives a reply no signal", () => {
    const ws = setup();
    const pkg = makePackage("out_r", "acme.example", { mode: "reply", personId: "per_dana" });
    expect(touchTags(ws, pkg, makeStep(1, { frame: "reply", thread: "reply", subject: null }), at(0)).signalType).toBeUndefined();
  });

  it("carries a writing bet's arm from the draft", () => {
    const ws = setup();
    withBet(ws, { variable: "Advice ask vs observation", control: "advice ask", variant: "observation", why: "", dimension: "frame", controlKey: "founder_card", variantKey: "4t" });
    const pkg = makePackage("out_1", "acme.example", { personId: "per_dana" });
    const step = makeStep(1, { bet: { id: "prop_bet", arm: "variant" } });
    expect(touchTags(ws, pkg, step, at(0)).tags?.bet).toEqual({ id: "prop_bet", arm: "variant" });
  });

  it("sorts a first touch into a targeting bet's arm by who it went to", () => {
    const ws = setup();
    withBet(ws, { variable: "Champion vs economic buyer", control: "champion", variant: "economic buyer", why: "", dimension: "persona", controlKey: "champion", variantKey: "economic_buyer" });
    const pkg = makePackage("out_1", "acme.example", { personId: "per_dana" });
    expect(touchTags(ws, pkg, makeStep(1), at(0)).tags?.bet).toEqual({ id: "prop_bet", arm: "control" });
    ws.people.per_dana.role = "technical_approver";
    expect(touchTags(ws, pkg, makeStep(1), at(0)).tags?.bet).toBeUndefined();
    // Follow-ups aren't first touches: they're never counted in a bet.
    ws.people.per_dana.role = "champion";
    expect(touchTags(ws, pkg, makeStep(2), at(0)).tags?.bet).toBeUndefined();
  });
});
