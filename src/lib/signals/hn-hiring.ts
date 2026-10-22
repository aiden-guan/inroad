import "server-only";
import { TTL, cached } from "./cache";
import { politeGate } from "./gate";
import { API_UA, fetchJSON, toDomain } from "./http";

/**
 * Hacker News "Ask HN: Who is hiring?": the monthly thread where hundreds of startups post open roles,
 * one top-level comment each ("Acme | Founding Platform Engineer | Remote (US) | acme.com/careers").
 * Read through Algolia's free HN API: one request finds the thread, one reads the whole tree. Cached.
 */

const UA = { "User-Agent": API_UA };

export interface HiringThread {
  id: string;
  title: string;
  url: string;
  createdAt: string;
}

export interface HiringPost {
  id: string;
  /** The comment on news.ycombinator.com. */
  url: string;
  company: string;
  domain?: string;
  /** An ATS board the post links to, which carries the company's job-board slug. */
  board?: { provider: "ashby" | "greenhouse" | "lever" | "workable"; token: string };
  roles: string[];
  location?: string;
  /** Plain text, ≤1500 chars. */
  text: string;
  postedAt: string;
}

interface AlgoliaSearch {
  hits?: { objectID: string; title?: string; created_at?: string }[];
}
interface AlgoliaItem {
  id: number;
  created_at?: string;
  title?: string;
  text?: string | null;
  author?: string | null;
  children?: AlgoliaItem[];
}

export async function latestHiringThread(): Promise<HiringThread | null> {
  try {
    return await cached("hnhiring:thread:v1", 6 * TTL.hour, async () => {
      await politeGate("hn");
      const data = await fetchJSON<AlgoliaSearch>("https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&hitsPerPage=6", 10_000, { headers: UA });
      const hit = (data?.hits ?? []).find((h) => /^Ask HN: Who is hiring\?/i.test(h.title ?? ""));
      if (!hit) throw new Error("no thread");
      return { id: hit.objectID, title: hit.title!, url: `https://news.ycombinator.com/item?id=${hit.objectID}`, createdAt: hit.created_at ?? "" };
    });
  } catch {
    return null;
  }
}

