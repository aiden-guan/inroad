import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetCompat } from "@/lib/ai/engine";
import { sampleWorkspace } from "@/lib/sample";
import { fetchJSON, fetchText } from "@/lib/signals/http";
import { writeSettings } from "@/lib/store/settings";
import { readWorkspace, replaceWorkspace } from "@/lib/store/workspace";
import { useTape, type Tape } from "@/test/anthropic-tape";
import { freshRun } from "@/test/deterministic";
import { FIT_DOMAINS, HN_DOMAINS, YC_ALL_URL, discoveryRoutes, formDRoutes, hnHiringRoutes, searchHitSites, vendorDirectory } from "@/test/discovery-fixtures";
import { NOW, TODAY } from "@/test/factories";
import { fixture, routeFetches } from "@/test/http-fixtures";
import { logLines, runWorkflow } from "@/test/run-workflow";
import { expectHealthyRun } from "@/test/tape-checks";
import type { Workspace } from "@/lib/domain/types";
import discovery, { emptyNote, queryPlan } from "./discovery";

/**
 * W3 "Find companies" end to end on recorded Anthropic exchanges, against the sample workspace's ICP
 * (Ledgerline: finance tooling for usage-priced software companies). Code ranks the YC directory and
 * reads job boards from saved responses; Haiku screens; code scores, tiers and writes.
 */

vi.mock("@/lib/domain/ids", async (actual) => (await import("@/test/deterministic")).deterministicIds(await actual()));
vi.mock("@/lib/signals/http", async (actual) => ({ ...(await actual<typeof import("@/lib/signals/http")>()), fetchText: vi.fn(), fetchJSON: vi.fn() }));

let tape: Tape;

function serve(routes: Record<string, string>) {
  const r = routeFetches(routes);
  vi.mocked(fetchText).mockImplementation(r.fetchText);
  vi.mocked(fetchJSON).mockImplementation(r.fetchJSON);
}

beforeEach(async () => {
  freshRun(NOW);
  resetCompat();
  writeSettings({ newsSource: "off" });
  await replaceWorkspace(sampleWorkspace(NOW));
});

afterEach(async () => {
  await tape?.close();
  writeSettings({ newsSource: undefined });
  vi.useRealTimers();
});

