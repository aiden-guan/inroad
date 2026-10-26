import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { seenWebUrls } from "@/lib/deals/ledger";
import { startMock, type MockServer } from "@/test/mock-anthropic";
import { AgentError, defineTool, runAgent, type RunOptions } from "./engine";
import type { AgentEvent } from "./events";
import { anthropicSafe, EMULATED } from "./openai-compat";

/**
 * The same agent loop on an OpenAI-compatible provider: scripts/mock-anthropic.mjs answers Chat Completions
 * (POST /v1/chat/completions) from the same per-workflow playbooks, and fakes Firecrawl's web search.
 */

let mock: MockServer;
const ENV = ["INROAD_AI_PROVIDER", "INROAD_AI_MODEL", "OPENAI_BASE_URL", "OPENAI_API_KEY", "FIRECRAWL_API_URL", "FIRECRAWL_API_KEY"];

beforeAll(async () => {
  mock = await startMock();
  process.env.INROAD_AI_PROVIDER = "openai";
  process.env.INROAD_AI_MODEL = "mock-large";
  process.env.OPENAI_BASE_URL = `${mock.url}/v1`;
  process.env.OPENAI_API_KEY = "sk-proj-mockmockmockmockmock";
  process.env.FIRECRAWL_API_URL = mock.url;
  process.env.FIRECRAWL_API_KEY = "fc-mocktestkey";
});

afterAll(() => {
  mock?.stop();
  for (const name of ENV) delete process.env[name];
});

beforeEach(async () => {
  await mock.reset();
  process.env.INROAD_AI_MODEL = "mock-large";
  process.env.FIRECRAWL_API_KEY = "fc-mocktestkey";
});

interface ChatRequest {
  api?: string;
  model: string;
  tools: string[];
  streamUsage: boolean;
  effort: string | null;
  maxTokens: number | null;
  status?: number;
}
const chatRequests = async () => ((await mock.requests()) as unknown as ChatRequest[]).filter((r) => r.api === "chat");

async function run<T>(opts: Omit<RunOptions, "emit">) {
  const events: AgentEvent[] = [];
  const out = await runAgent<T>({ ...opts, emit: (e) => events.push(e) });
  return { ...out, events, of: <K extends AgentEvent["type"]>(type: K) => events.filter((e): e is Extract<AgentEvent, { type: K }> => e.type === type) };
}

const plan = z.object({ headline: z.string().max(120), steps: z.array(z.string()).max(4) });
const lookups: string[] = [];
const tools = [
  defineTool({ name: "look_up", description: "Look up a company in the workspace", schema: z.object({ domain: z.string() }), run: ({ domain }) => (lookups.push(domain), `${domain}: 40 people, Series A`) }),
  defineTool({ name: "submit_plan", description: "Submit the plan", schema: plan, terminal: true }),
];

describe("a run on an OpenAI-compatible provider", () => {
  it("ends in a validated submit, with usage, the model that ran, and no price claimed", async () => {
    const out = await run<z.infer<typeof plan>>({ system: ["You are Inroad."], messages: [{ role: "user", content: "Plan outreach for acme.com" }], tools, requireTerminal: true, effort: "low" });
    expect(plan.safeParse(out.result).success).toBe(true);
    expect(out.modelName).toBe("mock-large");
    expect(out.unpriced).toBe(true);
    expect(out.costUsd).toBe(0);
    expect(out.usage.inputTokens + out.usage.cacheReadTokens).toBeGreaterThan(0);
    expect(out.usage.outputTokens).toBeGreaterThan(0);
    expect(out.messages.at(-1)).toMatchObject({ role: "user", content: [{ type: "tool_result", content: "Saved." }] });
    const reqs = await chatRequests();
    expect(reqs.length).toBeGreaterThan(0);
    // OpenAI's preset asks for usage at the end of the stream and passes the effort on.
    expect(reqs[0]).toMatchObject({ model: "mock-large", streamUsage: true, effort: "low" });
    expect(out.of("writing").length + out.of("status").length).toBeGreaterThan(0);
  });

  it("searches the web through Firecrawl and records it where Anthropic would, so citations work unchanged", async () => {
    const out = await run({ system: ["You are Inroad."], messages: [{ role: "user", content: "Research northwind.io (northwind.io) for outreach" }], tools, requireTerminal: true, webSearch: 2 });
    expect(out.of("search").length).toBe(1);
    const sources = out.of("sources").flatMap((e) => e.sources);
    expect(sources.some((s) => s.host === "techcrunch.com")).toBe(true);
    const blocks = out.messages.filter((m) => m.role === "assistant").flatMap((m) => (Array.isArray(m.content) ? m.content : [])) as { type: string; id?: string; tool_use_id?: string }[];
    const call = blocks.find((b) => b.type === "server_tool_use");
    expect(call?.id?.startsWith(EMULATED)).toBe(true);
    expect(blocks.some((b) => b.type === "web_search_tool_result" && b.tool_use_id === call?.id)).toBe(true);
    expect([...seenWebUrls(out.messages)].some((u) => u.includes("techcrunch.com"))).toBe(true);
    expect(out.usage.webSearches).toBe(1);
    // The same conversation can move to Anthropic: its search becomes text there.
    expect(JSON.stringify(anthropicSafe(out.messages))).not.toContain(EMULATED);
  });

  it("offers no search without a Firecrawl key, and still finishes", async () => {
    delete process.env.FIRECRAWL_API_KEY;
    const out = await run({ system: ["You are Inroad."], messages: [{ role: "user", content: "Research acme.com" }], tools, requireTerminal: true, webSearch: 2 });
    expect(out.result).toBeDefined();
    expect((await chatRequests()).every((r) => !r.tools.includes("web_search"))).toBe(true);
  });

  it("drops the optional fields a strict endpoint rejects, one at a time, and finishes", async () => {
    process.env.INROAD_AI_MODEL = "mock-strictparams";
    const out = await run({ system: ["You are Inroad."], messages: [{ role: "user", content: "Plan outreach for acme.com" }], tools, requireTerminal: true, effort: "high", maxTokens: 4000 });
    expect(out.result).toBeDefined();
    const reqs = await chatRequests();
    expect(reqs.filter((r) => r.status === 400).length).toBe(3);
    const ok = reqs.find((r) => r.status === 200)!;
    expect(ok).toMatchObject({ streamUsage: false, effort: null, maxTokens: 4000 });
  });

  it("says what went wrong in plain words, naming the provider", async () => {
    await mock.fault({ type: "credit" });
    const err = await run({ system: ["x"], messages: [{ role: "user", content: "hi" }] }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AgentError);
    expect((err as AgentError).code).toBe("no_credit");
    expect((err as AgentError).message).toMatch(/OpenAI account is out of credits/);
    expect((err as AgentError).detail).toMatch(/insufficient_quota/);
  });

  it("runs app tools and feeds their results back", async () => {
    lookups.length = 0;
    const out = await run({ system: ["You are Inroad."], messages: [{ role: "user", content: "Add northwind.io and log it" }], tools: [tools[0]] });
    expect(lookups.length).toBe(1);
    expect(out.text).toMatch(/updated your workspace/);
  });
});
