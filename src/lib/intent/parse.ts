import type { IntentSourceId } from "./types";

/**
 * Each source's raw API response → one shape (a candidate post), in code. Pure, so every parser is tested against
 * saved responses (src/test/fixtures/signals/intent). Nothing here is judged; that happens after dedupe.
 */

export interface Candidate {
  key: string;
  thread: string;
  source: IntentSourceId;
  site?: string;
  url: string;
  title: string;
  /** Plain text, HTML and Markdown noise removed, at most 2,000 characters. */
  text: string;
  author: string;
  authorUrl?: string;
  postedAt?: string;
  query: string;
  queryKey: string;
  /** GitHub: the author's association with the repo (OWNER, MEMBER, CONTRIBUTOR, NONE…). */
  association?: string;
  bot?: boolean;
  /** Where a snippet came from, when the text is a search provider's extract rather than the post. */
  snippet?: boolean;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…", mdash: "—", ndash: "–", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

/** HTML (HN, Stack Exchange) or Markdown (GitHub) → plain sentences. Code blocks and images are dropped. */
export function plainText(raw: string | null | undefined, max = 2000): string {
  const stripped = (raw ?? "")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<pre[\s\S]*?<\/pre>/gi, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\((?:[^)]*)\)/g, "$1")
    .replace(/<(br|p|li|div|h\d)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  const text = decodeEntities(stripped)
    .replace(/^[ \t]*#{1,6}\s+/gm, "")
    .replace(/^[ \t]*>[ \t]?/gm, "")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/__([^_\n]+)__/g, "$1")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/[ \t\r\f\v]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).replace(/\s+\S*$/, "")}…` : text;
}

const BOT = /\[bot\]$|^(dependabot|renovate|github-actions|codecov|sonarcloud|vercel|netlify|stale)(-bot)?$/i;
export const isBotLogin = (login: string | undefined) => !!login && BOT.test(login);

/* ─────────────────────────── Hacker News (Algolia) ─────────────────────────── */

interface HnHit {
  objectID: string;
  title?: string | null;
  story_title?: string | null;
  story_text?: string | null;
  comment_text?: string | null;
  story_id?: number | null;
  author?: string;
  created_at?: string;
  _tags?: string[];
  url?: string | null;
}

export function parseHn(json: unknown, query: string, queryKey: string): Candidate[] {
  const hits = (json as { hits?: HnHit[] } | null)?.hits;
  if (!Array.isArray(hits)) return [];
  return hits.flatMap((h): Candidate[] => {
    if (!h?.objectID || !/^\d+$/.test(h.objectID)) return [];
    const tags = h._tags ?? [];
    const comment = tags.includes("comment");
    const title = decodeEntities(String((comment ? h.story_title : h.title) ?? "")).trim().slice(0, 200);
    const text = plainText(comment ? h.comment_text : h.story_text);
    if (!title && !text) return [];
    const author = h.author ?? "";
    return [
      {
        key: `hn:${h.objectID}`,
        thread: `hn:${comment && h.story_id ? h.story_id : h.objectID}`,
        source: "hn",
        site: tags.includes("ask_hn") ? "Ask HN" : comment ? "Comment" : tags.includes("show_hn") ? "Show HN" : "Story",
        url: `https://news.ycombinator.com/item?id=${h.objectID}`,
        title: title || "A Hacker News thread",
        text,
        author,
        ...(author ? { authorUrl: `https://news.ycombinator.com/user?id=${encodeURIComponent(author)}` } : {}),
        ...(h.created_at && Number.isFinite(Date.parse(h.created_at)) ? { postedAt: new Date(h.created_at).toISOString() } : {}),
        query,
        queryKey,
      },
    ];
  });
}

/** Threads where every comment is a job post or a résumé, not a need. */
export const HN_JOB_THREAD = /\b(who is hiring|who wants to be hired|seeking freelancer|freelancer\? seeking)\b/i;

/* ─────────────────────────── Stack Exchange ─────────────────────────── */

export const SITE_LABEL: Record<string, string> = {
  stackoverflow: "Stack Overflow",
  softwarerecs: "Software Recommendations",
  devops: "DevOps",
  security: "Information Security",
  dba: "Database Administrators",
  datascience: "Data Science",
  money: "Personal Finance & Money",
  pm: "Project Management",
  fitness: "Physical Fitness",
  parenting: "Parenting",
  cooking: "Seasoned Advice",
  travel: "Travel",
  photo: "Photography",
  gardening: "Gardening",
  pets: "Pets",
};

interface SeItem {
  question_id?: number;
  title?: string;
  body?: string;
  link?: string;
  creation_date?: number;
  owner?: { display_name?: string; link?: string; user_type?: string };
  closed_reason?: string;
}

export interface SeMeta {
  quotaRemaining?: number;
  backoff?: number;
  error?: string;
}

export function stackExchangeMeta(json: unknown): SeMeta {
  const j = (json ?? {}) as { quota_remaining?: unknown; backoff?: unknown; error_message?: unknown; error_name?: unknown };
  return {
    ...(typeof j.quota_remaining === "number" ? { quotaRemaining: j.quota_remaining } : {}),
    ...(typeof j.backoff === "number" ? { backoff: j.backoff } : {}),
    ...(typeof j.error_message === "string" ? { error: j.error_message } : {}),
  };
}

