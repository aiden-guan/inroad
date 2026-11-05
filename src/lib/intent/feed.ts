import { HN_JOB_THREAD, type Candidate } from "./parse";
import { hashText, lexicalScore, type IntentProfile } from "./profile";
import { INTENT_LIMITS, SOURCE_LABEL, type IntentItem, type IntentMatch, type IntentSourceId, type IntentState } from "./types";

/**
 * The feed in code: one row per post across sources and queries, threads the founder threw away stay gone, and only
 * posts that mention the playbook reach the model. Then the filters and the summary line the panel shows. Pure.
 */

export const itemId = (key: string) => `int_${hashText(key)}`;

const textKey = (c: Candidate) =>
  `${c.title} ${c.text}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .slice(0, 160);

/** One candidate per post (the first query that found it wins), and one per cross-posted text. */
export function dedupeCandidates(list: Candidate[]): Candidate[] {
  const byKey = new Map<string, Candidate>();
  const texts = new Set<string>();
  for (const c of list) {
    if (byKey.has(c.key)) continue;
    const t = textKey(c);
    if (t.length > 40 && texts.has(t)) continue;
    byKey.set(c.key, c);
    if (t.length > 40) texts.add(t);
  }
  return [...byKey.values()];
}

export type Scored = Candidate & { lex: number; lexMatched: IntentMatch[] };

export interface PrefilterResult {
  keep: Scored[];
  dropped: { bot: number; staff: number; short: number; old: number; dismissed: number; known: number; jobs: number; offTopic: number; over: number };
}

/**
 * Drops what isn't worth a model call: bots, the repo owner's own staff, empty posts, posts outside the window,
 * threads marked not relevant, posts already in the feed, job threads, and posts that mention no playbook term.
 * The rest is ranked by how much of the playbook it mentions, newest first on ties, and capped.
 */
export function prefilter(
  list: Candidate[],
  opts: { profile: IntentProfile; now: number; windowDays: number; dismissed: Set<string>; known: Set<string>; max: number },
): PrefilterResult {
  const dropped: PrefilterResult["dropped"] = { bot: 0, staff: 0, short: 0, old: 0, dismissed: 0, known: 0, jobs: 0, offTopic: 0, over: 0 };
  const since = opts.now - opts.windowDays * 86_400_000;
  const keep: Scored[] = [];
  for (const c of list) {
    if (c.bot) dropped.bot++;
    else if (c.association && /^(OWNER|MEMBER|COLLABORATOR)$/.test(c.association)) dropped.staff++;
    else if (`${c.title} ${c.text}`.trim().length < 40) dropped.short++;
    else if (c.postedAt && Date.parse(c.postedAt) < since) dropped.old++;
    else if (opts.dismissed.has(c.thread)) dropped.dismissed++;
    else if (opts.known.has(c.key)) dropped.known++;
    else if (c.source === "hn" && HN_JOB_THREAD.test(c.title)) dropped.jobs++;
    else {
      const lex = lexicalScore(`${c.title}\n${c.text}`, opts.profile);
      if (lex.score === 0) dropped.offTopic++;
      else keep.push({ ...c, lex: lex.score, lexMatched: lex.matched });
    }
  }
  keep.sort((a, b) => b.lex - a.lex || (b.postedAt ?? "").localeCompare(a.postedAt ?? ""));
  dropped.over = Math.max(0, keep.length - opts.max);
  return { keep: keep.slice(0, opts.max), dropped };
}

/** New items first; an item already in the feed keeps its state (tracked, drafted). Capped, tracked items kept. */
export function mergeItems(existing: IntentItem[], incoming: IntentItem[], max: number = INTENT_LIMITS.items): { items: IntentItem[]; added: IntentItem[] } {
  const have = new Set(existing.map((i) => i.key));
  const added = incoming.filter((i) => !have.has(i.key));
  const all = [...added, ...existing];
  if (all.length <= max) return { items: all, added };
  const pinned = all.filter((i) => i.trackedDomain || i.replyAssetId);
  const rest = all.filter((i) => !i.trackedDomain && !i.replyAssetId);
  const items = [...pinned, ...rest].slice(0, Math.max(max, pinned.length));
  const order = new Map(all.map((i, n) => [i.id, n]));
  items.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  return { items, added };
}

/** Marks the thread not relevant: its posts leave the feed and its query loses a point. */
export function dismissItem(state: IntentState, id: string, at: string): { state: IntentState; removed: IntentItem[] } {
  const item = state.items.find((i) => i.id === id);
  if (!item) return { state, removed: [] };
  const removed = state.items.filter((i) => i.thread === item.thread);
  const feedback = { ...state.feedback };
  for (const key of new Set(removed.map((i) => i.queryKey))) {
    const fb = feedback[key] ?? { hits: 0, misses: 0 };
    feedback[key] = { ...fb, misses: fb.misses + 1 };
  }
  return {
    state: {
      ...state,
      items: state.items.filter((i) => i.thread !== item.thread),
      dismissed: [{ thread: item.thread, at, queryKey: item.queryKey }, ...state.dismissed.filter((d) => d.thread !== item.thread)].slice(0, INTENT_LIMITS.dismissed),
      feedback,
    },
    removed,
  };
}

/** Undo: the thread comes back and the query gets its point back. */
export function restoreItems(state: IntentState, items: IntentItem[]): IntentState {
  if (!items.length) return state;
  const threads = new Set(items.map((i) => i.thread));
  const feedback = { ...state.feedback };
  for (const key of new Set(items.map((i) => i.queryKey))) {
    const fb = feedback[key];
    if (fb) feedback[key] = { ...fb, misses: Math.max(0, fb.misses - 1) };
  }
  const have = new Set(state.items.map((i) => i.id));
  return {
    ...state,
    items: [...items.filter((i) => !have.has(i.id)), ...state.items].sort((a, b) => b.foundAt.localeCompare(a.foundAt)),
    dismissed: state.dismissed.filter((d) => !threads.has(d.thread)),
    feedback,
  };
}

/** Drafting a reply or tracking the company counts for the query that found the post. */
export function creditQuery(state: IntentState, queryKey: string): IntentState {
  const fb = state.feedback[queryKey] ?? { hits: 0, misses: 0 };
  return { ...state, feedback: { ...state.feedback, [queryKey]: { ...fb, hits: fb.hits + 1 } } };
}

/* ─────────────────────────── What the panel shows ─────────────────────────── */

export type Freshness = "24h" | "7d" | "30d" | "all";
export const FRESHNESS: Freshness[] = ["24h", "7d", "30d", "all"];
const WINDOW_MS: Record<Exclude<Freshness, "all">, number> = { "24h": 86_400_000, "7d": 7 * 86_400_000, "30d": 30 * 86_400_000 };

export interface FeedFilters {
  when: Freshness;
  source: IntentSourceId | "all";
  /** "pain:…", "competitor:…", "category:…" or "all". */
  match: string;
  sort: "relevance" | "recent";
}

export const matchKey = (m: IntentMatch) => `${m.kind}:${m.label}`;

/** Posts inside the window. Undated posts only show under "All", so a date is never implied. */
export function withinWindow(item: Pick<IntentItem, "postedAt">, when: Freshness, now: number): boolean {
  if (when === "all") return true;
  if (!item.postedAt) return false;
  return now - Date.parse(item.postedAt) <= WINDOW_MS[when];
}

export function filterItems(items: IntentItem[], f: FeedFilters, now: number): IntentItem[] {
  const out = items.filter(
    (i) => withinWindow(i, f.when, now) && (f.source === "all" || i.source === f.source) && (f.match === "all" || i.matched.some((m) => matchKey(m) === f.match)),
  );
  const time = (i: IntentItem) => (i.postedAt ? Date.parse(i.postedAt) : 0);
  return out.sort((a, b) => (f.sort === "relevance" ? b.relevance - a.relevance || time(b) - time(a) : time(b) - time(a) || b.relevance - a.relevance));
}

export function sourceCounts(items: IntentItem[], when: Freshness, now: number): Partial<Record<IntentSourceId, number>> {
  const out: Partial<Record<IntentSourceId, number>> = {};
  for (const i of items) if (withinWindow(i, when, now)) out[i.source] = (out[i.source] ?? 0) + 1;
  return out;
}

export function matchOptions(items: IntentItem[], when: Freshness, now: number): { key: string; match: IntentMatch; count: number }[] {
  const counts = new Map<string, { match: IntentMatch; count: number }>();
  for (const i of items) {
    if (!withinWindow(i, when, now)) continue;
    for (const m of i.matched) {
      const k = matchKey(m);
      counts.set(k, { match: m, count: (counts.get(k)?.count ?? 0) + 1 });
    }
  }
  return [...counts.entries()].map(([key, v]) => ({ key, ...v })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/**
 * The line at the top of the panel, counted in code: "9 people asked for what you sell in the last 7 days. 3 of them
 * say where they work." Falls back to the widest window that has posts.
 */
export function feedSummary(items: IntentItem[], now: number, consumer = false): string {
  const what = consumer ? "what you make" : "what you sell";
  for (const [when, label] of [["7d", "in the last 7 days"], ["30d", "in the last 30 days"], ["all", "so far"]] as const) {
    const live = items.filter((i) => withinWindow(i, when, now));
    if (!live.length) continue;
    const authors = new Set(live.map((i) => `${i.source}:${i.author || i.id}`)).size;
    const asks = live.filter((i) => i.kind === "ask").length;
    const placed = live.filter((i) => i.company?.domain).length;
    const parts = [`${n(authors, "person", "people")} posted about ${what} ${label}`];
    if (asks) parts[0] += `, ${asks} asking for a tool`;
    const second = placed && !consumer ? `${n(placed, "says where they work", "say where they work")}.` : "";
    return `${parts[0]}.${second ? ` ${second}` : ""}`;
  }
  return consumer ? "Nobody has asked for what you make yet, in the places I can search." : "Nobody has asked for what you sell yet, in the places I can search.";
}

/** "Hacker News · Ask HN", "Stack Exchange · Software Recommendations", "Reddit · r/SaaS". */
export const whereLabel = (i: Pick<IntentItem, "source" | "site">) => [SOURCE_LABEL[i.source], i.site].filter(Boolean).join(" · ");
