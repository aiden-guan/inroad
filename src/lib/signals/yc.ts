import "server-only";
import { TTL, cached } from "./cache";
import { fetchText, toDomain } from "./http";
import type { JobPosting } from "./jobs";

/**
 * The YC directory (yc-oss mirror, refreshed daily): ~6,300 launched companies with one-liner,
 * team size, industry, tags, batch, hiring flag and locations. Free, no key, no tokens.
 * We download it once a day, keep a compact copy on disk, and rank it in code.
 */

const ALL_URL = "https://yc-oss.github.io/api/companies/all.json";

export interface YcCompany {
  slug: string;
  name: string;
  domain: string;
  oneLiner: string;
  description: string; // ≤400 chars
  teamSize: number | null;
  industry: string;
  subindustry: string;
  tags: string[];
  batch: string;
  status: string; // Active | Acquired | Inactive | Public
  stage: string; // Early | Growth
  isHiring: boolean;
  regions: string[];
  locations: string;
  launchedAt: number | null; // unix seconds
}

interface RawYc {
  slug?: string;
  name?: string;
  website?: string;
  one_liner?: string;
  long_description?: string;
  team_size?: number | null;
  industry?: string;
  subindustry?: string;
  tags?: string[];
  batch?: string;
  status?: string;
  stage?: string;
  isHiring?: boolean;
  regions?: string[];
  all_locations?: string;
  launched_at?: number | null;
}

// Profiles that point at a directory or social page instead of the company's own site.
const NOT_A_COMPANY_SITE = /(^|\.)(ycombinator|producthunt|linkedin|github|twitter|x|facebook|instagram|medium|angel|wellfound|google|apple|notion|substack|linktr|carrd|bit)\.[a-z.]+$/i;

function compact(raw: RawYc): YcCompany[] {
  const domain = raw.website ? toDomain(raw.website) : null;
  if (!domain || NOT_A_COMPANY_SITE.test(domain) || !raw.name || !raw.slug) return [];
  return [
    {
      slug: raw.slug,
      name: raw.name.trim(),
      domain,
      oneLiner: (raw.one_liner ?? "").trim().slice(0, 200),
      description: (raw.long_description ?? "").replace(/\s+/g, " ").trim().slice(0, 400),
      teamSize: typeof raw.team_size === "number" && raw.team_size > 0 ? raw.team_size : null,
      industry: raw.industry ?? "",
      subindustry: raw.subindustry ?? "",
      tags: (raw.tags ?? []).slice(0, 12),
      batch: raw.batch ?? "",
      status: raw.status ?? "",
      stage: raw.stage ?? "",
      isHiring: Boolean(raw.isHiring),
      regions: (raw.regions ?? []).slice(0, 8),
      locations: (raw.all_locations ?? "").slice(0, 120),
      launchedAt: typeof raw.launched_at === "number" ? raw.launched_at : null,
    },
  ];
}

const memo = (() => {
  const g = globalThis as unknown as { __inroadYc?: { at: number; data: YcCompany[] }; __inroadYcPending?: Promise<YcCompany[]> };
  return g;
})();

async function load(hit: { at: number; data: YcCompany[] } | undefined): Promise<YcCompany[]> {
  try {
    const data = await cached("yc:all:v2", TTL.day, async () => {
      const res = await fetchText(ALL_URL, { timeoutMs: 45_000, maxBytes: 40_000_000, accept: "application/json" });
      if (!res) throw new Error("YC directory unreachable");
      const raw = JSON.parse(res.body) as RawYc[];
      if (!Array.isArray(raw) || raw.length < 100) throw new Error("YC directory looked wrong");
      return raw.flatMap(compact);
    });
    memo.__inroadYc = { at: Date.now(), data };
    return data;
  } catch {
    return hit?.data ?? [];
  }
}

/** The whole directory, compacted. Empty array if it can't be reached (never cached empty). */
export async function ycDirectory(): Promise<YcCompany[]> {
  const hit = memo.__inroadYc;
  if (hit && Date.now() - hit.at < TTL.hour) return hit.data;
  // Concurrent callers (lookups per keystroke, a discovery run) share one multi-MB download.
  memo.__inroadYcPending ??= load(hit).finally(() => {
    memo.__inroadYcPending = undefined;
  });
  return memo.__inroadYcPending;
}

