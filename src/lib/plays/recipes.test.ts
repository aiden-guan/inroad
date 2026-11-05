import { describe, expect, it } from "vitest";
import { applyAction } from "@/lib/domain/actions";
import type { Signal, Workspace } from "@/lib/domain/types";
import { computeMoves, mergeMoves } from "@/lib/moves/rules";
import { sampleWorkspace } from "@/lib/sample";
import { SAMPLE_PLAY } from "@/lib/sample/plays";
import { NOW, TODAY, at, day, makeAccount, makeActivity, makeDeal, makeMove, makePackage, makePerson, makeWorkspace } from "@/test/factories";
import { backtestPlay, playEnabled, playResults, PLAY_BY_ID } from "./catalog";
import { measureLine, playLessons, resultsByVersion } from "./custom";
import type { CustomPlay, Recipe } from "./recipe-types";
import {
  cardId,
  compileCustom,
  customPlayCards,
  currentVersion,
  describeChanges,
  dryRun,
  editingRecipe,
  evaluateRecipe,
  findPlay,
  mentions,
  normalizeRecipe,
  playsFor,
  versionAt,
  withUnsupported,
} from "./recipes";
import { suggestPlays, typesFor } from "./suggest";

function sig(id: string, type: Signal["type"], daysAgo: number, headline = `${type} headline`, strength: Signal["strength"] = 2): Signal {
  return { id, type, headline, date: day(-daysAgo), url: `https://jobs.example/${id}`, host: "jobs.example", strength, usableInOutreach: true, implication: "" };
}

/** "Billing or RevOps hire at an A or B company with no open deal, write to the champion." */
function recipe(patch: { trigger?: Partial<Recipe["trigger"]>; audience?: Partial<Recipe["audience"]>; guardrails?: Partial<Recipe["guardrails"]>; action?: Partial<Recipe["action"]>; name?: string } = {}): Recipe {
  return normalizeRecipe({
    name: patch.name ?? "Billing hire",
    trigger: { signals: ["jd_names_pain", "first_hire"], withinDays: 45, keywords: ["billing", "revops"], ...patch.trigger },
    audience: { tiers: ["A", "B"], deal: "none", personas: ["champion"], ...patch.audience },
    guardrails: { cooldownDays: 30, maxPerWeek: 5, ...patch.guardrails },
    action: { kind: "write", angle: "Reference the role.", ...patch.action },
    measure: "meeting",
  });
}

function play(id: string, r: Recipe, opts: { enabled?: boolean; at?: string } = {}): CustomPlay {
  const when = opts.at ?? at(-10);
  return { id, createdAt: when, sentence: "When a fit company posts a billing role, write to the controller.", origin: "sentence", versions: [{ version: 1, recipe: r, at: when, note: "First version", source: "compiled" }], history: [{ version: 1, at: when }], unsupported: [], assumptions: [], dismissed: [] };
}

/** Three prospects with billing posts, one with an open deal, one customer; people on each. */
function world(): Workspace {
  return makeWorkspace({
    accounts: {
      "a.example": makeAccount("a.example", { fitScore: 82, signals: [sig("s_a", "jd_names_pain", 10, "Billing Analyst to reconcile usage")], peopleIds: ["per_a"] }),
      "b.example": makeAccount("b.example", { tier: "B", fitScore: 74, signals: [sig("s_b", "first_hire", 20, "First RevOps Manager")], peopleIds: ["per_b", "per_b2"] }),
      "c.example": makeAccount("c.example", { tier: "C", fitScore: 55, signals: [sig("s_c", "jd_names_pain", 5, "Billing lead")] }),
      "d.example": makeAccount("d.example", { dealId: "deal_d", signals: [sig("s_d", "jd_names_pain", 8, "Billing ops hire")] }),
      "e.example": makeAccount("e.example", { status: "customer", signals: [sig("s_e", "jd_names_pain", 8, "Billing ops hire")] }),
      "f.example": makeAccount("f.example", { signals: [sig("s_f", "jd_names_pain", 9, "Senior Data Engineer")] }),
    },
    people: {
      per_a: makePerson("per_a", "a.example", { name: "Ana Alvarez", role: "champion" }),
      per_b: makePerson("per_b", "b.example", { name: "Ben Brook", role: "economic_buyer", title: "CFO" }),
      per_b2: makePerson("per_b2", "b.example", { name: "Bea Bell", role: "champion" }),
    },
    deals: { deal_d: makeDeal("deal_d", "d.example", { stage: "qualified" }) },
  });
}

