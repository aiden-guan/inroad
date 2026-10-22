import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { startMock, type MockServer } from "@/test/mock-anthropic";
import { AgentError, NO_SUBMIT_MESSAGE, compatState, defineTool, resetCompat, runAgent, type RunOptions } from "./engine";
import type { AgentEvent } from "./events";
import { costOf, requestCost } from "./models";

/**
 * The agent loop against scripts/mock-anthropic.mjs, which speaks the real streaming wire format
 * (thinking → web search → web fetch → tool call), reports usage from what each request contains and
 * fails on demand the way the API does. Nothing leaves this machine. A spy on fetch records each request
 * the engine sends, so the tests can check what reaches the API too.
 */

let mock: MockServer;

beforeAll(async () => {
  mock = await startMock();
  process.env.ANTHROPIC_BASE_URL = mock.url;
  process.env.ANTHROPIC_API_KEY = "mock";
});

afterAll(() => {
  mock?.stop();
});

const fault = (...faults: Parameters<MockServer["fault"]>) => mock.fault(...faults);

interface SentRequest {
  headers: Headers;
  body: Record<string, unknown> & { model: string; system: { text: string; cache_control?: unknown }[]; tools?: Record<string, unknown>[]; messages: { role: string; content: unknown }[] };
}
let sent: SentRequest[];

beforeEach(async () => {
  sent = [];
  // A clean mock per test (no queued faults, an empty prompt cache), and no features remembered as rejected.
  await mock.reset();
  resetCompat();
  const real = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("/v1/messages")) sent.push({ headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
    return real(input, init);
  });
});

/** Runs the agent and collects every event it emitted. */
async function run<T>(opts: Omit<RunOptions, "emit">) {
  const events: AgentEvent[] = [];
  const out = await runAgent<T>({ ...opts, emit: (e) => events.push(e) });
  return { ...out, events, of: <K extends AgentEvent["type"]>(type: K) => events.filter((e): e is Extract<AgentEvent, { type: K }> => e.type === type) };
}

const planSchema = z.object({
  headline: z.string().max(200).describe("One line"),
  score: z.number().min(0).max(100),
  steps: z.array(z.string()).max(5),
  url: z.string(),
});
type Plan = z.infer<typeof planSchema>;
const submitPlan = defineTool({ name: "submit_plan", description: "Submit the outreach plan.", terminal: true, schema: planSchema });

