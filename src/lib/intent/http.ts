import "server-only";
import { fetchText } from "@/lib/signals/http";

/**
 * The public APIs the intent radar reads (Hacker News search, Stack Exchange, GitHub), through the guarded fetch.
 * In mock mode (`npm run dev:mock`) they answer from saved, anonymized responses through the mock server instead
 * (scripts/mock/intent.mjs), so the panel can be exercised without touching the network.
 */

const MOCK_ROUTES: [origin: string, prefix: string][] = [
  ["https://hn.algolia.com", "/hn"],
  ["https://api.stackexchange.com", "/se"],
  ["https://api.github.com", "/gh"],
];

/**
 * The mock server's intent routes, or null outside mock mode. `npm run dev:mock` points the Anthropic API at a local
 * mock with the key "mock"; INROAD_INTENT_MOCK_URL overrides it (tests, other mock setups).
 */
export function intentMockBase(): string | null {
  const explicit = process.env.INROAD_INTENT_MOCK_URL?.trim();
  if (explicit) return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/.*)?$/.test(explicit) ? explicit.replace(/\/+$/, "") : null;
  const base = process.env.ANTHROPIC_BASE_URL?.trim();
  if (process.env.ANTHROPIC_API_KEY !== "mock" || !base) return null;
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(base) ? `${base.replace(/\/+$/, "")}/intent` : null;
}

type Options = NonNullable<Parameters<typeof fetchText>[1]>;
export type Fetched = Awaited<ReturnType<typeof fetchText>>;

export async function apiFetch(url: string, opts: Options = {}): Promise<Fetched> {
  const route = MOCK_ROUTES.find(([origin]) => url.startsWith(origin));
  const mock = intentMockBase();
  if (mock && route) return mockFetch(`${mock}${route[1]}${url.slice(route[0].length)}`, opts);
  return fetchText(url, opts);
}

/** Plain fetch to the local mock server (loopback only, never the guarded public path). */
async function mockFetch(url: string, opts: Options): Promise<Fetched> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), opts.timeoutMs ?? 10_000);
  try {
    const res = await fetch(url, {
      headers: { Accept: opts.accept ?? "application/json", ...(opts.headers ?? {}) },
      signal: opts.signal ? AbortSignal.any([opts.signal, abort.signal]) : abort.signal,
      cache: "no-store",
    });
    if (!res.ok && !opts.allowErrors) return null;
    const out: NonNullable<Fetched> = { url, status: res.status, body: await res.text() };
    if (opts.responseHeaders?.length) {
      out.headers = {};
      for (const h of opts.responseHeaders) {
        const v = res.headers.get(h);
        if (v !== null) out.headers[h] = v;
      }
    }
    return out;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** A JSON GET: the parsed body (or null), its status, and the response headers asked for. */
export async function apiJson<T>(url: string, opts: Options = {}): Promise<{ data: T | null; status: number; headers?: Record<string, string> }> {
  const res = await apiFetch(url, { accept: "application/json", maxBytes: 3_000_000, timeoutMs: 12_000, allowErrors: true, ...opts });
  if (!res) return { data: null, status: 0 };
  try {
    return { data: JSON.parse(res.body) as T, status: res.status, ...(res.headers ? { headers: res.headers } : {}) };
  } catch {
    return { data: null, status: res.status, ...(res.headers ? { headers: res.headers } : {}) };
  }
}
