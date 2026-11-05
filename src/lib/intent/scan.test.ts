import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/intent/route";
import type { AgentEvent } from "@/lib/ai/events";
import { emptyUsage } from "@/lib/ai/models";
import { readAutomation, resetAutomation } from "@/lib/automation/store";
import { sampleWorkspace } from "@/lib/sample";
import { resetGates } from "@/lib/signals/gate";
import { resetGithubBudget } from "@/lib/signals/github";
import { fetchText } from "@/lib/signals/http";
import { DATA_DIR, writeSettings } from "@/lib/store/settings";
import { readWorkspace, replaceWorkspace, mutateWorkspace } from "@/lib/store/workspace";
import type { WorkflowContext } from "@/lib/workflows/types";
import { NOW } from "@/test/factories";
import { signalIdFor } from "./attach";
import { runRadarScan } from "./radar";
import { runIntentScan } from "./scan";

vi.mock("@/lib/signals/http", async (actual) => ({ ...(await actual<typeof import("@/lib/signals/http")>()), fetchText: vi.fn() }));
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), connection: async () => undefined }));

const ANCHOR = new Date("2026-11-05T09:00:00Z");
const fixture = (name: string) => fs.readFileSync(new URL(`../../test/fixtures/signals/intent/${name}`, import.meta.url), "utf8");
const json = (name: string) => JSON.parse(fixture(name));
const ok = (url: string, body: unknown, headers: Record<string, string> = {}) => ({ url, status: 200, body: typeof body === "string" ? body : JSON.stringify(body), headers });

/** The public APIs, answered from the saved responses the way the real ones answer (by path, any query). */
function serve() {
  const requested: string[] = [];
  vi.mocked(fetchText).mockImplementation(async (url: string) => {
    requested.push(url);
    const u = new URL(url);
    const gh = { "x-ratelimit-remaining": "55", "x-ratelimit-reset": String(Math.floor(ANCHOR.getTime() / 1000) + 3600) };
    if (u.host === "hn.algolia.com" && u.pathname === "/api/v1/search") return ok(url, fixture("hn-search.json"));
    if (u.host === "hn.algolia.com" && u.pathname.startsWith("/api/v1/users/")) return ok(url, json("hn-users.json")[u.pathname.split("/").pop()!] ?? { about: "" });
    if (u.host === "api.stackexchange.com") return ok(url, json("se-search.json")[u.searchParams.get("site")!] ?? { items: [] });
    if (u.host === "api.github.com" && u.pathname === "/search/issues") return ok(url, fixture("gh-search-issues.json"), gh);
    if (u.host === "api.github.com" && u.pathname.startsWith("/users/")) {
      const user = json("gh-users.json")[u.pathname.split("/")[2]];
      return user ? ok(url, user, gh) : { url, status: 404, body: '{"message":"Not Found"}', headers: gh };
    }
    const repo = u.pathname.match(/^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/);
    if (u.host === "api.github.com" && repo) {
      const file = { "": "gh-repo.json", "/forks": "gh-forks.json", "/issues": "gh-issues.json", "/issues/comments": "gh-comments.json", "/stargazers/history": "gh-stars-history.json" }[repo[3] ?? ""];
      if (!file) return { url, status: 404, body: "{}", headers: gh };
      return ok(url, fixture(file).replaceAll("{{repo}}", `${repo[1]}/${repo[2]}`).replaceAll("{{owner}}", repo[1]).replaceAll("{{name}}", repo[2]), gh);
    }
    if (u.host === "api.github.com" && /^\/(orgs|users)\/[^/]+\/(repos|public_members)/.test(u.pathname)) return ok(url, "[]", gh);
    return null;
  });
  return requested;
}

