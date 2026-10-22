import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetCompat } from "@/lib/ai/engine";
import { sampleWorkspace } from "@/lib/sample";
import { fetchJSON, fetchText } from "@/lib/signals/http";
import { writeSettings } from "@/lib/store/settings";
import { readWorkspace, replaceWorkspace } from "@/lib/store/workspace";
import { useTape, type Tape } from "@/test/anthropic-tape";
import { freshRun } from "@/test/deterministic";
import { FIT_DOMAINS, YC_ALL_URL, discoveryRoutes } from "@/test/discovery-fixtures";
import { NOW, TODAY } from "@/test/factories";
import { routeFetches } from "@/test/http-fixtures";
import { runWorkflow } from "@/test/run-workflow";
import { expectHealthyRun } from "@/test/tape-checks";
import discovery from "./discovery";

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
});
