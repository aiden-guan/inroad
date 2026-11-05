import { describe, expect, it } from "vitest";
import { sampleWorkspace } from "@/lib/sample";
import { NOW } from "@/test/factories";
import { creditQuery, dedupeCandidates, dismissItem, feedSummary, filterItems, itemId, matchOptions, mergeItems, prefilter, restoreItems, sourceCounts, withinWindow } from "./feed";
import type { Candidate } from "./parse";
import { intentProfile } from "./profile";
import { emptyIntent, type IntentItem } from "./types";

const now = Date.parse("2026-11-05T12:00:00Z");
const hoursAgo = (h: number) => new Date(now - h * 3_600_000).toISOString();

const post = (key: string, patch: Partial<Candidate> = {}): Candidate => ({
  key,
  thread: key,
  source: "hn",
  url: `https://news.ycombinator.com/item?id=${key.split(":")[1]}`,
  title: "Ask HN: How do you handle usage reconciliation at month-end?",
  text: "Our controller exports the usage export every close and books adjustments nobody can explain. Meterbook doesn't cover late events.",
  author: "someone",
  postedAt: hoursAgo(3),
  query: '"usage reconciliation"',
  queryKey: 'hn:"usage reconciliation"',
  ...patch,
});

const item = (id: string, patch: Partial<IntentItem> = {}): IntentItem => ({
  id,
  key: `hn:${id}`,
  thread: `hn:${id}`,
  source: "hn",
  url: `https://news.ycombinator.com/item?id=${id}`,
  title: `Post ${id}`,
  quote: "We export usage by hand.",
  author: `author${id}`,
  postedAt: hoursAgo(2),
  kind: "ask",
  relevance: 3,
  why: "Needs it.",
  matched: [{ kind: "pain", label: "The usage export" }],
  query: "q",
  queryKey: "hn:q",
  foundAt: hoursAgo(1),
  ...patch,
});

describe("dedupeCandidates", () => {
  it("keeps one row per post and per cross-posted text, the first query winning", () => {
    const a = post("hn:1");
    const b = post("hn:1", { query: "other", queryKey: "hn:other" });
    const cross = post("stackexchange:softwarerecs:9", { source: "stackexchange" });
    const different = post("hn:2", { text: "A completely different post about the month-end close and metered usage exports." });
    const out = dedupeCandidates([a, b, cross, different]);
    expect(out.map((c) => [c.key, c.query])).toEqual([
      ["hn:1", '"usage reconciliation"'],
      ["hn:2", '"usage reconciliation"'],
    ]);
  });
});

describe("prefilter", () => {
  it("drops bots, staff, old, dismissed, known, job threads and off-topic posts before any model call", () => {
    const profile = intentProfile(sampleWorkspace(NOW))!;
    const list = [
      post("hn:1"),
      post("github:a/b#1", { source: "github", bot: true }),
      post("github:a/b#2", { source: "github", association: "MEMBER" }),
      post("hn:3", { postedAt: hoursAgo(24 * 40) }),
      post("hn:4", { thread: "hn:404" }),
      post("hn:5"),
      post("hn:6", { title: "Ask HN: Who is hiring? (November 2026)" }),
      post("hn:7", { title: "Lease question", text: "Our office lease has a confusing clause about extra square footage at year end." }),
      post("hn:8", { title: "x", text: "short" }),
      post("hn:9", { postedAt: undefined }),
    ];
    const r = prefilter(list, { profile, now, windowDays: 30, dismissed: new Set(["hn:404"]), known: new Set(["hn:5"]), max: 60 });
    expect(r.keep.map((c) => c.key)).toEqual(["hn:1", "hn:9"]);
    expect(r.dropped).toMatchObject({ bot: 1, staff: 1, old: 1, dismissed: 1, known: 1, jobs: 1, offTopic: 1, short: 1, over: 0 });
    expect(r.keep[0].lexMatched.map((m) => m.label)).toContain("Meterbook");
  });

  it("ranks by playbook mentions and caps what goes to the model", () => {
    const profile = intentProfile(sampleWorkspace(NOW))!;
    const weak = post("hn:20", { text: "We do usage reconciliation in a spreadsheet." });
    const strong = post("hn:21");
    const r = prefilter([weak, strong], { profile, now, windowDays: 30, dismissed: new Set(), known: new Set(), max: 1 });
    expect(r.keep.map((c) => c.key)).toEqual(["hn:21"]);
    expect(r.dropped.over).toBe(1);
  });
});