describe("recipes: normalizing", () => {
  it("keeps only real values and clamps the numbers", () => {
    const r = normalizeRecipe({
      name: "  A   name  ",
      trigger: { signals: ["funding", "made_up", "funding"], withinDays: 900, keywords: ["  Billing ", "billing", "x"], minStrength: 7, stack: 3 },
      audience: { tiers: ["A", "Z"], minFit: -4, deal: "none", stages: ["proposal"], personas: ["champion"], excludePersonas: ["champion", "blocker"] },
      guardrails: { cooldownDays: -1, maxPerWeek: 500 },
      action: { kind: "telepathy", angle: 4 },
      measure: "vibes",
    } as never);
    expect(r).toMatchObject({
      name: "A name",
      trigger: { signals: ["funding"], withinDays: 365, keywords: ["billing"], minStrength: 3, stack: 1 },
      audience: { tiers: ["A"], minFit: 0, deal: "none", stages: [], personas: ["champion"], excludePersonas: ["blocker"] },
      guardrails: { cooldownDays: 0, maxPerWeek: 50 },
      action: { kind: "write", angle: "" },
      measure: "reply",
    });
    expect(normalizeRecipe({ audience: { deal: "open", stages: ["proposal", "won"] } }).audience.stages).toEqual(["proposal"]);
  });

  it("matches keywords from the start of a word, across hyphens and case", () => {
    expect(mentions("Revenue Accounting Manager to reconcile usage-based invoices", ["reconcil"])).toBe("reconcil");
    expect(mentions("Usage based pricing", ["usage-based"])).toBe("usage-based");
    expect(mentions("End of quarter close", ["ar"])).toBeUndefined();
    expect(mentions("Hiring for AR and billing", ["ar"])).toBe("ar");
  });
});