/** The fast model, as a test double: noise out, questions in, the company only when the post says "At X we". */
function fakeJudge(calls: { content: string }[]) {
  return async (opts: Parameters<WorkflowContext<unknown>["agent"]>[0]) => {
    const content = String(opts.messages[0].content);
    calls.push({ content });
    const posts = [...content.matchAll(/^\[(\d+)\] [^\n]*\n([^\n]*)/gm)].map((m) => ({ i: Number(m[1]), body: m[2] }));
    const head = (i: number) => content.match(new RegExp(`^\\[${i}\\] ([^\\n]*)`, "m"))?.[1] ?? "";
    const verdicts = posts.map((p) => {
      const noise = /Show HN|lease/i.test(head(p.i) + p.body);
      return {
        i: p.i,
        label: noise ? "irrelevant" : /\?/.test(head(p.i) + p.body) ? "ask" : "problem",
        relevance: noise ? 0 : 3,
        matched: noise ? [] : ["P1"],
        quote: noise ? "" : (p.body.split(/(?<=[.!?])\s+/)[0] ?? ""),
        why: noise ? "Not about this." : "Has the problem now.",
        company: p.body.match(/\bAt ([A-Z]\w+) we\b/)?.[1] ?? null,
      };
    });
    return { result: { posts: verdicts }, text: "", messages: [], stopReason: "end_turn", usage: { ...emptyUsage(), inputTokens: 1200, outputTokens: 300 }, costUsd: 0.0004 } as never;
  };
}

function context(args: { mode: "asks" | "radar"; repos?: string[] }, calls: { content: string }[] = [], events: AgentEvent[] = []) {
  return {
    runId: "run_test",
    args,
    emit: (e: AgentEvent) => events.push(e),
    signal: new AbortController().signal,
    agent: fakeJudge(calls),
    read: readWorkspace,
    mutate: async <R>(fn: (ws: ReturnType<typeof readWorkspace>) => R) => (await mutateWorkspace(fn)).value,
    noteFreeSignals: () => undefined,
    noteExternalSearch: () => undefined,
  } as unknown as WorkflowContext<{ mode: "asks" | "radar"; repos?: string[] }>;
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(ANCHOR);
  vi.mocked(fetchText).mockReset();
  resetGates();
  resetGithubBudget();
  fs.rmSync(path.join(DATA_DIR, "cache"), { recursive: true, force: true });
  await resetAutomation();
  const ws = sampleWorkspace(NOW);
  delete ws.sample;
  delete ws.intent;
  await replaceWorkspace(ws);
});
afterEach(() => {
  vi.useRealTimers();
  writeSettings({ githubToken: undefined });
});

