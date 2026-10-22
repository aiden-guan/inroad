import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetCompat } from "@/lib/ai/engine";
import { fetchJSON, fetchText } from "@/lib/signals/http";
import { writeSettings } from "@/lib/store/settings";
import { readWorkspace, replaceWorkspace } from "@/lib/store/workspace";
import { useTape, type Tape } from "@/test/anthropic-tape";
import { freshRun } from "@/test/deterministic";
import { NOW, TODAY, makeAccount, makePerson, makeWorkspace } from "@/test/factories";
import { fixture, routeFetches } from "@/test/http-fixtures";
import { logLines, runWorkflow } from "@/test/run-workflow";
import { expectHealthyRun } from "@/test/tape-checks";
import dossier from "./dossier";

/**
 * W4 end to end on recorded Anthropic exchanges (src/test/anthropic-tape.ts): code gathers Acme's site,
 * job boards and news from saved responses, the model records evidence and submits, code checks every
 * quote and persists. Assertions hold for any faithful model, so the same test runs on the live API.
 */

vi.mock("@/lib/domain/ids", async (actual) => (await import("@/test/deterministic")).deterministicIds(await actual()));
vi.mock("@/lib/signals/http", async (actual) => ({ ...(await actual<typeof import("@/lib/signals/http")>()), fetchText: vi.fn(), fetchJSON: vi.fn() }));

