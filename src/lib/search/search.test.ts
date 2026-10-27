import { beforeEach, describe, expect, it, vi } from "vitest";
import { readAiKey, saveAiKey } from "@/lib/store/ai-keys";
import { readSettings, writeSettings } from "@/lib/store/settings";
import { setSecrets } from "@/lib/store/workspace";
import { POST as testConnection } from "@/app/api/settings/search/test/route";
import { cleanSearchEndpoint, SEARCH_PROVIDERS, type SearchProviderId } from "./providers";
import { activeSearch, clearSearchCache, saveSearchSetup, searchStatus, searchWeb, type ActiveSearch } from "./search";

const key = "provider-secret-123456";
const provider = (id: SearchProviderId): ActiveSearch => ({ id, name: SEARCH_PROVIDERS.find((p) => p.id === id)!.name, key, keySource: "saved" });
const hit = { url: "https://example.com/news", title: "Company news", description: "A new sales leader" };

beforeEach(() => {
  clearSearchCache();
  writeSettings({ search: undefined, researchRequests: undefined, browserRequests: undefined });
  setSecrets("hub", Object.fromEntries(SEARCH_PROVIDERS.map((p) => [`search_${p.id}`, null])));
  for (const p of SEARCH_PROVIDERS) vi.stubEnv(p.env, "");
  vi.stubEnv("INROAD_SEARCH_PROVIDER", "");
  vi.stubEnv("INROAD_SEARCH_URL", "");
});

describe("search provider configuration", () => {
  it("preserves environment Firecrawl, honors a chosen provider, and disables search explicitly", () => {
    vi.stubEnv("INROAD_SEARCH_PROVIDER", "auto");
    vi.stubEnv("FIRECRAWL_API_KEY", "fc-existing-key");
    vi.stubEnv("TINYFISH_API_KEY", "tinyfish-existing-key");
    expect(activeSearch()?.id).toBe("firecrawl");
    expect(saveSearchSetup({ provider: "tinyfish" })).toBeNull();
    expect(activeSearch()?.id).toBe("tinyfish");
    expect(saveSearchSetup({ provider: "off" })).toBeNull();
    expect(activeSearch()).toBeNull();
  });

  it("keeps saved keys out of settings and public status, and removes only the search key", () => {
    expect(saveSearchSetup({ provider: "deepseek", key })).toBeNull();
    expect(activeSearch()).toMatchObject({ id: "deepseek", key, keySource: "saved" });
    expect(JSON.stringify(readSettings())).not.toContain(key);
    expect(JSON.stringify(searchStatus())).not.toContain(key);
    expect(searchStatus().saved.deepseek).toBe("…3456");
    expect(saveSearchSetup({ provider: "deepseek", key: null })).toBeNull();
    expect(searchStatus().saved.deepseek).toBeUndefined();
  });

  it("uses a saved DeepSeek model key only when DeepSeek search is explicitly selected", () => {
    saveAiKey("deepseek", "deepseek-model-key");
    vi.stubEnv("INROAD_SEARCH_PROVIDER", "auto");
    expect(activeSearch()).toBeNull();
    saveSearchSetup({ provider: "deepseek" });
    expect(activeSearch()).toMatchObject({ key: "deepseek-model-key", keySource: "ai" });
    saveSearchSetup({ provider: "deepseek", key });
    saveSearchSetup({ provider: "deepseek", key: null });
    expect(readAiKey("deepseek")).toBe("deepseek-model-key");
    expect(activeSearch()?.keySource).toBe("ai");
  });

  it("doesn't fall back to a billable provider when the chosen provider is unavailable or misspelled", () => {
    vi.stubEnv("FIRECRAWL_API_KEY", "fc-existing-key");
    saveSearchSetup({ provider: "tavily" });
    expect(activeSearch()).toBeNull();
    writeSettings({ search: undefined, researchRequests: undefined, browserRequests: undefined });
    vi.stubEnv("INROAD_SEARCH_PROVIDER", "typo");
    expect(activeSearch()).toBeNull();
  });

  it("validates endpoint URLs before writing a key and permits an unauthenticated local adapter", () => {
    expect(saveSearchSetup({ provider: "custom", key, endpoint: "https://user:password@example.com/search" })).toMatch(/HTTPS/);
    expect(searchStatus().saved.custom).toBeUndefined();
    expect(saveSearchSetup({ provider: "custom", endpoint: "http://localhost:8080/search" })).toBeNull();
    expect(activeSearch()).toMatchObject({ id: "custom", endpoint: "http://localhost:8080/search", keySource: "none" });
    for (const url of ["file:///etc/passwd", "http://remote.example/search", "https://example.com/?key=secret", "https://example.com/#fragment"])
      expect(cleanSearchEndpoint(url)).toBeNull();
    expect(cleanSearchEndpoint("http://[::1]:8080/search")).toBe("http://[::1]:8080/search");
  });
});

