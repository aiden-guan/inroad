import "server-only";
import { TTL, cached } from "@/lib/signals/cache";
import { politeGate } from "@/lib/signals/gate";
import { githubBudget, githubSearchIssues, hasGithubToken } from "@/lib/signals/github";
import { API_UA } from "@/lib/signals/http";
import { activeSearch, searchWeb } from "@/lib/search/search";
import { apiJson } from "./http";
import { parseGithubIssues, parseHn, parseReddit, parseStackExchange, stackExchangeMeta, type Candidate } from "./parse";
import { SOURCE_LABEL, type IntentQuery, type IntentSourceId, type SourceRequests } from "./types";

/**
 * The free public sources, each within its own published limits, identified with a generic User-Agent and cached
 * on disk so a second scan within the hour costs nothing:
 * - Hacker News search (Algolia): 10,000 requests an hour per IP. https://hn.algolia.com/api
 * - Stack Exchange: 300 requests a day per IP without an app key, and its `backoff` field is obeyed.
 *   https://api.stackexchange.com/docs/throttle
 * - GitHub issue search: 10 searches a minute without a token, 30 with one (src/lib/signals/github.ts).
 * - Reddit: only through the founder's own web search provider (Reddit's API needs an account), on its request limit.
 * - Bluesky: its public search now refuses signed-out requests (the public AppView returns 403), so it is skipped.
 */

export interface SourceStatus {
  id: IntentSourceId;
  label: string;
  state: "ready" | "setup" | "off";
  note: string;
  href?: string;
}

const se = globalThis as unknown as { __inroadStackExchange?: { remaining?: number; day?: string; backoffUntil?: number } };
const seState = () => {
  const day = new Date().toISOString().slice(0, 10);
  const s = (se.__inroadStackExchange ??= {});
  if (s.day !== day) {
    s.day = day;
    delete s.remaining;
  }
  return s;
};
/** Requests kept back so the founder's own Stack Exchange use isn't starved. */
const SE_RESERVE = 20;

export function intentSources(consumer: boolean): SourceStatus[] {
  const search = activeSearch();
  const s = seState();
  const gh = githubBudget("search");
  return [
    { id: "hn", label: SOURCE_LABEL.hn, state: "ready", note: "Free. Stories and comments from the last 30 days." },
    {
      id: "stackexchange",
      label: SOURCE_LABEL.stackexchange,
      state: s.backoffUntil && s.backoffUntil > Date.now() ? "setup" : "ready",
      note:
        s.backoffUntil && s.backoffUntil > Date.now()
          ? "Stack Exchange asked for a pause. It comes back on its own."
          : `Free. 300 requests a day from this computer${s.remaining !== undefined ? `, ${s.remaining} left today` : ""}.`,
    },
    consumer
      ? { id: "github", label: SOURCE_LABEL.github, state: "off", note: "Issues are for developer tools, so consumer mode leaves them out." }
      : {
          id: "github",
          label: SOURCE_LABEL.github,
          state: "ready",
          note: hasGithubToken()
            ? "Free with your token. 30 issue searches a minute."
            : `Free. 10 issue searches a minute without a token${gh.remaining !== undefined ? `, ${gh.remaining} left this minute` : ""}.`,
        },
    search
      ? { id: "reddit", label: SOURCE_LABEL.reddit, state: "ready", note: `Through ${search.name}. Each query uses one request of your daily search limit.`, href: "/settings#web-search" }
      : { id: "reddit", label: SOURCE_LABEL.reddit, state: "setup", note: "Needs a web search provider. Reddit's own API requires an account.", href: "/settings#web-search" },
    { id: "bluesky", label: SOURCE_LABEL.bluesky, state: "off", note: "Skipped: Bluesky's public search now needs a signed-in account." },
  ];
}

export interface FetchResult {
  candidates: Candidate[];
  requests: Partial<Record<IntentSourceId, SourceRequests>>;
  warnings: string[];
  skipped: { source: IntentSourceId; reason: string }[];
}

const enc = encodeURIComponent;

async function seGate() {
  const g = globalThis as unknown as { __inroadSeSlot?: number };
  const now = performance.now();
  const next = g.__inroadSeSlot ?? 0;
  g.__inroadSeSlot = Math.max(now, next) + 250;
  if (next > now) await new Promise((r) => setTimeout(r, next - now));
}

