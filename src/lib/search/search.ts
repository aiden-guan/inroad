import "server-only";
import { createHash } from "node:crypto";
import { reserveSearchRequests } from "./budget";
import { readAutomation, recordOperation } from "@/lib/automation/store";
import { callCapability } from "@/lib/automation/connections";
import { canonicalUrl, rankResults, cleanDomains, querySuffix, type SearchHit, type SearchFilters } from "./quality";
import { firecrawlSearch } from "@/lib/connectors/firecrawl";
import { request } from "@/lib/connectors/http";
import { fail, ok, type Result } from "@/lib/connectors/types";
import { readAiKey } from "@/lib/store/ai-keys";
import { readSettings, writeSettings } from "@/lib/store/settings";
import { getSecret, readWorkspace, setSecrets } from "@/lib/store/workspace";
import { cleanSearchEndpoint, isSearchChoice, SEARCH_PROVIDERS, type SearchChoice, type SearchProviderId, type SearchStatus } from "./providers";

export interface ActiveSearch {
  id: SearchProviderId;
  name: string;
  key: string;
  keySource: NonNullable<SearchStatus["active"]>["keySource"];
  endpoint?: string;
  connectionId?: string;
}

const secretName = (id: SearchProviderId) => `search_${id}`;

function configured(id: SearchProviderId): ActiveSearch | null {
  const preset = SEARCH_PROVIDERS.find((p) => p.id === id)!;
  if (id === "connected") {
    const connectionId = readSettings().search?.connectionId ?? process.env.INROAD_SEARCH_CONNECTION_ID;
    const connection = readAutomation().connections.find((c) => c.id === connectionId && c.enabled && c.bindings.some((b) => b.capability === "search"));
    return connection ? { id, name: connection.name, key: "", keySource: "integration", connectionId: connection.id } : null;
  }
  let key = getSecret("hub", secretName(id))?.trim();
  let keySource: ActiveSearch["keySource"] = "saved";
  if (!key && id === "firecrawl" && readWorkspace().integrations.firecrawl?.enabled) {
    key = getSecret("firecrawl", "key")?.trim();
    keySource = "integration";
  }
  // Reuse the DeepSeek model key only when search is explicitly set to DeepSeek.
  if (!key && id === "deepseek") {
    key = readAiKey("deepseek");
    keySource = "ai";
  }
  if (!key) {
    key = process.env[preset.env]?.trim();
    keySource = key ? "env" : "none";
  }
  const endpoint = id === "custom" ? cleanSearchEndpoint(readSettings().search?.endpoint ?? process.env.INROAD_SEARCH_URL ?? "") : undefined;
  if (id === "custom" ? !endpoint : !key) return null;
  return { id, name: preset.name, key: key ?? "", keySource, ...(endpoint ? { endpoint } : {}) };
}

export function searchChoice(): SearchChoice {
  const choice = readSettings().search?.provider ?? (process.env.INROAD_SEARCH_PROVIDER || "auto");
  // Invalid explicit configuration must not silently select another billable provider.
  return isSearchChoice(choice) ? choice : "off";
}

/** A turn pins one provider. Errors never send the query to another vendor or spend its credits. */
export function activeSearch(): ActiveSearch | null {
  const choice = searchChoice();
  if (choice === "off") return null;
  if (choice !== "auto") return configured(choice);
  // Preserve existing Firecrawl setups. DeepSeek requires an explicit choice because its model key
  // is also a search key; installing a model must not start spending on a new search service.
  for (const id of ["firecrawl", "tinyfish", "tavily", "exa", "brave", "custom"] as const) {
    const provider = configured(id);
    if (provider) return provider;
  }
  return null;
}

export function searchStatus(): SearchStatus {
  const active = activeSearch();
  const saved: SearchStatus["saved"] = {};
  for (const p of SEARCH_PROVIDERS) {
    const key = getSecret("hub", secretName(p.id));
    if (key) saved[p.id] = `…${key.slice(-4)}`;
  }
  return {
    chosen: searchChoice(),
    connectionId: readSettings().search?.connectionId,
    dailyLimit: readSettings().search?.dailyLimit ?? 100,
    browser: readSettings().search?.browser ?? "off",
    browserDailyLimit: readSettings().search?.browserDailyLimit ?? 10,
    pageConnectionId: readSettings().search?.pageConnectionId,
    active: active ? { id: active.id, name: active.name, keySource: active.keySource } : null,
    endpoint: cleanSearchEndpoint(readSettings().search?.endpoint ?? process.env.INROAD_SEARCH_URL ?? ""),
    saved,
    env: SEARCH_PROVIDERS.filter((p) => !!process.env[p.env]?.trim()).map((p) => p.id),
  };
}

