import { describe, expect, it } from "vitest";
import { applyAction } from "@/lib/domain/actions";
import type { Dossier, FounderQuestion, RunSummary, Workspace } from "@/lib/domain/types";
import { NOW, TODAY, at, day, makeAccount, makeDossier, makePackage, makePerson, makeSignal, makeWorkspace } from "@/test/factories";
import { draftsToStart } from "./ahead";
import { codeGreeting } from "./brief-data";
import { TOP_MOVES, computeMoves, firstThreeDomains, mergeMoves, visibleMoves } from "./rules";

/**
 * The audit's day one: onboarding showed Alpha (a 25-day-old founding-role post), Beta (hiring, 10 days) and
 * Gamma (a strength-1 launch), and the founder clicked "Research these 3". Only Beta passed the stricter
 * signal rule, so Alpha and Gamma got no move at all, and the rest of the desk was one card per question.
 */
function dayOne(dossiers = true, patch: Partial<Workspace> = {}): Workspace {
  const acc = (domain: string, tier: "A" | "B", signal: ReturnType<typeof makeSignal>, person: string) =>
    makeAccount(domain, { tier, signals: [{ ...signal, evidenceId: `ev_${domain}` }], peopleIds: [person], ...(dossiers ? { dossier: makeDossier({ generatedAt: at(0, "09:10"), recommendation: { move: "cold_email", personId: person, why: "A dated hire for the job you do" } }) } : {}) });
  const q = (id: string): FounderQuestion => ({ id, question: `Question ${id}?`, whyItMatters: "It changes the bet.", affects: ["icp"] });
  return makeWorkspace({
    founder: { name: "Priya Raman" },
    onboarding: { status: "hired", hiredAt: at(0, "09:00"), firstThree: ["alpha.example", "beta.example", "gamma.example"] },
    accounts: {
      "alpha.example": acc("alpha.example", "B", makeSignal("s_a", { type: "first_hire", strength: 3, date: day(-25) }), "per_al"),
      "beta.example": acc("beta.example", "A", makeSignal("s_b", { type: "hiring", strength: 2, date: day(-10) }), "per_bana"),
      "gamma.example": acc("gamma.example", "B", makeSignal("s_g", { type: "launch", strength: 1, date: day(-5) }), "per_gus"),
    },
    people: {
      per_al: makePerson("per_al", "alpha.example", { name: "Al Ortiz" }),
      per_bana: makePerson("per_bana", "beta.example", { name: "Bana Ito" }),
      per_gus: makePerson("per_gus", "gamma.example", { name: "Gus Park" }),
    },
    evidence: Object.fromEntries(["alpha.example", "beta.example", "gamma.example"].map((d) => [`ev_${d}`, { id: `ev_${d}`, claim: "x", quote: "x", url: "https://jobs.example/1", host: "jobs.example", sourceType: "job_post" as const, retrievedAt: at(-1), confidence: "high" as const }])),
    foundation: { founderQuestions: [q("onb_last3"), q("q1"), q("q2"), q("q3"), q("q4"), q("q5")] } as unknown as Workspace["foundation"],
    ...patch,
  });
}

const top = (ws: Workspace) => visibleMoves(mergeMoves({}, computeMoves(ws, NOW), TODAY), TODAY).slice(0, TOP_MOVES);
const line = (m: { priority: number; rule: string; title: string }) => `${m.priority} ${m.rule} | ${m.title}`;