describe("an intent scan", () => {
  it("finds, dedupes, judges and places posts, and turns posts by people at known accounts into signals", async () => {
    serve();
    const calls: { content: string }[] = [];
    const result = await runIntentScan(context({ mode: "asks" }, calls));
    const ws = readWorkspace();
    const state = ws.intent!;
    const keys = state.items.map((i) => i.key).sort();
    // Show HN and the lease post were judged noise; the hiring thread, the 45-day-old comment, the bot, the
    // maintainer's own issue and the GRANT question never reached the model.
    expect(keys).toEqual(
      [
        "github:fixture-closewise/closewise-cli#88",
        "github:fixture-meterbook/meterbook-node#412",
        "hn:99000101",
        "hn:99000102",
        "hn:99000103",
        "hn:99000104",
        "hn:99000105",
        "stackexchange:money:99002",
        "stackexchange:softwarerecs:99001",
        "stackexchange:stackoverflow:99000201",
      ].sort(),
    );
    const judged = calls.map((c) => c.content).join("\n");
    expect(judged).not.toContain("Who is hiring");
    expect(judged).not.toContain("GRANT USAGE");
    expect(judged).not.toContain("fixture_mkessler");

    const by = (key: string) => state.items.find((i) => i.key === key)!;
    expect(by("hn:99000103").company).toMatchObject({ domain: "quayside.example", basis: "profile_site" });
    expect(by("hn:99000103").trackedDomain).toBe("quayside.example");
    expect(by("hn:99000102").company).toMatchObject({ domain: "pebblecart.example" });
    expect(by("hn:99000102").trackedDomain).toBeUndefined();
    expect(by("hn:99000101").company).toBeUndefined();
    expect(by("hn:99000105").company).toMatchObject({ name: "Brightmeter", basis: "said_in_post" });
    expect(by("hn:99000105").company!.domain).toBeUndefined();
    expect(by("github:fixture-meterbook/meterbook-node#412").company).toMatchObject({ domain: "fernwick.example", basis: "profile" });
    expect(by("github:fixture-closewise/closewise-cli#88").company).toMatchObject({ domain: "lumenwire.example" });
    expect(by("hn:99000101").quote).toMatch(/^We bill per API call\./);

    // The post is now dated evidence and a signal on the account, as its why now.
    const quayside = ws.accounts["quayside.example"];
    const sig = quayside.signals.find((s) => s.id === signalIdFor(by("hn:99000103").id))!;
    expect(sig).toMatchObject({ type: "public_pain", strength: 3, usableInOutreach: true, url: "https://news.ycombinator.com/item?id=99000103" });
    expect(ws.evidence[sig.evidenceId!]).toMatchObject({ sourceType: "community", host: "news.ycombinator.com", quote: by("hn:99000103").quote });
    expect(quayside.whyNowScore).toBeGreaterThan(0);
    expect(result.attached.sort()).toEqual(["fernwick.example", "lumenwire.example", "quayside.example"]);

    const scan = state.scans[0];
    expect(scan).toMatchObject({ judged: 12, reused: 0, kept: 10, added: 10, costUsd: 0.0004 });
    expect(scan.requests.hn).toEqual({ made: 6, cached: 0, failed: 0 });
    expect(scan.requests.stackexchange).toEqual({ made: 6, cached: 0, failed: 0 });
    expect(scan.requests.github).toEqual({ made: 3, cached: 0, failed: 0 });
    expect(scan.skipped.map((s) => s.source).sort()).toEqual(["bluesky", "reddit"]);
    expect(readAutomation().receipts.filter((r) => r.kind === "fetch").map((r) => [r.provider, r.requests, r.costUsd]).sort()).toEqual([
      ["GitHub", 3, 0],
      ["Hacker News", 6, 0],
      ["Stack Exchange", 6, 0],
    ]);
  });

  it("costs nothing the second time: every request and every verdict comes from the cache", async () => {
    const requested = serve();
    await runIntentScan(context({ mode: "asks" }));
    const first = requested.length;
    const calls: { content: string }[] = [];
    const again = await runIntentScan(context({ mode: "asks" }, calls));
    expect(calls).toHaveLength(0);
    expect(again).toMatchObject({ added: 0, judged: 0, costUsd: 0 });
    expect(requested.length).toBe(first);
    expect(readWorkspace().intent!.scans[0].requests.hn).toEqual({ made: 0, cached: 6, failed: 0 });
  });
});