export function parseStackExchange(json: unknown, site: string, query: string, queryKey: string): Candidate[] {
  const items = (json as { items?: SeItem[] } | null)?.items;
  if (!Array.isArray(items)) return [];
  return items.flatMap((q): Candidate[] => {
    if (!q?.question_id || !q.link || !q.title) return [];
    const author = decodeEntities(q.owner?.display_name ?? "").slice(0, 80);
    return [
      {
        key: `stackexchange:${site}:${q.question_id}`,
        thread: `stackexchange:${site}:${q.question_id}`,
        source: "stackexchange",
        site: SITE_LABEL[site] ?? site,
        url: q.link,
        title: decodeEntities(q.title).slice(0, 200),
        text: plainText(q.body),
        author,
        ...(q.owner?.link ? { authorUrl: q.owner.link } : {}),
        ...(q.creation_date ? { postedAt: new Date(q.creation_date * 1000).toISOString() } : {}),
        query,
        queryKey,
      },
    ];
  });
}

/* ─────────────────────────── GitHub issue search ─────────────────────────── */

interface GhIssue {
  html_url?: string;
  number?: number;
  title?: string;
  body?: string | null;
  created_at?: string;
  repository_url?: string;
  author_association?: string;
  pull_request?: unknown;
  user?: { login?: string; html_url?: string; type?: string } | null;
}

/** "https://api.github.com/repos/acme/sdk" → "acme/sdk". */
export function repoOf(apiUrl: string | undefined): string | undefined {
  return apiUrl?.match(/\/repos\/([^/]+\/[^/]+)$/)?.[1];
}

export function parseGithubIssues(json: unknown, query: string, queryKey: string): Candidate[] {
  const items = (json as { items?: GhIssue[] } | null)?.items;
  if (!Array.isArray(items)) return [];
  return items.flatMap((i): Candidate[] => {
    const repo = repoOf(i.repository_url);
    const login = i.user?.login;
    if (!i.html_url || !i.title || !repo || !login || i.pull_request) return [];
    const bot = i.user?.type === "Bot" || isBotLogin(login);
    return [
      {
        key: `github:${repo}#${i.number}`,
        thread: `github:${repo}#${i.number}`,
        source: "github",
        site: repo,
        url: i.html_url,
        title: i.title.slice(0, 200),
        text: plainText(i.body),
        author: login,
        authorUrl: i.user?.html_url ?? `https://github.com/${login}`,
        ...(i.created_at ? { postedAt: new Date(i.created_at).toISOString() } : {}),
        query,
        queryKey,
        ...(i.author_association ? { association: i.author_association } : {}),
        ...(bot ? { bot } : {}),
      },
    ];
  });
}

/* ─────────────────────────── Reddit, through the founder's search provider ─────────────────────────── */

export function parseReddit(hits: { url: string; title: string; description: string; publishedAt?: string }[], query: string, queryKey: string): Candidate[] {
  return hits.flatMap((h): Candidate[] => {
    const m = h.url.match(/^https?:\/\/(?:(?:www|old|new)\.)?reddit\.com\/r\/([A-Za-z0-9_]{2,21})\/comments\/([a-z0-9]{4,10})(?:\/|$)/i);
    if (!m) return [];
    const sub = m[1];
    const id = m[2].toLowerCase();
    const title = h.title.replace(/\s*[:|–-]\s*r\/[A-Za-z0-9_]+\s*$/i, "").replace(/\s*[-|]\s*reddit\s*$/i, "").trim().slice(0, 200);
    return [
      {
        key: `reddit:${sub.toLowerCase()}:${id}`,
        thread: `reddit:${sub.toLowerCase()}:${id}`,
        source: "reddit",
        site: `r/${sub}`,
        url: `https://www.reddit.com/r/${sub}/comments/${id}/`,
        title: title || `A thread in r/${sub}`,
        text: plainText(h.description, 1200),
        author: "",
        ...(h.publishedAt && Number.isFinite(Date.parse(h.publishedAt)) ? { postedAt: new Date(h.publishedAt).toISOString() } : {}),
        query,
        queryKey,
        snippet: true,
      },
    ];
  });
}

/* ─────────────────────────── Quotes ─────────────────────────── */

const squash = (s: string) => s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();

/** At most `max` characters, cut at a word, marked when cut. */
export function clipQuote(s: string, max = 300): string {
  const t = s.trim();
  return t.length > max ? `${t.slice(0, max - 1).replace(/\s+\S*$/, "")}…` : t;
}

/**
 * The model's quote only when it is really in the post (whitespace and curly quotes aside), else null: a quote on
 * screen is always the author's own words.
 */
export function verbatim(text: string, quote: string | null | undefined): string | null {
  const q = squash(quote ?? "").replace(/^["'“]+|["'”]+$/g, "").replace(/…$/, "").trim();
  if (q.length < 12) return null;
  const hay = squash(text);
  const at = hay.toLowerCase().indexOf(q.toLowerCase());
  if (at < 0) return null;
  return clipQuote(hay.slice(at, at + q.length));
}

/** The sentence that mentions the most of the given words: the fallback quote when the model's isn't verbatim. */
export function bestSentence(text: string, tokens: string[]): string {
  const sentences = squash(text)
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 12);
  if (!sentences.length) return clipQuote(squash(text));
  const want = new Set(tokens.map((t) => t.toLowerCase()));
  let best = sentences[0];
  let bestScore = -1;
  for (const s of sentences) {
    const score = (s.toLowerCase().match(/[a-z0-9]+(?:-[a-z0-9]+)*/g) ?? []).filter((w) => want.has(w)).length + (s.includes("?") ? 0.5 : 0);
    if (score > bestScore) {
      best = s;
      bestScore = score;
    }
  }
  return clipQuote(best);
}
