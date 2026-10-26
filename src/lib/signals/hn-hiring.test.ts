import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DATA_DIR } from "@/lib/store/settings";
import { fixture, routeFetches } from "@/test/http-fixtures";
import { resetGates } from "./gate";
import { fetchJSON, fetchText } from "./http";
import { hiringPosts, latestHiringThread, matchPosts, parseHiringPost, whoIsHiring } from "./hn-hiring";

vi.mock("./http", async (actual) => ({ ...(await actual<typeof import("./http")>()), fetchText: vi.fn(), fetchJSON: vi.fn() }));

const SEARCH = "https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&hitsPerPage=6";
const ITEMS = "https://hn.algolia.com/api/v1/items/45512001";

function serve(routes: Parameters<typeof routeFetches>[0]) {
  const r = routeFetches(routes);
  vi.mocked(fetchText).mockImplementation(r.fetchText);
  vi.mocked(fetchJSON).mockImplementation(r.fetchJSON);
  return r.requested;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetGates();
  fs.rmSync(path.join(DATA_DIR, "cache"), { recursive: true, force: true });
});

describe("the monthly thread", () => {
  it("picks the latest 'Who is hiring?' story, not the other two monthly threads", async () => {
    serve({ [SEARCH]: fixture("hn-whoishiring-search.json") });
    expect(await latestHiringThread()).toEqual({
      id: "45512001",
      title: "Ask HN: Who is hiring? (October 2026)",
      url: "https://news.ycombinator.com/item?id=45512001",
      createdAt: "2026-10-01T15:01:00Z",
    });
    expect(vi.mocked(fetchJSON).mock.calls[0][2]).toEqual({ headers: { "User-Agent": expect.stringMatching(/^Inroad\//) } });
  });

  it("is null when Algolia can't be reached", async () => {
    serve({});
    expect(await latestHiringThread()).toBeNull();
  });
});

describe("posts", () => {
  it("parses company, site, board, roles and location from each top-level post, and skips meta and deleted comments", async () => {
    serve({ [ITEMS]: fixture("hn-whoishiring-items.json") });
    const posts = await hiringPosts("45512001");
    expect(posts.map((p) => [p.company, p.domain, p.board, p.roles, p.location])).toEqual([
      ["Meterly", "meterly.com", { provider: "ashby", token: "meterly" }, ["Founding Finance Lead", "Senior Backend Engineer"], "San Francisco, CA (ONSITE)"],
      ["Glasswing Health", undefined, { provider: "lever", token: "glasswing" }, ["Senior Platform Engineer"], "REMOTE (US)"],
      ["Northpeak", "northpeak.io", undefined, ["Head of Revenue Operations"], "NYC"],
      ["Tollgate", "tollgate.dev", undefined, ["Staff Engineer", "Product Designer"], "Remote (EU)"],
    ]);
    expect(posts[0]).toMatchObject({ id: "45512101", url: "https://news.ycombinator.com/item?id=45512101", postedAt: "2026-10-01T15:04:12.000Z" });
    expect(posts[0].text).toContain("we're hiring our first finance lead");
    expect(posts[0].text).not.toMatch(/<|&#x/);
  });

  it("ignores a comment that doesn't lead with a company", () => {
    expect(parseHiringPost({ id: 1, created_at: "2026-10-01T00:00:00Z", text: "Please don&#x27;t post agencies." })).toBeNull();
    expect(parseHiringPost({ id: 2, created_at: "2026-10-01T00:00:00Z", text: null })).toBeNull();
  });

  it("matches keywords with a window of text around the first one, the most matches first", async () => {
    serve({ [ITEMS]: fixture("hn-whoishiring-items.json") });
    const posts = await hiringPosts("45512001");
    const m = matchPosts(posts, ["usage-based billing", "finance", "invoice", "x"]);
    expect(m.map((x) => [x.post.company, x.hits])).toEqual([
      ["Meterly", ["finance", "invoice"]],
      ["Northpeak", ["usage-based billing"]],
    ]);
    expect(m[0].excerpt).toMatch(/invoices for B2B software/);
    expect(m[0].excerpt.length).toBeLessThanOrEqual(242);
  });

  it("reads the thread once and caches it", async () => {
    const requested = serve({ [SEARCH]: fixture("hn-whoishiring-search.json"), [ITEMS]: fixture("hn-whoishiring-items.json") });
    const a = await whoIsHiring(["clinics"]);
    const b = await whoIsHiring(["api gateway"]);
    expect(a.matches.map((x) => x.post.company)).toEqual(["Glasswing Health"]);
    expect(b.matches.map((x) => x.post.company)).toEqual(["Tollgate"]);
    expect(requested).toEqual([SEARCH, ITEMS]);
  });
});
