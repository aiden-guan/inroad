import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/settings/route";
import { readAiKey, resetAiKeyCache } from "@/lib/store/ai-keys";
import { DATA_DIR, readSettings, writeSettings } from "@/lib/store/settings";
import { startMock, type MockServer } from "@/test/mock-anthropic";
import { activeProvider } from "./client";

/**
 * Choosing a provider through POST /api/settings, the way Settings and first run do. The key is checked by
 * listing the provider's models (the mock answers GET /v1/models), and it must never come back out.
 */

let mock: MockServer;
const KEY = "sk-customkey-0123456789abcdef";

beforeAll(async () => {
  mock = await startMock();
});
afterAll(() => mock?.stop());

beforeEach(() => {
  for (const f of ["settings.json", "ai-keys.json", "ai-keys.secret"]) fs.rmSync(path.join(DATA_DIR, f), { force: true });
  resetAiKeyCache();
});

const post = async (body: unknown) => {
  const res = await POST(new Request("http://localhost/api/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
  return { status: res.status, text: await res.clone().text(), json: await res.json() };
};

describe("connecting a provider", () => {
  it("checks the key, lists the chat models, picks one, and keeps the key out of every response and settings.json", async () => {
    const out = await post({ ai: { provider: "custom", baseUrl: `${mock.url}/v1`, key: KEY } });
    expect(out.status).toBe(200);
    expect(out.text).not.toContain(KEY);
    expect(out.json.hasKey).toBe(true);
    expect(out.json.keyHint).toBe("…cdef");
    expect(out.json.ai.active).toMatchObject({ id: "custom", kind: "openai", models: { strategist: "mock-large", operator: "mock-large", fast: "mock-large-mini" } });
    expect(out.json.ai.available).toEqual(["mock-large", "mock-large-mini", "mock-routed"]);
    expect(out.json.ai.saved.custom).toMatchObject({ hint: "…cdef", store: "file" });
    // Published prices (OpenRouter-style) come in per million tokens.
    expect(out.json.ai.prices["mock-routed"]).toEqual({ input: 2, output: 8 });
    expect(fs.readFileSync(path.join(DATA_DIR, "settings.json"), "utf8")).not.toContain(KEY);
    resetAiKeyCache();
    expect(readAiKey("custom")).toBe(KEY);
    // Reading the status again (an empty POST answers what GET does) doesn't show it either.
    expect((await post({})).text).not.toContain(KEY);
  });

  it("says when the provider rejects the key, and saves nothing", async () => {
    const out = await post({ ai: { provider: "custom", baseUrl: `${mock.url}/v1`, key: "bad-key-0123456789" } });
    expect(out.status).toBe(400);
    expect(out.json.error).toMatch(/rejected that key/);
    expect(readSettings().ai).toBeUndefined();
    expect(readAiKey("custom")).toBeUndefined();
  });

  it("catches a key pasted under the wrong provider", async () => {
    const out = await post({ ai: { provider: "openai", key: "sk-ant-api03-abcdefghijklmnop" } });
    expect(out.status).toBe(400);
    expect(out.json.error).toBe("That looks like an Anthropic key. Pick Anthropic (Claude) above, or paste an OpenAI key.");
  });

  it("refuses a custom address that isn't https (or this computer)", async () => {
    const out = await post({ ai: { provider: "custom", baseUrl: "http://api.example.com/v1", key: KEY } });
    expect(out.status).toBe(400);
    expect(out.json.error).toMatch(/https:\/\//);
  });

  it("changes the model, a per-task model and a price without asking for the key again", async () => {
    await post({ ai: { provider: "custom", baseUrl: `${mock.url}/v1`, key: KEY } });
    const out = await post({ ai: { provider: "custom", model: "mock-routed", models: { strategist: "mock-large" }, prices: { "mock-routed": { input: 1, output: 3 } } } });
    expect(out.status).toBe(200);
    expect(out.json.ai.active.models).toEqual({ strategist: "mock-large", operator: "mock-routed", fast: "mock-routed" });
    expect(out.json.ai.unpriced).toBe(true);
    expect(activeProvider()?.prices["mock-routed"]).toEqual({ input: 1, output: 3 });
  });

  it("forgets a key on request, and the provider stops being ready", async () => {
    await post({ ai: { provider: "custom", baseUrl: `${mock.url}/v1`, key: KEY } });
    const out = await post({ removeKey: "custom" });
    expect(out.json.hasKey).toBe(false);
    expect(out.json.ai.saved.custom).toBeUndefined();
    resetAiKeyCache();
    expect(readAiKey("custom")).toBeUndefined();
  });
});

describe("a key saved by an earlier version", () => {
  it("moves out of settings.json into the key store the first time it's read", () => {
    writeSettings({ anthropicApiKey: "sk-ant-api03-legacylegacylegacy" });
    const p = activeProvider();
    expect(p).toMatchObject({ id: "anthropic", keySource: "saved", apiKey: "sk-ant-api03-legacylegacylegacy" });
    const raw = fs.readFileSync(path.join(DATA_DIR, "settings.json"), "utf8");
    expect(raw).not.toContain("legacylegacy");
    expect(readSettings().ai?.keys?.anthropic).toMatchObject({ hint: "…gacy", store: "file" });
  });
});