describe("official search API contracts", () => {
  it.each([
    {
      id: "deepseek",
      url: "https://api.deepseek.com/v1/tools/search",
      header: "Authorization",
      value: `Bearer ${key}`,
      body: { query: "new sales leaders", count: 3, need_content: false },
      response: { results: [{ ...hit, summary: hit.description }] },
    },
    {
      id: "tinyfish",
      url: "https://api.search.tinyfish.ai/?query=new+sales+leaders",
      header: "X-API-Key",
      value: key,
      response: { results: [{ url: hit.url, title: hit.title, snippet: hit.description }] },
    },
    {
      id: "tavily",
      url: "https://api.tavily.com/search",
      header: "Authorization",
      value: `Bearer ${key}`,
      body: { query: "new sales leaders", max_results: 3, search_depth: "basic", include_answer: false, include_raw_content: false },
      response: { results: [{ url: hit.url, title: hit.title, content: hit.description }] },
    },
    {
      id: "exa",
      url: "https://api.exa.ai/search",
      header: "x-api-key",
      value: key,
      body: { query: "new sales leaders", numResults: 3, type: "auto", contents: { highlights: true } },
      response: { results: [{ url: hit.url, title: hit.title, highlights: [hit.description] }] },
    },
    {
      id: "brave",
      url: "https://api.search.brave.com/res/v1/web/search?q=new+sales+leaders&count=3",
      header: "X-Subscription-Token",
      value: key,
      response: { web: { results: [hit] } },
    },
  ] as const)("translates $id requests and results", async (contract) => {
    const fetch = vi.fn().mockResolvedValue(Response.json(contract.response));
    vi.stubGlobal("fetch", fetch);
    const result = await searchWeb(provider(contract.id), "new sales leaders", 3);
    expect(result).toEqual({ ok: true, value: [hit] });
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(contract.url);
    expect(init.headers[contract.header]).toBe(contract.value);
    expect(init.method).toBe("body" in contract ? "POST" : "GET");
    expect(init.redirect).toBe("manual");
    expect(init.body ? JSON.parse(init.body) : undefined).toEqual("body" in contract ? contract.body : undefined);
    expect(String(url)).not.toContain(key);
  });

  it("accepts the Firecrawl v2 result envelope", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ success: true, data: { web: [hit] } }));
    vi.stubGlobal("fetch", fetch);
    expect(await searchWeb(provider("firecrawl"), "new sales leaders", 3)).toEqual({ ok: true, value: [hit] });
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ query: "new sales leaders", limit: 3 });
  });

  it("supports another tool through the custom adapter contract and an optional bearer key", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ results: [hit] }));
    vi.stubGlobal("fetch", fetch);
    const custom = { ...provider("custom"), endpoint: "http://localhost:8080/search", key: "" };
    expect(await searchWeb(custom, "a company", 2)).toEqual({ ok: true, value: [hit] });
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ query: "a company", limit: 2 });
    expect(fetch.mock.calls[0][1].headers.Authorization).toBeUndefined();
    await searchWeb({ ...custom, key }, "a company");
    expect(fetch.mock.calls[1][1].headers.Authorization).toBe(`Bearer ${key}`);
  });

  it("filters unsafe URLs and duplicates and caps result context", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          results: [
            { ...hit, url: "javascript:alert(1)" },
            { ...hit, url: "https://user:pass@example.com/" },
            hit,
            hit,
            { url: "https://example.com/other", content: "x".repeat(10000) },
          ],
        }),
      ),
    );
    const result = await searchWeb(provider("tavily"), "a company", 2);
    expect(result.ok && result.value.length).toBe(2);
    expect(result.ok && result.value[1].description.length).toBe(4000);
    expect(result.ok && result.value[1].title).toBe("https://example.com/other");
  });

  it("distinguishes an empty search from a malformed success response", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ results: [] }))
      .mockResolvedValueOnce(Response.json({ error: "bad shape" }));
    vi.stubGlobal("fetch", fetch);
    expect(await searchWeb(provider("deepseek"), "a company")).toEqual({ ok: true, value: [] });
    expect(await searchWeb(provider("deepseek"), "a company", 8, { fresh: true })).toMatchObject({ ok: false, error: { code: "upstream" } });
  });

  it("rejects overlong DeepSeek queries without truncating meaning or making a request", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(await searchWeb(provider("deepseek"), "a".repeat(129))).toMatchObject({ ok: false, error: { code: "validation" } });
    expect(await searchWeb(provider("tinyfish"), "   ")).toMatchObject({ ok: false });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([401, 402, 429, 503])("reports HTTP %i without retrying or switching vendors", async (status) => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ message: `problem with ${key}` }, { status }));
    vi.stubGlobal("fetch", fetch);
    const result = await searchWeb(provider("deepseek"), "a company");
    expect(result).toMatchObject({ ok: false, error: { status } });
    expect(JSON.stringify(result)).not.toContain(key);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("reports network failures without leaking credentials", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error(`network ${key}`)));
    const result = await searchWeb(provider("exa"), "a company");
    expect(result).toMatchObject({ ok: false, error: { code: "network" } });
    expect(JSON.stringify(result)).not.toContain(key);
  });
});

describe("the Settings search test", () => {
  it("returns source results without returning the provider key", async () => {
    saveSearchSetup({ provider: "tinyfish", key });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ results: [hit] })));
    const response = await testConnection(
      new Request("http://localhost/api/settings/search/test", { method: "POST", body: JSON.stringify({ query: "a company" }) }),
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toEqual({ provider: "TinyFish", results: [hit] });
    expect(JSON.stringify(body)).not.toContain(key);
  });

  it("makes no provider call when search is disabled", async () => {
    saveSearchSetup({ provider: "off" });
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const response = await testConnection(
      new Request("http://localhost/api/settings/search/test", { method: "POST", body: JSON.stringify({ query: "a company" }) }),
    );
    expect(response.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
});
