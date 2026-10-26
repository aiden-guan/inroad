import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { ActiveProvider } from "./client";
import { anthropicSafe, chatSchema, chatTool, droppable, EMULATED, ProviderHttpError, toChatMessages, toolIdFor, toProviderError } from "./openai-compat";
import { providerById } from "./providers";

/**
 * The translation between the engine's Anthropic-shaped conversations and Chat Completions. Every provider
 * rejects a conversation whose tool calls and tool results don't pair up, so these tests pin the pairing.
 */

type Msg = Anthropic.Beta.BetaMessageParam;
const m = (role: string, content: unknown) => ({ role, content }) as unknown as Msg;

const openai: ActiveProvider = {
  preset: providerById("openai")!,
  id: "openai",
  kind: "openai",
  name: "OpenAI",
  apiKey: "sk-proj-secretsecretsecret",
  keySource: "saved",
  baseUrl: "https://api.openai.com/v1",
  models: { strategist: "gpt-x", operator: "gpt-x", fast: "gpt-x-mini" },
  prices: {},
};

describe("Anthropic-shaped history → Chat Completions", () => {
  it("joins system blocks, pairs tool calls with their results, and drops thinking", () => {
    const out = toChatMessages(
      ["You are Inroad.", "Company: Acme."],
      [
        m("user", "Find leads."),
        m("assistant", [
          { type: "thinking", thinking: "plan", signature: "sig" },
          { type: "text", text: "Looking." },
          { type: "tool_use", id: "toolu_1", name: "add_lead", input: { domain: "a.com" } },
        ]),
        m("user", [
          { type: "tool_result", tool_use_id: "toolu_1", content: "Added." },
          { type: "text", text: "Thanks." },
        ]),
      ],
    );
    expect(out).toEqual([
      { role: "system", content: "You are Inroad.\n\nCompany: Acme." },
      { role: "user", content: "Find leads." },
      { role: "assistant", content: "Looking.", tool_calls: [{ id: "toolu_1", type: "function", function: { name: "add_lead", arguments: '{"domain":"a.com"}' } }] },
      { role: "tool", tool_call_id: "toolu_1", content: "Added." },
      { role: "user", content: "Thanks." },
    ]);
  });

  it("marks failed tool results and sends the app's mid-thread notes as labeled user text, merged with the turn", () => {
    const out = toChatMessages(
      [],
      [
        m("assistant", [{ type: "tool_use", id: "t1", name: "x", input: {} }]),
        m("user", [{ type: "tool_result", tool_use_id: "t1", is_error: true, content: [{ type: "text", text: "Bad input" }] }]),
        m("user", "What now?"),
        m("system", "Today is Monday."),
      ],
    );
    expect(out[1]).toEqual({ role: "tool", tool_call_id: "t1", content: "Error: Bad input" });
    expect(out[2]).toEqual({ role: "user", content: "What now?\n\n[Context from the app, not the founder]\nToday is Monday." });
  });

  it("turns web results into tool messages after their call, and never forwards Anthropic's encrypted search content", () => {
    const out = toChatMessages(
      [],
      [
        m("user", "Research acme.com"),
        m("assistant", [
          { type: "server_tool_use", id: "srvtoolu_1", name: "web_search", input: { query: "acme" } },
          { type: "web_search_tool_result", tool_use_id: "srvtoolu_1", content: [{ type: "web_search_result", url: "https://a.com/n", title: "Acme raises", encrypted_content: "SECRET-BLOB", page_age: null }] },
          { type: "server_tool_use", id: "srvtoolu_2", name: "code_execution", input: {} },
          { type: "text", text: "Found it." },
          { type: "tool_use", id: "toolu_9", name: "submit", input: { ok: true } },
        ]),
        m("user", [{ type: "tool_result", tool_use_id: "toolu_9", content: "Saved." }]),
      ],
    );
    expect(out.map((x) => x.role)).toEqual(["user", "assistant", "tool", "assistant", "tool"]);
    expect(out[1].tool_calls?.map((c) => c.function.name)).toEqual(["web_search"]);
    expect(out[2].content).toBe("- Acme raises | https://a.com/n");
    expect(JSON.stringify(out)).not.toContain("SECRET-BLOB");
    expect(out[3]).toMatchObject({ content: "Found it.", tool_calls: [{ id: "toolu_9" }] });
  });

  it("answers a tool call left open by a stopped run, which every provider would otherwise reject", () => {
    const out = toChatMessages([], [m("user", "Go"), m("assistant", [{ type: "tool_use", id: "t1", name: "x", input: {} }, { type: "tool_use", id: "t2", name: "y", input: {} }]), m("user", [{ type: "tool_result", tool_use_id: "t1", content: "ok" }])]);
    expect(out.slice(2)).toEqual([
      { role: "tool", tool_call_id: "t1", content: "ok" },
      { role: "tool", tool_call_id: "t2", content: "No result: the run stopped before this ran." },
    ]);
  });

  it("gives Mistral the 9-character ids it insists on, the same each time", () => {
    const idOf = toolIdFor({ id: "mistral" });
    expect(idOf("toolu_01ABCDEFGHIJ")).toMatch(/^[A-Za-z0-9]{9}$/);
    expect(idOf("toolu_01ABCDEFGHIJ")).toBe(idOf("toolu_01ABCDEFGHIJ"));
    expect(idOf("abc123XYZ")).toBe("abc123XYZ");
    expect(toolIdFor({ id: "openai" })("toolu_1")).toBe("toolu_1");
  });
});