describe("mergeItems", () => {
  it("puts new posts first, keeps existing ones as they are, and keeps tracked ones past the cap", () => {
    const old = [item("a", { trackedDomain: "acme.example" }), item("b")];
    const fresh = [item("c"), item("a", { title: "changed" })];
    const { items, added } = mergeItems(old, fresh, 2);
    expect(added.map((i) => i.id)).toEqual(["c"]);
    expect(items.map((i) => i.id)).toEqual(["c", "a"]);
    expect(items[1].title).toBe("Post a");
  });
});

describe("dismissing and undoing", () => {
  it("removes the whole thread, remembers it, and counts a miss for its query; undo puts it all back", () => {
    const state = { ...emptyIntent(), items: [item("a", { thread: "hn:t" }), item("b", { thread: "hn:t" }), item("c")] };
    const { state: next, removed } = dismissItem(state, "a", hoursAgo(0));
    expect(removed.map((i) => i.id)).toEqual(["a", "b"]);
    expect(next.items.map((i) => i.id)).toEqual(["c"]);
    expect(next.dismissed[0]).toMatchObject({ thread: "hn:t", queryKey: "hn:q" });
    expect(next.feedback["hn:q"]).toEqual({ hits: 0, misses: 1 });
    const back = restoreItems(next, removed);
    expect(back.items.map((i) => i.id).sort()).toEqual(["a", "b", "c"]);
    expect(back.dismissed).toEqual([]);
    expect(back.feedback["hn:q"]).toEqual({ hits: 0, misses: 0 });
    expect(creditQuery(back, "hn:q").feedback["hn:q"]).toEqual({ hits: 1, misses: 0 });
    expect(dismissItem(state, "missing", hoursAgo(0)).removed).toEqual([]);
  });
});

describe("filters", () => {
  const items = [
    item("new", { postedAt: hoursAgo(2), relevance: 2 }),
    item("week", { postedAt: hoursAgo(24 * 3), source: "stackexchange", matched: [{ kind: "competitor", label: "Meterbook" }] }),
    item("month", { postedAt: hoursAgo(24 * 20) }),
    item("undated", { postedAt: undefined, source: "reddit" }),
  ];
  it("windows by freshness, never implying a date for undated posts", () => {
    expect(filterItems(items, { when: "24h", source: "all", match: "all", sort: "recent" }, now).map((i) => i.id)).toEqual(["new"]);
    expect(filterItems(items, { when: "30d", source: "all", match: "all", sort: "recent" }, now).map((i) => i.id)).toEqual(["new", "week", "month"]);
    expect(filterItems(items, { when: "all", source: "all", match: "all", sort: "recent" }, now).map((i) => i.id)).toEqual(["new", "week", "month", "undated"]);
    expect(withinWindow({ postedAt: undefined }, "30d", now)).toBe(false);
  });
  it("filters by source and matched term, and sorts by relevance", () => {
    expect(filterItems(items, { when: "30d", source: "stackexchange", match: "all", sort: "recent" }, now).map((i) => i.id)).toEqual(["week"]);
    expect(filterItems(items, { when: "30d", source: "all", match: "competitor:Meterbook", sort: "recent" }, now).map((i) => i.id)).toEqual(["week"]);
    expect(filterItems(items, { when: "30d", source: "all", match: "all", sort: "relevance" }, now).map((i) => i.id)).toEqual(["week", "month", "new"]);
    expect(sourceCounts(items, "30d", now)).toEqual({ hn: 2, stackexchange: 1 });
    expect(matchOptions(items, "30d", now).map((m) => [m.key, m.count])).toEqual([
      ["pain:The usage export", 2],
      ["competitor:Meterbook", 1],
    ]);
  });
});

describe("feedSummary", () => {
  it("counts people, asks and placed authors in code, falling back to a wider window", () => {
    const items = [
      item("1", { author: "a", company: { name: "Acme", domain: "acme.example", basis: "profile", evidence: "x" } }),
      item("2", { author: "b", kind: "problem" }),
      item("3", { author: "a" }),
    ];
    expect(feedSummary(items, now)).toBe("2 people posted about what you sell in the last 7 days, 2 asking for a tool. 1 says where they work.");
    expect(feedSummary([item("old", { postedAt: hoursAgo(24 * 20), kind: "problem" })], now, true)).toBe("1 person posted about what you make in the last 30 days.");
    expect(feedSummary([], now)).toMatch(/^Nobody has asked/);
    expect(itemId("hn:1")).toBe(itemId("hn:1"));
    expect(itemId("hn:1")).not.toBe(itemId("hn:2"));
  });
});