describe("the first three on day one", () => {
  it("gives each company its own card, the best first, then the network and one questions card", () => {
    expect(top(dayOne()).map(line)).toEqual([
      "56 today.first_three | Write to Al at Alpha",
      "48 today.network | Bring in your network",
      "47 today.questions | Answer 3 questions that change the plan",
      "45 today.first_three | Write to Bana at Beta",
      "44 today.first_three | Write to Gus at Gamma",
    ]);
  });

  it("says what the research is doing: running, stopped short, or not started", () => {
    const run = (domain: string, status: RunSummary["status"], startedAt = at(0, "09:00")): RunSummary => ({ id: `run_${domain}`, workflow: "dossier", title: "", ref: { kind: "account", id: domain }, startedAt, status });
    const ws = dayOne(false, { runs: [run("alpha.example", "running"), run("beta.example", "queued")] });
    const why = () => computeMoves(ws, NOW).filter((m) => m.rule === "today.first_three").map((m) => [m.id, m.why]);
    expect(why()).toEqual([
      ["mv_first_alpha.example", "Hiring a founding finance engineer · 25d · researching now, then the draft"],
      ["mv_first_beta.example", "Hiring a founding finance engineer · 10d · researching now, then the draft"],
      ["mv_first_gamma.example", "Hiring a founding finance engineer · 5d · research first, then the draft"],
    ]);
    // No separate research cards on top of them.
    expect(computeMoves(ws, NOW).filter((m) => m.rule === "today.research")).toEqual([]);
    expect(codeGreeting(ws, [], NOW)).toBe("Thanks, Priya. I'm researching Alpha and Beta now. First draft in about 3 minutes.");
    expect(codeGreeting(dayOne(), [], NOW)).not.toContain("researching");

    // A run that failed (or was stopped) never reads as "researching": the card and the greeting say to try again.
    ws.runs = [run("alpha.example", "running"), run("beta.example", "error"), run("gamma.example", "stopped")];
    expect(why()[1]).toEqual(["mv_first_beta.example", "Hiring a founding finance engineer · 10d · the research didn't finish · try again"]);
    expect(codeGreeting(ws, [], NOW)).toBe("Thanks, Priya. I'm researching Alpha now. First draft in about 3 minutes. I couldn't finish researching Beta and Gamma; try again from their cards.");
    ws.runs = [run("beta.example", "error")];
    expect(codeGreeting(ws, [], NOW)).toBe("Thanks, Priya. I couldn't finish researching Beta; try again from its card.");
    // The newest run counts, and one "running" for over half an hour was cut off by a restart.
    ws.runs = [run("beta.example", "error", at(0, "08:00")), run("beta.example", "running", at(0, "09:00")), run("alpha.example", "running", at(-1))];
    expect(why().map(([, w]) => w.split(" · ").at(-1))).toEqual(["try again", "researching now, then the draft", "research first, then the draft"]);
  });

  it("starts each cold draft itself once the dossier is in", () => {
    const ws = dayOne();
    ws.moves = mergeMoves({}, computeMoves(ws, NOW), TODAY);
    expect(draftsToStart(ws, NOW).map((d) => d.args)).toEqual([
      { domain: "alpha.example", personId: "per_al", mode: "cold" },
      { domain: "beta.example", personId: "per_bana", mode: "cold" },
      { domain: "gamma.example", personId: "per_gus", mode: "cold" },
    ]);
    // Nothing cited to write from (the evidence was flagged wrong): no draft, and no draft button that can only fail.
    // The card turns into "keep watching", whatever the dossier hoped for.
    ws.evidence["ev_gamma.example"].flaggedWrong = { at: at(0) };
    ws.moves = mergeMoves(ws.moves, computeMoves(ws, NOW), TODAY);
    expect(draftsToStart(ws, NOW).map((d) => d.args.domain)).toEqual(["alpha.example", "beta.example"]);
    expect(ws.moves["mv_first_gamma.example"]).toMatchObject({
      kind: "research",
      title: "Keep watching Gamma",
      why: "The research found no dated reason I can cite yet · I'll bring it back when there's news",
    });
    expect(ws.moves["mv_first_alpha.example"].why).toBe("Hiring a founding finance engineer · 25d · draft on its way");
  });

  it("keeps the card's id when the draft lands, and hands over once the first note goes", () => {
    const ws = dayOne();
    ws.outreach.pkg_al = makePackage("pkg_al", "alpha.example", { personId: "per_al", createdAt: at(0, "09:12") });
    const alpha = computeMoves(ws, NOW).find((m) => m.id === "mv_first_alpha.example")!;
    expect(alpha).toMatchObject({ rule: "today.cold_draft", draft: { packageId: "pkg_al", step: 1 } });
    applyAction(ws, { type: "outreach.approveStep", packageId: "pkg_al", step: 1, at: at(0, "09:20"), activityId: "act_sent" });
    expect(computeMoves(ws, NOW).map((m) => m.id)).not.toContain("mv_first_alpha.example");
  });

  it("puts the drafts at the top of day one in the order onboarding showed the companies", () => {
    const ws = dayOne();
    for (const [id, domain, person] of [["pkg_g", "gamma.example", "per_gus"], ["pkg_b", "beta.example", "per_bana"], ["pkg_a", "alpha.example", "per_al"]]) {
      ws.outreach[id] = makePackage(id, domain, { personId: person, createdAt: at(0, "09:12") });
    }
    expect(top(ws).map(line)).toEqual([
      "57 today.cold_draft | Write to Al at Alpha",
      "56 today.cold_draft | Write to Bana at Beta",
      "55 today.cold_draft | Write to Gus at Gamma",
      "48 today.network | Bring in your network",
      "47 today.questions | Answer 3 questions that change the plan",
    ]);
  });

  it("asks what the dossier recommends: an intro, a LinkedIn invite, or to keep watching", () => {
    const ws = dayOne();
    const rec = (domain: string, move: Dossier["recommendation"]["move"], why: string) => (ws.accounts[domain].dossier!.recommendation = { move, why });
    rec("alpha.example", "warm_intro", "Ivy knows their CFO");
    rec("beta.example", "linkedin_first", "No public email; active on LinkedIn");
    rec("gamma.example", "watch", "Nothing dated yet; check back after their launch");
    ws.accounts["alpha.example"].warmPathCount = 1;
    const cards = computeMoves(ws, NOW).filter((m) => m.rule === "today.first_three");
    expect(cards.map((m) => [m.kind, m.title, m.why])).toEqual([
      ["intro_ask", "Ask for an intro to Al at Alpha", "1 person you know there · Ivy knows their CFO"],
      ["linkedin", "Connect with Bana at Beta on LinkedIn", "No public email; active on LinkedIn · doesn't count toward your email cap"],
      ["research", "Keep watching Gamma", "Not yet · Nothing dated yet; check back after their launch"],
    ]);
  });

  it("shows the ten more prospects queued behind the research as a search in progress, not a button", () => {
    const search = (status: RunSummary["status"], startedAt = at(0, "09:01")): RunSummary => ({ id: "run_more", workflow: "discovery", title: "Topping up your prospects", startedAt, status });
    const card = (ws: Workspace) => computeMoves(ws, NOW).find((m) => m.rule === "today.discover");
    expect(card(dayOne(true, { runs: [search("queued")] }))).toMatchObject({ title: "Finding more companies to talk to", why: "Looking now · 3 untouched A and B prospects left · keep 10 ready" });
    expect(card(dayOne(true, { runs: [search("running")] }))?.title).toBe("Finding more companies to talk to");
    // Once it's back (or long gone quiet), the card offers the top-up again.
    expect(card(dayOne(true, { runs: [search("done")] }))?.title).toBe("Find 7 more companies to talk to");
    expect(card(dayOne(true, { runs: [search("running", at(-1))] }))?.title).toBe("Find 7 more companies to talk to");
  });

  it("hands a company back to the regular rules once its card is decided, so news brings it back", () => {
    const ws = dayOne();
    ws.accounts["beta.example"].signals[0].date = day(-2);
    ws.moves = mergeMoves({}, computeMoves(ws, NOW), TODAY);
    const beta = () => computeMoves(ws, NOW).filter((m) => m.ref?.kind === "person" && m.ref.id === "per_bana").map((m) => m.id);
    expect(beta()).toEqual(["mv_first_beta.example"]);
    applyAction(ws, { type: "move.skip", id: "mv_first_beta.example", reason: "not_relevant_now" });
    // The fresh signal's own card now; a snooze would have kept the first-three card instead.
    expect(beta()).toEqual(["mv_signal_beta.example_s_b"]);
  });

  it("stops after three weeks, and reads older workspaces' first three from their dossier runs", () => {
    const old = dayOne(true, { onboarding: { status: "hired", hiredAt: at(-22), firstThree: ["alpha.example"] } });
    expect(computeMoves(old, NOW).filter((m) => m.rule === "today.first_three")).toEqual([]);
    const legacy = dayOne(true, {
      onboarding: { status: "hired", hiredAt: at(0, "09:00"), dossierRunIds: ["run_a"] },
      runs: [{ id: "run_a", workflow: "dossier", title: "", ref: { kind: "account", id: "gamma.example" }, startedAt: at(0, "09:00"), status: "done" }],
    });
    expect(firstThreeDomains(legacy)).toEqual(["gamma.example"]);
  });

  it("folds the plan's questions into one card that keeps its id while they're answered", () => {
    const ws = dayOne();
    const card = () => computeMoves(ws, NOW).filter((m) => m.kind === "question");
    expect(card().map((m) => [m.id, m.subjectIds])).toEqual([["mv_questions_q5", ["onb_last3", "q1", "q2"]]]);
    applyAction(ws, { type: "foundation.answerQuestion", questionId: "onb_last3", answer: "Acme and Globex", at: at(0) });
    expect(card().map((m) => [m.id, m.subjectIds])).toEqual([["mv_questions_q5", ["q1", "q2", "q3"]]]);
    for (const id of ["q1", "q2", "q3", "q4"]) applyAction(ws, { type: "foundation.answerQuestion", questionId: id, answer: "x", at: at(0) });
    expect(card().map((m) => m.title)).toEqual(["Answer: Question q5?"]);
    // Outside onboarding week the card sits at the base priority.
    ws.onboarding.hiredAt = at(-10);
    expect(card()[0].priority).toBe(35);
  });
});