describe("history going back to Anthropic", () => {
  it("turns web results another provider gathered into text, and leaves Anthropic's own alone", () => {
    const native = m("assistant", [
      { type: "server_tool_use", id: "srvtoolu_1", name: "web_search", input: { query: "x" } },
      { type: "web_search_tool_result", tool_use_id: "srvtoolu_1", content: [] },
    ]);
    const emulated = m("assistant", [
      { type: "text", text: "Let me look." },
      { type: "server_tool_use", id: `${EMULATED}abc`, name: "web_search", input: { query: "acme" } },
      { type: "web_search_tool_result", tool_use_id: `${EMULATED}abc`, content: [{ type: "web_search_result", url: "https://a.com", title: "Acme", text: "snippet" }] },
    ]);
    const [a, b] = anthropicSafe([native, emulated]);
    expect(a).toBe(native);
    expect(b.content).toEqual([
      { type: "text", text: "Let me look." },
      { type: "text", text: "[Web search]\n- Acme | https://a.com\n  snippet" },
    ]);
  });

  it("returns the same array when nothing came from another provider", () => {
    const msgs = [m("user", "hi")];
    expect(anthropicSafe(msgs)).toBe(msgs);
  });
});

describe("tool schemas", () => {
  it("leaves out JSON Schema keywords narrow providers reject", () => {
    const schema = chatSchema({ $schema: "x", type: "object", additionalProperties: false, properties: { kind: { const: "a", default: "a" } } });
    expect(schema).toEqual({ type: "object", properties: { kind: { enum: ["a"] } } });
  });

  it("builds a function tool from a zod schema", () => {
    const tool = chatTool("submit", "Submit it", z.object({ name: z.string().max(10), n: z.number().optional() }));
    expect(tool.function.parameters).toMatchObject({ type: "object", properties: { name: { type: "string", maxLength: 10 } }, required: ["name"] });
  });
});

describe("compat mode", () => {
  it("drops only the optional field a rejection names", () => {
    const sent = new Set(["reasoning_effort", "stream_options", "max_tokens"] as const);
    expect(droppable("Unsupported parameter: 'reasoning_effort' is not supported with this model.", new Set(sent))).toEqual(["reasoning_effort"]);
    expect(droppable("Unrecognized request argument supplied: stream_options", new Set(sent))).toEqual(["stream_options"]);
    expect(droppable("max_tokens is too large: 32000. This model supports at most 16384 completion tokens.", new Set(sent))).toEqual(["max_tokens"]);
    expect(droppable("Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.", new Set(sent))).toEqual(["token_param"]);
    expect(droppable("Extra inputs are not permitted", new Set(sent)).sort()).toEqual(["max_tokens", "reasoning_effort", "stream_options"]);
    expect(droppable("messages: role tool must follow tool_calls", new Set(sent))).toEqual([]);
  });
});

describe("provider errors in plain words", () => {
  const err = (status: number, body: Record<string, unknown>) => toProviderError(new ProviderHttpError(status, body, String((body.error as { message?: string })?.message ?? body.message ?? ""), "req_1"), openai, "gpt-x");

  it.each([
    [429, { error: { message: "You exceeded your current quota", code: "insufficient_quota" } }, "no_credit", /OpenAI account is out of credits/],
    [402, { message: "Insufficient balance" }, "no_credit", /out of credits/],
    [401, { error: { message: "Incorrect API key provided: sk-proj-secretsecretsecret" } }, "auth", /rejected your API key/],
    [403, { error: { message: "Country, region, or territory not supported" } }, "auth", /isn't available where this computer is/],
    [404, { error: { message: "The model `gpt-x` does not exist" } }, "model_unavailable", /doesn't offer gpt-x/],
    [400, { error: { message: "registry.ollama.ai/library/gemma does not support tools" } }, "model_unavailable", /can't use tools/],
    [400, { error: { message: "This model's maximum context length is 128000 tokens", code: "context_length_exceeded" } }, "context_too_long", /too much text/],
    [429, { error: { message: "Rate limit reached" } }, "rate_limit", /rate limiting/],
    [503, { error: { message: "overloaded" } }, "overloaded", /having trouble/],
    [422, { detail: "bad" }, "bad_request", /turned this request down/],
  ])("%i %j → %s", (status, body, code, text) => {
    const e = err(status, body);
    expect(e.code).toBe(code);
    expect(e.message).toMatch(text);
    expect(e.requestId).toBe("req_1");
  });

  it("never keeps the key in the details it saves for Copy details", () => {
    const e = err(401, { error: { message: "Incorrect API key provided: sk-proj-secretsecretsecret" } });
    expect(e.detail).not.toContain("secretsecret");
  });
});
