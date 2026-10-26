import Anthropic from "@anthropic-ai/sdk";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startMock, type MockServer } from "./mock-anthropic";

/**
 * The mock is only useful if it fails, bills and caches the way the API does, so these pin its realism:
 * the request checks Inroad's requests could trip, the error shapes the SDK turns into exceptions, and
 * the usage numbers receipts are computed from.
 */

let mock: MockServer;
let client: Anthropic;

beforeAll(async () => {
  mock = await startMock();
  client = new Anthropic({ apiKey: "mock", baseURL: mock.url, maxRetries: 0 });
});

afterAll(() => mock?.stop());

beforeEach(() => mock.reset());

const MODEL = "claude-sonnet-5-5";
const base = { model: MODEL, max_tokens: 4000, messages: [{ role: "user" as const, content: "Plan outreach for Acme" }] };
const long = (word: string) => `${word} `.repeat(1200);

async function post(body: Record<string, unknown>) {
  const res = await fetch(`${mock.url}/v1/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, requestId: res.headers.get("request-id"), body: (await res.json()) as { type: string; error?: { type: string; message: string }; usage?: Record<string, unknown>; content?: { type: string }[] } };
}

describe("the mock checks requests like the API", () => {
  it("rejects more than four cache breakpoints", async () => {
    const system = [1, 2, 3, 4].map((n) => ({ type: "text", text: `Block ${n}`, cache_control: { type: "ephemeral" } }));
    const r = await post({ ...base, system, cache_control: { type: "ephemeral" } });
    expect(r.status).toBe(400);
    expect(r.body.error).toEqual({ type: "invalid_request_error", message: "A maximum of 4 blocks with cache_control may be provided. Found 5." });
  });

  it("rejects a 1-hour breakpoint after a 5-minute one, and a tail TTL that disagrees with the top level", async () => {
    const after = await post({
      ...base,
      system: [{ type: "text", text: "Core", cache_control: { type: "ephemeral" } }],
      cache_control: { type: "ephemeral", ttl: "1h" },
    });
    expect(after.status).toBe(400);
    expect(after.body.error?.message).toMatch(/ttl='1h'.*must not come after.*ttl='5m'/);
    const tail = await post({ ...base, messages: [{ role: "user", content: [{ type: "text", text: "Plan", cache_control: { type: "ephemeral" } }] }], cache_control: { type: "ephemeral", ttl: "1h" } });
    expect(tail.status).toBe(400);
    // 1-hour markers first, then the 5-minute tail, is allowed.
    const ok = await post({ ...base, system: [{ type: "text", text: "Core", cache_control: { type: "ephemeral", ttl: "1h" } }], cache_control: { type: "ephemeral" } });
    expect(ok.status).toBe(200);
  });

  it("rejects size keywords in strict tool schemas, disabled thinking and forced tool choice", async () => {
    const strict = await post({ ...base, tools: [{ name: "submit_x", description: "x", strict: true, input_schema: { type: "object", properties: { a: { type: "string", maxLength: 5 } } } }] });
    expect(strict.body.error?.message).toBe("tools.0.custom.input_schema.properties.a.maxLength: strict mode does not support this keyword");
    expect((await post({ ...base, thinking: { type: "disabled" } })).status).toBe(400);
    expect((await post({ ...base, tool_choice: { type: "any" } })).body.error?.message).toMatch(/not supported for this model/);
    expect((await post({ ...base, messages: [] })).status).toBe(400);
  });
});

describe("failures on demand", () => {
  it("answers with the API's status, error type and message, plus a request id", async () => {
    await mock.fault({ type: "credit" }, { type: "model_unavailable" }, { type: "too_large" }, { type: "overloaded" });
    const credit = await post(base);
    expect(credit.status).toBe(400);
    expect(credit.body).toMatchObject({ type: "error", error: { type: "invalid_request_error", message: expect.stringMatching(/^Your credit balance is too low/) } });
    expect(credit.requestId).toMatch(/^req_mock/);
    expect((await post(base)).body.error).toEqual({ type: "not_found_error", message: `model: ${MODEL}` });
    expect((await post(base)).status).toBe(413);
    expect((await post(base)).status).toBe(529);
    expect((await post(base)).status).toBe(200);
  });

  it("only rejects betas when the request sends them", async () => {
    await mock.fault({ type: "reject_betas" });
    expect((await post(base)).status).toBe(200);
    await expect(client.beta.messages.create({ ...base, betas: ["server-side-fallback-2026-07-01"] })).rejects.toBeInstanceOf(Anthropic.BadRequestError);
    expect((await mock.requests()).map((r) => r.status)).toEqual([200, 400]);
  });

  it("serves a refused turn from a fallback model, with a fallback block and per-attempt usage", async () => {
    await mock.fault({ type: "refusal_fallback" });
    const msg = await client.beta.messages.stream({ ...base, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } as Anthropic.Beta.Messages.MessageCreateParamsStreaming).finalMessage();
    expect(msg.model).toBe("claude-sonnet-5");
    expect(msg.content.find((b) => b.type === "fallback")).toMatchObject({ from: { model: MODEL }, to: { model: "claude-sonnet-5" } });
    expect(msg.usage.iterations?.map((i) => [i.type, (i as { model?: string }).model])).toEqual([
      ["message", MODEL],
      ["fallback_message", "claude-sonnet-5"],
    ]);
  });

  it("pauses a server-tool loop and resumes it on the next request", async () => {
    await mock.fault({ type: "pause_turn" });
    const tools = [{ type: "web_search_20260209" as const, name: "web_search" as const, max_uses: 3 }];
    const first = await client.beta.messages.stream({ ...base, tools }).finalMessage();
    expect(first.stop_reason).toBe("pause_turn");
    expect(first.content.at(-1)?.type).toBe("server_tool_use");
    const second = await client.beta.messages.stream({ ...base, tools, messages: [...base.messages, { role: "assistant", content: first.content }] }).finalMessage();
    expect(second.content.map((b) => b.type)).toEqual(["thinking", "web_search_tool_result", "text"]);
    expect(second.usage.server_tool_use?.web_search_requests).toBe(1);
  });

  it("cuts a turn off at max_tokens, counting the reasoning it spent first", async () => {
    const msg = await client.beta.messages.stream({ ...base, max_tokens: 40, output_config: { effort: "high" } }).finalMessage();
    expect(msg.stop_reason).toBe("max_tokens");
    expect(msg.usage.output_tokens).toBe(40);
    expect(msg.content.map((b) => b.type)).toEqual(["thinking"]);
  });

  it("refuses with stop details", async () => {
    await mock.fault({ type: "refusal" });
    const msg = await client.beta.messages.stream(base).finalMessage();
    expect(msg).toMatchObject({ stop_reason: "refusal", content: [], stop_details: { type: "refusal", category: "cyber" } });
  });
});

describe("usage the mock reports", () => {
  it("writes and reads 1-hour cache entries, per model", async () => {
    const body = { ...base, system: [{ type: "text" as const, text: long("rules"), cache_control: { type: "ephemeral" as const, ttl: "1h" as const } }], cache_control: { type: "ephemeral" as const, ttl: "1h" as const } };
    const first = await client.beta.messages.stream(body).finalMessage();
    expect(first.usage.cache_creation?.ephemeral_1h_input_tokens).toBeGreaterThan(1024);
    expect(first.usage.cache_creation?.ephemeral_5m_input_tokens).toBe(0);
    const second = await client.beta.messages.stream(body).finalMessage();
    expect(second.usage.cache_read_input_tokens).toBe(first.usage.cache_creation_input_tokens);
    // Caches are model-scoped: another model starts cold.
    const haiku = await client.beta.messages.stream({ ...body, model: "claude-haiku-5-5" }).finalMessage();
    expect(haiku.usage.cache_read_input_tokens).toBe(0);
  });

  it("answers a non-streaming request with the same message as JSON", async () => {
    const r = await post({ ...base, tools: [{ name: "submit_x", description: "x", input_schema: { type: "object", properties: { headline: { type: "string" } } } }] });
    expect(r.status).toBe(200);
    expect(r.body.content?.map((b) => b.type)).toEqual(["thinking", "tool_use"]);
    expect(r.body.usage).toMatchObject({ input_tokens: expect.any(Number), output_tokens: expect.any(Number), cache_read_input_tokens: 0 });
  });
});
