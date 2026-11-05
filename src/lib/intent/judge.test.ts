import { describe, expect, it } from "vitest";
import { sampleWorkspace } from "@/lib/sample";
import { NOW } from "@/test/factories";
import { codeVerdict, judgeContext, judgeMessage, JudgeOutput, saidCompany, toItem, type Judgement } from "./judge";
import type { Candidate } from "./parse";
import { intentProfile } from "./profile";

const profile = () => intentProfile(sampleWorkspace(NOW))!;

const post: Candidate = {
  key: "hn:99000105",
  thread: "hn:99000091",
  source: "hn",
  site: "Comment",
  url: "https://news.ycombinator.com/item?id=99000105",
  title: "Ask HN: What breaks first when you switch to usage pricing?",
  text: "At Brightmeter we bill per GB and our controller spends the first week of every close on the usage export. Metered usage never matches the invoices on the first pass.",
  author: "fixture_brightops",
  postedAt: "2026-11-03T05:00:00.000Z",
  query: '"usage export"',
  queryKey: 'hn:"usage export"',
};

const verdict = (patch: Partial<Judgement> = {}): Judgement => ({
  label: "problem",
  relevance: 3,
  matched: ["P1", "K1", "Z9"],
  quote: "our controller spends the first week of every close on the usage export",
  why: "Their controller loses the first week of every close to the usage export.",
  company: "Brightmeter",
  ...patch,
});

describe("judgeMessage", () => {
  it("sends the posts without their authors, and the playbook terms in the cached system block", () => {
    const msg = judgeMessage([post]);
    expect(msg).toContain("[0] Hacker News, Comment · 2026-11-03 · Ask HN: What breaks first");
    expect(msg).not.toContain("fixture_brightops");
    const ctx = judgeContext(profile());
    expect(ctx).toContain("P1 pain: The usage export eats the first week of every close");
    expect(ctx).toContain("C1 competitor: Meterbook");
    expect(ctx).toContain("K1 category: Usage reconciliation for the month-end close");
    expect(ctx.startsWith("THE COMPANY: Ledgerline.")).toBe(true);
  });
});

describe("toItem", () => {
  it("keeps a verbatim quote, only real term ids, and a company the post itself names", () => {
    const it = toItem(post, verdict(), profile(), { now: "2026-11-05T09:00:00Z", id: "int_x" })!;
    expect(it.quote).toBe("our controller spends the first week of every close on the usage export");
    expect(it.matched).toEqual([
      { kind: "pain", label: "The usage export eats the first week of every close" },
      { kind: "category", label: "Usage reconciliation for the month-end close" },
    ]);
    expect(it.company).toMatchObject({ name: "Brightmeter", basis: "said_in_post" });
    expect(it.company!.evidence).toContain("At Brightmeter we bill per GB");
    expect(it).toMatchObject({ kind: "problem", relevance: 3, id: "int_x", thread: "hn:99000091", foundAt: "2026-11-05T09:00:00Z" });
  });

  it("replaces a quote the model made up with the post's own best sentence", () => {
    const it = toItem(post, verdict({ quote: "Our close takes nine days because of usage." }), profile(), { now: "x", id: "int_y" })!;
    expect(post.text).toContain(it.quote);
    expect(it.quote).toMatch(/usage export/);
  });

  it("drops noise and weak posts, and never takes a company from a username", () => {
    expect(toItem(post, verdict({ label: "irrelevant" }), profile(), { now: "x", id: "i" })).toBeNull();
    expect(toItem(post, verdict({ relevance: 1 }), profile(), { now: "x", id: "i" })).toBeNull();
    expect(saidCompany({ ...post, author: "brightmeter_ops" }, "Brightmeter")).toBeUndefined();
    expect(saidCompany(post, "Pebblecart")).toBeUndefined();
    expect(toItem(post, verdict({ company: null }), profile(), { now: "x", id: "i" })!.company).toBeUndefined();
  });

  it("validates the tool's output shape", () => {
    expect(JudgeOutput.safeParse({ posts: [{ i: 0, label: "ask", relevance: 3, matched: ["P1"], quote: "q", why: "w", company: null }] }).success).toBe(true);
    expect(JudgeOutput.safeParse({ posts: [{ i: 0, label: "maybe", relevance: 9, matched: [], quote: "", why: "", company: null }] }).success).toBe(false);
  });
});

describe("codeVerdict", () => {
  it("keeps a question that mentions three playbook terms, labeled as found in code", () => {
    const j = codeVerdict({ ...post, text: `${post.text} Has anyone used Meterbook for this?`, lex: 4, lexMatched: [{ kind: "competitor", label: "Meterbook" }, { kind: "pain", label: "The usage export eats the first week of every close" }] })!;
    expect(j).toMatchObject({ label: "ask", relevance: 2, company: null });
    expect(j.why).toMatch(/^Found in code, not checked by AI: mentions meterbook/);
    expect(codeVerdict({ ...post, lex: 2, lexMatched: [] })).toBeNull();
    expect(codeVerdict({ ...post, title: "Notes", text: "We export usage. It takes long. Close is slow.", lex: 3, lexMatched: [{ kind: "pain", label: "x" }] })).toBeNull();
  });
});
