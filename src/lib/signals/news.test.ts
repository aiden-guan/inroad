import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeSettings } from "@/lib/store/settings";
import { fixture, routeFetches } from "@/test/http-fixtures";
import { fetchJSON, fetchText } from "./http";
import { companyNews, gdeltNews, googleNews, hackerNews } from "./news";

vi.mock("./http", () => ({ fetchText: vi.fn(), fetchJSON: vi.fn() }));

const google = (q: string) => `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
const gdelt = (q: string, limit: number) =>
  `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(q)}&mode=artlist&format=json&maxrecords=${limit}&timespan=90d&sourcelang=english&sort=datedesc`;
const HN = "https://hn.algolia.com/api/v1/search_by_date?query=acme.com&restrictSearchableAttributes=url&tags=story&hitsPerPage=5";

function serve(routes: Parameters<typeof routeFetches>[0]) {
  const r = routeFetches(routes);
  vi.mocked(fetchText).mockImplementation(r.fetchText);
  vi.mocked(fetchJSON).mockImplementation(r.fetchJSON);
  return r.requested;
}

/** GDELT calls are spaced 5.2s apart through a process-wide slot; start each test with it free. */
const resetGdeltGate = () => delete (globalThis as { __gdeltNextSlot?: number }).__gdeltNextSlot;

beforeEach(resetGdeltGate);
afterEach(() => {
  vi.useRealTimers();
  writeSettings({ newsSource: undefined });
});

describe("googleNews", () => {
  it("parses the RSS feed: decoded titles without the source suffix, links and dates", async () => {
    serve({ [google("acme")]: fixture("google-news.xml") });
    expect(await googleNews("acme")).toEqual([
      { title: "Acme raises $12M Series A to fix usage billing", url: "https://news.google.com/rss/articles/CBMiA1?oc=5", source: "TechCrunch", publishedAt: "2026-10-12T13:00:00.000Z" },
      { title: `Acme & Tollgate partner on "usage-first" invoicing`, url: "https://news.google.com/rss/articles/CBMiB2?oc=5", source: "Business Wire", publishedAt: "2026-10-01T09:15:00.000Z" },
      { title: "Road Runner sues Acme Corporation over defective rockets", url: "https://news.google.com/rss/articles/CBMiC3?oc=5", source: "Example Gazette", publishedAt: "2026-09-15T09:15:00.000Z" },
    ]);
  });

  it("honors the limit and returns nothing when the feed fails", async () => {
    serve({ [google("acme")]: fixture("google-news.xml") });
    expect(await googleNews("acme", 1)).toHaveLength(1);
    expect(await googleNews("unreachable")).toEqual([]);
  });
});

describe("hackerNews", () => {
  it("lists stories linking to the domain, with points", async () => {
    serve({ [HN]: fixture("hn-algolia.json") });
    expect(await hackerNews("acme.com")).toEqual([
      { title: "Show HN: Acme – reconcile usage events with invoices", url: "https://news.ycombinator.com/item?id=41820001", source: "Hacker News · 212 points", publishedAt: "2026-10-14T15:02:11Z" },
      { title: "Acme pricing page teardown", url: "https://news.ycombinator.com/item?id=41820003", source: "Hacker News", publishedAt: "2026-10-02T08:00:00Z" },
    ]);
  });
});

describe("gdeltNews", () => {
  it("parses GDELT's compact timestamps", async () => {
    serve({ [gdelt("acme", 15)]: fixture("gdelt.json") });
    const items = await gdeltNews("acme");
    expect(items.map((n) => [n.source, n.publishedAt])).toEqual([
      ["finextra.example", "2026-10-12T13:15:00.000Z"],
      ["example-news.com", "2026-10-05T09:00:00.000Z"],
      ["", undefined],
    ]);
  });

  it("waits 5.2 seconds between requests", async () => {
    vi.useFakeTimers({ now: new Date(2026, 9, 20, 9, 30) });
    const requested = serve({ [gdelt("a", 15)]: fixture("gdelt.json"), [gdelt("b", 15)]: fixture("gdelt.json") });
    const first = gdeltNews("a");
    const second = gdeltNews("b");
    await vi.advanceTimersByTimeAsync(5000);
    expect(requested).toEqual([gdelt("a", 15)]);
    await vi.advanceTimersByTimeAsync(200);
    expect(requested).toEqual([gdelt("a", 15), gdelt("b", 15)]);
    await Promise.all([first, second]);
  });
});

describe("companyNews", () => {
  const byName = `"Acme" (startup OR raises OR funding OR launches OR CEO OR customers)`;
  const nameFeed = `<rss><channel>
    <item><title>Acme launches usage alerts - The Verge</title><link>https://n/1</link><pubDate>Fri, 16 Oct 2026 10:00:00 GMT</pubDate><source url="x">The Verge</source></item>
    <item><title>ACME raises $12M Series A to fix usage billing</title><link>https://n/2</link><pubDate>Mon, 12 Oct 2026 13:00:00 GMT</pubDate></item>
    <item><title>Acme Corporation stock rallies</title><link>https://n/3</link><pubDate>Sat, 17 Oct 2026 10:00:00 GMT</pubDate></item>
    <item><title>Acmeify launches a new startup</title><link>https://n/4</link><pubDate>Sun, 18 Oct 2026 10:00:00 GMT</pubDate></item>
  </channel></rss>`;

  it("keeps domain matches, and name matches that name the company in a business context, newest first", async () => {
    writeSettings({ newsSource: "google_news" });
    serve({ [google(`"acme.com"`)]: fixture("google-news.xml"), [google(byName)]: nameFeed });
    const news = await companyNews("Acme", "acme.com");
    expect(news.map((n) => [n.title, n.signal])).toEqual([
      ["Acme launches usage alerts", true],
      ["Acme raises $12M Series A to fix usage billing", true],
      [`Acme & Tollgate partner on "usage-first" invoicing`, false],
      ["Road Runner sues Acme Corporation over defective rockets", false],
    ]);
  });

  it("reads GDELT by default", async () => {
    vi.useFakeTimers({ now: new Date(2026, 9, 20, 9, 30) });
    const requested = serve({ [gdelt(`"acme.com"`, 10)]: fixture("gdelt.json") });
    const pending = companyNews("Acme", "acme.com");
    await vi.advanceTimersByTimeAsync(5200);
    const news = await pending;
    expect(requested).toEqual([gdelt(`"acme.com"`, 10), gdelt(`"Acme" (startup OR raises OR funding OR launches OR customers)`, 20)]);
    expect(news.map((n) => n.title)).toEqual(["Acme raises $12M to automate usage invoicing", "Acme hires former Stripe finance lead as CFO", "Acme profile"]);
  });

  it("makes no requests when news is turned off", async () => {
    writeSettings({ newsSource: "off" });
    const requested = serve({});
    expect(await companyNews("Acme", "acme.com")).toEqual([]);
    expect(requested).toEqual([]);
  });
});