/** Fetches every query, each source in its own lane. A failed query is a warning, never the end of the scan. */
export async function fetchSources(
  queries: IntentQuery[],
  opts: { windowDays: number; now: number; signal?: AbortSignal; onQuery?: (q: IntentQuery) => void },
): Promise<FetchResult> {
  const requests: FetchResult["requests"] = {};
  const tally = (source: IntentSourceId, kind: keyof SourceRequests) => {
    const r = (requests[source] ??= { made: 0, cached: 0, failed: 0 });
    r[kind]++;
  };
  const warnings: string[] = [];
  const skipped: FetchResult["skipped"] = [];
  // Rounded to the hour, so the URL (and its cache entry) stays the same for an hour.
  const sinceSec = Math.floor((opts.now - opts.windowDays * 86_400_000) / 3_600_000) * 3600;
  const sinceDay = new Date(sinceSec * 1000).toISOString().slice(0, 10);
  const headers = { "User-Agent": API_UA };

  const lane = async (source: IntentSourceId, run: (q: IntentQuery) => Promise<Candidate[] | null>) => {
    const out: Candidate[] = [];
    for (const q of queries.filter((x) => x.source === source)) {
      if (opts.signal?.aborted) break;
      opts.onQuery?.(q);
      const got = await run(q).catch(() => null);
      if (got) out.push(...got);
    }
    return out;
  };

  const hn = lane("hn", async (q) => {
    let fetched = false;
    const url = `https://hn.algolia.com/api/v1/search?query=${enc(q.query)}&tags=(story,comment)&numericFilters=created_at_i%3E${sinceSec}&hitsPerPage=30`;
    const data = await cached(`intent:hn:${q.query.toLowerCase()}:${sinceSec}`, TTL.hour, async () => {
      fetched = true;
      await politeGate("hn");
      return (await apiJson<unknown>(url, { headers, signal: opts.signal })).data;
    });
    if (!data) {
      tally("hn", "failed");
      warnings.push(`Hacker News didn't answer for ${q.query}.`);
      return null;
    }
    tally("hn", fetched ? "made" : "cached");
    return parseHn(data, q.query, q.key);
  });

  const stack = lane("stackexchange", async (q) => {
    const site = q.site ?? "stackoverflow";
    const s = seState();
    if (s.backoffUntil && s.backoffUntil > Date.now()) {
      if (!skipped.some((x) => x.source === "stackexchange")) skipped.push({ source: "stackexchange", reason: "Stack Exchange asked for a pause; skipped this time." });
      return null;
    }
    if (s.remaining !== undefined && s.remaining <= SE_RESERVE) {
      if (!skipped.some((x) => x.source === "stackexchange")) skipped.push({ source: "stackexchange", reason: "Today's Stack Exchange allowance is nearly used up; skipped until tomorrow." });
      return null;
    }
    let fetched = false;
    const url = `https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=creation&q=${enc(q.query)}&site=${enc(site)}&fromdate=${sinceSec}&pagesize=20&filter=withbody`;
    const data = await cached(`intent:se:${site}:${q.query.toLowerCase()}:${sinceDay}`, 2 * TTL.hour, async () => {
      fetched = true;
      await seGate();
      const res = await apiJson<unknown>(url, { headers, signal: opts.signal });
      const meta = stackExchangeMeta(res.data);
      if (meta.quotaRemaining !== undefined) s.remaining = meta.quotaRemaining;
      if (meta.backoff) s.backoffUntil = Date.now() + meta.backoff * 1000;
      if (meta.error || res.status >= 400) {
        warnings.push(`Stack Exchange refused ${q.query}${meta.error ? `: ${meta.error.replace(/\.$/, "")}` : ""}.`);
        return null;
      }
      return res.data;
    });
    if (!data) {
      tally("stackexchange", "failed");
      return null;
    }
    tally("stackexchange", fetched ? "made" : "cached");
    return parseStackExchange(data, site, q.query, q.key);
  });

  const github = lane("github", async (q) => {
    const r = await githubSearchIssues(`${q.query} in:title,body is:issue created:>${sinceDay}`);
    if (r.rateLimited) {
      if (!skipped.some((x) => x.source === "github")) skipped.push({ source: "github", reason: hasGithubToken() ? "GitHub's search limit is used up for this minute." : "GitHub allows 10 searches a minute without a token; the rest wait for the next scan." });
      return null;
    }
    if (!r.data) {
      tally("github", "failed");
      warnings.push(`GitHub didn't answer for ${q.query}.`);
      return null;
    }
    tally("github", r.cached ? "cached" : "made");
    return parseGithubIssues(r.data, q.query, q.key);
  });

  const reddit = lane("reddit", async (q) => {
    const provider = activeSearch();
    if (!provider) return null;
    const res = await searchWeb(provider, q.query, 10, {
      includeDomains: ["reddit.com"],
      since: sinceDay,
      purpose: "Reddit threads where someone asks about this",
      signal: opts.signal,
    });
    if (!res.ok) {
      tally("reddit", "failed");
      warnings.push(`Reddit search through ${provider.name} failed: ${res.error.message}`);
      return null;
    }
    tally("reddit", "made");
    return parseReddit(res.value, q.query, q.key);
  });

  const lists = await Promise.all([hn, stack, github, reddit]);
  return { candidates: lists.flat(), requests, warnings: [...new Set(warnings)].slice(0, 8), skipped };
}

/* ─────────────────────────── Authors: where their profile says they work ─────────────────────────── */

/** A Hacker News user's "about" field. Cached for a week; at most a dozen per scan. */
export async function hnAbout(username: string): Promise<{ about: string | null; fetched: boolean }> {
  if (!/^[A-Za-z0-9_-]{1,30}$/.test(username)) return { about: null, fetched: false };
  let fetched = false;
  const data = await cached(`intent:hnuser:${username.toLowerCase()}`, TTL.week, async () => {
    fetched = true;
    await politeGate("hn");
    const res = await apiJson<{ about?: string | null }>(`https://hn.algolia.com/api/v1/users/${enc(username)}`, { headers: { "User-Agent": API_UA } });
    return res.data ? { about: res.data.about ?? "" } : null;
  }).catch(() => null);
  return { about: data?.about ?? null, fetched };
}
