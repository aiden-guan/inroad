import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { computeMoves, mergeMoves, visibleMoves } from "@/lib/moves/rules";
import { sampleWorkspace } from "@/lib/sample";
import { DEAL, DOMAIN, EVENT, MEETING, PACKAGE, PERSON } from "@/lib/sample/ids";
import { MATERIAL, PIECE } from "@/lib/sample/studio";
import { NOW, TODAY, at, consumerWorkspace, day, makeMove, makePackage, makePartner, makeStep, makeWeek, makeWorkspace } from "@/test/factories";
import { buildRevision } from "@/lib/playbook/revision";
import { ActionError, applyAction, hrefFor, type Action } from "./actions";
import type { Workspace } from "./types";

/**
 * The reducer runs twice (optimistically in the browser, then on the server), so it must be pure:
 * the same actions on the same state give the same result. Each action type gets a case below.
 */

let sample: Workspace;
beforeAll(() => {
  sample = sampleWorkspace(NOW);
  sample.moves = mergeMoves({}, computeMoves(sample, NOW), TODAY);
});

/** A fresh copy of the sample workspace (with Today's moves computed) for each case. */
const ws = () => structuredClone(sample);

function apply(state: Workspace, ...actions: Action[]): Workspace {
  for (const a of actions) applyAction(state, a);
  return state;
}

afterEach(() => {
  vi.useRealTimers();
});

/** The sample plus one graphic (on the hero's first option) and the image it was made with. */
function withVisual(): Workspace {
  const w = ws();
  const optionId = w.studio.pieces[PIECE.hero].options[0].id;
  w.studio.images.img_test000001 = { id: "img_test000001", source: "upload", file: "img_test000001.png", mime: "image/png", width: 800, height: 600, alt: "", createdAt: at(0) };
  w.studio.visuals.vis_test000001 = {
    id: "vis_test000001",
    pieceId: PIECE.hero,
    optionId,
    layout: "screenshot",
    preset: "og",
    width: 1200,
    height: 630,
    svgFile: "vis_test000001.svg",
    pngFile: "vis_test000001.png",
    imageId: "img_test000001",
    why: "",
    checks: [],
    aiImagery: false,
    createdAt: at(0),
  };
  return w;
}

