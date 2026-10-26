import "server-only";
import type { Workspace } from "@/lib/domain/types";
import { TTL, cached } from "./cache";
import { fetchJSON } from "./http";

/**
 * Questions buyers ask in public, for the founder to answer (research 01: "search those sites by pain keywords").
 * Hacker News only: Algolia's search is free and keyless. Reddit's API needs an account, so it isn't used. Queries
 * are built from the playbook's own words (the buyer's words, the category, persona pains), never from the founder's
 * private notes or contacts. No tokens.
 */

export interface CommunityQuestion {
  id: string;
  title: string;
  text: string;
  url: string;
  author: string;
  createdAt: string;
  points?: number;
  kind: "ask_hn" | "comment";
}

interface Hit {
  objectID: string;
  title?: string | null;
  story_title?: string | null;
  comment_text?: string | null;
  story_text?: string | null;
  author?: string;
  created_at?: string;
  points?: number | null;
  _tags?: string[];
}

const STOP = new Set(
  "a an and are as at be but by for from has have how in into is it its of on or that the their them they this to too was we were what when where which who why will with without you your our us can does do don't".split(" "),
);

/** A phrase cut to its first `max` content words (Algolia requires every word, so long phrases find nothing). */
export function queryFor(phrase: string, max = 3): string {
  return phrase
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w))
    .slice(0, max)
    .join(" ");
}

/** Where a customer word came from, most public first: words buyers already use in communities search best. */
const SOURCE_ORDER = ["community", "review", "call", "job_post", "founder", "site"];

/**
 * Up to 3 short queries from the playbook: the buyer's own words (community and review words first), then the category,
 * then the champion's pains and the ICP obstacle, each cut to two or three words.
 */
export function questionQueries(ws: Workspace): string[] {
  const f = ws.foundation;
  if (!f) return [];
  const champion = f.personas.find((p) => p.role === "champion") ?? f.personas[0];
  const said = [...f.messaging.customerWords].sort((a, b) => SOURCE_ORDER.indexOf(a.source) - SOURCE_ORDER.indexOf(b.source)).map((w) => queryFor(w.phrase));
  const ours = [f.positioning.category.name, ...(champion?.pains ?? []), f.icp.hypothesis.obstacle].map((p) => queryFor(p ?? "", 2));
  const ok = (q: string) => q.split(" ").length >= 2;
  return [...new Set([...said.filter(ok).slice(0, 2), ...ours.filter(ok)])].slice(0, 3);
}

const QUESTION = /\?|\b(how do (you|i|we)|anyone (here )?(use|know|tried)|recommend|what do (you|people) use|looking for|best way to|struggl)/i;

function clean(html: string | null | undefined): string {
  return (html ?? "")
    .replace(/<p>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** Ask HN posts and question-shaped comments from the last `days` for one query, most relevant first; null if HN didn't answer. */
export async function hnQuestions(query: string, now: Date, days = 60): Promise<CommunityQuestion[] | null> {
  const since = Math.floor(now.getTime() / 1000) - days * 86_400;
  const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=(ask_hn,comment)&numericFilters=created_at_i%3E${since}&hitsPerPage=30`;
  const data = await cached(`hnq:${query}:${days}`, TTL.hour * 6, () => fetchJSON<{ hits?: Hit[] }>(url));
  if (!data) return null;
  return (data.hits ?? []).flatMap((h): CommunityQuestion[] => {
    const ask = h._tags?.includes("ask_hn") ?? false;
    const text = clean(ask ? h.story_text : h.comment_text);
    const title = ask ? (h.title ?? "") : `On “${h.story_title ?? "a thread"}”`;
    if (!ask && !QUESTION.test(text)) return [];
    if (!title && !text) return [];
    return [
      {
        id: h.objectID,
        title,
        text: text.length > 320 ? `${text.slice(0, 317)}…` : text,
        url: `https://news.ycombinator.com/item?id=${h.objectID}`,
        author: h.author ?? "",
        createdAt: h.created_at ?? "",
        points: h.points ?? undefined,
        kind: ask ? "ask_hn" : "comment",
      },
    ];
  });
}

/**
 * Questions for the playbook's queries, deduplicated, Ask HN first, then newest; at most 12. `reached` is false when
 * Hacker News answered none of the queries, so "nobody asked" is never shown for "couldn't look".
 */
export async function communityQuestions(ws: Workspace, now: Date): Promise<{ queries: string[]; questions: CommunityQuestion[]; reached: boolean }> {
  const queries = questionQueries(ws);
  const lists = await Promise.all(queries.map((q) => hnQuestions(q, now)));
  const seen = new Set<string>();
  const questions = lists
    .flatMap((l) => l ?? [])
    .filter((q) => !seen.has(q.id) && !!seen.add(q.id))
    .sort((a, b) => (a.kind === b.kind ? b.createdAt.localeCompare(a.createdAt) : a.kind === "ask_hn" ? -1 : 1))
    .slice(0, 12);
  return { queries, questions, reached: !queries.length || lists.some((l) => l !== null) };
}
