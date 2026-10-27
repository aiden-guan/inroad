import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/ai/connections/route";
import { DATA_DIR, readSettings, writeSettings } from "@/lib/store/settings";
import { readAiKey, resetAiKeyCache } from "@/lib/store/ai-keys";
import { startMock, type MockServer } from "@/test/mock-anthropic";
import { activeProvider, connectionProvider, getAnthropicClient } from "./client";
import { removeConnection, routingStatus, saveConnection, saveRouting } from "./connections";
import { routeProvider } from "./routing";
import { saveAiSetup } from "./setup";
import { runAgent } from "./engine";
import { listModels } from "./openai-compat";

let mock: MockServer;
const KEY = "isolated-account-key-12345678";
beforeAll(async () => { mock = await startMock(); });
afterAll(() => mock.stop());
beforeEach(() => {
  for (const f of ["settings.json", "ai-keys.json", "ai-keys.secret"]) fs.rmSync(path.join(DATA_DIR, f), { force: true });
  resetAiKeyCache();
});
async function add(name: string, extra: Record<string, unknown> = {}) {
  await saveConnection({ name, provider: "custom", baseUrl: `${mock.url}/v1`, key: KEY, model: "mock-large", ...extra });
  return readSettings().ai!.connections!.find((c) => c.name === name)!;
}
async function post(body: unknown) {
  return POST(new Request("http://localhost/api/ai/connections", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
}

describe("independent AI connections", () => {
  it("preserves Anthropic SDK token authentication and environment base URLs", () => {
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "sdk-bearer-token");
    const provider = activeProvider();
    expect(provider?.kind).toBe("anthropic");
    const sdk = getAnthropicClient(provider);
    expect(sdk.authToken).toBe("sdk-bearer-token");
    expect(sdk.apiKey).toBeNull();
    expect(sdk.baseURL).toBe(process.env.ANTHROPIC_BASE_URL);
  });
  it("preserves the original environment provider when the first named connection is added", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "original-env-key");
    await add("Additional account");
    expect(activeProvider()?.id).toBe("anthropic");
    expect(routingStatus().connections.map((c) => c.id)).toContain("legacy");
    expect(readSettings().ai?.provider).toBe("anthropic");
  });
  it("keeps multiple accounts for one provider, separate keys, and a usable first default", async () => {
    const a = await add("Work");
    const b = await add("Personal", { key: "different-account-key-98765432", model: "mock-routed" });
    expect(a.id).not.toBe(b.id);
    expect(activeProvider()?.connectionId).toBe(a.id);
    expect(connectionProvider(a)?.apiKey).toBe(KEY);
    expect(connectionProvider(b)?.apiKey).toBe("different-account-key-98765432");
    resetAiKeyCache();
    expect(readAiKey(`connection:${a.id}`)).toBe(KEY);
    const settingsText = fs.readFileSync(path.join(DATA_DIR, "settings.json"), "utf8");
    expect(settingsText).not.toContain(KEY);
    expect(await (await GET()).text()).not.toContain(KEY);
    expect(await (await GET()).text()).not.toContain("different-account-key-98765432");
  });

  it("retains saved connections and task choices when changing the original provider setup", async () => {
    const c = await add("Work");
    saveRouting({ mode: "manual", policy: "balanced", defaultConnectionId: c.id, tasks: { compose: { connectionId: c.id } } });
    const result = await saveAiSetup({ provider: "custom", baseUrl: `${mock.url}/v1`, key: KEY, model: "mock-large" });
    expect(result.ok).toBe(true);
    expect(readSettings().ai?.connections).toHaveLength(1);
    expect(readSettings().ai?.routing?.tasks.compose?.connectionId).toBe(c.id);
    expect(activeProvider()?.connectionId).toBeUndefined();
  });

  it("requires the key again when changing an endpoint and never exposes it in validation errors", async () => {
    const c = await add("Work");
    const { available: _available, key: _key, ...input } = c;
    void _available; void _key;
    await expect(saveConnection({ ...input, baseUrl: "https://other.example/v1" })).rejects.toThrow(/key again/);
    expect(activeProvider()?.baseUrl).toBe(`${mock.url}/v1`);
    expect((await post({ action: "save", connection: { ...input, key: "short" } })).status).toBe(400);
  });

  it("removes keys and all references to a deleted connection", async () => {
    const c = await add("Work");
    saveRouting({ mode: "manual", policy: "balanced", defaultConnectionId: c.id, tasks: { compose: { connectionId: c.id } } });
    const status = removeConnection(c.id);
    expect(status.connections).toHaveLength(0);
    expect(status.routing.defaultConnectionId).toBeUndefined();
    expect(status.routing.tasks).toEqual({});
    resetAiKeyCache();
    expect(readAiKey(`connection:${c.id}`)).toBeUndefined();
  });
});

