/**
 * ⌘K's ranking, in code and kept pure so it can be tested. The palette renders exactly the order this returns:
 * cmdk's own sort moves DOM nodes and can't reorder groups (it looks groups up by id but stamps them with their
 * heading), which put "Ask: …" at the bottom and loose matches like "Import LinkedIn connections" above Rowanstack.
 *
 *   1. Companies, people and deals named exactly what was typed, then those whose name starts with it.
 *   2. Anything whose words start with the typed words ("imp li" → Import LinkedIn connections).
 *   3. The typed text inside a word ("stack" → Rowanstack), then its letters in order from a word start (fuzzy).
 *
 * Ties keep the order rows came in (companies by fit, commands as listed). "Ask: …" isn't ranked: it's always there,
 * first when the text reads like a question and last otherwise (`isQuestion`).
 */

export type RankKind = "entity" | "command" | "page";

export interface Rankable {
  /** What the row is called: a company's or a person's name, a command's label. */
  name: string;
  /** Other names that count as the name itself: a company's domain, a deal named differently from its company. */
  aliases?: readonly string[];
  /** More words that find it (synonyms, a title, the company someone works at), never matched as the name. */
  keywords?: string;
  /** Companies, people and deals are entities: only they rank first on an exact or prefix match. */
  kind: RankKind;
  /** Rows about what's on screen (the company sheet that's open) win ties within a tier. */
  boost?: number;
}

const TIER = {
  exact: 1000,
  prefix: 900,
  labelStart: 800,
  wordsInOrder: 760,
  words: 740,
  keywordWords: 700,
  inside: 500,
  fuzzyName: 300,
  fuzzyKeywords: 200,
} as const;

