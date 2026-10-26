import { beforeEach, describe, expect, it, vi } from "vitest";
import { sampleWorkspace } from "@/lib/sample";
import { NOW } from "@/test/factories";
import { routeFetches } from "@/test/http-fixtures";
import { communityQuestions, hnQuestions, queryFor, questionQueries } from "./community";
import { fetchJSON, fetchText } from "./http";

vi.mock("./http", () => ({ fetchText: vi.fn(), fetchJSON: vi.fn() }));
vi.mock("./cache", () => ({ TTL: { hour: 1, day: 1, week: 1 }, cached: (_key: string, _ttl: number, load: () => Promise<unknown>) => load() }));

const now = new Date("2026-10-22T12:00:00Z");
const since = Math.floor(now.getTime() / 1000) - 60 * 86_400;
const url = (q: string) => `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(q)}&tags=(ask_hn,comment)&numericFilters=created_at_i%3E${since}&hitsPerPage=30`;

const hits = {
  hits: [
    { objectID: "1", title: "Ask HN: How do you close usage revenue each month?", story_text: "<p>We bill on usage &amp; the close takes 9 days.</p>", author: "dana", created_at: "2026-10-20T10:00:00Z", points: 41, _tags: ["story", "ask_hn"] },
    { objectID: "2", story_title: "Stripe Billing pricing", comment_text: "Anyone here use a tool to reconcile usage events with invoices?", author: "leo", created_at: "2026-10-21T10:00:00Z", _tags: ["comment"] },
    { objectID: "3", story_title: "Stripe Billing pricing", comment_text: "This is great, thanks for sharing.", author: "max", created_at: "2026-10-21T11:00:00Z", _tags: ["comment"] },
  ],
};

function serve(routes: Parameters<typeof routeFetches>[0]) {
  const r = routeFetches(routes);
  vi.mocked(fetchText).mockImplementation(r.fetchText);
  vi.mocked(fetchJSON).mockImplementation(r.fetchJSON);
  return r.requested;
}

beforeEach(() => vi.mocked(fetchJSON).mockReset());

describe("queryFor", () => {
  it("keeps the first few content words, since Algolia needs every word to match", () => {
    expect(queryFor("The month-end close takes 9 days because usage invoices don't match")).toBe("month-end close takes");
    expect(queryFor("Usage reconciliation for the month-end close", 2)).toBe("usage reconciliation");
    expect(queryFor("How do we do it?")).toBe("");
  });
});

describe("questionQueries", () => {
  it("builds up to three short queries from the playbook's own words, the buyer's public words first", () => {
    const ws = sampleWorkspace(NOW);
    ws.foundation!.messaging.customerWords = [
      { phrase: "the usage export", source: "call" },
      { phrase: "true-up", source: "call" },
      { phrase: "tie out usage", source: "community" },
    ];
    ws.foundation!.positioning.category.name = "Usage reconciliation for the month-end close";
    expect(questionQueries(ws)).toEqual(["tie out usage", "usage export", "usage reconciliation"]);
    // Never the founder's contacts.
    const contacts = Object.values(ws.people).map((p) => p.name.toLowerCase().split(" ")[0]);
    expect(questionQueries(sampleWorkspace(NOW)).join(" ").split(" ").some((w) => contacts.includes(w))).toBe(false);
  });

  it("is empty before there's a playbook", () => {
    expect(questionQueries({ ...sampleWorkspace(NOW), foundation: null })).toEqual([]);
  });
});

describe("hnQuestions", () => {
  it("keeps Ask HN posts and question-shaped comments, as plain text", async () => {
    serve({ [url("usage close")]: JSON.stringify(hits) });
    const qs = (await hnQuestions("usage close", now))!;
    expect(qs.map((q) => q.id)).toEqual(["1", "2"]);
    expect(qs[0]).toMatchObject({ kind: "ask_hn", title: "Ask HN: How do you close usage revenue each month?", text: "We bill on usage & the close takes 9 days.", url: "https://news.ycombinator.com/item?id=1", points: 41 });
    expect(qs[1]).toMatchObject({ kind: "comment", title: "On “Stripe Billing pricing”" });
  });

  it("tells an unreachable Hacker News apart from no questions", async () => {
    serve({});
    expect(await hnQuestions("usage close", now)).toBeNull();
    serve({ [url("usage close")]: JSON.stringify({ hits: [] }) });
    expect(await hnQuestions("usage close", now)).toEqual([]);
  });
});

describe("communityQuestions", () => {
  it("merges the playbook's queries, Ask HN first, without duplicates", async () => {
    const ws = sampleWorkspace(NOW);
    const queries = questionQueries(ws);
    const requested = serve(Object.fromEntries(queries.map((q) => [url(q), JSON.stringify(hits)])));
    const out = await communityQuestions(ws, now);
    expect(out.queries).toEqual(queries);
    expect(requested).toHaveLength(queries.length);
    expect(out.questions.map((q) => q.id)).toEqual(["1", "2"]);
    expect(out.reached).toBe(true);
  });

  it("says so when it couldn't look", async () => {
    serve({});
    expect(await communityQuestions(sampleWorkspace(NOW), now)).toMatchObject({ questions: [], reached: false });
  });
});