export function saveSearchSetup(input: {
  provider: SearchChoice;
  key?: string | null;
  endpoint?: string;
  connectionId?: string;
  dailyLimit?: number;
  browser?: "off" | "tinyfish";
  browserDailyLimit?: number;
  pageConnectionId?: string;
  browserKey?: string | null;
}): string | null {
  if (
    input.connectionId !== undefined &&
    input.provider === "connected" &&
    !readAutomation().connections.some((c) => c.id === input.connectionId && c.enabled && c.bindings.some((b) => b.capability === "search"))
  )
    return "Choose an enabled connection with a mapped search capability.";
  if (input.provider === "connected" && input.key !== undefined) return "Save the key on the tool connection instead.";
  const endpoint = input.endpoint === undefined ? readSettings().search?.endpoint : input.endpoint.trim();
  if (endpoint && !cleanSearchEndpoint(endpoint))
    return "Use an HTTPS endpoint without credentials, a query string or a fragment (HTTP is allowed on localhost).";
  if (input.provider === "custom" && !endpoint && !cleanSearchEndpoint(process.env.INROAD_SEARCH_URL ?? ""))
    return "Enter the full URL of your search adapter.";
  if (input.key !== undefined && (input.provider === "auto" || input.provider === "off")) return "Choose a search provider before changing its key.";
  if (input.browserKey?.trim() && (input.browserKey.trim().length < 6 || /[\r\n]/.test(input.browserKey))) return "Paste the full TinyFish key on one line.";
  if (input.key?.trim() && (input.key.trim().length < 6 || /[\r\n]/.test(input.key))) return "Paste the full API key on one line (at least 6 characters).";
  if (input.key !== undefined && input.provider !== "auto" && input.provider !== "off") {
    setSecrets("hub", { [secretName(input.provider)]: input.key?.trim() || null });
  }
  if (input.browserKey !== undefined) setSecrets("hub", { search_tinyfish: input.browserKey?.trim() || null });
  writeSettings({
    search: {
      ...readSettings().search,
      provider: input.provider,
      ...(input.connectionId !== undefined ? { connectionId: input.connectionId } : {}),
      ...(input.dailyLimit !== undefined ? { dailyLimit: input.dailyLimit } : {}),
      ...(input.browser !== undefined ? { browser: input.browser } : {}),
      ...(input.browserDailyLimit !== undefined ? { browserDailyLimit: input.browserDailyLimit } : {}),
      ...(input.pageConnectionId !== undefined ? { pageConnectionId: input.pageConnectionId || undefined } : {}),
      endpoint: endpoint ? cleanSearchEndpoint(endpoint)! : undefined,
    },
  });
  return null;
}

const object = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const string = (v: unknown): string => (typeof v === "string" ? v : "");

/** Validate untrusted provider responses and keep the context/citation shape the engine already uses. */
function normalize(rows: unknown, limit: number): Result<SearchHit[]> {
  if (!Array.isArray(rows)) return fail("upstream", "The search provider returned an unexpected response. Check the adapter's response format.");
  const seen = new Set<string>();
  const results: SearchHit[] = [];
  for (const raw of rows) {
    const row = object(raw);
    let url: URL;
    try {
      url = new URL(string(row.url));
    } catch {
      continue;
    }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) continue;
    const href = canonicalUrl(url.href);
    if (!href) continue;
    if (seen.has(href)) continue;
    seen.add(href);
    const highlights = Array.isArray(row.highlights) ? row.highlights.filter((x): x is string => typeof x === "string").join("\n") : "";
    results.push({
      url: href,
      ...(typeof (row.publishedAt ?? row.publishedDate ?? row.date) === "string" &&
      Number.isFinite(Date.parse(String(row.publishedAt ?? row.publishedDate ?? row.date)))
        ? { publishedAt: new Date(String(row.publishedAt ?? row.publishedDate ?? row.date)).toISOString() }
        : {}),
      title: (string(row.title) || href).slice(0, 500),
      description: (string(row.description) || string(row.summary) || string(row.snippet) || string(row.content) || highlights || string(row.text)).slice(
        0,
        4000,
      ),
    });
    if (results.length >= limit) break;
  }
  return ok(results);
}