describe("task routing", () => {
  it("honors one-run and task choices before automatic preferences", async () => {
    const a = await add("Reasoning", { strengths: ["reasoning"], models: { strategist: "mock-routed" } });
    const b = await add("Writing", { strengths: ["writing"] });
    saveRouting({ mode: "auto", policy: "quality", defaultConnectionId: a.id, tasks: { compose: { connectionId: a.id, model: "mock-routed" } } });
    expect(routeProvider({ task: "review", tier: "strategist" }).provider.connectionId).toBe(a.id);
    expect(routeProvider({ task: "asset", tier: "operator" }).provider.connectionId).toBe(b.id);
    expect(routeProvider({ task: "compose", tier: "operator" }).provider.models.operator).toBe("mock-routed");
    expect(routeProvider({ task: "compose", tier: "operator", route: { connectionId: b.id } }).provider.connectionId).toBe(b.id);
    expect(() => routeProvider({ tier: "operator", route: { connectionId: a.id, model: "missing" } })).toThrow(/Add the selected model/);
  });

  it("uses configured fast models, and excludes connections outside their context limit", async () => {
    const a = await add("Small context", { contextWindow: 4096, strengths: ["fast"], models: { fast: "mock-large-mini" } });
    const b = await add("Large context", { contextWindow: 100_000 });
    saveRouting({ mode: "auto", policy: "quality", tasks: {} });
    expect(routeProvider({ tier: "fast", promptTokens: 2048 }).provider.models.fast).toBe("mock-large-mini");
    expect(routeProvider({ tier: "fast", promptTokens: 50_000 }).provider.connectionId).toBe(b.id);
    expect(() => routeProvider({ tier: "fast", promptTokens: 200_000 })).toThrow(/No enabled automatic route/);
    expect(a.id).not.toBe(b.id);
  });

  it("never treats unknown pricing as free, and keeps automatic routing opt-in", async () => {
    const a = await add("Unknown price");
    const b = await add("Known price", { prices: { "mock-large": { input: 1, output: 2 } } });
    expect(routeProvider({ tier: "operator" }).provider.connectionId).toBe(a.id);
    saveRouting({ mode: "auto", policy: "cost", tasks: {} });
    expect(routeProvider({ tier: "operator" }).provider.connectionId).toBe(b.id);
    const ai = readSettings().ai!;
    writeSettings({ ai: { ...ai, connections: ai.connections!.map((c) => ({ ...c, auto: false })) } });
    expect(() => routeProvider({ tier: "operator" })).toThrow(/No enabled automatic route/);
  });

  it("rejects disabled, missing, and unknown task targets", async () => {
    const c = await add("Disabled", { enabled: false });
    expect(() => saveRouting({ mode: "manual", policy: "balanced", tasks: { compose: { connectionId: c.id } } })).toThrow(/enabled connection/);
    expect(() => saveRouting({ mode: "manual", policy: "balanced", tasks: { surprise: { connectionId: c.id } } })).toThrow();
    expect(() => saveRouting({ mode: "auto", policy: "balanced", tasks: {} })).toThrow(/at least one/);
  });
});