describe("finding companies", () => {
  it("screens the ranked YC directory against the ICP and adds fits with a dated reason first", async () => {
    serve(discoveryRoutes());
    tape = await useTape("discovery-yc");
    const before = new Set(Object.keys(readWorkspace().accounts));
    const { summary, result } = await runWorkflow(discovery, { count: 5, source: "manual" });
    await expectHealthyRun(summary, tape, { submits: ["submit_screen"] });

    const ws = readWorkspace();
    const added = Object.values(ws.accounts).filter((a) => !before.has(a.domain));
    expect(added.length).toBeGreaterThan(0);
    expect(added.length).toBeLessThanOrEqual(5);
    for (const a of added) {
      expect(FIT_DOMAINS).toContain(a.domain);
      expect(a.status).toBe("new");
      expect(a.source).toBe("yc_directory");
      expect(a.criteria.length).toBeGreaterThan(0);
      expect(a.fitScore).toBeGreaterThanOrEqual(50);
      for (const s of a.signals) {
        expect(s.date <= TODAY).toBe(true);
        expect(ws.evidence[s.evidenceId!]).toBeDefined();
      }
    }
    // Fits with a reason to talk now come first.
    expect(added.some((a) => a.whyNowScore > 0)).toBe(true);
    expect((result as { note: string }).note).toMatch(/^Checked \d+ companies/);
    // Every screening batch is cached for an hour.
    for (const e of tape.exchanges()) expect(e.request.cacheTtl).toBe("1h");
  });

  it("falls back to a capped web search when free sources come up thin, keeping only companies it saw", async () => {
    // No YC directory: free sources are thin. The companies the search turns up have real sites.
    const routes = discoveryRoutes();
    delete routes[YC_ALL_URL];
    for (const d of FIT_DOMAINS) routes[`https://${d}`] = `<html><head><title>${d.split(".")[0]} | Usage billing</title><meta name="description" content="Usage-based billing API for B2B software companies."></head></html>`;
    serve(routes);
    tape = await useTape("discovery-search");
    const before = new Set(Object.keys(readWorkspace().accounts));
    const { summary } = await runWorkflow(discovery, { count: 5, source: "manual" });
    await expectHealthyRun(summary, tape, { submits: ["submit_candidates", "submit_screen"] });
    expect(summary.receipt!.searches).toBeGreaterThan(0);
    expect(summary.receipt!.searches).toBeLessThanOrEqual(5);

    const ws = readWorkspace();
    const added = Object.values(ws.accounts).filter((a) => !before.has(a.domain));
    expect(added.length).toBeGreaterThan(0);
    const seen = new Set(tape.messages().flatMap((m) => m.content.flatMap((b) => (b.type === "web_search_tool_result" && Array.isArray(b.content) ? b.content.map((r) => (r as { url: string }).url) : []))));
    for (const a of added) {
      expect(["web_search", "ats_search"]).toContain(a.source);
      expect(seen.has(a.sourceUrl!)).toBe(true);
    }
  });

  it("searches the web after screening when too few YC matches survive, instead of calling the bet too narrow", async () => {
    // Eight YC consultancies share the ICP's tags and words, so code ranks them in, and the screen rejects every
    // one. Before, six raw matches skipped the web search and the run blamed the bet.
    const routes = { ...discoveryRoutes(), [YC_ALL_URL]: JSON.stringify(vendorDirectory()), ...searchHitSites() };
    serve(routes);
    tape = await useTape("discovery-survivors");
    const before = new Set(Object.keys(readWorkspace().accounts));
    const { summary, result, events } = await runWorkflow(discovery, { count: 3, source: "onboarding" });
    await expectHealthyRun(summary, tape, { submits: ["submit_screen", "submit_candidates"] });

    // Screen first, search second, then screen what the search found.
    expect(tape.exchanges().map((e) => e.request.tools[0])).toEqual(["submit_screen", "submit_candidates", "submit_screen"]);
    expect(summary.receipt!.searches).toBeGreaterThan(0);
    expect(summary.receipt!.searches).toBeLessThanOrEqual(2);
    expect(logLines(events)).toContain("Only 0 strong fits so far, so I'm searching the web");

    const r = result as { rejected: { domain: string; reason: string }[]; note: string };
    expect(r.rejected.filter((x) => x.reason.startsWith("Anti-ICP")).length).toBe(8);
    const added = Object.values(readWorkspace().accounts).filter((a) => !before.has(a.domain));
    expect(added.length).toBeGreaterThan(0);
    for (const a of added) expect(["web_search", "ats_search"]).toContain(a.source);
    expect(r.note).not.toMatch(/too narrow/);
  });

  it("draws on HN “Who is hiring?” and SEC Form D when the ICP's detection methods call for them", async () => {
    // No YC directory: the sample's job_posts and form_d criteria bring in this month's hiring thread and recent filings.
    const routes = { ...discoveryRoutes(), ...hnHiringRoutes(), ...formDRoutes(fixture("edgar-search.json"), fixture("edgar-formd.xml")) };
    delete routes[YC_ALL_URL];
    serve(routes);
    tape = await useTape("discovery-sources");
    const before = new Set(Object.keys(readWorkspace().accounts));
    const { summary, result } = await runWorkflow(discovery, { count: 8, source: "manual" });
    await expectHealthyRun(summary, tape, { submits: ["submit_screen"] });

    const r = result as { sourcesUsed: { source: string; candidates: number }[] };
    expect(r.sourcesUsed).toEqual(expect.arrayContaining([{ source: "hn_hiring", candidates: 12 }, { source: "form_d", candidates: 2 }]));
    const ws = readWorkspace();
    const added = Object.values(ws.accounts).filter((a) => !before.has(a.domain));
    // At most five from one source, then the filings.
    expect(added.filter((a) => a.source === "hn_hiring").length).toBeGreaterThanOrEqual(5);
    const filed = added.filter((a) => a.source === "form_d");
    expect(filed.map((a) => a.domain).sort()).toEqual(expect.arrayContaining(["pavewise.com"]));
    for (const a of added.filter((x) => x.source === "hn_hiring")) {
      expect(HN_DOMAINS).toContain(a.domain);
      expect(a.signals.some((s) => s.url.startsWith("https://news.ycombinator.com/item?id=") && (s.type === "first_hire" || s.type === "hiring"))).toBe(true);
    }
    const pave = ws.accounts["pavewise.com"];
    const funding = pave.signals.find((s) => s.type === "funding")!;
    expect(funding).toMatchObject({ headline: "Filed a Form D: $18M raised", date: "2026-10-02", host: "sec.gov", usableInOutreach: true });
    expect(ws.evidence[funding.evidenceId!]).toMatchObject({ sourceType: "filing", quote: expect.stringContaining("Total Amount Sold: $18,000,000") });
    expect(pave.sourceDetail).toBe("Form D · $18M · filed 2026-10-02");
    // The fund in the same search never became a candidate.
    expect(Object.keys(ws.accounts).some((d) => d.includes("northgate"))).toBe(false);
  });
});

