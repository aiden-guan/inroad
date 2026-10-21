import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AgentError, defineTool, runAgent, type RunOptions } from "./engine";
import type { AgentEvent } from "./events";

/**
 * The agent loop against scripts/mock-anthropic.mjs, which speaks the real streaming wire format
 * (thinking → web search → web fetch → tool call). Nothing leaves this machine. A spy on fetch
 * records each request the engine sends, so the tests can check what reaches the API too.
 */

const MOCK = fileURLToPath(new URL("../../../scripts/mock-anthropic.mjs", import.meta.url));
let mock: ChildProcess;
const mockLog: string[] = [];

async function freePort(): Promise<number> {
  const srv = net.createServer();
  await new Promise<void>((resolve) => srv.listen(0, "127.0.0.1", resolve));
  const { port } = srv.address() as net.AddressInfo;
  await new Promise((resolve) => srv.close(resolve));
  return port;
}

beforeAll(async () => {
  const port = await freePort();
  mock = spawn(process.execPath, [MOCK], { env: { ...process.env, MOCK_PORT: String(port), MOCK_DELAY: "0" }, stdio: ["ignore", "pipe", "pipe"] });
  // Its error log (the 400 below is on purpose) stays out of the test output.
  mock.stderr!.on("data", (chunk: Buffer) => mockLog.push(chunk.toString().trim()));
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("mock Anthropic server did not start")), 10_000);
    mock.once("exit", (code) => reject(new Error(`mock Anthropic server exited (${code})`)));
    mock.stdout!.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString().split("\n")) if (line.trim()) mockLog.push(line);
      if (mockLog.some((l) => l.includes("listening"))) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${port}`;
  process.env.ANTHROPIC_API_KEY = "mock";
});

afterAll(() => {
  mock?.kill();
});

interface SentRequest {
  headers: Headers;
  body: Record<string, unknown> & { model: string; system: { text: string; cache_control?: unknown }[]; tools?: Record<string, unknown>[]; messages: { role: string; content: unknown }[] };
}
let sent: SentRequest[];

beforeEach(() => {
  sent = [];
  mockLog.length = 0;
  const real = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    sent.push({ headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
    return real(input, init);
  });
});

/** Runs the agent and collects every event it emitted. */
async function run<T>(opts: Omit<RunOptions, "emit">) {
  const events: AgentEvent[] = [];
  const out = await runAgent<T>({ ...opts, emit: (e) => events.push(e) });
  return { ...out, events, of: <K extends AgentEvent["type"]>(type: K) => events.filter((e): e is Extract<AgentEvent, { type: K }> => e.type === type) };
}

const submitPlan = defineTool({
  name: "submit_plan",
  description: "Submit the outreach plan.",
  terminal: true,
  schema: z.object({
    headline: z.string().max(200).describe("One line"),
    score: z.number().min(0).max(100),
    steps: z.array(z.string()).max(5),
    url: z.string(),
  }),
});

describe("runAgent with a terminal tool", () => {
  it("streams the work and returns the validated tool input as the result", async () => {
    const r = await run<z.infer<typeof submitPlan.schema>>({
      system: ["Core rules", "Workflow rules", "Company context"],
      messages: [{ role: "user", content: "Plan outreach for Acme" }],
      tools: [submitPlan],
      webSearch: 3,
      webFetch: 2,
    });
    expect(r.result).toEqual({ headline: "Mock headline", score: 78, steps: ["Mock steps1", "Mock steps2", "Mock steps3"], url: "https://example.com" });
    expect(r.stopReason).toBe("tool_use");
    expect(r.of("thinking").map((e) => e.text)).toEqual(["Reviewing what the founder asked for.", "Checking public sources before drafting."]);
    expect(r.of("search")).toEqual([{ type: "search", query: "Plan outreach for Acme funding news 2026" }]);
    expect(r.of("sources")[0].sources.map((s) => s.host)).toEqual(["techcrunch.com", "jobs.ashbyhq.com", "forbes.com"]);
    expect(r.of("read")).toEqual([{ type: "read", url: "https://example.com", host: "example.com" }]);
    expect(r.of("status")).toEqual([{ type: "status", text: "Writing it up" }]);
    expect(r.of("writing").at(-1)?.chars).toBeGreaterThan(0);
    // One turn: 100 input and 420 output tokens on Sonnet ($2 / $10 per million).
    expect(r.usage).toMatchObject({ inputTokens: 100, outputTokens: 420, cacheReadTokens: 0, webSearches: 0 });
    expect(r.costUsd).toBeCloseTo(0.0044, 10);
    expect(r.events.at(-1)).toEqual({ type: "usage", costUsd: r.costUsd, model: "operator" });
    expect(r.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(r.messages[2].content).toEqual([expect.objectContaining({ type: "tool_result", content: "Saved." })]);
    expect(sent).toHaveLength(1);
  });

  it("sends a strict, cache-friendly request to the routed model", async () => {
    await run({ system: ["Core rules", "Workflow rules", "Company context"], messages: [{ role: "user", content: "Plan" }], tools: [submitPlan], webSearch: 3, webFetch: 2, effort: "high" });
    const { body, headers } = sent[0];
    expect(body.model).toBe("claude-sonnet-5-5");
    expect(body).toMatchObject({ cache_control: { type: "ephemeral" }, output_config: { effort: "high" }, thinking: { type: "adaptive", display: "summarized", block_binding: { prefix_mismatch_behavior: "drop_block" } } });
    // The last system block is cached, and with three blocks the one before it too.
    expect(body.system.map((b) => !!b.cache_control)).toEqual([false, true, true]);
    const [tool, search, fetchTool] = body.tools!;
    expect(tool).toMatchObject({ name: "submit_plan", strict: true });
    const props = (tool.input_schema as { properties: Record<string, Record<string, unknown>> }).properties;
    // Size constraints move into the description (zod enforces them afterwards).
    expect(props.score).toEqual({ type: "number", description: "(minimum 0, maximum 100)" });
    expect(props.headline).toEqual({ type: "string", description: 'One line (maxLength 200)' });
    expect(props.steps).toMatchObject({ type: "array", description: "(maxItems 5)" });
    expect(search).toEqual({ type: "web_search_20260209", name: "web_search", max_uses: 3 });
    expect(fetchTool).toEqual({ type: "web_fetch_20260209", name: "web_fetch", max_uses: 2 });
    expect(headers.get("anthropic-beta")).toContain("server-side-fallback-2026-07-01");
    expect(body.fallbacks).toBe("default");
  });

  it("routes the fast tier to Haiku with the basic web tools and no fallback beta", async () => {
    await run({ tier: "fast", system: "Classify.", messages: [{ role: "user", content: "Plan" }], tools: [submitPlan], webSearch: 1, effort: "low" });
    const { body, headers } = sent[0];
    expect(body.model).toBe("claude-haiku-5-5");
    expect(body.tools?.[1]).toEqual({ type: "web_search_20250305", name: "web_search", max_uses: 1 });
    expect(headers.get("anthropic-beta")).toBe("thinking-binding-controls-2026-08-01");
    expect(body).not.toHaveProperty("fallbacks");
    expect(body.system).toEqual([{ type: "text", text: "Classify.", cache_control: { type: "ephemeral" } }]);
  });

  it("returns invalid tool input to the model to fix instead of accepting it", async () => {
    const strict = defineTool({ name: "submit_plan", description: "Submit.", terminal: true, schema: z.object({ headline: z.string().min(50) }) });
    const r = await run({ system: "Rules", messages: [{ role: "user", content: "Plan" }], tools: [strict] });
    expect(r.result).toBeUndefined();
    expect(sent).toHaveLength(2);
    const feedback = (sent[1].body.messages.at(-1)!.content as { is_error?: boolean; content: string }[])[0];
    expect(feedback.is_error).toBe(true);
    expect(feedback.content).toMatch(/^Invalid input\. Fix these fields and call submit_plan again: headline: /);
  });
});

describe("runAgent with app tools", () => {
  it("runs the tool, sends its result back, and keeps only the answer after the last call", async () => {
    const calls: unknown[] = [];
    const addNote = defineTool({
      name: "add_note",
      description: "Add a note to the account.",
      schema: z.object({ text: z.string() }),
      label: (input) => `Adding “${input.text}”`,
      run: async (input) => {
        calls.push(input);
        return "Note saved";
      },
    });
    const r = await run({ system: "Rules", messages: [{ role: "user", content: "Please add a note about Acme" }], tools: [addNote] });
    expect(calls).toEqual([{ text: "Mock text" }]);
    expect(r.result).toBeUndefined();
    expect(r.stopReason).toBe("end_turn");
    expect(r.of("action")).toEqual([{ type: "action", text: "Adding “Mock text”" }]);
    // The narration before the tool call is wiped from the live answer.
    const reset = r.events.findIndex((e) => e.type === "text_reset");
    expect(r.events[reset]).toEqual({ type: "text_reset", text: "" });
    const after = r.events.slice(reset).filter((e): e is Extract<AgentEvent, { type: "text" }> => e.type === "text").map((e) => e.text).join("");
    expect(after).toBe("Done — I've updated your workspace. Anything else you want me to take on?");
    expect(r.text).toBe(`Let me check your workspace first. ${after}`);
    expect(sent[0].body.tools?.[0]).toMatchObject({ name: "add_note", eager_input_streaming: true });
    expect(sent[0].body.tools?.[0]).not.toHaveProperty("strict");
    expect(sent[1].body.messages.at(-1)!.content).toEqual([expect.objectContaining({ type: "tool_result", content: "Note saved" })]);
    expect(r.messages).toHaveLength(4);
    expect(r.usage.outputTokens).toBe(840);
  });

  it("reports a tool that throws as a tool error the model can see", async () => {
    const failing = defineTool({
      name: "log_call",
      description: "Log a call.",
      schema: z.object({ summary: z.string() }),
      run: () => {
        throw new Error("CRM is down");
      },
    });
    await run({ system: "Rules", messages: [{ role: "user", content: "Log the call with Ana" }], tools: [failing] });
    expect(sent[1].body.messages.at(-1)!.content).toEqual([expect.objectContaining({ type: "tool_result", is_error: true, content: "CRM is down" })]);
  });

  it("nudges once for the final output when a run must end in a tool call", async () => {
    const r = await run({ system: "Rules", messages: [{ role: "user", content: "Summarize Acme" }], tools: [], requireTerminal: true });
    expect(sent).toHaveLength(2);
    expect(sent[1].body.messages.at(-1)).toEqual({ role: "user", content: "Now call the submit tool with your final output. Do not reply in plain text." });
    expect(r.result).toBeUndefined();
    expect(r.text).toContain("Here's my take on");
  });
});

describe("runAgent failures", () => {
  it("retries once without optional features when the API rejects the request, then reports it", async () => {
    // The mock answers 400 to an empty conversation.
    const err = await run({ system: "Rules", messages: [], tools: [submitPlan] }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AgentError);
    expect(err).toMatchObject({ code: "bad_request", usage: { inputTokens: 0, outputTokens: 0 }, costUsd: 0 });
    expect(sent).toHaveLength(2);
    expect(sent[0].headers.get("anthropic-beta")).toBeTruthy();
    // Compat mode: no betas, no thinking block binding, no strict tool schemas.
    expect(sent[1].headers.get("anthropic-beta")).toBeNull();
    expect(sent[1].body.thinking).toEqual({ type: "adaptive", display: "summarized" });
    expect(sent[1].body.tools?.[0]).not.toHaveProperty("strict");
  });

  it("stops before calling the API once the run is cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(run({ system: "Rules", messages: [{ role: "user", content: "Plan" }], signal: controller.signal })).rejects.toMatchObject({ code: "stopped" });
    expect(sent).toHaveLength(0);
  });

  it("asks for an API key when none is configured", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    await expect(run({ system: "Rules", messages: [{ role: "user", content: "Plan" }] })).rejects.toMatchObject({ code: "no_key" });
    expect(sent).toHaveLength(0);
  });
});
