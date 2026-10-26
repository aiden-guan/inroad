import { describe, expect, it } from "vitest";
import type { Asset, ReviewProposal, Workspace } from "@/lib/domain/types";
import { sampleWorkspace } from "@/lib/sample";
import { NOW, TODAY, at, makeWorkspace } from "@/test/factories";
import { assetGate, offerable, postSources, postThisWeek, questionBrief } from "./model";

/** Founder content in the Playbook (SPEC non-goal 11): one optional post a week, answers, a launch post; never offered. */

const asset = (id: string, kind: Asset["kind"], patch: Partial<Asset> = {}): Asset => ({ id, kind, title: id, body: "", createdAt: at(0), updatedAt: at(0), ...patch });

function ws(): Workspace {
  const w = structuredClone(sampleWorkspace(NOW));
  delete w.sample;
  // No review-drafted post unless a test adds one.
  for (const b of Object.values(w.briefs)) b.proposals = b.proposals?.filter((p) => !p.post);
  return w;
}

const post: ReviewProposal = { id: "p1", kind: "note", title: "Post draft: Nobody trusts the month-end number", detail: "", justification: [], text: "Nobody trusts…", post: true, status: "open" };

describe("postThisWeek", () => {
  it("counts a post drafted this week, and the one last Friday's review drafted", () => {
    const w = ws();
    expect(postThisWeek(w, TODAY)).toBeNull();
    w.assets.push(asset("a1", "post"));
    expect(postThisWeek(w, TODAY)).toBe("drafted");
    // Rewriting that post in place doesn't count against itself.
    expect(postThisWeek(w, TODAY, "a1")).toBeNull();
    // Last week's post doesn't count this week.
    w.assets[w.assets.length - 1].createdAt = at(-8);
    expect(postThisWeek(w, TODAY)).toBeNull();

    // Friday 16 Oct is in the week before Monday 19 Oct.
    w.briefs["2026-10-12:friday"] = { kind: "review", reviewKind: "friday", text: "", proposals: [post], generatedAt: at(-4) } as unknown as Workspace["briefs"][string];
    expect(postThisWeek(w, TODAY)).toBe("review");
    w.briefs["2026-10-12:friday"].proposals![0].status = "dismissed";
    expect(postThisWeek(w, TODAY)).toBeNull();
  });
});

describe("assetGate for founder content", () => {
  it("allows one post a week, from the founder's own material only", () => {
    const w = ws();
    expect(assetGate(w, { kind: "post" }, TODAY)).toBeNull();
    w.assets.push(asset("a1", "post"));
    expect(assetGate(w, { kind: "post" }, TODAY)).toMatch(/already drafted/);
    expect(assetGate(w, { kind: "post", assetId: "a1" }, TODAY)).toBeNull();

    const empty = ws();
    empty.povs = [];
    empty.meetings = {};
    empty.foundation!.founderQuestions = empty.foundation!.founderQuestions.map((q) => ({ ...q, answer: "" }));
    expect(assetGate(empty, { kind: "post" }, TODAY)).toMatch(/only from what you said or saw/);
  });

  it("needs the question for a community answer, and something to try for a launch", () => {
    const w = ws();
    expect(assetGate(w, { kind: "community_answer" }, TODAY)).toMatch(/question/);
    expect(assetGate(w, { kind: "community_answer", brief: "  " }, TODAY)).toMatch(/question/);
    expect(assetGate(w, { kind: "community_answer", brief: "How do you close usage revenue?" }, TODAY)).toBeNull();
    expect(assetGate(w, { kind: "launch" }, TODAY)).toBeNull();
    w.company = { ...w.company!, stage: "pre_launch" };
    expect(assetGate(w, { kind: "launch" }, TODAY)).toMatch(/try without talking to you/);
  });
});

describe("offerable", () => {
  it("never lets an email offer founder content, even once it's marked posted", () => {
    expect(offerable(asset("a", "one_pager", { approved: true }))).toBe(true);
    expect(offerable(asset("b", "one_pager"))).toBe(false);
    for (const kind of ["post", "community_answer", "launch"] as const) expect(offerable(asset("c", kind, { approved: true }))).toBe(false);
  });
});

describe("questionBrief and postSources", () => {
  it("turns a found question into the answer's brief, with where it was asked", () => {
    const brief = questionBrief({ title: "Ask HN: How do you close usage revenue?", text: "We bill on usage.", url: "https://news.ycombinator.com/item?id=1" });
    expect(brief).toBe("Ask HN: How do you close usage revenue?\n\nWe bill on usage.\n\nAsked at https://news.ycombinator.com/item?id=1");
    expect(questionBrief({ title: "t", text: "x".repeat(3000), url: "u" }).length).toBeLessThanOrEqual(2000);
  });

  it("offers the latest debriefed calls and approved insight memos to start a post from", () => {
    const w = ws();
    const sources = postSources(w);
    const calls = Object.values(w.meetings).filter((m) => m.debrief);
    expect(sources.filter((s) => s.kind === "call")).toHaveLength(Math.min(3, calls.length));
    expect(sources[0].label).toMatch(/^Call with /);
    w.assets.push(asset("memo", "insight", { approved: true, title: "What we learned from 12 calls" }), asset("draft", "insight"));
    expect(postSources(w).filter((s) => s.kind === "memo")).toEqual([{ id: "memo", kind: "memo", label: "What we learned from 12 calls" }]);
    expect(postSources(makeWorkspace())).toEqual([]);
  });
});