function decode(s: string): string {
  return s
    .replace(/&#x2F;/gi, "/")
    .replace(/&#x27;|&#39;|&apos;/gi, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&");
}

const plain = (html: string) =>
  decode(html.replace(/<p>/gi, "\n").replace(/<[^>]+>/g, " "))
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();

const ATS: [RegExp, NonNullable<HiringPost["board"]>["provider"]][] = [
  [/^https?:\/\/jobs\.ashbyhq\.com\/([^/?#]+)/i, "ashby"],
  [/^https?:\/\/(?:job-)?boards\.greenhouse\.io\/(?:embed\/job_board\?for=)?([^/?#&]+)/i, "greenhouse"],
  [/^https?:\/\/jobs\.lever\.co\/([^/?#]+)/i, "lever"],
  [/^https?:\/\/apply\.workable\.com\/([^/?#]+)/i, "workable"],
];

// Links that never point at the company's own site.
const NOT_COMPANY =
  /(^|\.)(ycombinator|workatastartup|github|gitlab|linkedin|google|notion|notion\.site|airtable|typeform|wellfound|angel|bit|calendly|ashbyhq|greenhouse|lever|workable|breezy|recruitee|rippling|bamboohr|jobvite|smartrecruiters|teamtailor|twitter|x|youtube|medium|substack)\.[a-z.]+$/i;
const CAREERS_SUBDOMAIN = /^(jobs|careers|career|apply|join|work|hiring|boards?)\./i;
const DOMAIN_IN_TEXT = /\b((?:[a-z0-9-]+\.)+(?:com|io|ai|co|dev|app|so|xyz|org|net|tech|health|finance|tools|sh|cloud|inc|us|uk|de|fr|eu|ca))\b/i;

const ROLE = /\b(engineer\w*|developer|architect|designer|scientist|analyst|manager|lead|head of|director|vp|chief|founding|recruiter|marketer|marketing|sales|account executive|sdr|bdr|operations|ops|support|success|accountant|controller|counsel|writer|researcher|intern|cto|cfo|coo)\b/i;
const PLACE_WORD = /\b(remote|onsite|on-site|hybrid|in[- ]office|relocation|visa)\b/i;
const PLACE_NAME = /\b[A-Z][a-z]+(?: [A-Z][a-z]+)?, ?[A-Z]{2}\b|\b(NYC|SF|London|Berlin|Toronto|Paris|Austin|Seattle|Boston)\b/;
const isPlace = (s: string) => PLACE_WORD.test(s) || PLACE_NAME.test(s);

function companySite(href: string): string | undefined {
  const d = toDomain(href);
  if (!d || NOT_COMPANY.test(d)) return undefined;
  const apex = CAREERS_SUBDOMAIN.test(d) && d.split(".").length >= 3 ? d.replace(CAREERS_SUBDOMAIN, "") : d;
  return apex;
}

/** One top-level comment → a post, or null when it isn't one (a meta comment, a reply, a deleted post). */
export function parseHiringPost(c: Pick<AlgoliaItem, "id" | "text" | "created_at">): HiringPost | null {
  if (!c.text || !c.created_at) return null;
  const html = c.text;
  const headerHtml = html.split(/<p>/i)[0];
  const header = plain(headerHtml);
  const segments = header.split(/\s*\|\s*/).map((s) => s.trim()).filter(Boolean);
  // A real post leads with "Company | Role | …". Meta comments ("Please don't…") don't.
  if (segments.length < 2) return null;
  const company = segments[0]
    .replace(/\((?:YC|Y Combinator)[^)]*\)/gi, "")
    .replace(/\(.*?\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!company || company.length > 60 || /^(please|note|reminder|hi|hello|edit)\b/i.test(company)) return null;

  const hrefs = [...html.matchAll(/href="([^"]+)"/gi)].map((m) => decode(m[1]));
  let board: HiringPost["board"];
  for (const h of hrefs) {
    for (const [re, provider] of ATS) {
      const t = h.match(re)?.[1];
      if (t && !board) board = { provider, token: decodeURIComponent(t).toLowerCase() };
    }
  }
  const textDomain = header.match(DOMAIN_IN_TEXT)?.[1];
  const domain = (textDomain && companySite(textDomain)) ?? hrefs.map(companySite).find(Boolean);

  const roles = segments.slice(1).filter((s) => ROLE.test(s) && s.length <= 120).flatMap((s) => s.split(/\s*(?:,|;|\/| or | and )\s*(?=[A-Z])/)).map((s) => s.trim()).filter((s) => s && ROLE.test(s));
  const location = segments.slice(1).find((s) => isPlace(s) && !ROLE.test(s));
  return {
    id: String(c.id),
    url: `https://news.ycombinator.com/item?id=${c.id}`,
    company,
    ...(domain ? { domain } : {}),
    ...(board ? { board } : {}),
    roles: [...new Set(roles)].slice(0, 6),
    ...(location ? { location: location.slice(0, 80) } : {}),
    text: plain(html).slice(0, 1500),
    postedAt: c.created_at,
  };
}

/** Every company post in a thread (top-level comments only). */
export async function hiringPosts(threadId: string): Promise<HiringPost[]> {
  try {
    return await cached(`hnhiring:posts:v1:${threadId}`, 6 * TTL.hour, async () => {
      await politeGate("hn");
      const item = await fetchJSON<AlgoliaItem>(`https://hn.algolia.com/api/v1/items/${encodeURIComponent(threadId)}`, 20_000, { headers: UA, maxBytes: 12_000_000 });
      if (!item?.children) throw new Error("thread unreadable");
      return item.children.flatMap((c) => parseHiringPost(c) ?? []);
    });
  } catch {
    return [];
  }
}

export interface HiringMatch {
  post: HiringPost;
  /** The keywords it mentions. */
  hits: string[];
  /** About 240 characters around the first keyword: the part worth reading. */
  excerpt: string;
}

function wordRe(term: string): RegExp {
  const esc = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`(^|[^a-z0-9])${esc}(s|es)?($|[^a-z0-9])`, "i");
}

/** Posts that mention any keyword, the most keywords first. */
export function matchPosts(posts: HiringPost[], keywords: string[], limit = 30): HiringMatch[] {
  const res = [...new Set(keywords.map((k) => k.trim().toLowerCase()).filter((k) => k.length >= 3))].map((k) => [k, wordRe(k)] as const);
  if (!res.length) return [];
  const out: HiringMatch[] = [];
  for (const post of posts) {
    const hay = `${post.company} ${post.roles.join(" ")} ${post.text}`;
    const hits = res.filter(([, re]) => re.test(hay)).map(([k]) => k);
    if (!hits.length) continue;
    const at = post.text.search(res.find(([k]) => hits.includes(k))![1]);
    const from = Math.max(0, at - 100);
    const excerpt = `${from > 0 ? "…" : ""}${post.text.slice(from, from + 240).replace(/\n/g, " ").trim()}${from + 240 < post.text.length ? "…" : ""}`;
    out.push({ post, hits, excerpt });
  }
  return out.sort((a, b) => b.hits.length - a.hits.length || b.post.postedAt.localeCompare(a.post.postedAt)).slice(0, limit);
}

/** The latest thread's posts that mention the keywords. Two requests at most, both cached. */
export async function whoIsHiring(keywords: string[], limit = 30): Promise<{ thread: HiringThread | null; matches: HiringMatch[] }> {
  const thread = await latestHiringThread();
  if (!thread) return { thread: null, matches: [] };
  return { thread, matches: matchPosts(await hiringPosts(thread.id), keywords, limit) };
}
