import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as sampleRoute } from "@/app/api/workspace/sample/route";
import { MonitorInput } from "@/lib/automation/types";
import { readAutomation } from "@/lib/automation/store";
import { sampleWorkspace } from "@/lib/sample";
import { sampleRepoSuggestions } from "@/lib/sample/intent";
import { sampleAutomation } from "@/lib/sample/research";
import { resetGates } from "@/lib/signals/gate";
import { fetchText } from "@/lib/signals/http";
import { DATA_DIR } from "@/lib/store/settings";
import { readWorkspace, replaceWorkspace } from "@/lib/store/workspace";
import { NOW } from "@/test/factories";
import { outcomesLine } from "@/components/research/outcomes-model";
import { feedSummary, filterItems } from "./feed";
import { intentCandidates } from "./monitor";
import { intentProfile, isRetired, planIntentQueries } from "./profile";

vi.mock("@/lib/signals/http", async (actual) => ({ ...(await actual<typeof import("@/lib/signals/http")>()), fetchText: vi.fn() }));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("the sample's Intent tab", () => {
  const ws = sampleWorkspace(NOW);
  const state = ws.intent!;

  it("has posts across sources and windows, all fictional, each quote under 300 characters", () => {
    expect(state.items.length).toBeGreaterThanOrEqual(8);
    expect(new Set(state.items.map((i) => i.source))).toEqual(new Set(["hn", "stackexchange", "github", "reddit"]));
    for (const i of state.items) {
      expect(new URL(i.url).hostname.endsWith(".example")).toBe(true);
      expect(i.quote.length).toBeLessThanOrEqual(300);
      if (i.company?.domain) expect(i.company.domain.endsWith(".example")).toBe(true);
    }
    const now = NOW.getTime();
    const base = { source: "all" as const, match: "all", sort: "recent" as const };
    expect(filterItems(state.items, { ...base, when: "24h" }, now).length).toBeGreaterThan(0);
    expect(filterItems(state.items, { ...base, when: "7d" }, now).length).toBeGreaterThan(filterItems(state.items, { ...base, when: "24h" }, now).length);
    expect(feedSummary(state.items, now)).toMatch(/^\d+ people posted about what you sell in the last 7 days/);
  });

  it("teaches like a real one: its retired query is one the plan would run, and its feedback keys match", () => {
    const profile = intentProfile(ws)!;
    const plan = planIntentQueries(profile, state.feedback, { reddit: true });
    expect(plan.retired.map((q) => q.query)).toEqual(['"month-end close"']);
    expect(Object.entries(state.feedback).filter(([, fb]) => isRetired(fb))).toHaveLength(1);
    const keys = new Set([...plan.queries, ...plan.retired].map((q) => q.key));
    for (const i of state.items) expect(keys.has(i.queryKey)).toBe(true);
  });

  it("leaves the sample accounts' signals alone, and puts real companies on the radar", () => {
    expect(Object.values(ws.accounts).some((a) => a.signals.some((s) => s.id.startsWith("sig_int_") || s.id.startsWith("sig_rad_")))).toBe(false);
    const radar = state.radar!;
    expect(radar.companies[0]).toMatchObject({ domain: "fernwick.example", name: "Fernwick" });
    expect(radar.companies[0].line).toMatch(/^3 people at Fernwick engaged with meterbook\/meterbook-node in the last 30 days: .*1 issue about tying metered usage to invoices at month-end/);
    expect(radar.companies.some((c) => c.domain === "meterbook.example" || c.domain === "closewise.example")).toBe(false);
    expect(sampleRepoSuggestions().every((s) => s.url.includes(".example/"))).toBe(true);
  });
});

describe("the sample's other Research tabs", () => {
  it("writes searches, monitors, changes and receipts the automation routes accept", () => {
    const data = sampleAutomation(NOW);
    expect(data.sessions.length).toBeGreaterThanOrEqual(2);
    for (const m of data.monitors) {
      expect(m.id).toMatch(UUID);
      expect(() => MonitorInput.parse(m)).not.toThrow();
    }
    expect(data.monitors.map((m) => m.kind).sort()).toEqual(["intent", "page", "topic"]);
    for (const o of data.observations) expect(o.id).toMatch(UUID);
    for (const r of data.receipts) expect(r.id).toMatch(UUID);
    for (const s of data.sessions) expect(data.receipts.some((r) => r.id === s.receiptId && r.kind === "research")).toBe(true);
    const names = Object.values(sampleWorkspace(NOW).people).map((p) => p.name);
    expect(names.some((n) => JSON.stringify(data).includes(n))).toBe(false);
  });

  it("loads with the sample, and Outcomes leads with one plain line", async () => {
    const res = await sampleRoute(new Request("http://localhost:3000/api/workspace/sample", { method: "POST", body: JSON.stringify({ replace: true }) }));
    expect(res.status).toBe(200);
    expect(readAutomation().monitors).toHaveLength(3);
    expect(readWorkspace().intent?.items.length).toBeGreaterThan(0);
    expect(
      outcomesLine([
        { provider: "Firecrawl", requests: 3, failures: 0, cached: 0, knownCostUsd: 0, unknownCost: 3, acceptedAccounts: 3, meetings: 4, replies: 2, won: 0, meanDurationMs: 1, knownCostPerAccount: null },
        { provider: "Hacker News", requests: 6, failures: 0, cached: 1, knownCostUsd: 0, unknownCost: 0, acceptedAccounts: 0, meetings: 0, replies: 0, won: 0, meanDurationMs: 1, knownCostPerAccount: null },
      ]),
    ).toBe("In the last 90 days, 9 research requests found 3 companies you kept, linked to 2 replies, 4 meetings. Cost: $0.00 known, plus 3 requests with no published price.");
    expect(outcomesLine([])).toBeNull();
  });
});

describe("the daily intent monitor", () => {
  beforeEach(async () => {
    resetGates();
    fs.rmSync(path.join(DATA_DIR, "cache"), { recursive: true, force: true });
    const ws = sampleWorkspace(NOW);
    delete ws.sample;
    await replaceWorkspace(ws);
  });

  it("finds new posts in code only, the way a topic monitor reads them", async () => {
    vi.mocked(fetchText).mockImplementation(async (url: string) => {
      const u = new URL(url);
      if (u.host === "hn.algolia.com") {
        const hits = [{ objectID: "99100001", title: "Ask HN: Anyone using a tool for usage reconciliation and the usage export?", story_text: "Our controller spends the month-end close on the usage export.", author: "x", created_at: new Date().toISOString(), _tags: ["story", "ask_hn"] }];
        return { url, status: 200, body: JSON.stringify({ hits }) };
      }
      return { url, status: 200, body: JSON.stringify(u.host === "api.stackexchange.com" ? { items: [], quota_remaining: 200 } : { items: [] }) };
    });
    const r = await intentCandidates();
    expect(r.warnings.filter((w) => !w.startsWith("Some sources"))).toEqual([]);
    expect(r.results.map((x) => x.url)).toEqual(["https://news.ycombinator.com/item?id=99100001"]);
  });

  it("fails the check visibly when nothing answers", async () => {
    vi.mocked(fetchText).mockResolvedValue(null);
    const r = await intentCandidates();
    expect(r.results).toEqual([]);
    expect(r.warnings).toEqual(["None of the sources answered. The monitor will try again."]);
  });
});
