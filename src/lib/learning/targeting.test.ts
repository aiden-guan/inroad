import { describe, expect, it } from "vitest";
import { applyAction } from "@/lib/domain/actions";
import type { Move, Workspace } from "@/lib/domain/types";
import { computeMoves } from "@/lib/moves/rules";
import { sampleWorkspace } from "@/lib/sample";
import { NOW, TODAY, at, day, makeAccount, makeDossier, makeFoundation, makeMove, makePerson, makeSignal, makeWorkspace } from "@/test/factories";
import { LEARN_WEIGHTS, applyLearned, learnedAdjustments, skipTarget, wouldLearn } from "./targeting";

/** Five companies, each with a Head of Data and a funding signal, and one with a Controller. */
function desk(): Workspace {
  const foundation = makeFoundation();
  foundation.personas = [
    { id: "psn_data", role: "technical_approver", titles: ["Head of Data", "Data Platform Lead"], kpis: [], pains: [], triggers: [], objections: [], wateringHoles: [], line: "" },
    { id: "psn_ctrl", role: "champion", titles: ["Controller"], kpis: [], pains: [], triggers: [], objections: [], wateringHoles: [], line: "" },
  ];
  const ws = makeWorkspace({ foundation });
  for (const i of [1, 2, 3, 4, 5, 6]) {
    const domain = `d${i}.example`;
    ws.accounts[domain] = makeAccount(domain, { peopleIds: [`per_${i}`], signals: [makeSignal(`sig_${i}`, { type: "funding", url: `https://news.example/${i}` })], dossier: makeDossier() });
    ws.people[`per_${i}`] = makePerson(`per_${i}`, domain, { title: i === 6 ? "Controller" : "Head of Data" });
  }
  return ws;
}

/** A first-touch card for company i, the way the signal rule writes it. */
const card = (i: number, patch: Partial<Move> = {}): Move =>
  makeMove(`mv_signal_d${i}.example_sig_${i}`, { kind: "first_touch", rule: "today.signal", title: `Write to ${i}`, ref: { kind: "person", id: `per_${i}` }, source: { url: `https://news.example/${i}` }, priority: 50, ...patch });

function skip(ws: Workspace, i: number, reason: "wrong_person" | "weak_angle", daysAgo: number) {
  const m = card(i);
  ws.moves[m.id] = m;
  applyAction(ws, { type: "move.skip", id: m.id, reason, at: at(-daysAgo) });
}

describe("skipTarget", () => {
  it("stamps the playbook persona the title matches and the signal the card rested on", () => {
    const ws = desk();
    expect(skipTarget(ws, card(1))).toEqual({ persona: { key: "psn:psn_data", label: "Head of Data" }, signalType: "funding", domain: "d1.example", personId: "per_1" });
    expect(skipTarget(ws, card(6)).persona).toEqual({ key: "psn:psn_ctrl", label: "Controller" });
  });

  it("falls back to the buying role, then the title, when no playbook persona fits", () => {
    const ws = desk();
    ws.people.per_1 = { ...ws.people.per_1, title: "VP Engineering", role: "technical_approver" };
    expect(skipTarget(ws, card(1)).persona).toEqual({ key: "role:technical_approver", label: "Technical approver" });
    ws.people.per_1 = { ...ws.people.per_1, role: undefined };
    expect(skipTarget(ws, card(1)).persona).toEqual({ key: "title:vp engineering", label: "VP Engineering" });
  });

  it("is stamped by the reducer at the skip, with the skip's time", () => {
    const ws = desk();
    skip(ws, 1, "wrong_person", 2);
    const m = ws.moves["mv_signal_d1.example_sig_1"];
    expect(m).toMatchObject({ status: "skipped", skipReason: "wrong_person", settledAt: at(-2), skipTarget: { persona: { key: "psn:psn_data" } } });
    // Undo takes the skip and what it taught back out.
    applyAction(ws, { type: "move.reopen", id: m.id });
    expect(ws.moves[m.id]).not.toHaveProperty("skipTarget");
    expect(ws.moves[m.id]).not.toHaveProperty("settledAt");
  });
});