describe("the founder's decisions", () => {
  const post = (body: unknown) => POST(new Request("http://localhost:3000/api/intent", { method: "POST", body: JSON.stringify(body) }));

  it("Not relevant hides the thread, takes its signal off the account and teaches the query builder; undo restores it", async () => {
    serve();
    await runIntentScan(context({ mode: "asks" }));
    const item = readWorkspace().intent!.items.find((i) => i.key === "hn:99000103")!;
    const res = await post({ action: "dismiss", id: item.id });
    expect(res.status).toBe(200);
    const { removed } = await res.json();
    let ws = readWorkspace();
    // 103 and 104 are comments in the same thread.
    expect(removed.map((i: { key: string }) => i.key).sort()).toEqual(["hn:99000103", "hn:99000104"]);
    expect(ws.intent!.items.some((i) => i.thread === item.thread)).toBe(false);
    expect(ws.intent!.dismissed[0].thread).toBe(item.thread);
    expect(ws.intent!.feedback[item.queryKey].misses).toBe(1);
    expect(ws.accounts["quayside.example"].signals.some((s) => s.id === signalIdFor(item.id))).toBe(false);
    expect(ws.evidence[`ev_${item.id}`]).toBeUndefined();

    expect((await post({ action: "undo_dismiss", items: removed })).status).toBe(200);
    ws = readWorkspace();
    expect(ws.intent!.items.some((i) => i.id === item.id)).toBe(true);
    expect(ws.intent!.dismissed).toEqual([]);
    // Its signal goes back on the account too.
    expect(ws.accounts["quayside.example"].signals.some((s) => s.id === signalIdFor(item.id))).toBe(true);
  });

  it("Track company creates the account with the post as evidence and a dated signal, and refuses what it can't place", async () => {
    serve();
    await runIntentScan(context({ mode: "asks" }));
    const items = readWorkspace().intent!.items;
    const pebble = items.find((i) => i.key === "hn:99000102")!;
    const res = await post({ action: "track", id: pebble.id });
    expect(await res.json()).toEqual({ domain: "pebblecart.example", created: true });
    const ws = readWorkspace();
    const acc = ws.accounts["pebblecart.example"];
    expect(acc).toMatchObject({ status: "tracked", watch: true, source: "community", sourceDetail: "Hacker News · asking for a tool", sourceUrl: pebble.url });
    expect(acc.signals[0]).toMatchObject({ type: "community_request", date: pebble.postedAt!.slice(0, 10) });
    expect(ws.intent!.items.find((i) => i.id === pebble.id)!.trackedDomain).toBe("pebblecart.example");
    expect(ws.intent!.feedback[pebble.queryKey].hits).toBe(1);

    const unplaced = items.find((i) => i.key === "hn:99000101")!;
    const refused = await post({ action: "track", id: unplaced.id });
    expect(refused.status).toBe(400);
    expect((await refused.json()).error).toMatch(/don't know this company's website/);
  });

  it("brings a retired query back, and shows the plan before anything runs", async () => {
    await mutateWorkspace((ws) => {
      ws.intent = { version: 1, items: [], dismissed: [], scans: [], feedback: { 'hn:"usage export"': { hits: 0, misses: 3 } } };
    });
    let body = await (await GET()).json();
    expect(body.retired.map((q: { key: string }) => q.key)).toEqual(['hn:"usage export"']);
    expect(body.canScan).toEqual({ ok: true });
    expect(body.sources.map((s: { id: string; state: string }) => `${s.id}:${s.state}`)).toEqual(["hn:ready", "stackexchange:ready", "github:ready", "reddit:setup", "bluesky:off"]);
    await post({ action: "retry_query", key: 'hn:"usage export"' });
    body = await (await GET()).json();
    expect(body.retired).toEqual([]);
  });
});

describe("the developer radar", () => {
  it("places active people at companies from their profiles, leaving out the maintainers and anyone it can't place", async () => {
    serve();
    const events: AgentEvent[] = [];
    const r = await runRadarScan(context({ mode: "radar", repos: ["https://github.com/fixture-meterbook/meterbook-node"] }, [], events));
    const radar = readWorkspace().intent!.radar!;
    expect(radar.repos[0]).toMatchObject({ full: "fixture-meterbook/meterbook-node", stars: 2140 });
    expect(radar.repos[0].starsLast30).toBeGreaterThan(0);
    // Forks, issues and comments from 8 people; the maintainer (MEMBER) and bots are out.
    expect(radar.people.map((p) => p.login).sort()).toEqual(["fixture-aamaro", "fixture-hollowpine", "fixture-jfrost", "fixture-kbello", "fixture-rkapoor", "fixture-squreshi", "fixture-tbaird", "fixture-wliu"]);
    expect(radar.companies.map((c) => [c.domain, c.logins.length])).toEqual([
      ["fernwick.example", 3],
      ["pebblecart.example", 1],
      ["driftglass.example", 1],
      ["hollowpine.example", 1],
    ]);
    expect(radar.companies[0].line).toBe("3 people at Fernwick engaged with fixture-meterbook/meterbook-node in the last 30 days: 1 fork, 1 issue, 1 comment.");
    expect(radar.totals).toMatchObject({ engaged: 8, placed: 6, withToken: false });
    expect(r).toMatchObject({ companies: 4, people: 8, placed: 6 });

    const res = await POST(new Request("http://localhost:3000/api/intent", { method: "POST", body: JSON.stringify({ action: "track_radar", domain: "fernwick.example" }) }));
    expect(await res.json()).toEqual({ domain: "fernwick.example", created: false });
    const fernwick = readWorkspace().accounts["fernwick.example"];
    const sig = fernwick.signals.find((s) => s.id.startsWith("sig_rad_"))!;
    // Watching what engineers fork is context, never an outreach line.
    expect(sig).toMatchObject({ type: "stack_change", strength: 1, usableInOutreach: false });
    expect(fernwick.whyNow).not.toContain("engineers");
  });
});