describe("runAgent with a terminal tool", () => {
  it("streams the work and returns the validated tool input as the result", async () => {
    const r = await run<Plan>({
      system: ["Core rules", "Workflow rules", "Company context"],
      messages: [{ role: "user", content: "Plan outreach for Acme" }],
      tools: [submitPlan],
      webSearch: 3,
      webFetch: 2,
    });
    // Schema-valid input that keeps to the caps the strict schema carries in its descriptions.
    expect(r.result).toEqual({ headline: "Hiring a first finance lead this quarter", score: 78, steps: ["Send the first email Thursday morning", "Send the first email Thursday morning"], url: "https://example.com" });
    expect(r.stopReason).toBe("tool_use");
    expect(r.of("thinking").map((e) => e.text)).toEqual(["Reading what was asked: Plan outreach for Acme.", "Checking the material I was given before writing."]);
    expect(r.of("search")).toEqual([{ type: "search", query: "Acme funding news 2026" }]);
    expect(r.of("sources")[0].sources.map((s) => s.host)).toEqual(["techcrunch.com", "jobs.ashbyhq.com", "forbes.com"]);
    expect(r.of("read")).toEqual([{ type: "read", url: "https://example.com", host: "example.com" }]);
    // The dynamic-filtering search runs code over its results before the model writes.
    expect(r.of("status")).toEqual([{ type: "status", text: "Filtering results" }, { type: "status", text: "Writing it up" }]);
    expect(r.of("writing").at(-1)?.chars).toBeGreaterThan(0);
    // One turn, billed from the usage the response reported: one search, one fetch, prompt too short to cache.
    expect(r.usage).toMatchObject({ cacheReadTokens: 0, cacheWriteTokens: 0, webSearches: 1, webFetches: 1 });
    expect(r.usage.inputTokens).toBeGreaterThan(100);
    expect(r.usage.outputTokens).toBeGreaterThan(220);
    expect(r.costUsd).toBeCloseTo(costOf("operator", r.usage), 10);
    expect(r.events.at(-1)).toEqual({ type: "usage", costUsd: r.costUsd, model: "operator" });
    expect(r.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(r.messages[2].content).toEqual([expect.objectContaining({ type: "tool_result", content: "Saved." })]);
    expect(sent).toHaveLength(1);
  });

  it("reports usage that grows with the request, and reads a repeated prefix from the cache", async () => {
    const tools = [submitPlan];
    const short = await run({ system: "Rules", messages: [{ role: "user", content: "Plan" }], tools });
    const long = await run({ system: "Rules", messages: [{ role: "user", content: `Plan ${"outreach for Acme ".repeat(400)}` }], tools });
    expect(long.usage.inputTokens + long.usage.cacheWriteTokens).toBeGreaterThan(short.usage.inputTokens + 1500);
    // A long, stable system prompt is written to the cache once, then read on the next request.
    const system = ["Core rules ".repeat(500), "Workflow rules"];
    const first = await run({ system, messages: [{ role: "user", content: "Plan for Acme" }], tools });
    const second = await run({ system, messages: [{ role: "user", content: "Plan for Northwind" }], tools });
    expect(first.usage).toMatchObject({ cacheReadTokens: 0 });
    expect(first.usage.cacheWriteTokens).toBeGreaterThan(1024);
    // The tools and system blocks come back from the cache; only the new message is written.
    expect(second.usage.cacheReadTokens).toBeGreaterThan(1024);
    expect(second.usage.cacheWriteTokens).toBeLessThan(20);
    expect(second.costUsd).toBeLessThan(first.costUsd);
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
    await fault({ type: "invalid_submit" });
    const r = await run<Plan>({ system: "Rules", messages: [{ role: "user", content: "Plan" }], tools: [submitPlan] });
    expect(sent).toHaveLength(2);
    const feedback = (sent[1].body.messages.at(-1)!.content as { is_error?: boolean; content: string }[])[0];
    expect(feedback.is_error).toBe(true);
    expect(feedback.content).toMatch(/^Invalid input\. Fix these fields and call submit_plan again: headline: /);
    // The resubmission keeps to the cap.
    expect(r.result?.headline.length).toBeLessThanOrEqual(200);
  });
});

describe("runAgent billing", () => {
  it("prices a turn a fallback model served at that model's rates, attempt by attempt", async () => {
    await fault({ type: "refusal_fallback" });
    const r = await run<Plan>({ tier: "strategist", system: "Rules", messages: [{ role: "user", content: "Plan" }], tools: [submitPlan] });
    expect(r.result).toBeDefined();
    const [served] = await mock.requests();
    const iterations = served.usage?.iterations ?? [];
    expect(iterations.map((i) => i.model)).toEqual(["claude-opus-5-5", "claude-opus-4-8"]);
    const priced = (i: (typeof iterations)[number]) => requestCost("strategist", i.model, { ...r.usage, inputTokens: i.input_tokens, outputTokens: i.output_tokens, cacheReadTokens: 0, cacheWriteTokens: 0, cacheWrite1hTokens: 0, webSearches: 0, webFetches: 0 });
    expect(r.costUsd).toBeCloseTo(priced(iterations[0]) + priced(iterations[1]), 12);
    // At Opus 5.5's own rates the same tokens would cost less: the fallback is priced as what it is.
    expect(r.costUsd).toBeGreaterThan(costOf("strategist", r.usage));
    expect(r.usage.inputTokens).toBe(iterations[0].input_tokens + iterations[1].input_tokens);
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
    expect(calls).toEqual([{ text: "Their team is hiring for the role this replaces" }]);
    expect(r.result).toBeUndefined();
    expect(r.stopReason).toBe("end_turn");
    expect(r.of("action")).toEqual([{ type: "action", text: "Adding “Their team is hiring for the role this replaces”" }]);
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
    // Two turns; the second re-sends the first, so it costs more input.
    expect(r.usage.inputTokens).toBeGreaterThan(0);
    expect(r.costUsd).toBeCloseTo(costOf("operator", r.usage), 10);
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

});

describe("runAgent when the model doesn't submit", () => {
  const plan = { system: "Rules", messages: [{ role: "user" as const, content: "Plan outreach for Acme" }], tools: [submitPlan], requireTerminal: true };

  it("nudges, retries once, and takes the submit that follows", async () => {
    await fault({ type: "no_submit", times: 2 });
    const r = await run<Plan>(plan);
    expect(r.result).toBeDefined();
    expect(sent).toHaveLength(3);
    expect(sent[1].body.messages.at(-1)).toEqual({ role: "user", content: "Now call the submit_plan tool with your final output. Do not reply in plain text." });
    expect(sent[2].body.messages.at(-1)?.content).toMatch(/^You still haven't called submit_plan\./);
    // The retry is the one the founder sees in the log (SPEC's no_submit copy).
    expect(r.of("status").map((e) => e.text)).toContain("I lost the thread on that one. Retrying.");
  });

  it("fails with no_submit after the retry, keeping what the turns cost", async () => {
    await fault({ type: "no_submit", times: 3 });
    const err = (await run(plan).catch((e: unknown) => e)) as AgentError;
    expect(err).toBeInstanceOf(AgentError);
    expect(err).toMatchObject({ code: "no_submit", message: NO_SUBMIT_MESSAGE });
    expect(sent).toHaveLength(3);
    expect(err.usage?.inputTokens).toBeGreaterThan(0);
    expect(err.costUsd).toBeGreaterThan(0);
  });

  it("returns no result instead of failing when the caller has a fallback", async () => {
    await fault({ type: "no_submit", times: 3 });
    const r = await run({ ...plan, optionalResult: true });
    expect(r.result).toBeUndefined();
    expect(r.text).toContain("Here's what I found");
  });

  it("gives a submit that keeps breaking its caps two resubmissions, then stops", async () => {
    await fault({ type: "invalid_submit", times: 5 });
    const err = await run(plan).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "no_submit" });
    // First try plus two resubmissions; the third rejection isn't sent back to be billed again.
    expect(sent).toHaveLength(3);
    const feedback = (sent[2].body.messages.at(-1)!.content as { is_error?: boolean }[])[0];
    expect(feedback.is_error).toBe(true);
  });
});

describe("runAgent retries the API's transient failures", () => {
  it("gives a turn cut off at max_tokens one more try with twice the room", async () => {
    await fault({ type: "max_tokens" });
    const r = await run<Plan>({ system: "Rules", messages: [{ role: "user", content: "Plan" }], tools: [submitPlan], maxTokens: 2000, requireTerminal: true });
    expect(r.result).toBeDefined();
    expect(sent.map((s) => s.body.max_tokens)).toEqual([2000, 4000]);
    // The cut-off attempt is dropped, not kept in the conversation.
    expect(sent[1].body.messages).toHaveLength(1);
    expect(r.of("status").map((e) => e.text)).toContain("That ran long. Giving it more room");
  });

  it("fails as truncated when the second try is cut off too", async () => {
    await fault({ type: "max_tokens", times: 2 });
    await expect(run({ system: "Rules", messages: [{ role: "user", content: "Plan" }], tools: [submitPlan], maxTokens: 2000 })).rejects.toMatchObject({ code: "truncated" });
    expect(sent).toHaveLength(2);
  });

  it("re-issues a turn the API dropped mid-stream as overloaded", async () => {
    await fault({ type: "overloaded_midstream" });
    const r = await run<Plan>({ system: "Rules", messages: [{ role: "user", content: "Plan" }], tools: [submitPlan] });
    expect(r.result).toBeDefined();
    expect(sent).toHaveLength(2);
    expect(r.of("status").map((e) => e.text)).toContain("Claude is busy. Retrying…");
  });

  it("lets the SDK retry 429 and 529 with backoff before anything fails", async () => {
    await fault({ type: "overloaded", times: 2 }, { type: "rate_limit" });
    const r = await run<Plan>({ system: "Rules", messages: [{ role: "user", content: "Plan" }], tools: [submitPlan] });
    expect(r.result).toBeDefined();
    expect((await mock.requests()).map((q) => q.status)).toEqual([529, 529, 429, 200]);
  });

  it("names an overload that outlasts the retries in plain words", async () => {
    await fault({ type: "overloaded", times: 4 });
    await expect(run({ system: "Rules", messages: [{ role: "user", content: "Plan" }], tools: [submitPlan] })).rejects.toMatchObject({ code: "overloaded", message: "Claude is overloaded right now. Try again in a moment." });
  });
});

describe("runAgent cache lifetime", () => {
  it("marks the system blocks and the conversation for an hour on bursty routes", async () => {
    const r = await run({ system: ["Core", "Workflow", "Company"], messages: [{ role: "user", content: "Screen these" }], tools: [submitPlan], cacheTtl: "1h" });
    expect(r.result).toBeDefined();
    expect(sent[0].body.system.map((b) => b.cache_control)).toEqual([undefined, { type: "ephemeral", ttl: "1h" }, { type: "ephemeral", ttl: "1h" }]);
    expect(sent[0].body.cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
  });

  it("keeps the automatic tail at 5 minutes when a message already carries a 5-minute marker", async () => {
    const r = await run({
      system: "Core",
      messages: [{ role: "user", content: [{ type: "text", text: "The bet", cache_control: { type: "ephemeral" } }] }],
      tools: [submitPlan],
      cacheTtl: "1h",
    });
    // A 1-hour tail after a 5-minute marker is a 400; the mock checks that ordering like the API.
    expect(r.result).toBeDefined();
    expect(sent[0].body.cache_control).toEqual({ type: "ephemeral" });
  });

  it("defaults to the 5-minute TTL", async () => {
    await run({ system: "Core", messages: [{ role: "user", content: "Plan" }], tools: [submitPlan] });
    expect(sent[0].body.cache_control).toEqual({ type: "ephemeral" });
    expect(sent[0].body.system[0].cache_control).toEqual({ type: "ephemeral" });
  });
});

describe("runAgent failures", () => {
  it("leaves out the betas the API rejects, says so, and starts later runs without them", async () => {
    await fault({ type: "reject_betas" });
    const r = await run<Plan>({ system: "Rules", messages: [{ role: "user", content: "Plan" }], tools: [submitPlan] });
    expect(r.result).toBeDefined();
    expect(sent).toHaveLength(2);
    expect(sent[0].headers.get("anthropic-beta")).toContain("server-side-fallback-2026-07-01");
    // Compat mode for the betas: no beta header, no fallbacks, no thinking block binding. Strict stays.
    expect(sent[1].headers.get("anthropic-beta")).toBeNull();
    expect(sent[1].body).not.toHaveProperty("fallbacks");
    expect(sent[1].body.thinking).toEqual({ type: "adaptive", display: "summarized" });
    expect(sent[1].body.tools?.[0]).toMatchObject({ strict: true });
    expect(r.compat).toEqual({ features: ["betas"], reason: expect.stringContaining("anthropic-beta") });
    // Remembered for the process: the next run doesn't send a request that's bound to fail.
    const again = await run<Plan>({ system: "Rules", messages: [{ role: "user", content: "Plan again" }], tools: [submitPlan] });
    expect(sent).toHaveLength(3);
    expect(sent[2].headers.get("anthropic-beta")).toBeNull();
    expect(again.compat?.features).toEqual(["betas"]);
    expect(compatState().map((c) => c.feature)).toEqual(["betas"]);
  });

  it("drops only strict schemas when strict is what the API rejects", async () => {
    await fault({ type: "reject_strict" });
    const r = await run<Plan>({ system: "Rules", messages: [{ role: "user", content: "Plan" }], tools: [submitPlan] });
    expect(sent).toHaveLength(2);
    expect(sent[1].body.tools?.[0]).not.toHaveProperty("strict");
    expect(sent[1].headers.get("anthropic-beta")).toContain("server-side-fallback-2026-07-01");
    // zod still checks the input.
    expect(r.result?.score).toBeLessThanOrEqual(100);
    expect(r.compat?.features).toEqual(["strict"]);
  });

  it("never retries a rejection that leaving features out can't fix", async () => {
    await fault({ type: "credit" });
    const err = await run({ system: "Rules", messages: [{ role: "user", content: "Plan" }], tools: [submitPlan] }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AgentError);
    expect(err).toMatchObject({ code: "no_credit", usage: { inputTokens: 0, outputTokens: 0 }, costUsd: 0, requestId: expect.stringMatching(/^req_mock/) });
    expect((err as AgentError).message).toMatch(/^Your Anthropic account is out of credits/);
    expect(sent).toHaveLength(1);
    expect(compatState()).toEqual([]);
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