describe("warm network first", () => {
  const hired = (patch: Partial<Workspace> = {}) => makeWorkspace({ onboarding: { status: "hired", hiredAt: at(-10) }, ...patch });
  const warm = (ws: Workspace) => computeMoves(ws, NOW).filter((m) => ["today.network", "today.connectors", "today.import"].includes(m.rule)).map((m) => `${m.priority} ${m.rule} | ${m.title}`);
  const ivy = { id: "con_ivy", name: "Ivy Chen", relationship: "investor" as const, introsMade: 0 };
  const network = { importedAt: at(-2), total: 1240, atIcpCompanies: 37, buyerTitles: 6, jobChanges: 0 };

  it("asks for the network and the investors in one card, above cold touches, until either is in", () => {
    expect(warm(hired())).toEqual(["57 today.network | Bring in your network"]);
    expect(warm(hired({ network }))).toEqual(["57 today.connectors | Add your investors and advisors"]);
    expect(warm(hired({ connectors: [ivy] }))).toEqual(["48 today.import | Import your LinkedIn connections"]);
    expect(warm(hired({ network, connectors: [ivy] }))).toEqual([]);
    // A LinkedIn connection asked through a path isn't an investor or advisor.
    expect(warm(hired({ network, connectors: [{ ...ivy, relationship: "connection" }] }))).toEqual(["57 today.connectors | Add your investors and advisors"]);
  });
});
