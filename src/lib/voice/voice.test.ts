import { describe, expect, it } from "vitest";
import { applyAction } from "@/lib/domain/actions";
import type { Activity, Deal, Meeting, Workspace } from "@/lib/domain/types";
import { playbookMarkdown } from "@/components/playbook/model";
import { refreshOffer } from "@/lib/moves/monthly-data";
import { sampleWorkspace } from "@/lib/sample";
import { CLAIM, DEAL } from "@/lib/sample/ids";
import { VOICE_MEETING } from "@/lib/sample/voice";
import { NOW, TODAY, at, makeAccount, makeWorkspace } from "@/test/factories";
import { battlecardInput, battlecardProblems, saveBattlecard, type BattlecardOut } from "./battlecard";
import { buyerCorpus, isFounderSpeaker, voiceFingerprint } from "./corpus";
import { buyerVoice, heardIn, needsAnswer } from "./index";
import { applyNaming, namingInput, namingProblems } from "./naming";
import { fraction, trendOf, winLine, winSplit } from "./stats";
import { seedMatches } from "./themes";
import { terms, topPhrases } from "./text";
import type { VoiceBattlecard, VoiceConversation, VoiceSnippet } from "./types";
import { askAboutAlternative, askAboutTheme, messagingChanges, studioMaterial } from "./use";

const sample = () => structuredClone(sampleWorkspace(NOW));
const theme = (ws: Workspace, key: string) => buyerVoice(ws, TODAY).themes.find((t) => t.key === key)!;
const alt = (ws: Workspace, key: string) => buyerVoice(ws, TODAY).alternatives.find((a) => a.key === key)!;

describe("text", () => {
  it("lands different words for the same thing on the same terms", () => {
    expect(terms("Usage tie-out took us five days")).toEqual(["usage", "reconcile", "#n", "duration"]);
    expect(terms("we reconcile and it never matches")).toEqual(["reconcile", "reconcile"]);
    expect(terms("Snowflake numbers")).toEqual(["warehouse", "number"]);
  });

  it("keeps phrases several conversations share, longest first among equals", () => {
    const docs = [
      { conv: "a", text: "The usage tie-out took five days." },
      { conv: "b", text: "Our usage tie-out is painful." },
      { conv: "b", text: "The usage tie-out again." },
      { conv: "c", text: "Nothing in common here." },
    ];
    expect(topPhrases(docs, 3, 2)).toEqual(["usage tie-out"]);
  });
});