describe("recipes: matching", () => {
  it("fires on a fresh signal that says the words, with the dated fact and the right person", () => {
    const ws = world();
    const { matches, skips } = evaluateRecipe(ws, recipe(), "cp_x", TODAY);
    expect(matches.map((m) => [m.domain, m.personName, m.matched, m.date])).toEqual([
      ["a.example", "Ana Alvarez", "billing", day(-10)],
      ["b.example", "Bea Bell", "revops", day(-20)],
    ]);
    expect(Object.fromEntries(skips.map((s) => [s.domain, s.reason]))).toEqual({
      "c.example": "Tier C: this play runs on A or B",
      "d.example": "Open deal at Qualified: worked from the deal",
      "e.example": "Already a customer",
      "f.example": "No fresh signal mentions “billing” or “revops”",
    });
  });

  it("says which condition stopped each company: freshness, strength, stacking, fit, status, criteria and facts", () => {
    const ws = world();
    const reason = (r: Recipe, domain: string) => evaluateRecipe(ws, r, "cp_x", TODAY).skips.find((s) => s.domain === domain)?.reason;
    expect(reason(recipe({ trigger: { withinDays: 7 } }), "a.example")).toBe("Newest signal is 10 days old; the window is 7");
    expect(reason(recipe({ trigger: { minStrength: 3 } }), "a.example")).toBe("Signal strength 2; this play needs 3+");
    expect(reason(recipe({ trigger: { stack: 2 } }), "a.example")).toBe("1 of the 2 signal types it needs at once");
    expect(reason(recipe({ audience: { minFit: 80 } }), "b.example")).toBe("Fit 74; this play needs 80+");
    expect(reason(recipe({ audience: { statuses: ["new"] } }), "a.example")).toBe("Status is tracked; this play runs on new");
    ws.foundation = sampleWorkspace(NOW).foundation;
    ws.accounts["a.example"].criteria = [{ criterionId: "icp_usage_pricing", met: "unknown" }];
    expect(reason(recipe({ audience: { criteria: ["icp_usage_pricing"] } }), "a.example")).toMatch(/^Not known to meet “Prices on a usage metric/);
    ws.accounts["a.example"].enrichment = { crawledAt: at(-1), tech: ["dbt", "Snowflake"], socials: {}, openRoles: 0, rolesByTeam: [], news: [] };
    const facts = evaluateRecipe(ws, recipe({ audience: { keywords: ["dbt"] } }), "cp_x", TODAY);
    expect(facts.matches.map((m) => m.domain)).toEqual(["a.example"]);
    expect(facts.skips.find((s) => s.domain === "b.example")?.reason).toBe("Nothing on file mentions “dbt”");
  });

  it("fires on stacked signals only when enough different types are fresh at once", () => {
    const ws = world();
    ws.accounts["a.example"].signals.push(sig("s_a2", "funding", 12, "Series B"));
    const r = recipe({ trigger: { signals: ["jd_names_pain", "first_hire", "funding"], stack: 2 } });
    const m = evaluateRecipe(ws, r, "cp_x", TODAY).matches;
    expect(m.map((x) => [x.domain, x.stacked])).toEqual([["a.example", 2]]);
  });

  it("runs on open deals at the stages it names, and writes to the persona in order, never an excluded one", () => {
    const ws = world();
    const onDeals = evaluateRecipe(ws, recipe({ audience: { deal: "open", stages: ["qualified"] } }), "cp_x", TODAY);
    expect(onDeals.matches.map((m) => [m.domain, m.dealId])).toEqual([["d.example", "deal_d"]]);
    expect(evaluateRecipe(ws, recipe({ audience: { deal: "open", stages: ["proposal"] } }), "cp_x", TODAY).skips.find((s) => s.domain === "d.example")?.reason).toBe("Deal at Qualified; this play runs on Proposal");
    const buyerFirst = evaluateRecipe(ws, recipe({ audience: { personas: ["economic_buyer", "champion"] } }), "cp_x", TODAY).matches;
    expect(buyerFirst.find((m) => m.domain === "b.example")?.personName).toBe("Ben Brook");
    const noBuyer = evaluateRecipe(ws, recipe({ audience: { personas: ["economic_buyer"], excludePersonas: [] } }), "cp_x", TODAY).matches;
    expect(noBuyer.find((m) => m.domain === "a.example")).toMatchObject({ personName: undefined, needsPerson: true });
    const excluded = evaluateRecipe(ws, recipe({ audience: { personas: [], excludePersonas: ["champion"] } }), "cp_x", TODAY).matches;
    expect(excluded.find((m) => m.domain === "b.example")?.personName).toBe("Ben Brook");
  });

  it("never fires on disqualified companies or a do-not-contact domain, and never picks a do-not-contact person", () => {
    const ws = world();
    ws.accounts["a.example"].status = "disqualified";
    ws.suppression.push({ id: "sup_b", domain: "b.example", reason: "requested_delete", at: at(-1) } as Workspace["suppression"][number]);
    const { matches, skips } = evaluateRecipe(ws, recipe(), "cp_x", TODAY);
    expect(matches).toEqual([]);
    expect(skips.filter((s) => s.stage === "always").map((s) => s.domain).sort()).toEqual(["a.example", "b.example", "e.example"]);
    const ws2 = world();
    ws2.people.per_a.doNotContact = true;
    expect(evaluateRecipe(ws2, recipe(), "cp_x", TODAY).matches.find((m) => m.domain === "a.example")?.personId).toBeUndefined();
  });
});