const cases: Record<Action["type"], () => void> = {
  "founder.update": () => {
    const s = apply(ws(), { type: "founder.update", patch: { availability: "Tue–Thu 10–4 PT" } });
    expect(s.founder).toMatchObject({ name: sample.founder.name, availability: "Tue–Thu 10–4 PT" });
  },

  "onboarding.update": () => {
    const s = apply(ws(), { type: "onboarding.update", patch: { note: "seed" } });
    expect(s.onboarding).toMatchObject({ status: "hired", note: "seed" });
  },

  "sender.update": () => {
    // No sender yet: defaults come from the founder and company, then the patch.
    const fresh = makeWorkspace({ founder: { name: "Priya Raman", email: "priya@ledgerline.example" } });
    apply(fresh, { type: "sender.update", patch: { postalAddress: "450 Example St" } });
    expect(fresh.sender).toEqual({ name: "Priya Raman", title: "Founder", company: "", email: "priya@ledgerline.example", postalAddress: "450 Example St" });
    // An existing sender keeps its fields.
    const s = apply(ws(), { type: "sender.update", patch: { title: "CEO" } });
    expect(s.sender).toMatchObject({ name: "Priya Raman", title: "CEO", company: "Ledgerline" });
  },

  "goal.update": () => {
    const s = apply(ws(), { type: "goal.update", patch: { target: 8 } });
    expect(s.goal.target).toBe(8);
    expect(s.goal.targetLabel).toBe(sample.goal.targetLabel);
  },

  "caps.update": () => {
    const s = apply(ws(), { type: "caps.update", patch: { firstTouchesPerWeek: 10 } });
    expect(s.caps).toEqual({ ...sample.caps, firstTouchesPerWeek: 10 });
  },

  "voice.addSample": () => {
    const fresh = makeWorkspace();
    apply(fresh, { type: "voice.addSample", text: "x".repeat(5000), kind: "email", at: at(0) });
    expect(fresh.voice?.samples[0].text).toHaveLength(4000);
    for (let i = 0; i < 6; i++) apply(fresh, { type: "voice.addSample", text: `sample ${i}`, kind: "post", at: at(0) });
    // Only the last five are kept.
    expect(fresh.voice?.samples.map((s) => s.text)).toEqual(["sample 1", "sample 2", "sample 3", "sample 4", "sample 5"]);
    expect(fresh.voice?.updatedAt).toBe(at(0));
    // Every 3rd sample re-reads the voice (7 added: after the 6th, one since).
    expect(fresh.voice?.samplesSinceExtract).toBe(1);
    expect(fresh.voice?.suggested).toMatchObject({ basis: "5 samples", contractions: false });
  },

  "voice.setTraits": () => {
    const s = ws();
    s.voice!.suggested = { greeting: "hi_first_name", at: at(-1), basis: "3 samples" };
    apply(s, { type: "voice.setTraits", traits: { greeting: "first_name", contractions: true }, at: at(0) });
    expect(s.voice?.traits).toEqual({ greeting: "first_name", contractions: true });
    expect(s.voice?.suggested).toBeUndefined();
    const fresh = apply(makeWorkspace(), { type: "voice.setTraits", traits: { formality: 2 }, at: at(0) });
    expect(fresh.voice?.traits).toEqual({ formality: 2 });
  },

  "voice.dismissSuggestion": () => {
    const s = ws();
    s.voice!.suggested = { greeting: "hi_first_name", at: at(-1), basis: "3 samples" };
    apply(s, { type: "voice.dismissSuggestion", at: at(0) });
    expect(s.voice?.suggested).toBeUndefined();
    apply(makeWorkspace(), { type: "voice.dismissSuggestion", at: at(0) });
  },

  "voice.extract": () => {
    const s = ws();
    apply(s, { type: "voice.extract", at: at(0) });
    expect(s.voice?.suggested?.basis).toBe(`${sample.voice!.samples.length} samples`);
    // Accepting what it found, then re-reading: nothing new to suggest.
    const traits: Partial<NonNullable<Workspace["voice"]>["suggested"]> = { ...s.voice!.suggested! };
    delete traits.at;
    delete traits.basis;
    apply(s, { type: "voice.setTraits", traits, at: at(0) }, { type: "voice.extract", at: at(0) });
    expect(s.voice?.suggested).toBeUndefined();
  },

  "voice.addBadExamples": () => {
    const long = "Hi Dana, I hope this email finds you well. Companies like yours struggle with finance ops and our platform helps.";
    const s = apply(makeWorkspace(), { type: "voice.addBadExamples", texts: [long, "  too short  ", long.replace("Dana", "Sam")], at: at(0) });
    // Fragments too short to judge are dropped; only the last five are kept.
    expect(s.voice?.badExamples?.map((b) => b.text)).toEqual([long, long.replace("Dana", "Sam")]);
    apply(s, { type: "voice.addBadExamples", texts: [1, 2, 3, 4].map((i) => `${long} ${i}`), at: at(0) });
    expect(s.voice?.badExamples).toHaveLength(5);
    expect(s.voice?.badExamples?.[0].text).toBe(long.replace("Dana", "Sam"));
  },

  "voice.noteToneOff": () => {
    const s = apply(ws(), { type: "voice.noteToneOff", text: "Hope this finds you well!", at: at(0), moveId: "mv_x" });
    expect(s.voice?.toneOff).toEqual([{ at: at(0), text: "Hope this finds you well!", moveId: "mv_x" }]);
    // Skipping the same card again replaces its example rather than adding a second one.
    apply(s, { type: "voice.noteToneOff", text: "Second try.", at: at(0), moveId: "mv_x" });
    expect(s.voice?.toneOff?.map((t) => t.text)).toEqual(["Second try."]);
  },

  "voice.update": () => {
    const s = apply(ws(), { type: "voice.update", patch: { summary: "s".repeat(700) }, at: at(0) });
    expect(s.voice?.summary).toHaveLength(600);
    expect(s.voice?.signOff).toBe(sample.voice?.signOff);
    apply(s, { type: "voice.update", patch: { signOff: "— P".padEnd(100, ".") }, at: at(0) });
    expect(s.voice?.signOff).toHaveLength(80);
  },

  "voice.removeSample": () => {
    const s = apply(ws(), { type: "voice.removeSample", index: 0, at: at(0) });
    expect(s.voice?.samples).toEqual(sample.voice?.samples.slice(1));
    // No voice card: nothing to remove.
    const fresh = makeWorkspace();
    apply(fresh, { type: "voice.removeSample", index: 0, at: at(0) });
    expect(fresh.voice).toBeNull();
  },

  "company.correctChip": () => {
    const s = ws();
    const chip = () => s.company!.chips.find((c) => c.key === "pricing")!;
    const original = chip().text;
    apply(s, { type: "company.correctChip", key: "pricing", text: null });
    expect(chip()).toMatchObject({ rejected: true, corrected: false, text: original });
    // Choosing the same text again undoes the rejection.
    apply(s, { type: "company.correctChip", key: "pricing", text: original });
    expect(chip().rejected).toBe(false);
    apply(s, { type: "company.correctChip", key: "pricing", text: "Usage-based, from $500/month" });
    expect(chip()).toMatchObject({ text: "Usage-based, from $500/month", corrected: true, confidence: "high", rejected: false });
    expect(() => apply(s, { type: "company.correctChip", key: "nope", text: "x" })).toThrow(ActionError);
  },

  "foundation.set": () => {
    const s = apply(ws(), { type: "foundation.set", path: ["positioning", "category", "name"], value: "Usage reconciliation" });
    expect(s.foundation?.positioning.category.name).toBe("Usage reconciliation");
    apply(s, { type: "foundation.set", path: ["personas", 0, "title"], value: "Controller" });
    expect(s.foundation?.personas[0]).toMatchObject({ title: "Controller" });
    expect(() => apply(s, { type: "foundation.set", path: [], value: 1 })).toThrow("Empty path");
    expect(() => apply(s, { type: "foundation.set", path: ["nope", "deeper"], value: 1 })).toThrow("Path nope not found");
    for (const path of [["__proto__", "polluted"], ["icp", "constructor"], ["prototype"]]) {
      expect(() => apply(s, { type: "foundation.set", path, value: true })).toThrow("Invalid path");
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  },

  "foundation.answerQuestion": () => {
    const s = apply(ws(), { type: "foundation.answerQuestion", questionId: "fq_network", answer: "Claire at Alder Street", at: at(0) });
    expect(s.foundation?.founderQuestions.find((q) => q.id === "fq_network")).toMatchObject({ answer: "Claire at Alder Street", answeredAt: at(0) });
    expect(() => apply(s, { type: "foundation.answerQuestion", questionId: "fq_missing", answer: "x", at: at(0) })).toThrow("Question not found");
    expect(() => apply(makeWorkspace(), { type: "foundation.answerQuestion", questionId: "fq_network", answer: "x", at: at(0) })).toThrow("Playbook not found");
  },

  "foundation.lockSegment": () => {
    const s = apply(ws(), { type: "foundation.lockSegment", at: at(0) });
    expect(s.foundation?.icp.segmentLockedAt).toBe(at(0));
  },

  "foundation.revise": () => {
    const s = ws();
    const f = structuredClone(s.foundation!);
    const v = f.version;
    const sentence = buildRevision(f, { target: "icp.sentence", op: "set", text: "Usage-priced API companies past $2M ARR whose controller closes the books by hand." })!;
    const words = buildRevision(f, { target: "messaging.customerWords", op: "add", text: "month-end fire drill" })!;
    apply(s, { type: "foundation.revise", revision: sentence, source: "refresh", runId: "run_r", at: at(0) });
    expect(s.foundation!.icp.hypothesis.sentence).toBe(sentence.text);
    expect(s.foundation!.version).toBe(v + 1);
    // The version it replaced is kept whole, so the refresh can be undone.
    expect(s.foundationHistory).toEqual([expect.objectContaining({ version: v, source: "refresh", runId: "run_r", changes: [expect.stringContaining("The ICP bet")] })]);
    expect(s.foundationHistory![0].snapshot.icp.hypothesis.sentence).toBe(f.icp.hypothesis.sentence);
    // A second change from the same refresh joins that version.
    apply(s, { type: "foundation.revise", revision: words, source: "refresh", runId: "run_r", at: at(0) });
    expect(s.foundation!.version).toBe(v + 1);
    expect(s.foundationHistory![0].changes).toHaveLength(2);
    expect(s.foundation!.messaging.customerWords.at(-1)).toEqual({ phrase: "month-end fire drill", source: "call" });
    // The founder edited that part since: the old proposal no longer applies.
    expect(() => apply(s, { type: "foundation.revise", revision: { ...sentence, before: "Something else" }, source: "refresh", at: at(0) })).toThrow(ActionError);
  },

  "foundation.restore": () => {
    const s = ws();
    const v = s.foundation!.version;
    const original = s.foundation!.icp.hypothesis.sentence;
    apply(s, { type: "foundation.revise", revision: buildRevision(s.foundation!, { target: "icp.sentence", op: "set", text: "A new bet." })!, source: "monthly", runId: "run_m", at: at(-1) });
    apply(s, { type: "foundation.lockSegment", at: at(0) });
    apply(s, { type: "foundation.restore", version: v, at: at(0) });
    expect(s.foundation!.icp.hypothesis.sentence).toBe(original);
    expect(s.foundation!.version).toBe(v + 2);
    // What happened since the old version stays: the segment lock is a record, not part of the bet.
    expect(s.foundation!.icp.segmentLockedAt).toBe(at(0));
    expect(s.foundationHistory!.map((x) => x.version)).toEqual([v, v + 1]);
    expect(s.foundationHistory!.at(-1)!.changes).toEqual([`Restored v${v}`]);
    expect(() => apply(s, { type: "foundation.restore", version: 99, at: at(0) })).toThrow("Version not found");
  },

  "claim.upsert": () => {
    const s = ws();
    const claim = { ...s.claims[0], text: "Edited" };
    apply(s, { type: "claim.upsert", claim });
    expect(s.claims).toHaveLength(sample.claims.length);
    expect(s.claims[0].text).toBe("Edited");
    apply(s, { type: "claim.upsert", claim: { ...claim, id: "clm_new" } });
    expect(s.claims.at(-1)?.id).toBe("clm_new");
  },

  "claim.remove": () => {
    const s = apply(ws(), { type: "claim.remove", id: sample.claims[0].id });
    expect(s.claims.map((c) => c.id)).not.toContain(sample.claims[0].id);
    expect(s.claims).toHaveLength(sample.claims.length - 1);
  },

  "objection.upsert": () => {
    const s = apply(ws(), { type: "objection.upsert", objection: { ...sample.objections[0], timesHeard: 9 } });
    expect(s.objections[0].timesHeard).toBe(9);
    apply(s, { type: "objection.upsert", objection: { ...sample.objections[0], id: "obj_new" } });
    expect(s.objections).toHaveLength(sample.objections.length + 1);
  },

  "objection.remove": () => {
    const s = apply(ws(), { type: "objection.remove", id: sample.objections[0].id });
    expect(s.objections).toHaveLength(sample.objections.length - 1);
  },

  "pov.upsert": () => {
    const s = apply(ws(), { type: "pov.upsert", pov: { id: "pov_new", text: "Nobody budgets for close until it breaks", evidence: "30 calls", createdAt: at(0), uses: 0 } });
    expect(s.povs.at(-1)?.id).toBe("pov_new");
    apply(s, { type: "pov.upsert", pov: { ...s.povs.at(-1)!, uses: 2 } });
    expect(s.povs.filter((p) => p.id === "pov_new")).toEqual([expect.objectContaining({ uses: 2 })]);
  },

  "pov.remove": () => {
    const s = apply(ws(), { type: "pov.remove", id: sample.povs[0].id });
    expect(s.povs).toHaveLength(sample.povs.length - 1);
  },

  "asset.upsert": () => {
    const s = apply(ws(), { type: "asset.upsert", asset: { ...sample.assets[0], approved: false } });
    expect(s.assets[0].approved).toBe(false);
    expect(s.assets).toHaveLength(sample.assets.length);
  },

  "asset.remove": () => {
    const s = apply(ws(), { type: "asset.remove", id: sample.assets[0].id });
    expect(s.assets).toHaveLength(sample.assets.length - 1);
  },

  "studio.profile.update": () => {
    const s = apply(ws(), { type: "studio.profile.update", patch: { audience: "prosumer" } });
    expect(s.studio.profile).toMatchObject({ audience: "prosumer", productName: "Ledgerline" });
    // No profile yet: defaults come from the company, then the patch.
    const fresh = apply(makeWorkspace({ company: sample.company }), { type: "studio.profile.update", patch: { reader: "a controller" } });
    expect(fresh.studio.profile).toEqual({ audience: "b2b", reader: "a controller", productName: sample.company!.name, neverSay: [] });
  },

  "studio.material.upsert": () => {
    const s = apply(ws(), { type: "studio.material.upsert", material: { id: "mat_new", kind: "number", text: "Closes in 6 hours", source: "Design partner, Sept 2026", createdAt: at(0), uses: 0 } });
    expect(s.studio.material.at(-1)?.id).toBe("mat_new");
    expect(s.studio.material).toHaveLength(sample.studio.material.length + 1);
  },

  "studio.material.remove": () => {
    const s = apply(ws(), { type: "studio.material.remove", id: MATERIAL.demo });
    expect(s.studio.material.some((m) => m.id === MATERIAL.demo)).toBe(false);
  },

  "studio.option.edit": () => {
    const option = sample.studio.pieces[PIECE.hero].options[0];
    const s = apply(ws(), { type: "studio.option.edit", pieceId: PIECE.hero, optionId: option.id, parts: { headline: "Unlock the power of seamless closes" } });
    const edited = s.studio.pieces[PIECE.hero].options[0];
    expect(edited).toMatchObject({ edited: true, parts: { headline: "Unlock the power of seamless closes", subhead: option.parts.subhead } });
    // Lint follows the edit, so "Ready" can't go stale.
    expect(option.lint.passed).toBe(true);
    expect(edited.lint.passed).toBe(false);
    // Graphics that set the old words are marked.
    const withGraphic = apply(withVisual(), { type: "studio.option.edit", pieceId: PIECE.hero, optionId: option.id, parts: { cta: "Try it" } });
    expect(withGraphic.studio.visuals.vis_test000001.stale).toBe(true);
  },

  "studio.option.keep": () => {
    const option = sample.studio.pieces[PIECE.hero].options[1];
    const s = apply(ws(), { type: "studio.option.keep", pieceId: PIECE.hero, optionId: option.id, kept: true });
    expect(s.studio.pieces[PIECE.hero].options[1].kept).toBe(true);
  },

  "studio.piece.remove": () => {
    const s = apply(withVisual(), { type: "studio.piece.remove", id: PIECE.hero });
    expect(s.studio.pieces[PIECE.hero]).toBeUndefined();
    expect(s.studio.visuals.vis_test000001).toBeUndefined();
  },

  "studio.visual.keep": () => {
    const s = apply(withVisual(), { type: "studio.visual.keep", id: "vis_test000001", kept: true });
    expect(s.studio.visuals.vis_test000001.kept).toBe(true);
    expect(() => apply(s, { type: "studio.visual.keep", id: "vis_missing", kept: true })).toThrow(ActionError);
  },

  "studio.visual.remove": () => {
    const s = apply(withVisual(), { type: "studio.visual.remove", id: "vis_test000001" });
    expect(s.studio.visuals).toEqual({});
  },

  "studio.image.remove": () => {
    const s = apply(withVisual(), { type: "studio.image.remove", id: "img_test000001" });
    expect(s.studio.images).toEqual({});
    // The rendered graphic stays.
    expect(s.studio.visuals.vis_test000001.pngFile).toBe("vis_test000001.png");
  },

  "connector.upsert": () => {
    const s = apply(ws(), { type: "connector.upsert", connector: { id: "con_new", name: "Jo Park", relationship: "angel", introsMade: 0 } });
    expect(s.connectors.at(-1)?.name).toBe("Jo Park");
  },

  "connector.remove": () => {
    const s = apply(ws(), { type: "connector.remove", id: sample.connectors[0].id });
    expect(s.connectors).toHaveLength(sample.connectors.length - 1);
  },

  "connector.give": () => {
    const id = sample.connectors[1].id;
    const s = apply(ws(), { type: "connector.give", id, what: `  Sent a customer lead ${"x".repeat(200)}`, at: at(0) });
    const gives = s.connectors.find((c) => c.id === id)!.gives!;
    expect(gives.at(-1)).toEqual({ at: TODAY, what: `Sent a customer lead ${"x".repeat(200)}`.slice(0, 140) });
    expect(() => apply(s, { type: "connector.give", id: "con_missing", what: "x", at: at(0) })).toThrow(ActionError);
  },

  "connector.sendList": () => {
    const id = sample.connectors[1].id;
    const s = apply(ws(), { type: "connector.sendList", id, domains: ["a.example", "b.example", "a.example"], at: at(0) });
    const c = s.connectors.find((x) => x.id === id)!;
    expect(c.list).toEqual({ sentOn: TODAY, domains: ["a.example", "b.example"] });
    expect(c.lastAskedOn).toBe(TODAY);
    expect(() => apply(s, { type: "connector.sendList", id: "con_missing", domains: [], at: at(0) })).toThrow(ActionError);
  },

  "connector.markList": () => {
    const id = sample.connectors[1].id;
    const s = apply(ws(), { type: "connector.sendList", id, domains: ["a.example", "b.example"], at: at(-2) }, { type: "connector.markList", id, marked: ["b.example", "z.example"], at: at(0) });
    expect(s.connectors.find((x) => x.id === id)!.list).toMatchObject({ marked: ["b.example"], markedOn: TODAY });
    expect(() => apply(ws(), { type: "connector.markList", id, marked: [], at: at(0) })).toThrow(ActionError);
  },

  "intro.create": () => {
    const intro = { id: "intro_t", kind: "ask" as const, stage: "asked" as const, targetName: "Rafael Ortiz", askedOn: TODAY, history: [], createdAt: at(0), updatedAt: at(0) };
    const s = apply(ws(), { type: "intro.create", intro });
    expect(s.intros.intro_t).toEqual(intro);
    // Idempotent: a second create with the same id keeps the first.
    apply(s, { type: "intro.create", intro: { ...intro, targetName: "Someone else" } });
    expect(s.intros.intro_t.targetName).toBe("Rafael Ortiz");
  },

  "intro.advance": () => {
    const s = ws();
    const id = Object.values(s.intros).find((i) => i.kind === "ask" && i.stage === "asked" && i.connectorId)!.id;
    const connector = () => s.connectors.find((c) => c.id === s.intros[id].connectorId)!;
    const before = connector().introsMade;
    apply(s, { type: "intro.advance", id, stage: "forwarded", at: at(0) });
    expect(s.intros[id]).toMatchObject({ stage: "forwarded", forwardedOn: TODAY });
    apply(s, { type: "intro.advance", id, stage: "introduced", at: at(0), activityId: "act_intro" });
    expect(s.intros[id].introducedOn).toBe(TODAY);
    expect(connector().introsMade).toBe(before + 1);
    expect(s.activities.find((a) => a.id === "act_intro")).toMatchObject({ kind: "intro_made", channel: "intro" });
    // Setting it again doesn't count twice.
    apply(s, { type: "intro.advance", id, stage: "meeting", at: at(0) }, { type: "intro.advance", id, stage: "introduced", at: at(0), activityId: "act_again" });
    expect(connector().introsMade).toBe(before + 1);
    apply(s, { type: "intro.advance", id, stage: "done", outcome: "pilot", at: at(0) });
    expect(s.intros[id]).toMatchObject({ stage: "done", outcome: "pilot", closedOn: TODAY });
    expect(s.intros[id].history.map((h) => h.stage)).toEqual(expect.arrayContaining(["forwarded", "introduced", "meeting", "done"]));
  },

  "intro.mark": () => {
    const s = ws();
    const ask = Object.values(s.intros).find((i) => i.kind === "ask")!.id;
    apply(s, { type: "intro.mark", id: ask, field: "nudgedOn", at: at(0) });
    expect(s.intros[ask].nudgedOn).toBe(TODAY);
    const give = Object.values(s.intros).find((i) => i.kind === "give")!.id;
    apply(s, { type: "intro.mark", id: give, field: "nudgedOn", side: 1, at: at(0) });
    expect(s.intros[give].sides![1].nudgedOn).toBe(TODAY);
    expect(() => apply(s, { type: "intro.mark", id: "intro_missing", field: "repliedOn", at: at(0) })).toThrow(ActionError);
  },

  "intro.consent": () => {
    const s = ws();
    const give = Object.values(s.intros).find((i) => i.kind === "give")!;
    const pending = give.sides!.findIndex((x) => x.consent === "pending") as 0 | 1;
    apply(s, { type: "intro.consent", id: give.id, side: pending, consent: "yes", at: at(0) });
    expect(s.intros[give.id].sides![pending].consent).toBe("yes");
    expect(s.intros[give.id].stage).toBe("asked");
    // One side passing closes the give.
    const fresh = ws();
    apply(fresh, { type: "intro.consent", id: give.id, side: pending, consent: "no", at: at(0) });
    expect(fresh.intros[give.id]).toMatchObject({ stage: "declined", closedOn: TODAY });
  },

  "intro.remove": () => {
    const id = Object.keys(sample.intros)[0];
    const s = apply(ws(), { type: "intro.remove", id });
    expect(s.intros[id]).toBeUndefined();
  },

  "evidence.flagWrong": () => {
    const s = apply(ws(), { type: "evidence.flagWrong", id: "ev_ll_home", note: "Old pricing", at: at(0) });
    expect(s.evidence.ev_ll_home.flaggedWrong).toEqual({ at: at(0), note: "Old pricing" });
    expect(() => apply(s, { type: "evidence.flagWrong", id: "ev_missing", at: at(0) })).toThrow("Evidence not found");
  },

  "account.add": () => {
    const s = ws();
    const account = { ...s.accounts[DOMAIN.quayside], domain: "new.example", name: "New Co" };
    apply(s, { type: "account.add", account });
    expect(s.accounts["new.example"].name).toBe("New Co");
    // Adding a domain that exists never overwrites it.
    apply(s, { type: "account.add", account: { ...account, domain: DOMAIN.northwind, name: "Overwritten" } });
    expect(s.accounts[DOMAIN.northwind].name).toBe(sample.accounts[DOMAIN.northwind].name);
  },

  "account.update": () => {
    const s = apply(ws(), { type: "account.update", domain: DOMAIN.fernwick, patch: { oneLiner: "Metered APIs for logistics" } });
    expect(s.accounts[DOMAIN.fernwick].oneLiner).toBe("Metered APIs for logistics");
    expect(() => apply(s, { type: "account.update", domain: "missing.example", patch: {} })).toThrow("Account not found");
  },

  "account.track": () => {
    const s = apply(ws(), { type: "account.track", domain: DOMAIN.quayside, watch: true });
    expect(s.accounts[DOMAIN.quayside]).toMatchObject({ watch: true, status: "tracked" });
    apply(s, { type: "account.track", domain: DOMAIN.quayside, watch: false });
    expect(s.accounts[DOMAIN.quayside]).toMatchObject({ watch: false, status: "new" });
    // Pipeline accounts keep their status either way.
    apply(s, { type: "account.track", domain: DOMAIN.northwind, watch: false });
    expect(s.accounts[DOMAIN.northwind].status).toBe("in_pipeline");
  },

  "account.disqualify": () => {
    const s = apply(ws(), { type: "account.disqualify", domain: DOMAIN.fernwick, reason: "too_small", note: "12 people", at: at(0) });
    expect(s.accounts[DOMAIN.fernwick]).toMatchObject({ status: "disqualified", watch: false, disqualified: { reason: "too_small", note: "12 people", at: at(0) } });
  },

  "account.restore": () => {
    const s = apply(ws(), { type: "account.restore", domain: DOMAIN.ironvale });
    expect(s.accounts[DOMAIN.ironvale].status).toBe("new");
    expect(s.accounts[DOMAIN.ironvale].disqualified).toBeUndefined();
    // A disqualified company with a deal goes back to the pipeline.
    apply(s, { type: "account.disqualify", domain: DOMAIN.northwind, reason: "other", at: at(0) }, { type: "account.restore", domain: DOMAIN.northwind });
    expect(s.accounts[DOMAIN.northwind].status).toBe("in_pipeline");
  },

  "person.upsert": () => {
    const s = ws();
    const person = { ...s.people[PERSON.owen], id: "per_new", name: "Ana Lima" };
    apply(s, { type: "person.upsert", person }, { type: "person.upsert", person: { ...person, title: "VP Finance" } });
    expect(s.people.per_new.title).toBe("VP Finance");
    expect(s.accounts[DOMAIN.fernwick].peopleIds.filter((id) => id === "per_new")).toHaveLength(1);
  },

  "person.remove": () => {
    const s = apply(ws(), { type: "person.remove", id: PERSON.dana });
    expect(s.people[PERSON.dana]).toBeUndefined();
    expect(s.accounts[DOMAIN.northwind].peopleIds).not.toContain(PERSON.dana);
    expect(s.deals[DEAL.northwind].contacts.map((c) => c.personId)).not.toContain(PERSON.dana);
    // Unknown ids are a no-op, not an error (two tabs may remove the same person).
    expect(() => apply(s, { type: "person.remove", id: PERSON.dana })).not.toThrow();
  },

  "person.forget": () => {
    // The full contract is in src/lib/people/forget.test.ts.
    const s = apply(ws(), { type: "person.forget", id: PERSON.dana, at: at(0), suppressionId: "sup_del" });
    expect(s.people[PERSON.dana]).toBeUndefined();
    expect(s.suppression.at(-1)).toEqual({ id: "sup_del", email: "dana@northwind.example", reason: "requested_delete", at: at(0) });
    expect(() => apply(s, { type: "person.forget", id: PERSON.dana, at: at(0), suppressionId: "sup_again" })).not.toThrow();
    expect(s.suppression.filter((x) => x.reason === "requested_delete")).toHaveLength(1);
  },

  "deal.create": () => {
    const s = ws();
    const deal = { ...s.deals[DEAL.saltmarsh], id: "deal_fernwick", accountDomain: DOMAIN.fernwick, name: "Fernwick" };
    apply(s, { type: "deal.create", deal });
    expect(s.deals.deal_fernwick).toEqual(deal);
    expect(s.accounts[DOMAIN.fernwick]).toMatchObject({ dealId: "deal_fernwick", status: "in_pipeline" });
  },

  "deal.update": () => {
    const s = apply(ws(), { type: "deal.update", id: DEAL.saltmarsh, patch: { amountUsd: 24000 }, at: at(0) });
    expect(s.deals[DEAL.saltmarsh]).toMatchObject({ amountUsd: 24000, updatedAt: at(0) });
    expect(() => apply(s, { type: "deal.update", id: "deal_missing", patch: {}, at: at(0) })).toThrow("Deal not found");
  },

  "deal.setStage": () => {
    const s = ws();
    const deal = () => s.deals[DEAL.saltmarsh];
    const history = deal().stageHistory.length;
    apply(s, { type: "deal.setStage", id: DEAL.saltmarsh, stage: "talking", at: at(0) });
    expect(deal().stageHistory).toHaveLength(history); // same stage: nothing to record

    apply(s, { type: "deal.setStage", id: DEAL.saltmarsh, stage: "qualified", at: at(0, "11:00") });
    expect(deal()).toMatchObject({ stage: "qualified", updatedAt: at(0, "11:00"), lastActivityAt: at(0, "11:00") });
    expect(deal().stageHistory.at(-1)).toEqual({ stage: "qualified", at: at(0, "11:00") });
    expect(s.accounts[DOMAIN.saltmarsh].status).toBe("in_pipeline");

    apply(s, { type: "deal.setStage", id: DEAL.saltmarsh, stage: "won", at: at(0, "12:00") });
    expect(s.accounts[DOMAIN.saltmarsh].status).toBe("customer");

    apply(s, { type: "deal.setStage", id: DEAL.saltmarsh, stage: "lost", lossReason: "timing", at: at(0, "13:00") });
    expect(deal()).toMatchObject({ stage: "lost", lossReason: "timing" });
    expect(s.accounts[DOMAIN.saltmarsh].status).toBe("in_pipeline");

    // Nurture without a date parks it for 60 days from today.
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    apply(s, { type: "deal.setStage", id: DEAL.saltmarsh, stage: "nurture", at: at(0, "14:00") });
    expect(deal().nurtureUntil).toBe("2026-12-19");
    apply(s, { type: "deal.setStage", id: DEAL.rowanstack, stage: "nurture", nurtureUntil: "2027-01-12", at: at(0) });
    expect(s.deals[DEAL.rowanstack].nurtureUntil).toBe("2027-01-12");
  },

  "deal.setNextStep": () => {
    const nextStep = { what: "Send the pilot terms", date: "2026-10-23", buyerAgreed: true };
    const s = apply(ws(), { type: "deal.setNextStep", id: DEAL.saltmarsh, nextStep, at: at(0) });
    expect(s.deals[DEAL.saltmarsh]).toMatchObject({ nextStep, updatedAt: at(0) });
  },

  "meeting.upsert": () => {
    const s = ws();
    const meeting = { ...s.meetings[MEETING.saltmarshDiscovery], id: "mtg_new" };
    apply(s, { type: "meeting.upsert", meeting }, { type: "meeting.upsert", meeting: { ...meeting, title: "Renamed" } });
    expect(s.meetings.mtg_new.title).toBe("Renamed");
    expect(s.deals[DEAL.saltmarsh].meetingIds.filter((id) => id === "mtg_new")).toHaveLength(1);
  },

  "meeting.toggleStar": () => {
    const s = ws();
    const briefAt = s.meetings[MEETING.lumenwireToday].brief!.generatedAt;
    const toggle = (index: number, stamp = briefAt) => apply(s, { type: "meeting.toggleStar", id: MEETING.lumenwireToday, briefAt: stamp, index });
    toggle(3);
    toggle(1);
    expect(s.meetings[MEETING.lumenwireToday].starred).toEqual([1, 3]);
    toggle(3);
    expect(s.meetings[MEETING.lumenwireToday].starred).toEqual([1]);
    // A star from before the brief was regenerated is dropped.
    toggle(2, at(-5));
    expect(s.meetings[MEETING.lumenwireToday].starred).toEqual([1]);
  },

  "meeting.patchDebrief": () => {
    const s = ws();
    const debrief = () => s.meetings[MEETING.northwindYesterday].debrief!;
    const generatedAt = debrief().generatedAt;
    apply(s, { type: "meeting.patchDebrief", id: MEETING.northwindYesterday, generatedAt, patch: { recap: { subject: "Recap", body: "Thanks" } } });
    expect(debrief().recap).toEqual({ subject: "Recap", body: "Thanks" });
    // A patch against an older debrief never overwrites the newer one.
    apply(s, { type: "meeting.patchDebrief", id: MEETING.northwindYesterday, generatedAt: at(-9), patch: { recap: { subject: "Stale", body: "" } } });
    expect(debrief().recap.subject).toBe("Recap");
  },

  "outreach.editStep": () => {
    const s = apply(ws(), { type: "outreach.editStep", packageId: PACKAGE.fernwickCold, step: 1, body: "Owen, new body." });
    const step = s.outreach[PACKAGE.fernwickCold].steps[0];
    const drafted = sample.outreach[PACKAGE.fernwickCold].steps[0];
    expect(step).toMatchObject({ body: "Owen, new body.", edited: true, subject: drafted.subject });
    apply(s, { type: "outreach.editStep", packageId: PACKAGE.fernwickCold, step: 1, subject: null });
    expect(s.outreach[PACKAGE.fernwickCold].steps[0].subject).toBeNull();
    // The draft as written is kept once, from before the first edit.
    expect(step.original).toEqual({ subject: drafted.subject, body: drafted.body });
    expect(() => apply(s, { type: "outreach.editStep", packageId: PACKAGE.fernwickCold, step: 4, body: "x" })).toThrow("Step not found");
    expect(() => apply(s, { type: "outreach.editStep", packageId: "pkg_missing", step: 1, body: "x" })).toThrow("Draft not found");
  },

  "outreach.useAlternate": () => {
    const s = ws();
    const pkg = s.outreach[PACKAGE.fernwickCold];
    const original = structuredClone(pkg.steps[0]);
    pkg.alternates = [makeStep(1, { subject: "alt subject", body: "Alternate body.", frame: "problem_prompter", evidenceIds: ["ev_alt"] })];
    apply(s, { type: "outreach.useAlternate", packageId: pkg.id, index: 0 });
    expect(pkg.steps[0]).toMatchObject({ subject: "alt subject", body: "Alternate body.", frame: "problem_prompter", evidenceIds: ["ev_alt"], sendOn: original.sendOn });
    // The text that was replaced becomes the alternate, so it can be swapped back.
    expect(pkg.alternates[0]).toEqual(original);
    expect(() => apply(s, { type: "outreach.useAlternate", packageId: pkg.id, index: 5 })).toThrow("Alternate not found");
  },

  "outreach.approveStep": () => {
    const s = ws();
    const card = Object.values(s.moves).find((m) => m.draft?.packageId === PACKAGE.fernwickCold)!;
    expect(card.status).toBe("open");
    const approve: Action = { type: "outreach.approveStep", packageId: PACKAGE.fernwickCold, step: 1, at: at(0, "09:45"), activityId: "act_new" };
    apply(s, approve, approve); // a double click logs one send
    expect(s.outreach[PACKAGE.fernwickCold].steps[0]).toMatchObject({ status: "sent", sentAt: at(0, "09:45") });
    expect(s.activities.filter((a) => a.id === "act_new")).toEqual([
      expect.objectContaining({
        kind: "touch_sent",
        channel: "email",
        personId: PERSON.owen,
        accountDomain: DOMAIN.fernwick,
        draftRef: { packageId: PACKAGE.fernwickCold, step: 1 },
        summary: "First touch to Owen Park",
        source: "founder",
        // What the learning reviews compare: the why-now signal behind the angle, frame, POV, persona and subject.
        signalType: "jd_names_pain",
        tags: { frame: "founder_card", povId: "pov_script_black_box", credentialClaimId: "clm_tollgate_credential", persona: "champion", subjectStyle: "trigger" },
        // Sent as drafted.
        editDistance: 0,
      }),
    ]);
    expect(s.moves[card.id].status).toBe("done");

    // LinkedIn and intro drafts log their own kind and channel.
    apply(s, { type: "outreach.approveStep", packageId: PACKAGE.bramblecastLinkedin, step: 1, at: at(0), activityId: "act_li" });
    apply(s, { type: "outreach.approveStep", packageId: PACKAGE.ashgroveIntro, step: 1, at: at(0), activityId: "act_intro" });
    expect(s.activities.find((a) => a.id === "act_li")).toMatchObject({ kind: "linkedin_dm", channel: "linkedin" });
    expect(s.activities.find((a) => a.id === "act_intro")).toMatchObject({ kind: "intro_requested", channel: "intro" });
  },

  "outreach.skipStep": () => {
    const s = apply(ws(), { type: "outreach.skipStep", packageId: PACKAGE.driftglassCold, step: 2 });
    expect(s.outreach[PACKAGE.driftglassCold].steps[1].status).toBe("skipped");
  },

  "outreach.swapAlternate": () => {
    const s = ws();
    const pkg = s.outreach[PACKAGE.fernwickCold];
    const current = structuredClone(pkg.steps[0]);
    const alt = makeStep(1, { body: "Alt.", angleId: "ang_alt", sendOn: "2030-01-01", thread: "reply", status: "skipped", personalizedSpans: [{ text: "Alt", evidenceId: "ev_alt" }] });
    pkg.alternates = [alt];
    apply(s, { type: "outreach.swapAlternate", packageId: pkg.id, index: 0 });
    // Text, spans and angle travel together; schedule, thread and status stay with the slot.
    expect(pkg.steps[0]).toMatchObject({ body: "Alt.", personalizedSpans: alt.personalizedSpans, sendOn: current.sendOn, thread: current.thread, status: "draft" });
    expect(pkg.angleId).toBe("ang_alt");
    expect(pkg.alternates[0]).toEqual(current);
    // A step that already went out can't be swapped.
    const sent = s.outreach[PACKAGE.driftglassCold];
    sent.alternates = [alt];
    const before = structuredClone(sent.steps);
    apply(s, { type: "outreach.swapAlternate", packageId: sent.id, index: 0 });
    expect(sent.steps).toEqual(before);
  },

  "outreach.editExtra": () => {
    const s = apply(
      ws(),
      { type: "outreach.editExtra", packageId: PACKAGE.bramblecastLinkedin, linkedinNote: null, postAcceptDm: "Thanks for connecting." },
      { type: "outreach.editExtra", packageId: PACKAGE.ashgroveIntro, introWrapper: "Claire, would you introduce me to Rafael?" },
    );
    expect(s.outreach[PACKAGE.bramblecastLinkedin].linkedin).toMatchObject({ note: null, postAcceptDm: "Thanks for connecting." });
    expect(s.outreach[PACKAGE.ashgroveIntro].intro?.wrapper).toBe("Claire, would you introduce me to Rafael?");
  },

  "outreach.unapproveStep": () => {
    const s = ws();
    s.moves.mv_done = makeMove("mv_done", { status: "done", draft: { packageId: PACKAGE.driftglassCold, step: 1 } });
    const sentActivity = s.activities.find((a) => a.draftRef?.packageId === PACKAGE.driftglassCold && a.draftRef.step === 1)!;
    apply(s, { type: "outreach.unapproveStep", packageId: PACKAGE.driftglassCold, step: 1, activityId: sentActivity.id });
    const step = s.outreach[PACKAGE.driftglassCold].steps[0];
    expect(step.status).toBe("draft");
    expect(step.sentAt).toBeUndefined();
    expect(s.activities.find((a) => a.id === sentActivity.id)).toBeUndefined();
    expect(s.moves.mv_done.status).toBe("open");
    // The card the approval finished comes back too, even without a draft link; missing ids are skipped.
    s.moves.mv_card = makeMove("mv_card", { status: "done" });
    s.moves.mv_skipped = makeMove("mv_skipped", { status: "skipped" });
    apply(s, { type: "outreach.approveStep", packageId: PACKAGE.driftglassCold, step: 1, at: at(0), activityId: "act_again" });
    apply(s, { type: "outreach.unapproveStep", packageId: PACKAGE.driftglassCold, step: 1, activityId: "act_again", moveIds: ["mv_card", "mv_skipped", "mv_missing"] });
    expect(s.moves.mv_card.status).toBe("open");
    expect(s.moves.mv_skipped.status).toBe("skipped");
  },

  "outreach.setPerson": () => {
    const s = apply(ws(), { type: "outreach.setPerson", packageId: PACKAGE.fernwickCold, personId: PERSON.mei });
    expect(s.outreach[PACKAGE.fernwickCold].personId).toBe(PERSON.mei);
    expect(() => apply(s, { type: "outreach.setPerson", packageId: PACKAGE.fernwickCold, personId: "per_missing" })).toThrow("Person not found");
  },

  "activity.log": () => {
    const s = ws();
    // A reply cancels the rest of that person's open sequence; sent steps stay sent.
    apply(s, { type: "activity.log", activity: { id: "act_reply", at: at(0, "09:40"), kind: "reply_received", personId: PERSON.mei, summary: "Replied" } });
    expect(s.outreach[PACKAGE.driftglassCold].steps.map((x) => x.status)).toEqual(["sent", "cancelled_by_reply"]);

    // Activity on a deal bumps its last-activity time.
    apply(s, { type: "activity.log", activity: { id: "act_note", at: at(0, "09:41"), kind: "note", dealId: DEAL.saltmarsh, summary: "Note" } });
    expect(s.deals[DEAL.saltmarsh].lastActivityAt).toBe(at(0, "09:41"));

    // Answering a person closes the webhook reply cards that came in before the answer.
    s.moves.mv_inbound = makeMove("mv_inbound", { rule: "inbound.reply", kind: "reply", ref: { kind: "person", id: PERSON.leo }, receivedAt: at(0, "08:00") });
    apply(s, { type: "activity.log", activity: { id: "act_early", at: at(0, "07:00"), kind: "touch_sent", personId: PERSON.leo, summary: "Earlier touch" } });
    expect(s.moves.mv_inbound.status).toBe("open");
    apply(s, { type: "activity.log", activity: { id: "act_answer", at: at(0, "09:42"), kind: "touch_sent", personId: PERSON.leo, summary: "Answered" } });
    expect(s.moves.mv_inbound.status).toBe("done");
  },

  "activity.remove": () => {
    const s = apply(ws(), { type: "activity.remove", id: "act_034" });
    expect(s.activities.find((a) => a.id === "act_034")).toBeUndefined();
    expect(s.activities).toHaveLength(sample.activities.length - 1);
  },

  "move.done": () => {
    const id = Object.keys(sample.moves)[0];
    expect(apply(ws(), { type: "move.done", id }).moves[id].status).toBe("done");
    expect(() => apply(ws(), { type: "move.done", id: "mv_missing" })).toThrow("Move not found");
  },

  "move.skip": () => {
    const id = Object.keys(sample.moves)[0];
    expect(apply(ws(), { type: "move.skip", id, reason: "wrong_person" }).moves[id]).toMatchObject({ status: "skipped", skipReason: "wrong_person" });
  },

  "move.snooze": () => {
    const id = Object.keys(sample.moves)[0];
    expect(apply(ws(), { type: "move.snooze", id, until: "2026-10-22" }).moves[id]).toMatchObject({ status: "snoozed", snoozedUntil: "2026-10-22" });
  },

  "move.reopen": () => {
    const id = Object.keys(sample.moves)[0];
    const s = apply(ws(), { type: "move.skip", id, reason: "other" }, { type: "move.snooze", id, until: "2026-10-22" }, { type: "move.reopen", id });
    expect(s.moves[id].status).toBe("open");
    expect(s.moves[id]).not.toHaveProperty("skipReason");
    expect(s.moves[id]).not.toHaveProperty("snoozedUntil");
  },

  "activity.markOutcome": () => {
    const s = apply(ws(), { type: "activity.markOutcome", ids: ["act_025", "act_033", "act_missing"], outcome: "no_reply", at: at(0) });
    for (const id of ["act_025", "act_033"]) expect(s.activities.find((a) => a.id === id)).toMatchObject({ outcome: "no_reply", outcomeAt: at(0) });
    apply(s, { type: "activity.markOutcome", ids: ["act_025"], outcome: null, at: at(0) });
    expect(s.activities.find((a) => a.id === "act_025")).not.toHaveProperty("outcome");
    expect(s.activities.find((a) => a.id === "act_033")?.outcome).toBe("no_reply");
  },

  "activity.closeLoop": () => {
    const s = apply(ws(), { type: "activity.closeLoop", id: "act_034", at: at(0) });
    expect(s.activities.find((a) => a.id === "act_034")?.loopClosedAt).toBe(at(0));
    apply(s, { type: "activity.closeLoop", id: "act_034", at: null });
    expect(s.activities.find((a) => a.id === "act_034")).not.toHaveProperty("loopClosedAt");
    expect(() => apply(s, { type: "activity.closeLoop", id: "act_missing", at: at(0) })).toThrow(ActionError);
  },

  "brief.setProposal": () => {
    const s = ws();
    s.briefs["2026-10-19"] = {
      date: "2026-10-19",
      kind: "monday",
      greeting: "",
      matters: [],
      generatedAt: at(-1),
      proposals: [{ id: "prop_1", kind: "nurture", title: "Nurture Saltmarsh", detail: "", dealId: DEAL.saltmarsh, status: "open" }],
    };
    apply(s, { type: "brief.setProposal", date: TODAY, proposalId: "prop_1", status: "applied", at: at(0) });
    expect(s.briefs["2026-10-19"].proposals?.[0]).toMatchObject({ status: "applied", decidedAt: at(0) });
    expect(() => apply(s, { type: "brief.setProposal", date: TODAY, proposalId: "prop_missing", status: "dismissed", at: at(0) })).toThrow("Proposal not found");
  },

  "event.upsert": () => {
    const s = ws();
    const event = { ...s.events[EVENT.dinner], id: "evt_new", title: "Boston dinner" };
    apply(s, { type: "event.upsert", event });
    expect(s.events.evt_new.title).toBe("Boston dinner");
  },

  "event.remove": () => {
    const s = apply(ws(), { type: "event.remove", id: EVENT.roundtable });
    expect(s.events[EVENT.roundtable]).toBeUndefined();
  },

  "event.update": () => {
    const s = apply(ws(), { type: "event.update", id: EVENT.dinner, patch: { status: "inviting", venue: { name: "Alder Room" } } });
    expect(s.events[EVENT.dinner]).toMatchObject({ status: "inviting", venue: { name: "Alder Room" } });
    expect(Object.keys(s.events[EVENT.dinner].guests)).toEqual(Object.keys(sample.events[EVENT.dinner].guests));
  },

  "event.chooseTheme": () => {
    expect(apply(ws(), { type: "event.chooseTheme", id: EVENT.dinner, index: 2 }).events[EVENT.dinner].chosenThemeIdx).toBe(2);
  },

  "event.toggleTask": () => {
    const s = ws();
    const task = () => s.events[EVENT.dinner].plan!.timeline[0];
    const before = !!task().done;
    apply(s, { type: "event.toggleTask", id: EVENT.dinner, index: 0 });
    expect(!!task().done).toBe(!before);
    // An explicit value is idempotent (Today's "Mark done").
    apply(s, { type: "event.toggleTask", id: EVENT.dinner, index: 0, done: true }, { type: "event.toggleTask", id: EVENT.dinner, index: 0, done: true });
    expect(task().done).toBe(true);
    expect(() => apply(s, { type: "event.toggleTask", id: EVENT.dinner, index: 99 })).toThrow("Task not found");
  },

  "guest.upsert": () => {
    const s = ws();
    const guest = { ...s.events[EVENT.dinner].guests.gst_ava, id: "gst_new", name: "Jo Park" };
    apply(s, { type: "guest.upsert", eventId: EVENT.dinner, guest });
    expect(s.events[EVENT.dinner].guests.gst_new.name).toBe("Jo Park");
    expect(() => apply(s, { type: "guest.upsert", eventId: "evt_missing", guest })).toThrow("Event not found");
  },

  "guest.remove": () => {
    const s = apply(ws(), { type: "guest.remove", eventId: EVENT.dinner, guestId: "gst_ava" });
    expect(s.events[EVENT.dinner].guests.gst_ava).toBeUndefined();
  },

  "integration.update": () => {
    const s = apply(ws(), { type: "integration.update", id: "slack", patch: { config: { channel: "#gtm" } } });
    expect(s.integrations.slack).toEqual({ id: "slack", enabled: false, config: { channel: "#gtm" } });
    apply(s, { type: "integration.update", id: "slack", patch: { enabled: true, config: { dailyBrief: false } } });
    expect(s.integrations.slack).toEqual({ id: "slack", enabled: true, config: { channel: "#gtm", dailyBrief: false } });
  },

  "webhook.add": () => {
    const s = apply(ws(), { type: "webhook.add", webhook: { id: "wh_1", url: "https://hooks.example/a", label: "Zap", events: ["deal.created"], createdAt: at(0) } });
    expect(s.webhooks.map((w) => w.id)).toEqual(["wh_1"]);
  },

  "webhook.remove": () => {
    const s = apply(
      ws(),
      { type: "webhook.add", webhook: { id: "wh_1", url: "https://hooks.example/a", label: "Zap", events: [], createdAt: at(0) } },
      { type: "webhook.remove", id: "wh_1" },
    );
    expect(s.webhooks).toEqual([]);
  },

  "webhook.update": () => {
    const s = apply(
      ws(),
      { type: "webhook.add", webhook: { id: "wh_1", url: "https://hooks.example/a", label: "Zap", events: [], createdAt: at(0) } },
      { type: "webhook.update", id: "wh_1", patch: { paused: true, label: "Paused zap" } },
    );
    expect(s.webhooks[0]).toMatchObject({ paused: true, label: "Paused zap", url: "https://hooks.example/a" });
    expect(() => apply(s, { type: "webhook.update", id: "wh_missing", patch: {} })).toThrow("Webhook not found");
  },

  "suppression.add": () => {
    const s = apply(ws(), { type: "suppression.add", entry: { id: "sup_1", email: "a@b.example", reason: "unsubscribe", at: at(0) } });
    expect(s.suppression.at(-1)?.id).toBe("sup_1");
  },

  "suppression.remove": () => {
    const s = apply(ws(), { type: "suppression.remove", id: "sup_meterbook" });
    expect(s.suppression.map((x) => x.id)).toEqual(["sup_closewise"]);
  },

  "run.markSeen": () => {
    const s = apply(ws(), { type: "run.markSeen", id: "run_prep_lumenwire" }, { type: "run.markSeen", id: "run_missing" });
    expect(s.runs.find((r) => r.id === "run_prep_lumenwire")?.seen).toBe(true);
  },

  /* Consumer companies */

  "company.setMarket": () => {
    const s = apply(ws(), { type: "company.setMarket", market: "consumer", consumerModel: "dtc" });
    expect(s.company).toMatchObject({ market: "consumer", consumerModel: "dtc", marketSource: "founder" });
    // The goal follows what a consumer company counts.
    expect(s.goal).toMatchObject({ metric: "paying", targetLabel: "customers", target: 100 });
    apply(s, { type: "company.setMarket", market: "b2b" });
    expect(s.company?.consumerModel).toBeUndefined();
    expect(s.goal).toMatchObject({ metric: "deals", target: 5, targetLabel: "paid pilots or design partners" });
    expect(() => apply(makeWorkspace(), { type: "company.setMarket", market: "consumer" })).toThrow("Company not found");
  },

  "growth.log": () => {
    const s = consumerWorkspace();
    apply(s, { type: "growth.log", week: makeWeek(day(-7), { signups: 40 }) }, { type: "growth.log", week: makeWeek(day(-14), { signups: 30 }) });
    expect(s.growthLog?.map((w) => w.weekOf)).toEqual([day(-14), day(-7)]);
    // The same week replaces, it doesn't duplicate.
    apply(s, { type: "growth.log", week: makeWeek(day(-7), { signups: 45 }) });
    expect(s.growthLog?.map((w) => w.signups)).toEqual([30, 45]);
  },

  "growth.remove": () => {
    const s = apply(consumerWorkspace(), { type: "growth.log", week: makeWeek(day(-7)) }, { type: "growth.remove", weekOf: day(-7) });
    expect(s.growthLog).toEqual([]);
  },

  "partner.upsert": () => {
    const s = apply(consumerWorkspace(), { type: "partner.upsert", partner: makePartner("ptn_maya") });
    expect(s.partners?.ptn_maya.stage).toBe("shortlist");
  },

  "partner.update": () => {
    const s = apply(consumerWorkspace(), { type: "partner.upsert", partner: makePartner("ptn_maya") }, { type: "partner.update", id: "ptn_maya", patch: { trackingCode: "MAYA10" }, at: at(0) });
    expect(s.partners?.ptn_maya).toMatchObject({ trackingCode: "MAYA10", updatedAt: at(0) });
    expect(() => apply(s, { type: "partner.update", id: "ptn_missing", patch: {}, at: at(0) })).toThrow("Partner not found");
  },

  "partner.setStage": () => {
    const s = apply(consumerWorkspace(), { type: "partner.upsert", partner: makePartner("ptn_maya") }, { type: "partner.setStage", id: "ptn_maya", stage: "replied", at: at(0) });
    // Setting the same stage again is a no-op.
    apply(s, { type: "partner.setStage", id: "ptn_maya", stage: "replied", at: at(0) });
    expect(s.partners?.ptn_maya.stageHistory.map((h) => h.stage)).toEqual(["shortlist", "replied"]);
  },

  "partner.markSent": () => {
    const partner = makePartner("ptn_maya", { outreach: { channel: "dm", subject: null, body: "Hi", followUp: "Hi again", draftedAt: at(-1) } });
    const s = apply(consumerWorkspace(), { type: "partner.upsert", partner }, { type: "partner.markSent", id: "ptn_maya", what: "outreach", at: at(0), activityId: "act_p1" });
    expect(s.partners?.ptn_maya).toMatchObject({ stage: "contacted", outreach: { sentOn: TODAY } });
    expect(s.activities.at(-1)).toMatchObject({ id: "act_p1", kind: "partner_contacted", partnerId: "ptn_maya" });
    // Marking it twice doesn't log a second touch.
    apply(s, { type: "partner.markSent", id: "ptn_maya", what: "outreach", at: at(0), activityId: "act_p2" });
    expect(s.activities.filter((a) => a.kind === "partner_contacted")).toHaveLength(1);
    apply(s, { type: "partner.markSent", id: "ptn_maya", what: "follow_up", at: at(7), activityId: "act_p3" });
    expect(s.partners?.ptn_maya.outreach?.followedUpOn).toBe(day(7));
  },

  "partner.unmark": () => {
    const partner = makePartner("ptn_maya", { outreach: { channel: "dm", subject: null, body: "Hi", draftedAt: at(-1) } });
    const s = apply(
      consumerWorkspace(),
      { type: "partner.upsert", partner },
      { type: "partner.markSent", id: "ptn_maya", what: "outreach", at: at(0), activityId: "act_p1" },
      { type: "partner.unmark", id: "ptn_maya", what: "outreach", activityId: "act_p1" },
    );
    expect(s.partners?.ptn_maya.stage).toBe("shortlist");
    expect(s.partners?.ptn_maya.stageHistory.map((h) => h.stage)).toEqual(["shortlist"]);
    expect(s.partners?.ptn_maya.outreach?.sentOn).toBeUndefined();
    expect(s.activities.some((a) => a.id === "act_p1")).toBe(false);
  },

  "partner.editOutreach": () => {
    const partner = makePartner("ptn_maya", { outreach: { channel: "email", subject: "Hi", body: "Old", draftedAt: at(-1) } });
    const s = apply(consumerWorkspace(), { type: "partner.upsert", partner }, { type: "partner.editOutreach", id: "ptn_maya", body: "New" });
    expect(s.partners?.ptn_maya.outreach).toMatchObject({ subject: "Hi", body: "New", edited: true });
    expect(() => apply(s, { type: "partner.editOutreach", id: "ptn_missing", body: "x" })).toThrow("Partner not found");
  },

  "partner.logResult": () => {
    const s = apply(consumerWorkspace(), { type: "partner.upsert", partner: makePartner("ptn_maya") }, { type: "partner.logResult", id: "ptn_maya", result: { at: at(0), signups: 12, costUsd: 200 } });
    expect(s.partners?.ptn_maya.results).toEqual([{ at: at(0), signups: 12, costUsd: 200 }]);
  },

  "partner.remove": () => {
    const s = apply(consumerWorkspace(), { type: "partner.upsert", partner: makePartner("ptn_maya") }, { type: "partner.remove", id: "ptn_maya" });
    expect(s.partners).toEqual({});
  },

  "experiment.upsert": () => {
    const s = apply(consumerWorkspace(), {
      type: "experiment.upsert",
      experiment: { id: "exp_1", stage: "activation", hypothesis: "Shorter onboarding", change: "Two screens", metric: "First win", status: "idea", createdAt: at(0), updatedAt: at(0) },
    });
    expect(s.experiments?.exp_1.status).toBe("idea");
  },

  "experiment.update": () => {
    const s = apply(
      consumerWorkspace(),
      { type: "experiment.upsert", experiment: { id: "exp_1", stage: "activation", hypothesis: "h", change: "c", metric: "m", status: "idea", createdAt: at(0), updatedAt: at(0) } },
      { type: "experiment.update", id: "exp_1", patch: { status: "running", startedOn: TODAY }, at: at(1) },
    );
    expect(s.experiments?.exp_1).toMatchObject({ status: "running", startedOn: TODAY, updatedAt: at(1) });
    expect(() => apply(s, { type: "experiment.update", id: "exp_missing", patch: {}, at: at(1) })).toThrow("Experiment not found");
  },

  "experiment.remove": () => {
    const s = apply(
      consumerWorkspace(),
      { type: "experiment.upsert", experiment: { id: "exp_1", stage: "activation", hypothesis: "h", change: "c", metric: "m", status: "idea", createdAt: at(0), updatedAt: at(0) } },
      { type: "experiment.remove", id: "exp_1" },
    );
    expect(s.experiments).toEqual({});
  },

  "pmf.log": () => {
    const s = apply(
      consumerWorkspace(),
      { type: "pmf.log", survey: { id: "pmf_2", on: TODAY, answers: 50, veryDisappointed: 22 } },
      { type: "pmf.log", survey: { id: "pmf_1", on: day(-30), answers: 40, veryDisappointed: 12 } },
    );
    expect(s.pmfSurveys?.map((x) => x.id)).toEqual(["pmf_1", "pmf_2"]);
  },

  "pmf.remove": () => {
    const s = apply(consumerWorkspace(), { type: "pmf.log", survey: { id: "pmf_1", on: TODAY, answers: 40, veryDisappointed: 12 } }, { type: "pmf.remove", id: "pmf_1" });
    expect(s.pmfSurveys).toEqual([]);
  },
};

describe("applyAction", () => {
  for (const [type, run] of Object.entries(cases)) it(type, run);

  it("gives the same result on two copies (the browser and the server agree)", () => {
    const actions: Action[] = [
      { type: "outreach.approveStep", packageId: PACKAGE.fernwickCold, step: 1, at: at(0, "09:45"), activityId: "act_a" },
      { type: "activity.log", activity: { id: "act_b", at: at(0, "09:50"), kind: "reply_received", personId: PERSON.mei, summary: "Replied" } },
      { type: "deal.setStage", id: DEAL.saltmarsh, stage: "qualified", at: at(0, "10:00") },
      { type: "move.skip", id: Object.keys(sample.moves)[3], reason: "weak_angle" },
      { type: "account.disqualify", domain: DOMAIN.cinderpath, reason: "not_icp", at: at(0, "10:05") },
    ];
    expect(apply(ws(), ...actions)).toEqual(apply(ws(), ...actions));
  });

  it("throws ActionError for records that don't exist", () => {
    expect(() => apply(ws(), { type: "move.skip", id: "mv_missing", reason: "other" })).toThrow(ActionError);
    expect(() => apply(ws(), { type: "event.chooseTheme", id: "evt_missing", index: 0 })).toThrow(ActionError);
  });
});

describe("Undo after Mark as sent on Today", () => {
  it("puts a reply card back on Today, and it survives the next prepare", () => {
    const s = ws();
    const card = s.moves.mv_reply_act_034;
    expect(card).toMatchObject({ status: "open", kind: "reply" });
    // The reply draft Today showed for Dana. Its card carries no draft link (the reply rule never sets one).
    s.outreach.out_reply = makePackage("out_reply", DOMAIN.northwind, { mode: "reply", personId: PERSON.dana, createdAt: at(0, "09:00"), steps: [makeStep(1, { thread: "reply", subject: null })], replyAction: "draft" });
    expect(card.draft).toBeUndefined();

    // A (or "Mark as sent"), then the card finishes quietly.
    apply(s, { type: "outreach.approveStep", packageId: "out_reply", step: 1, at: at(0, "09:40"), activityId: "act_sent" }, { type: "move.done", id: card.id });
    s.moves = mergeMoves(s.moves, computeMoves(s, NOW), TODAY);
    expect(s.moves[card.id].status).toBe("done");

    // Undo from the toast.
    apply(s, { type: "outreach.unapproveStep", packageId: "out_reply", step: 1, activityId: "act_sent", moveIds: [card.id] });
    s.moves = mergeMoves(s.moves, computeMoves(s, NOW), TODAY);
    expect(s.outreach.out_reply.steps[0].status).toBe("draft");
    expect(s.moves[card.id].status).toBe("open");
    expect(visibleMoves(s.moves, TODAY).map((m) => m.id)).toContain(card.id);
  });
});

describe("edits teach the voice card", () => {
  it("measures how far the send moved from the draft, keeps the diff, and takes it back on Undo", () => {
    const s = ws();
    const drafted = structuredClone(s.outreach[PACKAGE.fernwickCold].steps[0]);
    expect(drafted.body.startsWith("Owen,")).toBe(true);
    const edited = drafted.body.replace(/^Owen,/, "Hi Owen,");
    apply(s, { type: "outreach.editStep", packageId: PACKAGE.fernwickCold, step: 1, body: edited, subject: drafted.subject?.toLowerCase() });
    apply(s, { type: "outreach.approveStep", packageId: PACKAGE.fernwickCold, step: 1, at: at(0, "09:45"), activityId: "act_edit" });
    const sent = s.activities.find((a) => a.id === "act_edit")!;
    expect(sent.editDistance).toBeGreaterThan(0);
    expect(sent.editDistance).toBeLessThan(0.2);
    expect(s.voice?.edits?.at(-1)).toMatchObject({ before: drafted.body, after: edited, distance: sent.editDistance });
    expect(s.voice?.editsSinceExtract).toBe(1);
    apply(s, { type: "outreach.unapproveStep", packageId: PACKAGE.fernwickCold, step: 1, activityId: "act_edit" });
    expect(s.voice?.edits ?? []).toEqual([]);
    expect(s.voice?.editsSinceExtract).toBe(0);
  });

  it("re-reads the voice on the 20th edit", () => {
    const s = makeWorkspace();
    for (let i = 0; i < 20; i++) {
      const id = `out_${i}`;
      s.outreach[id] = makePackage(id, "acme.example", { steps: [makeStep(1, { body: "Dana, I wanted to reach out about your close process." })] });
      apply(s, { type: "outreach.editStep", packageId: id, step: 1, body: "Hi Dana,\n\nYour close runs nine days. It's the reconciliation, isn't it?" });
      apply(s, { type: "outreach.approveStep", packageId: id, step: 1, at: at(0), activityId: `act_${i}` });
    }
    expect(s.voice?.editsSinceExtract).toBe(0);
    expect(s.voice?.suggested).toMatchObject({ greeting: "hi_first_name", contractions: true, basis: "0 samples, 20 edits to drafts" });
    expect(s.voice?.suggested?.avoidsWords).toEqual(expect.arrayContaining(["wanted", "reach", "process"]));
    expect(s.voice?.traits).toBeUndefined();
  });
});

describe("hrefFor", () => {
  it("sends every entity to the screen that shows it", () => {
    const s = ws();
    expect(hrefFor(undefined)).toBeUndefined();
    expect(hrefFor({ kind: "account", id: "a b.example" })).toBe("/companies?c=a%20b.example");
    expect(hrefFor({ kind: "deal", id: DEAL.rowanstack }, s)).toBe(`/companies?c=${DOMAIN.rowanstack}`);
    expect(hrefFor({ kind: "deal", id: "deal_missing" }, s)).toBe("/companies?view=talking");
    expect(hrefFor({ kind: "person", id: PERSON.dana }, s)).toBe(`/companies?c=${DOMAIN.northwind}`);
    expect(hrefFor({ kind: "meeting", id: MEETING.lumenwireToday }, s)).toBe(`/companies?c=${DOMAIN.lumenwire}`);
    expect(hrefFor({ kind: "meeting", id: "mtg_missing" }, s)).toBeUndefined();
    expect(hrefFor({ kind: "event", id: EVENT.dinner })).toBe(`/events/${EVENT.dinner}`);
    expect(hrefFor({ kind: "playbook", id: "fq_soc2" })).toBe("/playbook#fq_soc2");
    expect(hrefFor({ kind: "studio", id: PIECE.hero })).toBe(`/studio?piece=${PIECE.hero}`);
    expect(hrefFor({ kind: "claim", id: "clm_1" })).toBeUndefined();
  });
});