describe("the query plan", () => {
  function banks(ws: Workspace): Workspace {
    const f = ws.foundation!;
    f.icp.primarySegment = "Community banks and credit unions in Texas with 50–500 employees";
    f.icp.hypothesis.companyGroup = "Community banks";
    f.icp.testSlices = [];
    f.positioning.bestFit = [];
    f.icp.criteria = [
      { ...f.icp.criteria[0], text: "A community bank or credit union", detection: "site" },
      { ...f.icp.criteria[1], text: "50–500 employees", detection: "site" },
    ];
    ws.company!.whoItsFor = "Compliance officers at community banks";
    return ws;
  }

  it("follows the sample's detection methods: the YC directory leads, HN hiring and Form D join, press gets more news checks", () => {
    const plan = queryPlan(sampleWorkspace(NOW), { source: "manual" });
    expect(plan).toMatchObject({ methods: ["site", "job_posts", "form_d", "press"], startupIcp: true, ycLimit: 140, ycPrior: 1, github: 0, news: 6 });
    expect(plan.formD).toMatchObject({ industries: ["Other Technology"], sinceDays: 90, limit: 14 });
    expect(plan.hnHiring?.icpWords).toEqual(expect.arrayContaining(["usage-priced", "infrastructure"]));
    expect(plan.hnHiring?.icpWords).not.toContain("model");
    expect(queryPlan(sampleWorkspace(NOW), { source: "onboarding" })).toMatchObject({ ycLimit: 40, formD: { limit: 6 }, hnHiring: { limit: 10 } });
  });

  it("keeps YC to a side source when the buyers aren't startups, and reads their industry's Form Ds in their state", () => {
    const plan = queryPlan(banks(sampleWorkspace(NOW)), { source: "manual" });
    expect(plan).toMatchObject({ startupIcp: false, ycLimit: 30, ycPrior: 0.6, hnHiring: null });
    expect(plan.formD).toEqual({ industries: ["Commercial Banking", "Other Banking & Financial Services"], states: ["TX"], sinceDays: 90, limit: 14 });
    expect(queryPlan(banks(sampleWorkspace(NOW)), { source: "onboarding" })).toMatchObject({ ycLimit: 10, formD: null });
  });

  it("looks candidates up on GitHub only when a criterion is detected there, and more with a token", () => {
    const ws = sampleWorkspace(NOW);
    ws.foundation!.icp.criteria[0].detection = "github";
    expect(queryPlan(ws, { source: "manual" }).github).toBe(6);
    expect(queryPlan(ws, { source: "onboarding" }).github).toBe(0);
    writeSettings({ githubToken: "github_pat_test" });
    expect(queryPlan(ws, { source: "manual" }).github).toBe(20);
    writeSettings({ githubToken: undefined });
  });
});

describe("when nothing clears the bar", () => {
  it("names the sources' limits instead of blaming the bet", () => {
    const none = emptyNote({ considered: 0, sources: [], startupIcp: false, searched: true });
    expect(none).toMatch(/^I couldn't find candidates for this segment in the free sources and a short web search\. Those sources can miss buyers who aren't startups/);
    const ycOnly = emptyNote({ considered: 30, sources: ["YC directory"], startupIcp: false, topReason: "a community bank or credit union", searched: true });
    expect(ycOnly).toBe(
      "None of the 30 companies I found in YC directory and a short web search fit your ICP. The YC directory is mostly venture-backed startups, which may not be who buys from you. Most were dropped for “a community bank or credit union”; if that isn't a must-have, make it nice-to-have in your Playbook. Import a list of companies you'd like to sell to (a CRM export, a conference list), or start from your network.",
    );
    for (const n of [none, ycOnly]) expect(n).not.toMatch(/too narrow|bet/);
  });
});