const google = (q: string) => `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;

/** Acme's public footprint, as saved responses. Everything else fails like an unreachable host. */
const ACME = {
  "https://acme.com": { url: "https://www.acme.com/", body: fixture("acme-home.html") },
  "https://www.acme.com/pricing": fixture("acme-pricing.html"),
  "https://www.acme.com/about-us": fixture("acme-about.html"),
  "https://www.acme.com/careers": fixture("acme-careers.html"),
  "https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=true": fixture("greenhouse-jobs.json"),
  [google(`"Acme" (startup OR raises OR funding OR launches OR CEO OR customers)`)]: fixture("google-news.xml"),
  "https://hn.algolia.com/api/v1/search_by_date?query=acme.com&restrictSearchableAttributes=url&tags=story&hitsPerPage=5": fixture("hn-algolia.json"),
};

let tape: Tape;

beforeEach(async () => {
  freshRun(NOW);
  resetCompat();
  writeSettings({ newsSource: "google_news" });
  const r = routeFetches(ACME);
  vi.mocked(fetchText).mockImplementation(r.fetchText);
  vi.mocked(fetchJSON).mockImplementation(r.fetchJSON);
  await replaceWorkspace(
    makeWorkspace({
      accounts: { "acme.com": makeAccount("acme.com", { status: "new", tier: "B", fitScore: 78, watch: false }), "northwind.io": makeAccount("northwind.io", { status: "new" }) },
    }),
  );
});

afterEach(async () => {
  await tape?.close();
  writeSettings({ newsSource: undefined });
  vi.useRealTimers();
});

describe("researching a company", () => {
  it("writes a sourced dossier from the free material: every fact, signal and angle cites a checked quote", async () => {
    tape = await useTape("dossier-acme");
    const { summary } = await runWorkflow(dossier, { domain: "acme.com" });
    await expectHealthyRun(summary, tape, { submits: ["record_evidence", "submit_dossier"] });

    const ws = readWorkspace();
    const acc = ws.accounts["acme.com"];
    const d = acc.dossier!;
    expect(d.generatedAt).toBeTruthy();
    expect(d.snapshot.plainDescription.length).toBeGreaterThan(10);
    expect(d.facts.length).toBeGreaterThan(0);
    const cited = [...d.facts.flatMap((f) => f.evidenceIds), ...d.angles.flatMap((a) => a.evidenceIds), ...acc.signals.map((s) => s.evidenceId!)];
    for (const id of cited) expect(ws.evidence[id], id).toBeDefined();
    // Quotes come only from what code gathered (the site, the job board, news, Hacker News).
    const allowed = /^https:\/\/(www\.acme\.com|boards\.greenhouse\.io\/acme|news\.google\.com|news\.ycombinator\.com|dns\.google)\b/;
    for (const id of cited) expect(ws.evidence[id].url).toMatch(allowed);
    // Two dated items were found in code, so no web search was allowed or run.
    expect(summary.receipt?.searches).toBe(0);
    // Fresh dated signals, none in the future.
    expect(acc.signals.length).toBeGreaterThan(0);
    for (const s of acc.signals) expect(s.date <= TODAY).toBe(true);
    expect(d.recommendation.move).toBeTruthy();
  });

  it("searches the web (at most 3 times) when free sources are thin, and keeps only snippets it really saw", async () => {
    tape = await useTape("dossier-thin");
    const { summary } = await runWorkflow(dossier, { domain: "northwind.io" });
    await expectHealthyRun(summary, tape, { submits: ["submit_dossier"] });
    const ws = readWorkspace();
    const d = ws.accounts["northwind.io"].dossier!;
    expect(summary.receipt!.searches).toBeGreaterThan(0);
    expect(summary.receipt!.searches).toBeLessThanOrEqual(3);
    const seen = new Set(
      tape.messages().flatMap((m) => m.content.flatMap((b) => (b.type === "web_search_tool_result" && Array.isArray(b.content) ? b.content.map((r) => (r as { url: string }).url) : []))),
    );
    for (const id of d.facts.flatMap((f) => f.evidenceIds)) {
      const ev = ws.evidence[id];
      expect(ev.sourceType).toBe("search_snippet");
      expect(seen.has(ev.url)).toBe(true);
      expect(ev.confidence).toBe("low");
    }
  });

  it("adds the company's Form D and its champion's podcast episodes to what it may cite, checked like any page", async () => {
    // A company with a homepage and no board or news: the public record is what has dates.
    const FILING = "https://www.sec.gov/Archives/edgar/data/1987654/000198765426000002/0001987654-26-000002-index.htm";
    const efts = `https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent('"Pavewise"')}&forms=D&dateRange=custom&startdt=2024-10-20&enddt=${TODAY}`;
    const itunes = (term: string, limit: number) => `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&media=podcast&entity=podcastEpisode&limit=${limit}`;
    const r = routeFetches({
      "https://pavewise.com": `<html><head><title>Pavewise | Usage billing for infrastructure APIs</title><meta name="description" content="Pavewise meters API usage and bills it for infrastructure companies."></head><body><h1>Bill every API call</h1><p>Pavewise turns metered API usage into invoices your finance team trusts.</p></body></html>`,
      [efts]: fixture("edgar-search.json"),
      "https://www.sec.gov/Archives/edgar/data/1987654/000198765426000002/primary_doc.xml": fixture("edgar-formd.xml"),
      [itunes("Dana Okafor Pavewise", 10)]: fixture("itunes-podcasts.json"),
      [itunes("Pavewise", 8)]: fixture("itunes-podcasts.json"),
    });
    vi.mocked(fetchText).mockImplementation(r.fetchText);
    vi.mocked(fetchJSON).mockImplementation(r.fetchJSON);
    await replaceWorkspace(
      makeWorkspace({
        accounts: { "pavewise.com": makeAccount("pavewise.com", { status: "new", peopleIds: ["per_dana"] }) },
        people: { per_dana: makePerson("per_dana", "pavewise.com", { name: "Dana Okafor", title: "CEO", role: "champion" }) },
      }),
    );
    tape = await useTape("dossier-records");
    const { summary, events } = await runWorkflow(dossier, { domain: "pavewise.com" });
    await expectHealthyRun(summary, tape, { submits: ["record_evidence", "submit_dossier"] });

    expect(events).toContainEqual(expect.objectContaining({ type: "read", url: FILING, host: "sec.gov" }));
    expect(logLines(events)).toContain("1 SEC filing · 2 podcast episodes");
    // Two dated items came from the public record, so no web search was needed.
    expect(summary.receipt?.searches).toBe(0);
    const ws = readWorkspace();
    const cited = Object.values(ws.evidence).filter((e) => e.url === FILING || e.url.startsWith("https://podcasts.apple.com/"));
    expect(cited.length).toBeGreaterThan(0);
    for (const e of cited) expect(e.sourceType).toBe(e.url === FILING ? "filing" : "podcast");
  });
});