/** Official wire formats, all translated to {url,title,description}; no provider SDK required. */
async function rawSearch(provider: ActiveSearch, query: string, limit = 8, filters: SearchFilters = {}): Promise<Result<SearchHit[]>> {
  if (filters.signal?.aborted) return fail("network", "Search cancelled.");
  if (provider.id === "connected") {
    try {
      return normalize(await callCapability(provider.connectionId!, "search", query, limit, filters.signal), limit);
    } catch (error) {
      return fail("upstream", error instanceof Error ? error.message : "Connected search failed.");
    }
  }
  const include = cleanDomains(filters.includeDomains),
    exclude = cleanDomains(filters.excludeDomains);
  const suffix = querySuffix(filters);
  const q = [query.trim(), ...(["deepseek", "firecrawl", "brave"].includes(provider.id) && suffix ? [suffix] : [])].join(" ");
  if (!q || [...q].length > (provider.id === "deepseek" ? 128 : 2000))
    return fail("validation", `Use a search query between 1 and ${provider.id === "deepseek" ? 128 : 2000} characters.`);
  const count = Number.isFinite(limit) ? Math.max(1, Math.min(20, Math.floor(limit))) : 8;
  if (provider.id === "firecrawl") {
    const r = await firecrawlSearch(provider.key, q, count);
    return r.ok ? normalize(r.value, count) : r;
  }
  let url: string;
  let headers: Record<string, string> = {};
  let body: unknown;
  switch (provider.id) {
    case "deepseek":
      url = "https://api.deepseek.com/v1/tools/search";
      headers = { Authorization: `Bearer ${provider.key}` };
      body = { query: q, count, need_content: false, ...(filters.purpose ? { ori_question: [...filters.purpose].slice(0, 128).join("") } : {}) };
      break;
    case "tinyfish": {
      const endpoint = new URL("https://api.search.tinyfish.ai");
      endpoint.searchParams.set("query", q);
      if (include.length) endpoint.searchParams.set("include_domains", include.join(","));
      if (exclude.length) endpoint.searchParams.set("exclude_domains", exclude.join(","));
      if (filters.since) endpoint.searchParams.set("after_date", filters.since);
      if (filters.purpose) endpoint.searchParams.set("purpose", filters.purpose);
      url = endpoint.href;
      headers = { "X-API-Key": provider.key };
      break;
    }
    case "tavily":
      url = "https://api.tavily.com/search";
      headers = { Authorization: `Bearer ${provider.key}` };
      body = {
        query: q,
        max_results: count,
        search_depth: "basic",
        include_answer: false,
        include_raw_content: false,
        ...(include.length ? { include_domains: include } : {}),
        ...(exclude.length ? { exclude_domains: exclude } : {}),
        ...(filters.since ? { start_date: filters.since } : {}),
      };
      break;
    case "exa":
      url = "https://api.exa.ai/search";
      headers = { "x-api-key": provider.key };
      body = {
        query: q,
        numResults: count,
        type: "auto",
        contents: { highlights: true },
        ...(include.length ? { includeDomains: include } : {}),
        ...(exclude.length ? { excludeDomains: exclude } : {}),
        ...(filters.since ? { startPublishedDate: `${filters.since}T00:00:00.000Z` } : {}),
      };
      break;
    case "brave": {
      const endpoint = new URL("https://api.search.brave.com/res/v1/web/search");
      endpoint.searchParams.set("q", q);
      endpoint.searchParams.set("count", String(count));
      url = endpoint.href;
      headers = { "X-Subscription-Token": provider.key };
      break;
    }
    case "custom": {
      const endpoint = cleanSearchEndpoint(provider.endpoint ?? "");
      if (!endpoint) return fail("validation", "Set a valid custom search endpoint in Settings.");
      url = endpoint;
      if (provider.key) headers = { Authorization: `Bearer ${provider.key}` };
      body = { query: q, limit: count };
      break;
    }
  }
  // One attempt: retries of a paid search could charge twice after a lost response.
  const response = await request<unknown>({
    tool: provider.name,
    url,
    headers,
    body,
    timeoutMs: 30_000,
    retries: 0,
    secrets: [provider.key],
    signal: filters.signal,
  });
  if (!response.ok) {
    if (response.error.status === 402)
      return fail("plan", `${provider.name}'s search allowance or balance is exhausted. Check your account or try after the allowance resets.`, 402);
    return response;
  }
  const data = object(response.value);
  return normalize(provider.id === "brave" ? (object(data.web).results ?? (data.type === "search" ? [] : undefined)) : data.results, count);
}