/** Lowercase without accents: "Zoë" and "zoe" are the same name. */
function fold(s: string): string {
  return s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Words, split on anything that isn't a letter or digit: "rowanstack.example" → rowanstack, example. */
function wordsOf(s: string): string[] {
  return fold(s)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/**
 * Each typed word starts a different word of the text. `ordered`: in the text's order; `tight`: on neighbouring
 * words ("imp li" sits tighter on "Import LinkedIn" than on "Import a list"); `lead`: the first word is the text's first.
 */
function wordStarts(typed: string[], words: string[]): { ordered: boolean; tight: boolean; lead: boolean } | null {
  const hits: number[] = [];
  for (let k = 0; k < words.length && hits.length < typed.length; k++) if (words[k].startsWith(typed[hits.length])) hits.push(k);
  if (hits.length === typed.length) {
    return { ordered: true, tight: typed.length > 1 && hits.every((k, i) => i === 0 || k === hits[i - 1] + 1), lead: hits[0] === 0 };
  }
  const used = new Set<number>();
  for (const t of typed) {
    const at = words.findIndex((w, k) => !used.has(k) && w.startsWith(t));
    if (at < 0) return null;
    used.add(at);
  }
  return { ordered: false, tight: false, lead: used.has(0) && words[0].startsWith(typed[0]) };
}

const fit = (m: { tight: boolean; lead: boolean }) => (m.tight ? 8 : 0) + (m.lead ? 4 : 0);

/**
 * The typed letters in order through the text, the first at the start of a word. 1 when they're contiguous,
 * smaller as they spread out; 0 below a quarter (a match strung across a whole sentence finds nothing real).
 */
function fuzzy(typed: string, words: string[]): number {
  const text = words.join(" ");
  let best = 0;
  for (let start = 0; start < text.length; start++) {
    if (text[start] !== typed[0] || (start > 0 && text[start - 1] !== " ")) continue;
    let t = start + 1;
    let q = 1;
    while (q < typed.length && t < text.length) {
      if (text[t] === typed[q]) q++;
      t++;
    }
    if (q === typed.length) best = Math.max(best, typed.length / (t - start));
  }
  return best >= 0.25 ? best : 0;
}

/** How well a row matches what was typed. 0 means it doesn't, and the row is left out. */
export function matchScore(query: string, item: Rankable): number {
  const typed = wordsOf(query);
  if (!typed.length) return 0;
  const joined = typed.join(" ");
  const raw = fold(query.trim());
  const names = [item.name, ...(item.aliases ?? [])];
  const boost = item.boost ?? 0;

  if (item.kind === "entity") {
    // Exact before prefix, on the name as written ("northwind.io") or as words ("Dana Kim" ~ "dana kim").
    if (names.some((n) => fold(n.trim()) === raw || wordsOf(n).join(" ") === joined)) return TIER.exact + boost;
    if (names.some((n) => fold(n.trim()).startsWith(raw) || wordsOf(n).join(" ").startsWith(joined))) return TIER.prefix + boost;
  }

  const nameWords = names.flatMap(wordsOf);
  const entity = item.kind === "entity" ? 5 : 0;
  if (wordsOf(item.name).join(" ").startsWith(joined)) return TIER.labelStart + boost;
  const inName = wordStarts(typed, nameWords);
  if (inName) return (inName.ordered ? TIER.wordsInOrder : TIER.words) + fit(inName) + entity + boost;
  const keywordWords = wordsOf(item.keywords ?? "");
  const inAll = wordStarts(typed, [...nameWords, ...keywordWords]);
  if (inAll) return TIER.keywordWords - (inAll.ordered ? 0 : 10) + entity + boost;

  const letters = typed.join("");
  if (letters.length < 2) return 0;
  if (typed.length === 1 && nameWords.some((w) => w.includes(letters))) return TIER.inside + entity + boost;
  const nameFuzzy = fuzzy(letters, nameWords);
  if (nameFuzzy) return TIER.fuzzyName + Math.round(nameFuzzy * 90) + boost;
  const keywordFuzzy = fuzzy(letters, keywordWords);
  if (keywordFuzzy) return TIER.fuzzyKeywords + Math.round(keywordFuzzy * 90) + boost;
  return 0;
}

/** The rows that match with their scores, best first; ties keep their order. For merging lists ranked apart. */
export function scoreBy<T>(query: string, items: readonly T[], toRankable: (item: T) => Rankable, limit = Infinity): { item: T; score: number }[] {
  const scored: { item: T; score: number; index: number }[] = [];
  items.forEach((item, index) => {
    const score = matchScore(query, toRankable(item));
    if (score > 0) scored.push({ item, score, index });
  });
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.slice(0, limit).map(({ item, score }) => ({ item, score }));
}

/** The rows that match, best first; ties keep their order. With nothing typed, every row in its order. */
export function rankBy<T>(query: string, items: readonly T[], toRankable: (item: T) => Rankable, limit = Infinity): T[] {
  if (!query.trim()) return items.slice(0, limit);
  return scoreBy(query, items, toRankable, limit).map((s) => s.item);
}

/** Two ranked lists as one, best first; on a tie the first list's rows come first. */
export function mergeRanked<A, B>(first: readonly { item: A; score: number }[], second: readonly { item: B; score: number }[], limit = Infinity): (A | B)[] {
  const all = [...first.map((s, i) => ({ ...s, order: i })), ...second.map((s, i) => ({ ...s, order: first.length + i }))];
  all.sort((a, b) => b.score - a.score || a.order - b.order);
  return all.slice(0, limit).map((s) => s.item);
}

const QUESTION_WORDS = new Set(["who", "what", "why", "how", "which", "when", "where", "should", "can", "is", "are", "do", "does"]);

/**
 * Reads like a question, so Enter should ask it: it ends with "?", has five or more words, or opens with a question
 * word. A question word on its own may still be a name being typed ("Whoop", "Isla"), so it counts once a second
 * word follows.
 */
export function isQuestion(query: string): boolean {
  const q = query.trim();
  if (!q) return false;
  if (q.endsWith("?")) return true;
  const words = q.toLowerCase().split(/\s+/);
  if (words.length >= 5) return true;
  const lead = words[0].replace(/['’]s$/, "").replace(/[^a-z]/g, "");
  return words.length >= 2 && QUESTION_WORDS.has(lead);
}
