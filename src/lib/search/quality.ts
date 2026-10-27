import type { WebResult } from "@/lib/connectors/firecrawl";
export interface SearchHit extends WebResult {
  publishedAt?: string;
}
export interface SearchFilters {
  includeDomains?: string[];
  excludeDomains?: string[];
  since?: string;
  purpose?: string;
  fresh?: boolean;
  signal?: AbortSignal;
}
export function canonicalUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return null;
    url.hash = "";
    for (const name of [...url.searchParams.keys()]) if (/^(utm_|fbclid|gclid|msclkid|ref$)/i.test(name)) url.searchParams.delete(name);
    url.searchParams.sort();
    return url.href;
  } catch {
    return null;
  }
}
export const textTokens = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu) ?? [];
const hostMatches = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);
export function cleanDomains(domains: string[] = []): string[] {
  return [
    ...new Set(
      domains.map((d) =>
        d
          .trim()
          .toLowerCase()
          .replace(/^www\./, ""),
      ),
    ),
  ]
    .filter((d) => /^(?:[a-z0-9-]+\.)+[a-z]{2,63}$/.test(d))
    .slice(0, 10);
}
export function querySuffix(filters: SearchFilters): string {
  return [
    cleanDomains(filters.includeDomains)
      .map((domain) => `site:${domain}`)
      .join(" OR "),
    ...cleanDomains(filters.excludeDomains).map((domain) => `-site:${domain}`),
    filters.since ? `after:${filters.since}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}
export function rankResults(rows: SearchHit[], query: string, filters: SearchFilters = {}, limit = 20): SearchHit[] {
  const include = cleanDomains(filters.includeDomains),
    exclude = cleanDomains(filters.excludeDomains);
  const tokens = [...new Set(textTokens(query).filter((t) => t.length > 2 && !["the", "and", "for", "that", "with", "find", "companies"].includes(t)))];
  const unique = new Map<string, { hit: SearchHit; score: number; rank: number }>();
  rows.forEach((row, rank) => {
    const url = canonicalUrl(row.url);
    if (!url) return;
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (include.length && !include.some((d) => hostMatches(host, d))) return;
    if (exclude.some((d) => hostMatches(host, d))) return;
    if (filters.since && row.publishedAt && row.publishedAt.slice(0, 10) < filters.since) return;
    const title = new Set(textTokens(row.title)),
      body = new Set(textTokens(row.description));
    const score = tokens.reduce((n, t) => n + (title.has(t) ? 4 : body.has(t) ? 1 : 0), 0) + (row.description.length >= 80 ? 1 : 0);
    const current = unique.get(url);
    const hit = { ...row, url };
    if (!current || score > current.score || row.description.length > current.hit.description.length) unique.set(url, { hit, score, rank });
  });
  const ranked = [...unique.values()].sort((a, b) => b.score - a.score || a.rank - b.rank);
  // First diversify domains, then fill remaining slots. Preserve useful multiple pages on small result sets.
  const counts = new Map<string, number>();
  const out: SearchHit[] = [],
    rest: SearchHit[] = [];
  for (const { hit } of ranked) {
    const host = new URL(hit.url).hostname;
    const count = counts.get(host) ?? 0;
    (count < 2 ? out : rest).push(hit);
    counts.set(host, count + 1);
  }
  return [...out, ...rest].slice(0, limit);
}

/** Preserve quotes and operators. Split long briefs at word boundaries and show every query to the user. */
export function planQueries(query: string, maxLength = 128): string[] {
  const words =
    query
      .trim()
      .replace(/\s+/g, " ")
      .match(/"[^"]+"|\S+/g) ?? [];
  const queries: string[] = [];
  let current = "";
  for (const word of words) {
    if (word.length > maxLength) throw new Error(`A search term exceeds ${maxLength} characters. Shorten that term.`);
    if (`${current} ${word}`.trim().length > maxLength) {
      queries.push(current);
      current = "";
    }
    current = `${current} ${word}`.trim();
  }
  if (current) queries.push(current);
  if (queries.length > 3) throw new Error("Focus the search on a shorter brief; at most three queries run at once.");
  return queries;
}