/**
 * The YC company that owns a domain. An acquired company's profile often points at the acquirer's
 * site (Paribus → ramp.com), so an acquired match only counts when its name matches the domain.
 */
export function ycByDomain(dir: YcCompany[], domain: string): YcCompany | undefined {
  const d = domain.toLowerCase();
  const stem = d.split(".")[0].replace(/[^a-z0-9]/g, "");
  const matches = dir.filter((c) => c.domain === d);
  const named = (c: YcCompany) => {
    const n = normalizeCompanyName(c.name).replace(/ /g, "");
    return n.includes(stem) || stem.includes(n);
  };
  return matches.find((c) => c.status !== "Acquired" && named(c)) ?? matches.find((c) => c.status !== "Acquired") ?? matches.find(named);
}

export function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\b(inc|llc|ltd|corp|corporation|co|gmbh|plc|sa|bv|hq|the)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function ycByName(dir: YcCompany[], name: string): YcCompany | undefined {
  const n = normalizeCompanyName(name);
  if (n.length < 2) return undefined;
  return dir.find((c) => normalizeCompanyName(c.name) === n);
}

export function ycUrl(c: Pick<YcCompany, "slug">): string {
  return `https://www.ycombinator.com/companies/${c.slug}`;
}

/** "Summer 2024" → 2024. */
export function batchYear(batch: string): number | null {
  const m = batch.match(/(20\d\d|19\d\d)/);
  return m ? Number(m[1]) : null;
}

/** "Summer 2024" → "S24", "Spring 2026" → "X26". Matches how YC writes batches. */
export function shortBatch(batch: string): string {
  const year = batchYear(batch);
  if (!year) return batch;
  const season = batch.match(/winter|summer|spring|fall/i)?.[0].toLowerCase();
  const letter = season === "winter" ? "W" : season === "summer" ? "S" : season === "spring" ? "X" : season === "fall" ? "F" : "";
  return `${letter}${String(year).slice(2)}`;
}

/* ─────────────────────────── Ranking in code ─────────────────────────── */

export interface YcQuery {
  /** Lowercased tag/industry → weight (already includes rarity). */
  tags: Map<string, number>;
  /** Lowercased content words with weights, matched against one-liner + description. */
  keywords: Map<string, number>;
  /** Soft team-size band (people); outside it costs points. */
  teamBand?: [number, number];
  /** Hard team-size band, from the founder's own brief. */
  hardTeamBand?: [number, number];
  /** Hard location filter, from the founder's brief. */
  region?: RegExp;
  /** Soft location preference, from the ICP. */
  softRegion?: RegExp;
  excludeDomains: Set<string>;
  excludeNames: Set<string>;
}

export interface YcMatch {
  company: YcCompany;
  score: number;
  matched: string[];
}

function wordRe(term: string) {
  const esc = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`(^|[^a-z0-9])${esc}(s|es)?($|[^a-z0-9])`, "i");
}

/** Tag/industry vocabulary with rarity weights, computed once per directory load. */
export function ycVocabulary(dir: YcCompany[]): Map<string, { label: string; weight: number; re: RegExp }> {
  const counts = new Map<string, { label: string; n: number }>();
  const bump = (label: string) => {
    const key = label.toLowerCase().trim();
    if (!key || key === "unspecified") return;
    const cur = counts.get(key);
    if (cur) cur.n++;
    else counts.set(key, { label, n: 1 });
  };
  for (const c of dir) {
    const seen = new Set<string>();
    for (const t of [...c.tags, c.industry, ...c.subindustry.split("->").map((s) => s.trim())]) {
      if (t && !seen.has(t.toLowerCase())) {
        seen.add(t.toLowerCase());
        bump(t);
      }
    }
  }
  const total = Math.max(1, dir.length);
  const out = new Map<string, { label: string; weight: number; re: RegExp }>();
  for (const [key, { label, n }] of counts) {
    if (n < 3) continue;
    out.set(key, { label, weight: Math.max(0.2, Math.log(total / n)), re: wordRe(key) });
  }
  return out;
}

/** Document frequency of a word across one-liners and descriptions (for keyword rarity). */
export function ycDocFrequency(dir: YcCompany[], word: string): number {
  const re = wordRe(word);
  let n = 0;
  for (const c of dir) if (re.test(c.oneLiner) || re.test(c.description)) n++;
  return n;
}

