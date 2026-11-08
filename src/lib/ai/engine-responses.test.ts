import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { writeSettings } from "@/lib/store/settings";
import { AgentError, defineTool, runAgent } from "./engine";
import type { AgentEvent } from "./events";
import { REASONING_EFFORTS } from "./reasoning";

vi.mock("@/lib/search/pages", () => ({ readResearchPage: vi.fn(async () => ({ url: "https://acme.com", title: "Acme", text: "Acme sells planning software." })) }));

type Json = Record<string, unknown>;
const submitted = z.object({ headline: z.string() });
const submit = defineTool({ name: "submit_plan", description: "Submit a plan", schema: submitted, terminal: true });
const call = (id: string, name: string, args: unknown): Json => ({ type: "function_call", id: `fc_${id}`, call_id: `call_${id}`, name, arguments: JSON.stringify(args), status: "completed" });
const reasoning = { type: "reasoning", id: "rs_1", summary: [], encrypted_content: "opaque-encrypted-reasoning" };

function stream(output: Json[], status = "completed", extra: Json[] = []) {
  const response = { status, model: "gpt-6-luna", output, usage: { input_tokens: 100, input_tokens_details: { cached_tokens: 20 }, output_tokens: 35 }, ...(status === "incomplete" ? { incomplete_details: { reason: "max_output_tokens" } } : {}) };
  return new Response([...extra, { type: `response.${status}`, response }].map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
}

beforeEach(() => {
  vi.stubEnv("OPENAI_API_KEY", "sk-proj-test-not-a-real-key");
  vi.stubEnv("OPENAI_BASE_URL", "http://127.0.0.1:9/v1");
  writeSettings({ ai: { provider: "openai", model: "gpt-6-luna", available: ["gpt-6-luna"] }, search: { provider: "off" } });
});

describe("OpenAI reasoning and Responses tool calling", () => {
  it.each(REASONING_EFFORTS)("sends the selected %s effort exactly, overriding the task preset", async (effort) => {
    writeSettings({ ai: { provider: "openai", model: "gpt-6-luna", reasoningEffort: effort } });
    const requests: { url: string; body: Json }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url, init) => {
      requests.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return stream([call("submit", "submit_plan", { headline: "A plan" })]);
    }));
    const out = await runAgent({ system: "Help with GTM", messages: [{ role: "user", content: "Plan" }], tools: [submit], requireTerminal: true, effort: "low", emit: () => {} });
    expect(out.result).toEqual({ headline: "A plan" });
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe("http://127.0.0.1:9/v1/responses");
    expect(requests[0].body).toMatchObject({ store: false, reasoning: { effort }, tools: [{ type: "function", name: "submit_plan", strict: false }] });
    expect(requests[0].body).not.toHaveProperty("reasoning_effort");
    expect(out.usage).toMatchObject({ inputTokens: 80, cacheReadTokens: 20, outputTokens: 35 });
  });

  it("keeps native encrypted reasoning and tool results between app-tool rounds", async () => {
    const requests: Json[] = [];
    const events: AgentEvent[] = [];
    const lookup = vi.fn(() => "Acme: 40 people");
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      requests.push(JSON.parse(String(init?.body)));
      if (requests.length === 1) return stream([reasoning, call("lookup", "look_up", { domain: "acme.com" })], "completed", [
        { type: "response.reasoning_summary_text.delta", delta: "Checking the company." },
        { type: "response.output_item.added", item: { id: "fc_lookup", type: "function_call", name: "look_up" } },
        { type: "response.function_call_arguments.delta", item_id: "fc_lookup", delta: '{"domain":"acme.com"}' },
      ]);
      return stream([call("submit", "submit_plan", { headline: "Contact Acme" })]);
    }));
    const out = await runAgent({ system: "Plan GTM", messages: [{ role: "user", content: "Research Acme" }], tools: [
      defineTool({ name: "look_up", description: "Read a company", schema: z.object({ domain: z.string() }), run: lookup }), submit,
    ], effort: "xhigh", requireTerminal: true, emit: (e) => events.push(e) });
    expect(out.result).toEqual({ headline: "Contact Acme" });
    expect(lookup).toHaveBeenCalledOnce();
    expect(requests[1].reasoning).toMatchObject({ effort: "xhigh" });
    expect(requests[1].input).toEqual([
      { role: "user", content: "Research Acme" }, reasoning,
      call("lookup", "look_up", { domain: "acme.com" }),
      { type: "function_call_output", call_id: "call_lookup", output: "Acme: 40 people" },
    ]);
    expect(events.some((e) => e.type === "thinking" && e.text === "Checking the company.")).toBe(true);
    // Opaque native state lives only for this run, outside the persisted Ask conversation.
    expect(JSON.stringify(out.messages)).not.toContain("opaque-encrypted-reasoning");
  });

  it("discards an incomplete tool call and retries with more room before executing tools", async () => {
    const lookup = vi.fn(() => "Should not run");
    const requests: Json[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      requests.push(JSON.parse(String(init?.body)));
      return requests.length === 1
        ? stream([reasoning, call("partial", "look_up", { domain: "acme.com" })], "incomplete")
        : stream([call("submit", "submit_plan", { headline: "Finished" })]);
    }));
    const out = await runAgent({ system: "Plan", messages: [{ role: "user", content: "Plan" }], maxTokens: 1000,
      tools: [defineTool({ name: "look_up", description: "Lookup", schema: z.object({ domain: z.string() }), run: lookup }), submit], requireTerminal: true, emit: () => {} });
    expect(out.result).toEqual({ headline: "Finished" });
    expect(lookup).not.toHaveBeenCalled();
    expect(requests.map((r) => r.max_output_tokens)).toEqual([1000, 2000]);
    expect(JSON.stringify(requests[1].input)).not.toContain("call_partial");
  });

  it("preserves reasoning and original call IDs through web rounds and subsequent app tools", async () => {
    const requests: Json[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      requests.push(JSON.parse(String(init?.body)));
      if (requests.length === 1) return stream([reasoning, call("web", "web_fetch", { url: "https://acme.com" })]);
      if (requests.length === 2) return stream([call("lookup", "look_up", { domain: "acme.com" })]);
      return stream([call("submit", "submit_plan", { headline: "Contact Acme" })]);
    }));
    const out = await runAgent({ system: "Research", messages: [{ role: "user", content: "Research Acme" }], webFetch: 1, tools: [
      defineTool({ name: "look_up", description: "Lookup", schema: z.object({ domain: z.string() }), run: () => "A customer" }), submit,
    ], requireTerminal: true, effort: "high", emit: () => {} });
    expect(out.result).toEqual({ headline: "Contact Acme" });
    expect(requests).toHaveLength(3);
    const last = requests[2].input as Json[];
    expect(last.map((item) => item.type ?? item.role)).toEqual(["user", "reasoning", "function_call", "function_call_output", "function_call", "function_call_output"]);
    expect(last[3]).toMatchObject({ call_id: "call_web", output: expect.stringContaining("Acme sells planning software.") });
    expect(last[5]).toEqual({ type: "function_call_output", call_id: "call_lookup", output: "A customer" });
    expect(JSON.stringify(last)).not.toContain("No result:");
    expect(out.usage.webFetches).toBe(1);
  });

  it("fails an interrupted stream without executing its partially streamed tool", async () => {
    const lookup = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => new Response('data: {"type":"response.output_item.added","item":{"id":"fc_1","type":"function_call","name":"look_up"}}\n\n')));
    await expect(runAgent({ system: "Plan", messages: [{ role: "user", content: "Plan" }], tools: [defineTool({ name: "look_up", description: "Lookup", schema: z.object({}), run: lookup })], emit: () => {} })).rejects.toMatchObject({ code: "network" });
    expect(lookup).not.toHaveBeenCalled();
  });

  it("reports a rejected effort without retrying at a different effort", async () => {
    writeSettings({ ai: { provider: "openai", model: "gpt-6-luna", reasoningEffort: "max" } });
    const fetch = vi.fn(async () => Response.json({ error: { code: "unsupported_value", message: "Unsupported reasoning effort: max" } }, { status: 400 }));
    vi.stubGlobal("fetch", fetch);
    const error = await runAgent({ system: "Plan", messages: [{ role: "user", content: "Plan" }], emit: () => {} }).catch((e) => e);
    expect(error).toBeInstanceOf(AgentError);
    expect(error).toMatchObject({ code: "bad_request", detail: expect.stringContaining("Unsupported reasoning effort: max") });
    expect(fetch).toHaveBeenCalledOnce();
  });
});