describe("corpus", () => {
  it("keeps buyers' words, never the founder's, and labels notes and summaries as paraphrase", () => {
    const ws = sample();
    const { snippets } = buyerCorpus(ws);
    expect(snippets.some((s) => s.speaker === "Priya Raman")).toBe(false);
    // The Lumenwire debrief quoted Priya's own line; it isn't here.
    expect(snippets.some((s) => /bills the usage it's given/.test(s.text))).toBe(false);
    const notes = snippets.filter((s) => s.source === "notes");
    expect(notes.length).toBeGreaterThan(0);
    expect(notes.every((s) => !s.verbatim)).toBe(true);
    expect(snippets.filter((s) => s.source === "summary").every((s) => !s.verbatim)).toBe(true);
    // Their own emails are their words; an out-of-office isn't voice.
    expect(snippets.some((s) => s.source === "email" && /dbt models/.test(s.text) && s.verbatim)).toBe(true);
    expect(snippets.some((s) => /out of the office/i.test(s.text))).toBe(false);
  });

  it("knows who said it and where the deal stood", () => {
    const { snippets } = buyerCorpus(sample());
    const grace = snippets.find((s) => s.id === `${VOICE_MEETING.lumenwireScoping}:q1`)!;
    expect(grace).toMatchObject({ speaker: "Grace Liu", title: "CFO", company: "Lumenwire", stage: "qualified", verbatim: true, source: "transcript" });
    const larkspur = snippets.find((s) => s.meetingId === VOICE_MEETING.larkspurDiscovery)!;
    expect(larkspur.stage).toBe("talking");
  });

  it("recognizes the founder by full name, first name or a me/you label", () => {
    const ws = makeWorkspace({ founder: { name: "Priya Raman" } });
    expect(isFounderSpeaker(ws, "Priya Raman")).toBe(true);
    expect(isFounderSpeaker(ws, "Priya")).toBe(true);
    expect(isFounderSpeaker(ws, "Me")).toBe(true);
    expect(isFounderSpeaker(ws, "Priya Shah")).toBe(false);
    expect(isFounderSpeaker(ws, undefined)).toBe(false);
  });
});

describe("themes on the sample", () => {
  const ws = sample();
  const v = buyerVoice(ws, TODAY);

  it("counts the usage close eating days across six deals, from code", () => {
    const t = v.themes.find((x) => x.key === "pain:time")!;
    expect(t.calls).toBe(6);
    expect(t.deals).toBe(6);
    expect(t.label).toBe("Usage tie-out eats days every close");
    expect(t.named).toBe(true);
    expect(t.inPlaybook).toBe("Pains · Controller");
    expect(t.stages).toEqual([{ stage: "talking", n: 6 }]);
    // An outcome ("in a day, I'd get my first week back") isn't counted as the pain.
    expect(t.snippets.some((s) => /close usage in a day/.test(s.text))).toBe(false);
  });

  it("groups building it in-house with its approved answer and an honest win split", () => {
    const t = v.themes.find((x) => x.key === "objection:build")!;
    expect(heardIn(t)).toBe(4);
    expect(t.response).toMatchObject({ objectionId: "obj_build", approved: true });
    expect(t.win).toEqual({ with: { won: 1, n: 2 }, without: { won: 0, n: 1 }, verdict: "too_early" });
    expect(winLine(t.win)).toBe("Won 1 of 2 where it came up · 0 of 1 where it didn't · too early to call (3 decided)");
  });

  it("finds NetSuite, which buyers named and the playbook doesn't, and nothing that isn't a tool", () => {
    const netsuite = v.alternatives.find((a) => a.key === "named:netsuite")!;
    expect(netsuite).toMatchObject({ name: "NetSuite", inPlaybook: false, calls: 2, record: { won: 0, lost: 1, open: 1 } });
    expect(v.alternatives.map((a) => a.name)).not.toContain("Thinks NetSuite");
    expect(v.alternatives.every((a) => !["Grace", "Sofia", "Stripe", "Snowflake"].includes(a.name))).toBe(true);
    expect(v.headlines[0]).toMatchObject({ alternative: "named:netsuite", text: "Buyers named NetSuite in 2 conversations (2 deals). It isn't in your playbook." });
  });

  it("counts a lost deal toward the alternative its loss reason names, quote or not", () => {
    const inHouse = v.alternatives.find((a) => a.key === "alt:in_house")!;
    expect(inHouse.dealRows.find((d) => d.dealId === DEAL.quillfeather)).toMatchObject({ outcome: "lost", lostTo: true });
    const nothing = v.alternatives.find((a) => a.key === "alt:nothing")!;
    expect(nothing.dealRows.find((d) => d.dealId === DEAL.larkspur)).toMatchObject({ outcome: "lost", lostTo: true });
  });

  it("uses a security review's pattern for process, and a concern about data for the objection", () => {
    expect(seedMatches("Security review is usually two weeks with us, so send the questionnaire early.")).toEqual(["process:security"]);
    expect(seedMatches("Before anyone touches billing data, Grace will want a security review.")).toEqual(expect.arrayContaining(["objection:security", "process:security"]));
    // "two weeks" of review time isn't a pain about the close.
    expect(seedMatches("Legal turns our paper around in a week.")).toEqual(["process:legal"]);
  });

  it("drops what the naming pass said doesn't belong", () => {
    const pilot = v.themes.find((x) => x.key === "process:pilot")!;
    expect(pilot.snippets.some((s) => s.id === `${VOICE_MEETING.wrenfieldReview}:q3`)).toBe(false);
  });

  it("counts only what has no answer on file at all as needing the founder", () => {
    expect(needsAnswer(v).map((x) => x.key).sort()).toEqual(["alt:hire", "named:netsuite", "objection:owner"]);
    expect(v.needsAnswer).toBe(3);
  });

  it("keeps the sample's names fresh, and every sample name lands on a theme", () => {
    expect(v.naming.status).toBe("fresh");
    expect(Object.keys(ws.buyerVoice!.names!.entries).every((k) => v.themes.some((t) => t.key === k))).toBe(true);
  });

  it("leaves the sample's refresh offer as it was: the won deal offers it, and four calls stay under the five that reword it", () => {
    expect(refreshOffer(ws)).toMatchObject({ calls: 4, won: 1, offered: true });
  });
});

describe("naming", () => {
  it("goes stale when a new debrief arrives", () => {
    const ws = sample();
    const m = ws.meetings[VOICE_MEETING.quillfeatherDiscovery];
    m.debrief = { ...m.debrief!, generatedAt: at(0, "09:00") };
    expect(buyerVoice(ws, TODAY).naming.status).toBe("stale");
    expect(voiceFingerprint(ws)).not.toBe(ws.buyerVoice!.names!.fingerprint);
  });

  it("keeps only valid names, merges within a kind and quotes that are in the cluster", () => {
    const ws = sample();
    delete ws.buyerVoice;
    const v = buyerVoice(ws, TODAY);
    const input = namingInput(v);
    const ids = [...input.clusters.entries()];
    const pain = ids.filter(([, c]) => c.kind === "pain");
    const objection = ids.find(([, c]) => c.kind === "objection")!;
    const [aId, a] = pain[0];
    const [bId] = pain[1];
    const quote = [...a.quotes.keys()][0];
    const out = {
      clusters: [
        { id: aId, name: "Usage tie-out eats days", gist: "Matching usage to invoices takes most of the close.", mergeInto: null, outliers: [quote] },
        { id: bId, name: "Same concern", gist: "", mergeInto: aId, outliers: [] },
        { id: objection[0], name: "Costs 5 times more", gist: "", mergeInto: aId, outliers: ["s999"] },
        { id: "c999", name: "Nope", gist: "", mergeInto: null, outliers: [] },
      ],
    };
    const problems = namingProblems(out, input);
    expect(problems).toEqual(expect.arrayContaining([`${objection[0]}: no digits in names`, `${objection[0]}: can't merge a objection into a pain`, "c999 isn't a cluster id"]));
    const names = applyNaming(out, input, { fingerprint: v.fingerprint, calls: 9, at: at(0) });
    expect(names.entries[a.key]).toEqual({ name: "Usage tie-out eats days", gist: "Matching usage to invoices takes most of the close." });
    expect(names.entries[objection[1].key]).toBeUndefined();
    expect(names.merges).toEqual({ [input.clusters.get(bId)!.key]: a.key });
    expect(names.outliers[a.key]).toEqual([a.quotes.get(quote)]);
    // Merged themes recount from their members: the target now holds both.
    ws.buyerVoice = { names };
    const merged = buyerVoice(ws, TODAY);
    expect(merged.themes.some((t) => t.key === input.clusters.get(bId)!.key)).toBe(false);
  });
});

describe("stats", () => {
  const convs = (n: number, ageFrom: number, kind: VoiceConversation["kind"] = "call"): VoiceConversation[] =>
    Array.from({ length: n }, (_, i) => ({ id: `${kind}${ageFrom}_${i}`, kind, date: at(-(ageFrom + i)).slice(0, 10) }));
  const snip = (conv: VoiceConversation): VoiceSnippet => ({ id: conv.id, text: "x", verbatim: true, source: "transcript", conv: conv.id, convKind: "call", date: conv.date, at: `${conv.date}T12:00:00.000Z`, fields: [], terms: [] });

  it("calls rising, new and quieter only with enough conversations, and counts every window", () => {
    const recent = convs(4, 1);
    const before = convs(6, 40);
    const all = [...recent, ...before];
    expect(trendOf([recent[0], recent[1], recent[2]].map(snip), all, TODAY)).toMatchObject({ recent: 3, recentTotal: 4, before: 0, beforeTotal: 6, label: "new" });
    expect(trendOf([recent[0]].map(snip), all, TODAY).label).toBeNull();
    expect(trendOf([recent[0], recent[1], before[0]].map(snip), all, TODAY).label).toBe("rising");
    expect(trendOf([before[0], before[1]].map(snip), all, TODAY).label).toBe("fading");
    expect(trendOf(all.map(snip), all, TODAY).buckets.reduce((a, b) => a + b, 0)).toBe(10);
  });

  it("splits wins only past the sample gate, and shows rates only from ten", () => {
    const deal = (id: string, stage: Deal["stage"]) => ({ id, stage }) as Deal;
    const decided = [...Array.from({ length: 6 }, (_, i) => deal(`w${i}`, i < 4 ? "won" : "lost")), ...Array.from({ length: 6 }, (_, i) => deal(`l${i}`, i < 1 ? "won" : "lost"))];
    const withIt = new Set(decided.slice(0, 6).map((d) => d.id));
    expect(winSplit(decided, withIt)).toEqual({ with: { won: 4, n: 6 }, without: { won: 1, n: 6 }, verdict: "more" });
    expect(winSplit(decided.slice(0, 7), withIt).verdict).toBe("too_early");
    expect(fraction(3, 9)).toBe("3 of 9");
    expect(fraction(3, 10)).toBe("3 of 10 (30%)");
  });
});

describe("battlecards", () => {
  const out = (patch: Partial<BattlecardOut> = {}): BattlecardOut => ({
    objection: "NetSuite already does this.",
    category: "competitor",
    underlyingConcern: "They don't want a second tool.",
    clarifyingQ: "Does it see usage that arrives after the invoice run?",
    response: "A design partner cut month-end usage reconciliation from 4 days to 6 hours in their first close.",
    walkAwayIf: "Every event is rated in NetSuite.",
    landmines: ["Who explains a variance when NetSuite and the warehouse disagree?"],
    whenWeWin: "Usage lives in the warehouse.",
    whenWeLose: null,
    quoteIds: ["q1"],
    claimIds: [CLAIM.designPartner],
    ...patch,
  });

  it("writes its prompt from the quotes and approved claims only", () => {
    const ws = sample();
    const input = battlecardInput(ws, buyerVoice(ws, TODAY), "named:netsuite")!;
    expect(input.quotes.size).toBe(2);
    expect(input.message).toContain("NetSuite already does this, supposedly.");
    expect(input.message).toContain(CLAIM.designPartner);
    expect(input.message).not.toContain(CLAIM.catchRate);
    expect(input.message).toContain("Larkspur Analytics: lost");
  });

  it("refuses unknown quotes, unapproved claims and numbers nobody said", () => {
    const ws = sample();
    const input = battlecardInput(ws, buyerVoice(ws, TODAY), "named:netsuite")!;
    expect(battlecardProblems(out(), input)).toEqual([]);
    const bad = battlecardProblems(out({ quoteIds: ["q9"], claimIds: [CLAIM.catchRate], response: "We catch 98% of mismatches for 40 customers!" }), input);
    expect(bad).toEqual(
      expect.arrayContaining(["Unknown quote ids: q9", `Not approved claims: ${CLAIM.catchRate}. Use only APPROVED CLAIMS`, "response: no exclamation marks", 'response: "98%" isn\'t in a quote or an approved claim; remove it']),
    );
  });

  it("saves into Objections and the competitor list through ordinary actions, and undoes cleanly", () => {
    const ws = sample();
    const v = buyerVoice(ws, TODAY);
    const card: VoiceBattlecard = { key: "named:netsuite", subject: "NetSuite", ...out(), whenWeWin: "Usage lives in the warehouse.", whenWeLose: undefined, quoteIds: [], at: at(0) };
    ws.buyerVoice!.battlecards!["named:netsuite"] = card;
    const before = structuredClone(ws);
    const plan = saveBattlecard(ws, v, card, true, at(0, "11:00"))!;
    for (const a of plan.actions) applyAction(ws, a);
    const saved = ws.objections.find((o) => o.id === plan.objectionId)!;
    expect(saved).toMatchObject({ objection: "NetSuite already does this.", category: "competitor", approved: true, timesHeard: 2 });
    expect(ws.foundation!.competitors.at(-1)).toMatchObject({ name: "NetSuite", landmineQuestions: card.landmines, whenWeWin: "Usage lives in the warehouse." });
    expect(ws.buyerVoice!.battlecards!["named:netsuite"].saved).toMatchObject({ objectionId: plan.objectionId, approved: true });
    for (const a of plan.undo) applyAction(ws, a);
    expect(ws.objections).toEqual(before.objections);
    expect(ws.foundation!.competitors).toEqual(before.foundation!.competitors);
    expect(ws.buyerVoice!.battlecards!["named:netsuite"].saved).toBeUndefined();
  });

  it("keeps the answer on file's id and wording, and never overwrites the founder's competitor text", () => {
    const ws = sample();
    const v = buyerVoice(ws, TODAY);
    const card: VoiceBattlecard = { key: "vendor:meterbook", subject: "Meterbook", ...out({ objection: "Meterbook covers it.", landmines: ["Does every event flow through Meterbook?"] }), whenWeWin: "New text", whenWeLose: undefined, quoteIds: [], at: at(0) };
    const plan = saveBattlecard(ws, v, card, false, at(0))!;
    for (const a of plan.actions) applyAction(ws, a);
    const meterbook = ws.objections.find((o) => o.id === "obj_meterbook")!;
    expect(meterbook.objection).toBe("Meterbook says its reconciliation report covers this.");
    expect(meterbook.response).toBe(card.response);
    const entry = ws.foundation!.competitors.find((c) => c.name === "Meterbook")!;
    expect(entry.whenWeWin).toMatch(/^Usage lives in the warehouse and they're not re-platforming/);
    expect(entry.landmineQuestions).toHaveLength(3);
  });

  it("marks drafts set aside and brings them back", () => {
    const ws = sample();
    applyAction(ws, { type: "buyerVoice.dismiss", key: "alt:hire", at: at(0) });
    expect(ws.buyerVoice!.battlecards!["alt:hire"].dismissedAt).toBe(at(0));
    applyAction(ws, { type: "buyerVoice.dismiss", key: "alt:hire", at: null });
    expect(ws.buyerVoice!.battlecards!["alt:hire"].dismissedAt).toBeUndefined();
    // Unknown keys are a no-op.
    expect(() => applyAction(ws, { type: "buyerVoice.markSaved", key: "nope", saved: null })).not.toThrow();
  });
});

describe("putting a theme to work", () => {
  it("proposes their words as tracked playbook changes that apply only on accept", () => {
    const ws = sample();
    const t = theme(ws, "pain:time");
    const changes = messagingChanges(ws, t);
    // "usage tie-out" is already there as "tie out usage", and "five days" is an amount, not a phrase.
    expect(changes.map((c) => [c.revision.target, c.revision.after])).toEqual([
      ["messaging.customerWords", "rebuild the sheet"],
      ["persona.pain", "Usage tie-out eats days every close"],
    ]);
    expect(changes[1].revision.refId).toBe("psn_controller");
    const version = ws.foundation!.version;
    applyAction(ws, { type: "foundation.revise", revision: changes[0].revision, source: "voice", at: at(0) });
    expect(ws.foundation!.messaging.customerWords.at(-1)).toEqual({ phrase: "rebuild the sheet", source: "call" });
    expect(ws.foundationHistory!.at(-1)).toMatchObject({ version, source: "voice" });
    // Once there, it isn't offered again.
    expect(messagingChanges(ws, theme(ws, "pain:time")).map((c) => c.revision.after)).not.toContain("rebuild the sheet");
    // Objections and process facts don't change messaging.
    expect(messagingChanges(ws, theme(ws, "objection:build"))).toEqual([]);
  });

  it("turns a theme into Studio material: their quotes, never named, and the count", () => {
    const ws = sample();
    const v = buyerVoice(ws, TODAY);
    const t = v.themes.find((x) => x.key === "pain:mismatch")!;
    const material = studioMaterial(ws, v, t, at(0));
    expect(material[0]).toMatchObject({ kind: "fact", text: `Buyers raised "${t.label}" in 3 of 15 conversations since Aug 7.` });
    const quotes = material.filter((m) => m.kind === "quote");
    expect(quotes.length).toBe(3);
    expect(quotes.every((q) => q.permission === "anonymized_only" && !/Ava|Tom|Ben/.test(q.source ?? ""))).toBe(true);
    for (const m of material) applyAction(ws, { type: "studio.material.upsert", material: { ...m, uses: 2 } });
    expect(studioMaterial(ws, v, t, at(0))).toEqual([]);
  });

  it("asks Ask with the counts and the quotes, so it needn't look them up", () => {
    const ws = sample();
    const v = buyerVoice(ws, TODAY);
    const q = askAboutTheme(v, v.themes.find((x) => x.key === "objection:build")!);
    expect(q).toContain('"Our data team could build it": 4 of 15 conversations, 3 deals');
    expect(q).toContain("too early to call");
    expect(askAboutAlternative(alt(ws, "named:netsuite"))).toContain("won 0, lost 1, open 1");
  });
});

describe("the summary page", () => {
  it("goes into the Playbook export with counts, one quote a theme and roles, never names", () => {
    const md = playbookMarkdown(sample(), TODAY);
    expect(md).toContain("## What buyers say");
    expect(md).toContain("- **Usage tie-out eats days every close** (pain): 6 of 15 conversations, 6 deals.");
    expect(md).toContain("- NetSuite _(not in this playbook yet)_: 2 conversations; won 0, lost 1, open 1");
    const section = md.slice(md.indexOf("## What buyers say"), md.indexOf("## Voice"));
    expect(section).not.toMatch(/Grace Liu|Ava Whitman|Ben Adler|Dana Okafor|Maya Okonkwo/);
  });
});

describe("other workspaces", () => {
  it("is empty and quiet with nothing debriefed", () => {
    const v = buyerVoice(makeWorkspace(), TODAY);
    expect(v.themes).toEqual([]);
    expect(v.headlines).toEqual([]);
    expect(v.naming.status).toBe("none");
  });

  it("reads a consumer founder's user-talk notes as paraphrase", () => {
    const talk = (id: string, body: string, n: number): Activity => ({ id, at: at(-n), kind: "user_conversation", summary: "Talked to a new runner", body, source: "founder" });
    const ws = makeWorkspace({
      company: { name: "Strider", domain: "strider.example", market: "consumer" } as Workspace["company"],
      activities: [talk("t1", "She said the plan felt too expensive for a hobby.", 3), talk("t2", "He thought it was too expensive until the first race.", 5)],
    });
    const v = buyerVoice(ws, TODAY);
    expect(v.summary.talks).toBe(2);
    expect(v.snippets.every((s) => s.source === "talk" && !s.verbatim)).toBe(true);
    expect(v.themes.find((t) => t.key === "objection:price")?.talks).toBe(2);
  });

  it("works on a minimal deal with a transcript debrief", () => {
    const deal = { id: "d1", accountDomain: "acme.example", name: "Acme", stage: "lost", stageHistory: [{ stage: "talking", at: at(-20) }, { stage: "lost", at: at(-2) }], source: "inbound", contacts: [], meetingIds: ["m1"], createdAt: at(-20), updatedAt: at(-2), lastActivityAt: at(-2), lossReason: "competitor" } as Deal;
    const meeting = {
      id: "m1",
      dealId: "d1",
      title: "Acme: discovery",
      startsAt: at(-10),
      attendees: [],
      debrief: { source: "transcript", quotes: [{ id: "q1", speaker: "Ana", text: "We looked at Orbital last quarter and it only covered invoices." }], newObjections: [], customerWords: [], generatedAt: at(-10) },
    } as unknown as Meeting;
    const ws = makeWorkspace({ accounts: { "acme.example": makeAccount("acme.example", { name: "Acme", dealId: "d1" }) }, deals: { d1: deal }, meetings: { m1: meeting } });
    const v = buyerVoice(ws, TODAY);
    const orbital = v.alternatives.find((a) => a.name === "Orbital")!;
    expect(orbital).toMatchObject({ inPlaybook: false, record: { won: 0, lost: 1, open: 0 } });
    // The only vendor named on a deal lost to a competitor is the one it was lost to.
    expect(orbital.dealRows[0].lostTo).toBe(true);
  });
});
