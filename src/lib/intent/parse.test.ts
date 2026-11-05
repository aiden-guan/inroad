import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { bestSentence, decodeEntities, isBotLogin, parseGithubIssues, parseHn, parseReddit, parseStackExchange, plainText, stackExchangeMeta, verbatim } from "./parse";

/** Saved responses from the real endpoints, anonymized (scripts/mock/intent.mjs serves the same files in mock mode). */
const fixture = (name: string) => JSON.parse(fs.readFileSync(new URL(`../../test/fixtures/signals/intent/${name}`, import.meta.url), "utf8"));

describe("plainText", () => {
  it("turns HN and Stack Exchange HTML and GitHub Markdown into sentences, without code or templates", () => {
    expect(plainText("We bill per call.<p>It takes four days &amp; we can&#x27;t explain it.")).toBe("We bill per call.\nIt takes four days & we can't explain it.");
    expect(plainText("&gt; quoted line\nanswer")).toBe("quoted line\nanswer");
    expect(plainText("**Steps**\n1. Send `usage_event`\n<!-- template -->\n```sql\nselect 1\n```\n![img](x.png) [docs](https://x.dev)")).toBe("Steps\n1. Send usage_event\ndocs");
    expect(plainText("x".repeat(30), 20)).toHaveLength(20);
    expect(decodeEntities("&#x2F;&#47;&nbsp;&unknown;")).toBe("// &unknown;");
  });
});

describe("parseHn", () => {
  it("reads Ask HN stories and comments, with item links, thread ids and dates", () => {
    const posts = parseHn(fixture("hn-search.json"), '"usage reconciliation"', "hn:q");
    expect(posts).toHaveLength(9);
    const ask = posts.find((p) => p.key === "hn:99000101")!;
    expect(ask).toMatchObject({
      source: "hn",
      site: "Ask HN",
      thread: "hn:99000101",
      url: "https://news.ycombinator.com/item?id=99000101",
      title: "Ask HN: How do you reconcile metered usage with what your billing system invoiced?",
      author: "fixture_mkessler",
      authorUrl: "https://news.ycombinator.com/user?id=fixture_mkessler",
      postedAt: "2026-11-05T04:00:00.000Z",
      query: '"usage reconciliation"',
      queryKey: "hn:q",
    });
    expect(ask.text).toContain("we still book an adjustment we can't explain.\nWhat do you use?");
    const comment = posts.find((p) => p.key === "hn:99000103")!;
    expect(comment).toMatchObject({ site: "Comment", thread: "hn:99000090", title: "Usage-based pricing is eating finance teams" });
    expect(posts.find((p) => p.key === "hn:99000106")!.site).toBe("Show HN");
  });

  it("is empty for anything that isn't a search response", () => {
    expect(parseHn(null, "q", "k")).toEqual([]);
    expect(parseHn({ hits: [{ objectID: "../x" }] }, "q", "k")).toEqual([]);
  });
});