const cf = { accountId: "a".repeat(32), gatewayId: "inroad", collectLogs: false };
function stream(model: string, headers?: HeadersInit) {
  return new Response(`data: ${JSON.stringify({ model, choices: [{ delta: { content: "Done." }, finish_reason: "stop" }], usage: { prompt_tokens: 1000, completion_tokens: 100 } })}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream", ...headers } });
}
const run = () => runAgent({ system: "Inroad", messages: [{ role: "user", content: "Hello" }], emit: () => {} });

describe("gateway wire contracts", () => {
  it("normalizes per-token gateway prices, cache reads and published free models without inventing missing prices", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ data: [
      { id: "author/paid", pricing: { input: "0.000001", output: "0.000004", input_cache_read: "0.0000001" } },
      { id: "author/free", pricing: { input: "0", output: "0" } },
      { id: "author/unknown", pricing: {} },
      { id: "author/invalid", pricing: { input: "-1", output: "0" } },
    ] }));
    const result = await listModels("https://ai-gateway.vercel.sh/v1", KEY, "Vercel");
    expect(result).toMatchObject({ ok: true, prices: { "author/paid": { input: 1, output: 4 }, "author/free": { input: 0, output: 0 } } });
    if (result.ok) {
      expect(result.prices["author/paid"].cacheRead).toBeCloseTo(0.1);
      expect(Object.keys(result.prices)).toHaveLength(2);
    }
  });

  it("lists Vercel models and streams tools-compatible Chat Completions on its fixed endpoint", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      calls.push({ url: String(url), init });
      return String(url).endsWith("/models") ? Response.json({ data: [{ id: "author/model" }] }) : stream("author/model");
    });
    await saveConnection({ name: "Vercel", provider: "vercel", key: KEY, prices: { "author/model": { input: 1, output: 2 } } });
    const result = await run();
    expect(calls.map((c) => c.url)).toEqual(["https://ai-gateway.vercel.sh/v1/models", "https://ai-gateway.vercel.sh/v1/chat/completions"]);
    expect(new Headers(calls[1].init?.headers).get("authorization")).toBe(`Bearer ${KEY}`);
    expect(calls.every((c) => c.init?.redirect === "error")).toBe(true);
    expect(JSON.parse(String(calls[1].init?.body))).toMatchObject({ model: "author/model", stream: true });
    expect(result.modelName).toBe("author/model");
    expect(result.costUsd).toBeCloseTo(0.0012);
  });

  it("uses Cloudflare account REST auth, gateway ID, cache bypass and log opt-out without probing an undocumented models API", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(stream("author/model"));
    await saveConnection({ name: "Cloudflare", provider: "cloudflare", key: KEY, model: "author/model", cloudflare: cf });
    expect(fetch).not.toHaveBeenCalled();
    const result = await run();
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(`https://api.cloudflare.com/client/v4/accounts/${cf.accountId}/ai/v1/chat/completions`);
    expect(Object.fromEntries(new Headers(init?.headers))).toMatchObject({ authorization: `Bearer ${KEY}`, "cf-aig-gateway-id": "inroad", "cf-aig-skip-cache": "true", "cf-aig-collect-log": "false" });
    expect(result.unpriced).toBe(true);
  });

  it("supports named Cloudflare dynamic routes on the current REST API and prices the actual serving model", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(stream("other/actual-model"));
    await saveConnection({ name: "Cloudflare router", provider: "cloudflare", key: KEY, cloudflare: { ...cf, dynamicRoute: "writing" }, models: { fast: "author/model" }, prices: { "other/actual-model": { input: 2, output: 5 } } });
    const result = await run();
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body)).model).toBe("dynamic/writing");
    expect(activeProvider()?.models.fast).toBe("dynamic/writing");
    expect(result.modelName).toBe("other/actual-model");
    expect(result.costUsd).toBeCloseTo(0.0025);
    expect(result.unpriced).toBeUndefined();
  });

  it("does not use an alias price when the gateway served a different unpriced model", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(stream("other/unpriced"));
    await saveConnection({ name: "Cloudflare router", provider: "cloudflare", key: KEY, cloudflare: { ...cf, dynamicRoute: "writing" }, prices: { "dynamic/writing": { input: 2, output: 5 } } });
    expect((await run()).unpriced).toBe(true);
  });

  it("uses Cloudflare serving-model headers when a dynamic stream reports only its route alias", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(stream("dynamic/writing", { "cf-aig-model": "actual", "cf-aig-provider": "author" }));
    await saveConnection({ name: "Header route", provider: "cloudflare", key: KEY, cloudflare: { ...cf, dynamicRoute: "writing" }, prices: { "author/actual": { input: 1, output: 2 } } });
    const result = await run();
    expect(result.modelName).toBe("author/actual");
    expect(result.costUsd).toBeCloseTo(0.0012);
    expect(result.unpriced).toBeUndefined();
  });

  it("validates Cloudflare account IDs and all model namespaces before saving secrets", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    await expect(saveConnection({ name: "Bad", provider: "cloudflare", key: KEY, model: "author/model", cloudflare: { ...cf, accountId: "../evil" } })).rejects.toThrow();
    await expect(saveConnection({ name: "Bad", provider: "cloudflare", key: KEY, model: "model", cloudflare: cf })).rejects.toThrow(/provider/);
    await expect(saveConnection({ name: "Bad", provider: "cloudflare", key: KEY, model: "author/model", models: { fast: "missing-prefix" }, cloudflare: cf })).rejects.toThrow(/prefix/);
    expect(fetch).not.toHaveBeenCalled();
    expect(routingStatus().connections).toEqual([]);
    expect(readSettings().ai).toBeUndefined();
  });
});