export function rankYc(dir: YcCompany[], q: YcQuery, limit: number): YcMatch[] {
  const tagEntries = [...q.tags.entries()];
  const kwEntries = [...q.keywords.entries()].map(([k, w]) => [k, w, wordRe(k)] as const);
  const out: YcMatch[] = [];
  const thisYear = new Date().getFullYear();

  for (const c of dir) {
    if (c.status !== "Active") continue;
    if (q.excludeDomains.has(c.domain) || q.excludeNames.has(normalizeCompanyName(c.name))) continue;
    if (q.hardTeamBand && c.teamSize !== null && (c.teamSize < q.hardTeamBand[0] || c.teamSize > q.hardTeamBand[1])) continue;
    if (q.region && !q.region.test(`${c.locations} ${c.regions.join(" ")}`)) continue;

    const ctags = new Set([...c.tags, c.industry, ...c.subindustry.split("->").map((s) => s.trim())].map((t) => t.toLowerCase()));
    let tagScore = 0;
    const matched: string[] = [];
    for (const [tag, w] of tagEntries) {
      if (ctags.has(tag)) {
        tagScore += w;
        matched.push(tag);
      }
    }
    const text = `${c.oneLiner} ${c.description}`;
    let kwScore = 0;
    let kwHits = 0;
    for (const [kw, w, re] of kwEntries) {
      if (re.test(text)) {
        kwScore += w;
        kwHits++;
        matched.push(kw);
      }
    }
    if (tagScore === 0 && kwHits < 2) continue;

    let score = tagScore + Math.min(6, kwScore * 0.5);
    if (c.isHiring) score += 0.8;
    const year = batchYear(c.batch);
    if (year && thisYear - year <= 3) score += 0.4;
    if (q.teamBand && c.teamSize !== null) score += c.teamSize >= q.teamBand[0] && c.teamSize <= q.teamBand[1] ? 0.6 : -0.8;
    if (q.softRegion && q.softRegion.test(`${c.locations} ${c.regions.join(" ")}`)) score += 0.4;
    out.push({ company: c, score, matched });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

/* ─────────────────────────── Jobs on YC's own board ─────────────────────────── */

/** "20 days", "about 1 month", "over 2 years" → days ago. */
function relativeDays(text: string | undefined): number | null {
  if (!text) return null;
  const t = text.toLowerCase();
  if (/less than|minute|hour|today|just/.test(t)) return 0;
  const m = t.match(/(\d+|an?|one)\s+(day|week|month|year)s?/);
  if (!m) return null;
  const n = /^\d+$/.test(m[1]) ? Number(m[1]) : 1;
  const per = m[2] === "day" ? 1 : m[2] === "week" ? 7 : m[2] === "month" ? 30 : 365;
  return n * per;
}

function decodeEntities(s: string) {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

interface YcJobsPage {
  props?: { jobPostings?: { title?: string; url?: string; location?: string; prettyRole?: string; createdAt?: string }[] };
}

/**
 * Open roles a YC company lists on ycombinator.com (for companies without a public ATS board).
 * YC shows posting age as relative text ("20 days"), so dates are approximate past a month.
 */
export async function ycJobs(slug: string): Promise<JobPosting[]> {
  try {
    return await cached(`ycjobs:${slug}`, TTL.day, async () => {
      const res = await fetchText(`https://www.ycombinator.com/companies/${encodeURIComponent(slug)}/jobs`, { timeoutMs: 10_000, maxBytes: 3_000_000 });
      if (!res) throw new Error("unreachable");
      const attr = res.body.match(/data-page="([^"]+)"/)?.[1];
      if (!attr) return [];
      const page = JSON.parse(decodeEntities(attr)) as YcJobsPage;
      const now = Date.now();
      return (page.props?.jobPostings ?? []).flatMap((j) => {
        if (!j.title) return [];
        const days = relativeDays(j.createdAt);
        return [
          {
            title: j.title.trim(),
            team: j.prettyRole,
            location: j.location,
            url: j.url ? `https://www.ycombinator.com${j.url}` : `https://www.ycombinator.com/companies/${slug}/jobs`,
            postedAt: days === null ? undefined : new Date(now - days * 86_400_000).toISOString(),
          },
        ];
      });
    });
  } catch {
    return [];
  }
}