describe("parseStackExchange", () => {
  it("reads questions with decoded titles, plain bodies and the asker's profile link", () => {
    const all = fixture("se-search.json");
    const [q] = parseStackExchange(all.softwarerecs, "softwarerecs", "usage reconciliation", "se:q");
    expect(q).toMatchObject({
      key: "stackexchange:softwarerecs:99001",
      source: "stackexchange",
      site: "Software Recommendations",
      title: "Tool to match usage events from our warehouse to invoice line items",
      author: "fixture M. Okonjo",
      postedAt: "2026-11-04T07:00:00.000Z",
    });
    expect(q.url).toMatch(/^https:\/\/softwarerecs\.stackexchange\.com\/questions\/99001\//);
    expect(q.text).toMatch(/^We bill per API call\. I need something that ties raw usage events/);
    const so = parseStackExchange(all.stackoverflow, "stackoverflow", "q", "k");
    expect(so.map((x) => x.site)).toEqual(["Stack Overflow", "Stack Overflow"]);
    expect(so[0].text).not.toContain("select customer_id");
  });

  it("reads the quota and the backoff the API asks for", () => {
    expect(stackExchangeMeta({ items: [], quota_remaining: 12, backoff: 10 })).toEqual({ quotaRemaining: 12, backoff: 10 });
    expect(stackExchangeMeta({ error_id: 502, error_message: "too many requests from this IP", error_name: "throttle_violation" })).toEqual({ error: "too many requests from this IP" });
  });
});

describe("parseGithubIssues", () => {
  it("keeps issues with their repo, marks bots, and keeps the author's association for the staff filter", () => {
    const posts = parseGithubIssues(fixture("gh-search-issues.json"), "Meterbook usage", "gh:q");
    expect(posts.map((p) => [p.key, p.author, p.bot ?? false, p.association])).toEqual([
      ["github:fixture-meterbook/meterbook-node#412", "fixture-rkapoor", false, "NONE"],
      ["github:fixture-closewise/closewise-cli#88", "fixture-dmehta", false, "NONE"],
      ["github:fixture-student/skills-usage-billing#1", "github-actions[bot]", true, "CONTRIBUTOR"],
      ["github:fixture-meterbook/meterbook-node#415", "fixture-nwatts", false, "MEMBER"],
    ]);
    expect(posts[0]).toMatchObject({ site: "fixture-meterbook/meterbook-node", url: "https://github.com/fixture-meterbook/meterbook-node/issues/412", title: "Late usage events after the invoice run are dropped silently" });
    expect(posts[0].text).toMatch(/^Events that arrive after the invoice run never show up on any Meterbook invoice/);
    expect(posts[0].text).not.toContain("template");
    expect(posts[1].text).not.toContain("select *");
  });
});

describe("parseReddit", () => {
  it("keeps only thread links from the search provider, as snippets with their subreddit", () => {
    const posts = parseReddit(
      [
        { url: "https://www.reddit.com/r/Accounting/comments/1q8zk2/usage_based_billing_is_wrecking_our_close/", title: "Usage-based billing is wrecking our close : r/Accounting", description: "Half of my first week goes to tying out usage.", publishedAt: "2026-11-03T10:00:00Z" },
        { url: "https://www.reddit.com/r/Accounting/", title: "r/Accounting", description: "A community" },
        { url: "https://old.reddit.com/r/SaaS/comments/abc123/x", title: "Metered billing tools? - Reddit", description: "Looking for a tool." },
      ],
      '"tie out usage"',
      "reddit:q",
    );
    expect(posts.map((p) => [p.key, p.site, p.title, p.postedAt ?? null, p.snippet])).toEqual([
      ["reddit:accounting:1q8zk2", "r/Accounting", "Usage-based billing is wrecking our close", "2026-11-03T10:00:00.000Z", true],
      ["reddit:saas:abc123", "r/SaaS", "Metered billing tools?", null, true],
    ]);
    expect(posts[0].url).toBe("https://www.reddit.com/r/Accounting/comments/1q8zk2/");
    expect(posts[0].author).toBe("");
  });
});

describe("quotes", () => {
  const text = "We bill per API call. Every month-end our controller exports usage and VLOOKUPs it. It takes four days.";
  it("accepts the model's quote only when it is really in the post", () => {
    expect(verbatim(text, "Every month-end our controller exports usage")).toBe("Every month-end our controller exports usage");
    expect(verbatim(text, "  “every month-end our   controller exports usage”  ")).toBe("Every month-end our controller exports usage");
    expect(verbatim(text, "Every month our controller exports usage")).toBeNull();
    expect(verbatim(text, "short")).toBeNull();
  });
  it("falls back to the sentence that mentions the most playbook words", () => {
    expect(bestSentence(text, ["controller", "usage", "month-end"])).toBe("Every month-end our controller exports usage and VLOOKUPs it.");
  });
  it("tells bots by their login", () => {
    expect(isBotLogin("dependabot[bot]")).toBe(true);
    expect(isBotLogin("renovate")).toBe(true);
    expect(isBotLogin("dana-dev")).toBe(false);
  });
});