describe("learnedAdjustments", () => {
  it("learns from three wrong-person skips on one persona inside 30 days, and says until when", () => {
    const ws = desk();
    skip(ws, 1, "wrong_person", 12);
    skip(ws, 2, "wrong_person", 5);
    expect(learnedAdjustments(ws, TODAY)).toEqual([]);
    skip(ws, 3, "wrong_person", 1);
    const [a] = learnedAdjustments(ws, TODAY);
    expect(a).toMatchObject({ key: "persona:psn:psn_data", kind: "persona", label: "Head of Data", weight: LEARN_WEIGHTS.at3, since: day(-12), expiresOn: day(18) });
    expect(a.skips.map((s) => s.moveId)).toEqual(["mv_signal_d3.example_sig_3", "mv_signal_d2.example_sig_2", "mv_signal_d1.example_sig_1"]);
  });

  it("ignores skips older than 30 days, other reasons, and skips the founder took back", () => {
    const ws = desk();
    skip(ws, 1, "wrong_person", 40);
    skip(ws, 2, "wrong_person", 5);
    skip(ws, 3, "wrong_person", 1);
    expect(learnedAdjustments(ws, TODAY)).toEqual([]);
    skip(ws, 4, "wrong_person", 2);
    expect(learnedAdjustments(ws, TODAY)).toHaveLength(1);
    applyAction(ws, { type: "move.learn", ids: ["mv_signal_d4.example_sig_4"], ignore: true });
    expect(learnedAdjustments(ws, TODAY)).toEqual([]);
    applyAction(ws, { type: "move.learn", ids: ["mv_signal_d4.example_sig_4"], ignore: false });
    expect(learnedAdjustments(ws, TODAY)).toHaveLength(1);
  });

  it("learns weak angles by signal type, and weighs five skips more than three", () => {
    const ws = desk();
    for (const i of [1, 2, 3, 4, 5]) skip(ws, i, "weak_angle", i);
    const [a] = learnedAdjustments(ws, TODAY);
    expect(a).toMatchObject({ key: "signal:funding", kind: "signal", label: "Funding news", weight: LEARN_WEIGHTS.at5 });
  });

  it("lists tone notes from the voice card, which an undo removes without reopening the skip", () => {
    const ws = desk();
    ws.moves.mv_t = makeMove("mv_t", { title: "Write to Ana", status: "skipped", skipReason: "tone_off" });
    applyAction(ws, { type: "voice.noteToneOff", text: "Hope this finds you well!", at: at(-1), moveId: "mv_t" });
    const tone = learnedAdjustments(ws, TODAY).find((a) => a.kind === "tone")!;
    expect(tone.skips).toEqual([{ moveId: "mv_t", title: "Write to Ana", at: at(-1) }]);
    applyAction(ws, { type: "voice.forgetToneOff", ats: [at(-1)] });
    expect(learnedAdjustments(ws, TODAY).find((a) => a.kind === "tone")).toBeUndefined();
    expect(ws.moves.mv_t.status).toBe("skipped");
  });
});

describe("applyLearned", () => {
  it("ranks matching new-outreach cards lower and says so; other cards and rules are untouched", () => {
    const ws = desk();
    for (const i of [1, 2, 3]) skip(ws, i, "wrong_person", i);
    const cands = [
      { ...card(4), rule: "signal" },
      { ...card(6), rule: "signal" },
      { ...card(5), rule: "reply", kind: "reply" as const },
    ];
    const touched = applyLearned(ws, cands, TODAY);
    expect(cands[0].priority).toBe(50 * LEARN_WEIGHTS.at3);
    expect(cands[0].why).toMatch(/ranked lower after 3 similar skips$/);
    expect(cands[1].priority).toBe(50); // a Controller
    expect(cands[2].priority).toBe(50); // a reply is never demoted
    expect(touched.get("persona:psn:psn_data")).toBe(1);
  });

  it("changes the ranking computeMoves produces, deterministically", () => {
    const ws = desk();
    ws.accounts["d4.example"].signals[0] = makeSignal("sig_4", { type: "funding", url: "https://news.example/4", strength: 3, date: day(-1) });
    const before = computeMoves(ws, NOW).find((m) => m.id === "mv_signal_d4.example_sig_4");
    for (const i of [1, 2, 3]) skip(ws, i, "wrong_person", i);
    const after = computeMoves(ws, NOW).find((m) => m.id === "mv_signal_d4.example_sig_4");
    expect(before && after).toBeTruthy();
    expect(after!.priority).toBeLessThan(before!.priority);
    expect(computeMoves(ws, NOW)).toEqual(computeMoves(ws, NOW));
  });
});

describe("wouldLearn", () => {
  it("says when a skip is the one that teaches, so the toast can say what changes", () => {
    const ws = desk();
    skip(ws, 1, "wrong_person", 3);
    expect(wouldLearn(ws, card(2), "wrong_person", at(0), TODAY)).toBeNull();
    skip(ws, 2, "wrong_person", 2);
    expect(wouldLearn(ws, card(3), "wrong_person", at(0), TODAY)).toEqual({ kind: "persona", label: "Head of Data", until: day(27) });
    expect(wouldLearn(ws, card(3), "already_handled", at(0), TODAY)).toBeNull();
  });
});

describe("the sample", () => {
  it("has learned from three Head of Data skips, shown with the skips and an expiry", () => {
    const [a] = learnedAdjustments(sampleWorkspace(NOW), TODAY);
    expect(a).toMatchObject({ kind: "persona", label: "Head of Data", since: day(-10), expiresOn: day(20) });
    expect(a.skips).toHaveLength(3);
  });
});
