import "server-only";
import { nowISO } from "@/lib/domain/ids";
import type { Enrichment } from "@/lib/domain/types";
import { TTL, cached } from "./cache";
import { dnsProfile, type DnsProfile } from "./dns";
import { findOpenRoles, summarizeRoles, type JobPosting } from "./jobs";
import { companyNews, hackerNews, type NewsItem } from "./news";
import { crawlSite, siteDigestToText, type SiteDigest } from "./website";

export { toDomain } from "./http";

/** News is nice-to-have; never let a slow feed hold up research. */
function within<T>(ms: number, p: Promise<T>, fallback: T): Promise<T> {
  return Promise.race([p.catch(() => fallback), new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))]);
}

/**
 * Everything we can learn about a company for free, in parallel, cached on disk.
 * Workflows hand `digest` (compact text, ~2–5K tokens) to Claude instead of letting it browse.
 */
export interface CompanySignals {
  domain: string;
  name: string;
  site: SiteDigest | null;
  jobs: JobPosting[];
  jobSource?: SiteDigest["jobBoards"][number];
  news: (NewsItem & { signal: boolean })[];
  hn: NewsItem[];
  dns: DnsProfile | null;
  enrichment: Enrichment;
  /** Compact text for a prompt. */
  digest: string;
  /** Number of free lookups performed (for the usage page). */
  lookups: number;
  /** URLs that appear in the digest, so web_fetch is allowed to open them if needed. */
  urls: string[];
}

export async function gatherSignals(
  domain: string,
  opts: {
    name?: string;
    includeSite?: boolean;
    includeNews?: boolean;
    maxPages?: number;
    /** GDELT allows one call per 5s, so parallel research queues; dossiers can afford to wait longer. */
    newsTimeoutMs?: number;
  } = {},
): Promise<CompanySignals> {
  const includeSite = opts.includeSite ?? true;
  const includeNews = opts.includeNews ?? true;

  const site = includeSite
    ? await cached(`site:${domain}:${opts.maxPages ?? 4}`, TTL.week, () => crawlSite(domain, { maxPages: opts.maxPages ?? 4 }))
    : null;
  const name = opts.name ?? site?.name ?? domain.split(".")[0];

  // Keyed on the boards we knew, so a slug-guess result never answers a lookup that found real boards.
  const boards = site?.jobBoards ?? [];
  const boardsKey = boards.length ? boards.map((b) => `${b.provider}:${b.token}`).join(",") : "guess";
  const [roles, news, hn, dns] = await Promise.all([
    cached(`jobs2:${domain}:${boardsKey}`, TTL.day, () => findOpenRoles(boards, domain, { name })),
    // The timeout sits outside the cache: a slow feed returns [] for this call only, and the lookup
    // keeps running and fills the cache when it answers.
    includeNews
      ? within(opts.newsTimeoutMs ?? 15_000, cached(`news:${domain}`, 12 * TTL.hour, () => companyNews(name, domain)), [])
      : Promise.resolve([]),
    includeNews ? cached(`hn:${domain}`, 12 * TTL.hour, () => hackerNews(domain)) : Promise.resolve([]),
    // An all-empty profile means DoH failed, not "no mail server": return null so it isn't cached.
    cached(`dns:${domain}`, TTL.week, () =>
      dnsProfile(domain)
        .then((p) => (p.mx.length || p.spf || p.dmarc || p.saas.length ? p : null))
        .catch(() => null),
    ),
  ]);

  const byTeam = new Map<string, string[]>();
  for (const j of roles.jobs) byTeam.set(j.team || "Other", [...(byTeam.get(j.team || "Other") ?? []), j.title]);

  const enrichment: Enrichment = {
    crawledAt: nowISO(),
    title: site?.pages[0]?.title,
    description: site?.pages[0]?.description,
    tech: [...new Set([...(site?.tech ?? []), ...(dns?.saas ?? [])])],
    socials: site?.socials ?? {},
    jobBoard: roles.source,
    openRoles: roles.jobs.length,
    rolesByTeam: [...byTeam.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([team, titles]) => ({ team, count: titles.length, titles: [...new Set(titles)].slice(0, 6) })),
    news: news.slice(0, 8).map((n) => ({ title: n.title, url: n.url, source: n.source, publishedAt: n.publishedAt, signal: n.signal })),
  };

  const recentJobs = roles.jobs
    .filter((j) => j.postedAt)
    .sort((a, b) => (b.postedAt ?? "").localeCompare(a.postedAt ?? ""))
    .slice(0, 12);

  const parts: string[] = [];
  if (site) parts.push(siteDigestToText(site));
  else parts.push(`Website: ${domain} (could not be read)`);
  if (dns) parts.push(`Email provider: ${dns.emailProvider}. SaaS seen in DNS: ${dns.saas.join(", ") || "none"}`);
  parts.push(
    `\n## Open roles (${roles.jobs.length}${roles.source ? `, ${roles.source.provider} board "${roles.source.token}"` : ""})\n${summarizeRoles(roles.jobs)}`,
  );
  if (recentJobs.length) {
    parts.push(`Most recent postings:\n${recentJobs.map((j) => `- ${j.postedAt?.slice(0, 10)} · ${j.title}${j.team ? ` (${j.team})` : ""}${j.url ? ` · ${j.url}` : ""}`).join("\n")}`);
  }
  if (news.length) {
    parts.push(`\n## News (newest first)\n${news.map((n) => `- ${n.publishedAt?.slice(0, 10) ?? "undated"} · ${n.title} · ${n.source} · ${n.url}`).join("\n")}`);
  }
  if (hn.length) {
    parts.push(`\n## Hacker News\n${hn.map((n) => `- ${n.publishedAt?.slice(0, 10)} · ${n.title} · ${n.url}`).join("\n")}`);
  }

  const urls = [
    ...(site?.pages.map((p) => p.url) ?? []),
    ...recentJobs.map((j) => j.url).filter(Boolean),
    ...news.map((n) => n.url),
    ...hn.map((n) => n.url),
  ] as string[];

  return {
    domain,
    name,
    site,
    jobs: roles.jobs,
    jobSource: roles.source,
    news,
    hn,
    dns,
    enrichment,
    digest: parts.join("\n"),
    lookups: (site ? site.pages.length : 0) + 1 + (includeNews ? 2 : 0) + 1,
    urls,
  };
}