describe("recipes: guardrails", () => {
  it("marks a match handled once anyone reached the company after the signal, or a draft is waiting", () => {
    const ws = world();
    ws.activities.push(makeActivity("t1", { kind: "touch_sent", accountDomain: "a.example", at: at(-2) }));
    ws.outreach.pkg_b = makePackage("pkg_b", "b.example", { createdAt: at(-1) });
    const m = evaluateRecipe(ws, recipe(), "cp_x", TODAY).matches;
    expect(m.map((x) => [x.domain, x.worked, x.inMotion])).toEqual([
      ["a.example", true, `Reached ${new Date(`${day(-2)}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`],
      ["b.example", true, `Draft waiting since ${new Date(`${day(-1)}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`],
    ]);
  });

  it("holds a company reached before the signal until the cooldown is over", () => {
    const ws = world();
    ws.activities.push(makeActivity("t1", { kind: "touch_sent", accountDomain: "a.example", at: at(-15) }));
    expect(evaluateRecipe(ws, recipe(), "cp_x", TODAY).skips.find((s) => s.domain === "a.example")).toMatchObject({ stage: "guardrail", reason: "Reached 15 days ago; the cooldown is 30 days" });
    expect(evaluateRecipe(ws, recipe({ guardrails: { cooldownDays: 14 } }), "cp_x", TODAY).matches.map((m) => m.domain)).toContain("a.example");
    // A card the founder skipped also starts the cooldown for the company's next signal.
    const ws2 = world();
    const key = "cp_x:a.example:s_old";
    ws2.moves[cardId({ key })] = makeMove(cardId({ key }), { playId: "cp_x", status: "skipped", skipReason: "not_relevant_now", ref: { kind: "account", id: "a.example" }, createdAt: at(-5) });
    expect(evaluateRecipe(ws2, recipe(), "cp_x", TODAY).skips.find((s) => s.domain === "a.example")?.reason).toBe("Its card was skipped 5 days ago; the cooldown is 30 days");
  });

  it("keeps the weekly cap: new work past it waits for Monday", () => {
    const ws = world();
    ws.accounts["g.example"] = makeAccount("g.example", { signals: [sig("s_g", "jd_names_pain", 3, "Billing manager")] });
    const capped = dryRun(ws, recipe({ guardrails: { maxPerWeek: 2 } }), "cp_x", TODAY);
    expect([capped.fire.map((m) => m.domain), capped.waiting.map((m) => m.domain), capped.capLeft]).toEqual([["g.example", "a.example"], ["b.example"], 2]);
    // A card this play put on Today this week uses one of the two.
    ws.moves.mv_one = makeMove("mv_one", { playId: "cp_x", ref: { kind: "account", id: "z.example" }, createdAt: at(0, "08:00") });
    expect(dryRun(ws, recipe({ guardrails: { maxPerWeek: 2 } }), "cp_x", TODAY).fire).toHaveLength(1);
  });
});

describe("recipes: on Today", () => {
  const running = (ws: Workspace, r: Recipe) => {
    ws.customPlays = { cp_x: play("cp_x", r) };
    ws.plays = { cp_x: { enabled: true, updatedAt: at(-1) } };
  };

  it("puts a running play's best new match on Today, like a built-in, and nothing for a draft or a paused play", () => {
    const ws = world();
    ws.customPlays = { cp_x: { ...play("cp_x", recipe()), versions: [], history: [], draft: recipe() } };
    expect(customPlayCards(ws, TODAY, new Set())).toEqual([]);
    applyAction(ws, { type: "customPlay.commit", id: "cp_x", source: "compiled", at: at(-1) });
    expect(customPlayCards(ws, TODAY, new Set())).toEqual([]);
    applyAction(ws, { type: "play.set", id: "cp_x", enabled: true, at: at(-1) });
    expect(customPlayCards(ws, TODAY, new Set()).map((m) => [m.id, m.kind, m.rule, m.playId, m.title, m.ref])).toEqual([
      ["mv_play_cp_x_a.example_s_a", "first_touch", "play", "cp_x", "Write to Ana at A", { kind: "person", id: "per_a" }],
    ]);
    // And through the moves engine, beside the built-ins.
    expect(computeMoves(ws, NOW).some((m) => m.rule === "today.play" && m.playId === "cp_x")).toBe(true);
    expect(findPlay(ws, "cp_x")?.name).toBe("Billing hire");
    applyAction(ws, { type: "play.set", id: "cp_x", enabled: false, at: at(0) });
    expect(customPlayCards(ws, TODAY, new Set())).toEqual([]);
  });

  it("takes one card per company: a company another rule covers goes to the next match", () => {
    const ws = world();
    running(ws, recipe());
    const busy = new Set<string | undefined>(["a.example"]);
    expect(customPlayCards(ws, TODAY, busy).map((m) => m.href)).toEqual(["/companies?c=b.example"]);
    expect(busy.has("b.example")).toBe(true);
  });

  it("keeps a card on the desk while its match lasts, brings the next match once it's skipped, and stops at the weekly cap", () => {
    const ws = world();
    running(ws, recipe({ guardrails: { maxPerWeek: 2 } }));
    const [first] = customPlayCards(ws, TODAY, new Set());
    ws.moves[first.id] = makeMove(first.id, { ...first, rule: "today.play", status: "open", createdAt: at(0, "08:00") });
    // Still open: the same card again, and no second one (one open at a time under a cap of 5 or fewer a week).
    expect(customPlayCards(ws, TODAY, new Set()).map((m) => m.id)).toEqual([first.id]);
    applyAction(ws, { type: "move.skip", id: first.id, reason: "not_relevant_now" });
    const [second] = customPlayCards(ws, TODAY, new Set());
    expect(second.ref).toEqual({ kind: "person", id: "per_b2" });
    ws.moves[second.id] = makeMove(second.id, { ...second, rule: "today.play", status: "skipped", skipReason: "not_relevant_now", createdAt: at(0, "09:00") });
    ws.accounts["g.example"] = makeAccount("g.example", { signals: [sig("s_g", "jd_names_pain", 3, "Billing manager")] });
    // Two companies this week already: the third waits for Monday.
    expect(customPlayCards(ws, TODAY, new Set())).toEqual([]);
    expect(dryRun(ws, recipe({ guardrails: { maxPerWeek: 2 } }), "cp_x", TODAY).waiting.map((m) => m.domain)).toEqual(["g.example"]);
  });

  it("puts more cards out at once when the weekly cap is higher", () => {
    const ws = world();
    running(ws, recipe({ guardrails: { maxPerWeek: 10 } }));
    expect(customPlayCards(ws, TODAY, new Set()).map((m) => m.href)).toEqual(["/companies?c=a.example", "/companies?c=b.example"]);
  });
});

describe("versions", () => {
  it("edits a draft in place, saves versions with what changed, and rolls back to any version", () => {
    const ws = makeWorkspace();
    applyAction(ws, { type: "customPlay.upsert", play: { ...play("cp_x", recipe()), versions: [], history: [], draft: recipe() } });
    applyAction(ws, { type: "customPlay.edit", id: "cp_x", recipe: recipe({ name: "Billing hires" }), at: at(-5) });
    expect(ws.customPlays!.cp_x.versions).toEqual([]);
    applyAction(ws, { type: "customPlay.commit", id: "cp_x", source: "compiled", at: at(-5) });
    applyAction(ws, { type: "customPlay.edit", id: "cp_x", recipe: recipe({ name: "Billing hires", guardrails: { cooldownDays: 60 }, trigger: { keywords: ["billing", "revops", "reconcil"] } }), at: at(-3) });
    const cp = () => ws.customPlays!.cp_x;
    // An edit to a play that ran is unsaved until it's saved as a version.
    expect([currentVersion(cp())?.version, editingRecipe(cp())?.guardrails.cooldownDays]).toEqual([1, 60]);
    applyAction(ws, { type: "customPlay.commit", id: "cp_x", source: "edit", at: at(-3) });
    expect(cp().versions.map((v) => [v.version, v.note])).toEqual([
      [1, "First version"],
      [2, "Signal may mention “reconcil”; Cooldown 30 → 60 days"],
    ]);
    // Editing back to what runs is no change at all.
    applyAction(ws, { type: "customPlay.edit", id: "cp_x", recipe: { ...currentVersion(cp())!.recipe }, at: at(-2) });
    expect(cp().draft).toBeUndefined();
    applyAction(ws, { type: "customPlay.rollback", id: "cp_x", version: 1, at: at(-1) });
    expect([currentVersion(cp())?.version, versionAt(cp(), at(-4)), versionAt(cp(), at(-2)), versionAt(cp(), at(0))]).toEqual([1, 1, 2, 1]);
    expect(compileCustom(ws, cp())?.custom).toEqual({ version: 1 });
  });

  it("describes changes in plain lines", () => {
    expect(describeChanges(recipe(), recipe({ trigger: { signals: ["jd_names_pain"], withinDays: 60 }, audience: { excludePersonas: ["technical_approver"] }, guardrails: { maxPerWeek: 10 } }))).toEqual([
      "No longer fires on first hire for the role",
      "Window 45 → 60 days",
      "Never writes to the technical approver",
      "At most 5 → 10 a week",
    ]);
  });
});

describe("results over time", () => {
  it("keeps a company's first-worked date for good, past the 30-run log and after old cards leave the desk", () => {
    const ws = makeWorkspace({ deals: { d: makeDeal("d", "dom0.example", { stage: "qualified", amountUsd: 12_000, stageHistory: [{ stage: "qualified", at: at(-30) }] }) } });
    for (let i = 0; i < 35; i++) applyAction(ws, { type: "play.run", id: "funding", domains: [`dom${i}.example`], at: at(-60 + i) });
    ws.activities.push(makeActivity("t0", { kind: "touch_sent", accountDomain: "dom0.example", at: at(-59) }));
    expect(ws.plays!.funding.runs).toHaveLength(30);
    expect(playResults(ws, PLAY_BY_ID.funding)).toMatchObject({ worked: 35, touched: 1, pipeline: 1, pipelineUsd: 12_000 });

    // A Today card marked done counts after the card itself is gone; undoing it takes it back.
    ws.moves.mv_card = makeMove("mv_card", { playId: "funding", ref: { kind: "account", id: "late.example" }, createdAt: at(-2) });
    applyAction(ws, { type: "move.done", id: "mv_card" });
    delete ws.moves.mv_card;
    expect(playResults(ws, PLAY_BY_ID.funding).worked).toBe(36);
    ws.moves.mv_undo = makeMove("mv_undo", { playId: "funding", ref: { kind: "account", id: "undo.example" }, createdAt: at(-1) });
    applyAction(ws, { type: "move.done", id: "mv_undo" });
    applyAction(ws, { type: "move.reopen", id: "mv_undo" });
    expect(ws.plays!.funding.worked!["undo.example"]).toBeUndefined();
  });

  it("attributes each company to the version that was current when the play first worked it", () => {
    const ws = makeWorkspace({ activities: [makeActivity("m1", { kind: "meeting_held", accountDomain: "one.example", at: at(-6) })] });
    applyAction(ws, { type: "customPlay.upsert", play: play("cp_x", recipe(), { at: at(-20) }) });
    applyAction(ws, { type: "play.run", id: "cp_x", domains: ["one.example"], at: at(-10) });
    applyAction(ws, { type: "customPlay.commit", id: "cp_x", source: "edit", recipe: recipe({ guardrails: { cooldownDays: 60 } }), at: at(-8) });
    applyAction(ws, { type: "play.run", id: "cp_x", domains: ["two.example", "one.example"], at: at(-4) });
    // The run log rolls over; attribution doesn't.
    ws.plays!.cp_x.runs = [];
    const { total, byVersion } = resultsByVersion(ws, ws.customPlays!.cp_x);
    expect([total.worked, byVersion.get(1)?.worked, byVersion.get(1)?.meetings, byVersion.get(2)?.worked]).toEqual([2, 1, 1, 1]);
    expect(measureLine(byVersion.get(1)!, "meeting")).toBe("1 meeting from 1 worked · too few to call");
    // Bulk runs on a play that was never turned on don't turn it on.
    applyAction(ws, { type: "customPlay.upsert", play: { ...play("cp_draft", recipe()), versions: [], history: [], draft: recipe() } });
    applyAction(ws, { type: "play.run", id: "cp_draft", domains: ["x.example"], at: at(0) });
    expect(playEnabled(ws, "cp_draft")).toBe(false);
  });
});

describe("skips teach plays", () => {
  function skipped(ws: Workspace, n: number, reason: "wrong_person" | "not_relevant_now" | "weak_angle", personId?: string, from = 0) {
    for (let i = from; i < from + n; i++) {
      ws.moves[`mv_s${reason}${i}`] = makeMove(`mv_s${reason}${i}`, { playId: "cp_x", status: "skipped", skipReason: reason, createdAt: at(-3, `0${i % 9}:00`), ref: personId ? { kind: "person", id: personId } : { kind: "account", id: `x${i}.example` } });
    }
  }

  it("offers to stop writing to a persona after 3 “wrong person” skips to it, and the version note says why", () => {
    const ws = world();
    ws.foundation = sampleWorkspace(NOW).foundation;
    ws.people.per_data = makePerson("per_data", "a.example", { title: "Head of Data" });
    ws.customPlays = { cp_x: play("cp_x", recipe({ audience: { personas: ["technical_approver", "champion"] } }), { at: at(-10) }) };
    skipped(ws, 2, "wrong_person", "per_data");
    expect(playLessons(ws, ws.customPlays.cp_x)).toEqual([]);
    skipped(ws, 1, "wrong_person", "per_data", 2);
    const [lesson] = playLessons(ws, ws.customPlays.cp_x);
    expect(lesson).toMatchObject({ key: "exclude:technical_approver", skips: 3, title: "Stop writing to the technical approver?", detail: "3 of its cards were skipped as “wrong person”, all written to a Head of Data." });
    expect([lesson.recipe.audience.personas, lesson.recipe.audience.excludePersonas]).toEqual([["champion"], ["technical_approver"]]);
    applyAction(ws, { type: "customPlay.commit", id: "cp_x", source: "learned", recipe: lesson.recipe, note: lesson.note, at: at(0) });
    expect(currentVersion(ws.customPlays.cp_x)?.note).toBe("Got it: no more technical approver after 3 “wrong person” skips");
    // Skips from before the new version don't argue for it again.
    expect(playLessons(ws, ws.customPlays.cp_x)).toEqual([]);
  });

  it("lengthens the cooldown after 3 “not relevant now” and asks for stronger signals after 3 “weak angle”", () => {
    const ws = world();
    ws.customPlays = { cp_x: play("cp_x", recipe(), { at: at(-10) }) };
    skipped(ws, 3, "not_relevant_now");
    skipped(ws, 3, "weak_angle");
    const lessons = playLessons(ws, ws.customPlays.cp_x);
    expect(lessons.map((l) => [l.key, l.title])).toEqual([
      ["cooldown:45", "Wait 45 days before coming back to a company?"],
      ["strength:2", "Only fire on stronger signals?"],
    ]);
    expect(lessons[0].recipe.guardrails.cooldownDays).toBe(45);
  });

  it("keeps a dismissed lesson away until 3 more skips", () => {
    const ws = world();
    ws.customPlays = { cp_x: play("cp_x", recipe(), { at: at(-10) }) };
    skipped(ws, 3, "not_relevant_now");
    applyAction(ws, { type: "customPlay.dismissLesson", id: "cp_x", key: "cooldown:45", skips: 3, at: at(0) });
    expect(playLessons(ws, ws.customPlays.cp_x)).toEqual([]);
    skipped(ws, 3, "not_relevant_now", undefined, 3);
    expect(playLessons(ws, ws.customPlays.cp_x).map((l) => l.skips)).toEqual([6]);
  });
});

describe("compiling and suggesting", () => {
  it("names what a sentence asks for that can't run, without repeating what the compiler already said", () => {
    const s = "When a fintech visits our pricing page and their deal has gone quiet, auto-send a note";
    expect(withUnsupported(s, []).map((u) => u.phrase)).toEqual(["visits our pricing page", "deal has gone quiet", "auto-send"]);
    expect(withUnsupported(s, [{ phrase: "visits our pricing page", why: "Visitor data", nearest: "Launch" }])).toHaveLength(3);
  });

  it("reads which signals a playbook trigger describes", () => {
    expect(typesFor("Hiring a revenue accountant for usage")).toEqual(["jd_names_pain", "first_hire", "hiring"]);
    expect(typesFor("A raise tied to enterprise or consumption pricing")).toEqual(["funding", "filing", "launch"]);
    expect(typesFor("First audit or a new audit firm")).toEqual(["compliance_deadline"]);
  });

  it("backtests a recipe with its own words and company traits, not just its signal types", () => {
    const ws = world();
    ws.deals.deal_d.stageHistory = [{ stage: "talking", at: at(-2) }];
    const r = recipe({ audience: { deal: "any" } });
    const test = backtestPlay(ws, compileCustom(ws, play("cp_x", r))!, TODAY)!;
    // Like the built-ins, "fired" counts every company the trigger showed up at, customers included.
    expect([test.open, test.fired]).toEqual([[1, 1], 5]);
    const strict = backtestPlay(ws, compileCustom(ws, play("cp_x", recipe({ audience: { deal: "any" }, trigger: { keywords: ["revops"] } })))!, TODAY)!;
    expect([strict.open, strict.fired]).toEqual([[0, 1], 1]);
  });
});

describe("the sample's play", () => {
  const ws = sampleWorkspace(NOW);
  const cp = ws.customPlays![SAMPLE_PLAY];

  it("runs, fires on the two prospects the built-ins rank lower, and shows why it skipped the rest", () => {
    expect(playEnabled(ws, SAMPLE_PLAY)).toBe(true);
    expect(playsFor(ws)[0].id).toBe(SAMPLE_PLAY);
    const dry = dryRun(ws, currentVersion(cp)!.recipe, SAMPLE_PLAY, TODAY);
    expect(dry.fire.map((m) => [m.company, m.personName])).toEqual([
      ["Tallyhook", "Iris Navarro"],
      ["Mossbank", "Kenji Watanabe"],
    ]);
    expect(dry.handled.map((m) => m.company).sort()).toEqual(["Ashgrove Telematics", "Cinderpath", "Fernwick"]);
    expect(dry.skips.map((s) => s.company).sort()).toEqual(["Lumenwire", "Northwind Metrics", "Saltmarsh Compute"]);
    const test = backtestPlay(ws, compileCustom(ws, cp)!, TODAY)!;
    expect([test.won, test.lost, test.open, test.becameDeals]).toEqual([[0, 1], [0, 2], [2, 4], 2]);
  });

  it("credits Saltmarsh's discovery call to version 1, and puts its best match on Today", () => {
    const { byVersion } = resultsByVersion(ws, cp);
    expect(byVersion.get(1)).toMatchObject({ worked: 1, touched: 1, replied: 1, meetings: 1, pipeline: 1 });
    expect(computeMoves(ws, NOW).filter((m) => m.playId === SAMPLE_PLAY).map((m) => m.title)).toEqual(["Write to Iris at Tallyhook"]);
  });

  it("offers a longer cooldown after one more “not relevant now” skip", () => {
    const s = sampleWorkspace(NOW);
    expect(playLessons(s, s.customPlays![SAMPLE_PLAY])).toEqual([]);
    s.moves = mergeMoves(s.moves, computeMoves(s, NOW), TODAY);
    applyAction(s, { type: "move.skip", id: "mv_play_cp_revops_hire_tallyhook.example_sig_th_jd", reason: "not_relevant_now" });
    expect(playLessons(s, s.customPlays![SAMPLE_PLAY]).map((l) => l.title)).toEqual(["Wait 45 days before coming back to a company?"]);
  });

  it("suggests plays from the workspace that would fire, none of them a copy of a play it already runs", () => {
    const suggestions = suggestPlays(ws, TODAY);
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions.length).toBeLessThanOrEqual(3);
    for (const s of suggestions) {
      expect(s.fires + s.handled).toBeGreaterThan(0);
      expect(s.why.length).toBeGreaterThan(20);
    }
    expect(suggestions.map((s) => s.key)).not.toContain(undefined);
  });
});