const shared = globalThis as unknown as {
  __inroadSearchCache?: Map<string, { until: number; results: SearchHit[] }>;
  __inroadSearchPending?: Map<string, Promise<Result<SearchHit[]>>>;
  __inroadSearchReservations?: Map<string, number>;
};
const cache = (shared.__inroadSearchCache ??= new Map());
const pending = (shared.__inroadSearchPending ??= new Map());

/** Every caller shares ranking, exact filters, caching, request limits, and provenance. */
export async function searchWeb(provider: ActiveSearch, query: string, limit = 8, filters: SearchFilters = {}): Promise<Result<SearchHit[]>> {
  const started = Date.now();
  const count = Number.isFinite(limit) ? Math.max(1, Math.min(20, Math.floor(limit))) : 8;
  const connection = provider.connectionId ? readAutomation().connections.find((c) => c.id === provider.connectionId) : undefined;
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify([
        connection,
        provider.connectionId ? getSecret("hub", `tool_${provider.connectionId}`) : undefined,
        provider.id,
        provider.key,
        provider.endpoint,
        provider.connectionId,
        query.trim(),
        count,
        cleanDomains(filters.includeDomains),
        cleanDomains(filters.excludeDomains),
        filters.since,
        filters.purpose,
      ]),
    )
    .digest("hex");
  if (filters.signal?.aborted) return fail("network", "Search cancelled.");
  const previous = cache.get(fingerprint);
  const cached = !!(!filters.fresh && previous && previous.until > started);
  const existing = !filters.fresh && !filters.signal ? pending.get(fingerprint) : undefined;
  if (existing) return structuredClone(await existing);
  const release = cached ? () => undefined : reserveSearchRequests(1);
  if (typeof release === "string") return fail("rate_limited", release);
  let actualRequests = cached ? 0 : 1;
  const work = async (): Promise<Result<SearchHit[]>> => {
    try {
      let result: Result<SearchHit[]>;
      let billable = false;
      if (cached && previous) result = ok(structuredClone(previous.results));
      else {
        result = await rawSearch(provider, query, count, filters);
        if (result.ok) {
          billable = result.value.length > 0;
          const hits = rankResults(result.value, query, filters, count);
          result = ok(hits);
          if (!filters.signal?.aborted) cache.set(fingerprint, { until: started + 600_000, results: structuredClone(hits) });
          while (cache.size > 100) cache.delete(cache.keys().next().value!);
        }
      }
      actualRequests = cached || (!result.ok && result.error.code === "validation" && !result.error.status) ? 0 : 1;
      await recordOperation({
        kind: "search",
        provider: provider.name,
        query: query.slice(0, 1000),
        durationMs: Date.now() - started,
        resultCount: result.ok ? result.value.length : 0,
        requests: cached || (!result.ok && result.error.code === "validation" && !result.error.status) ? 0 : 1,
        cached,
        costUsd: cached ? 0 : provider.id === "deepseek" && result.ok ? (billable ? 0.00075 : 0) : null,
        ...(!result.ok ? { error: result.error.message } : {}),
      });
      return result;
    } finally {
      release(actualRequests);
    }
  };
  const task = work();
  if (!filters.signal && !filters.fresh) pending.set(fingerprint, task);
  try {
    return await task;
  } finally {
    if (pending.get(fingerprint) === task) pending.delete(fingerprint);
  }
}
export function clearSearchCache() {
  cache.clear();
  pending.clear();
}
