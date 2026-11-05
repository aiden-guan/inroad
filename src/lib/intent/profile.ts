import { isConsumer } from "@/lib/consumer/market";
import type { Workspace } from "@/lib/domain/types";
import type { IntentFeedback, IntentMatch, IntentQuery, IntentSourceId } from "./types";

/**
 * What the intent radar listens for, built in code from the playbook: the buyer's own words, the category, the ICP
 * obstacle and the competitors. Never from the founder's contacts, notes or deals. Pure and isomorphic.
 */

export interface IntentTerm extends IntentMatch {
  /** "P1", "C2", "K1": how the model refers to it. */
  id: string;
  /** Words a post must contain to count as a lexical match. */
  tokens: string[];
}

export interface IntentProfile {
  product: string;
  oneLiner: string;
  category: string;
  /** Champion and buyer titles, for the model's context. */
  personas: string[];
  /** What buyers use today (spreadsheets, in-house scripts, competitors), by name. */
  alternatives: string[];
  pains: IntentTerm[];
  competitors: IntentTerm[];
  categoryTerms: IntentTerm[];
  /** Search phrases, best first. */
  phrases: { phrase: string; from: IntentMatch }[];
  /** The word most of the category and obstacle share ("usage"), to pin competitor names to the space. */
  anchor: string | null;
  /** Every distinctive word of the pains, category and phrases, for the prefilter's "talks about this" rule. */
  vocab: string[];
  consumer: boolean;
  ownDomain?: string;
  hash: string;
}

const STOP = new Set(
  (
    "a an and are as at be been being but by can could did do does doing don't didn't doesn't couldn't can't won't isn't aren't wasn't " +
    "for from had has have having how i if in into is it its it's me more most my no nor not of on once only or other our ours out over " +
    "own same she he should so some such than that the their theirs them then there these they this those through to too under until up " +
    "very was we were what when where which while who whom why will with would you your yours us every each per via just also really get " +
    "gets got make makes made one ones first last next new nobody anyone someone everyone something nothing anything week weeks month " +
    "months day days year years time times today team teams company companies people way ways thing things lot lots kind sort about " +
    "after before again against all any both few many much off still yet even ever never always often"
  ).split(" "),
);

/** Words ending in -ing that are nouns in a buyer's vocabulary; any other leading -ing word is a verb to drop. */
const NOUN_ING = new Set(
  "billing pricing accounting invoicing metering marketing onboarding engineering reporting forecasting licensing hosting logging monitoring tracking routing scheduling staffing testing training banking bookkeeping budgeting rating ticketing shipping packaging printing booking hiring lending recruiting parenting running cycling swimming climbing cooking baking gardening knitting sewing writing painting drawing gaming dating housing clothing bedding sleeping eating fasting".split(
    " ",
  ),
);

const norm = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’']/g, "'")
    // Possessives match the name: "Meterbook's report" is about Meterbook.
    .replace(/'s\b/g, "")
    .trim();

/** Lowercase word tokens, keeping hyphenated compounds ("month-end", "true-up") whole. */
export function words(text: string): string[] {
  return norm(text).match(/[a-z0-9]+(?:[-'][a-z0-9]+)*/g) ?? [];
}

const contentWords = (text: string) => words(text).filter((w) => !STOP.has(w) && w.length > 1);

/**
 * Noun-ish chunks of 2–3 content words between stop words and punctuation: "Usage reconciliation for the month-end
 * close" → ["usage reconciliation", "month-end close"]. A leading verb ("tying metered usage") is dropped.
 */
export function chunks(text: string): string[] {
  const out: string[] = [];
  for (const part of norm(text).split(/[.,;:!?()[\]"“”/|]+/)) {
    let run: string[] = [];
    const flush = () => {
      let r = run;
      if (r.length >= 3 && r[0].endsWith("ing") && !NOUN_ING.has(r[0])) r = r.slice(1);
      if (r.length > 3) r = r.slice(r.length - 3);
      if (r.length >= 2) out.push(r.join(" "));
      run = [];
    };
    for (const w of part.match(/[a-z0-9]+(?:[-'][a-z0-9]+)*/g) ?? []) {
      if (STOP.has(w) || w.length < 2) flush();
      else run.push(w);
    }
    flush();
  }
  return [...new Set(out)];
}

/** A customer phrase used as written (the buyer's exact words), minus a leading article, when it is short. */
function asWritten(phrase: string): string | null {
  const w = words(phrase);
  while (w.length && ["the", "a", "an", "our", "my", "their"].includes(w[0])) w.shift();
  if (!w.length || w.length > 4) return null;
  if (w.length === 1 && !(w[0].includes("-") && w[0].length >= 6)) return null;
  return w.join(" ");
}

/** FNV-1a, so the hash is the same in the browser and on the server. */
export function hashText(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

const SOURCE_RANK: Record<string, number> = { community: 0, review: 1, call: 2, job_post: 3, founder: 4, site: 5 };

export function intentProfile(ws: Pick<Workspace, "foundation" | "company">): IntentProfile | null {
  const f = ws.foundation;
  if (!f) return null;
  const champion = f.personas.find((p) => p.role === "champion" || p.role === "early_adopter") ?? f.personas[0];
  const buyer = f.personas.find((p) => p.role === "economic_buyer" || p.role === "payer");
  const painTexts = [...new Set([...(champion?.pains ?? []), ...(buyer?.pains ?? []), f.icp.hypothesis.obstacle].map((p) => p?.trim()).filter(Boolean) as string[])].slice(0, 8);
  const pains: IntentTerm[] = painTexts.map((label, i) => ({ id: `P${i + 1}`, kind: "pain", label: label.slice(0, 120), tokens: contentWords(label) }));

  const names = new Map<string, string>();
  for (const c of f.competitors) if (c.name?.trim()) names.set(norm(c.name), c.name.trim());
  for (const a of f.positioning.alternatives) if (a.kind === "competitor" && a.name?.trim()) names.set(norm(a.name), a.name.trim());
  const competitors: IntentTerm[] = [...names.values()].slice(0, 6).map((label, i) => ({ id: `C${i + 1}`, kind: "competitor", label, tokens: words(label) }));

  const category = f.positioning.category.name?.trim() ?? "";
  const categoryTerms: IntentTerm[] = category ? [{ id: "K1", kind: "category", label: category.slice(0, 120), tokens: contentWords(category) }] : [];

  // Search phrases: the buyer's public words first, then the category and the obstacle, then the rest of their words.
  const said = [...f.messaging.customerWords].sort((a, b) => (SOURCE_RANK[a.source] ?? 9) - (SOURCE_RANK[b.source] ?? 9));
  const candidates: { phrase: string; from: IntentMatch }[] = [];
  const painFor = (phrase: string): IntentMatch => {
    const hit = pains.find((p) => words(phrase).some((w) => p.tokens.includes(w)));
    return hit ? { kind: "pain", label: hit.label } : { kind: "pain", label: phrase };
  };
  for (const w of said.filter((x) => x.source === "community" || x.source === "review")) {
    const p = asWritten(w.phrase);
    if (p) candidates.push({ phrase: p, from: painFor(p) });
  }
  for (const c of chunks(category)) candidates.push({ phrase: c, from: { kind: "category", label: category.slice(0, 120) } });
  for (const c of chunks(f.icp.hypothesis.obstacle ?? "")) candidates.push({ phrase: c, from: painFor(c) });
  for (const w of said.filter((x) => x.source !== "community" && x.source !== "review")) {
    const p = asWritten(w.phrase);
    if (p) candidates.push({ phrase: p, from: painFor(p) });
  }
  const seen = new Set<string>();
  const phrases = candidates.filter((c) => !seen.has(c.phrase) && !!seen.add(c.phrase)).slice(0, 8);

  const tally = new Map<string, number>();
  for (const w of [...contentWords(category), ...contentWords(f.icp.hypothesis.obstacle ?? ""), ...phrases.flatMap((p) => words(p.phrase))]) {
    if (w.length >= 4) tally.set(w, (tally.get(w) ?? 0) + 1);
  }
  const anchor = [...tally.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
  const vocab = [...new Set([...pains, ...categoryTerms].flatMap((t) => t.tokens).concat(phrases.flatMap((p) => words(p.phrase))))].filter((t) => t.length >= 4);

  const personas = [...(champion?.titles ?? []), ...(buyer?.titles ?? [])].slice(0, 6);
  const alternatives = f.positioning.alternatives.map((a) => a.name).filter(Boolean).slice(0, 8);
  const product = ws.company?.name ?? "";
  const oneLiner = (f.messaging.oneLiner || ws.company?.plainOneLiner || "").slice(0, 300);
  const consumer = isConsumer(ws);
  const hash = hashText(JSON.stringify([product, oneLiner, category, personas, pains.map((p) => p.label), competitors.map((c) => c.label), consumer]));
  return {
    product,
    oneLiner,
    category,
    personas,
    alternatives,
    pains,
    competitors,
    categoryTerms,
    phrases,
    anchor,
    vocab,
    consumer,
    ...(ws.company?.domain ? { ownDomain: ws.company.domain.toLowerCase() } : {}),
    hash,
  };
}

/* ─────────────────────────── Queries ─────────────────────────── */

export const queryKey = (source: IntentSourceId, query: string, site?: string) => `${source}${site ? `@${site}` : ""}:${norm(query).replace(/\s+/g, " ")}`;

/**
 * A query stops running once the founder has thrown away three of its posts and kept none, or when it throws away
 * three times as many as it keeps. "Search it again" in the panel resets its counts.
 */
export function isRetired(fb: IntentFeedback | undefined): boolean {
  return !!fb && fb.misses >= 3 && fb.misses >= 3 * fb.hits;
}

/** Kept-to-thrown ratio with a prior, so a new query starts in the middle. */
const queryScore = (fb: IntentFeedback | undefined) => ((fb?.hits ?? 0) + 1) / ((fb?.hits ?? 0) + (fb?.misses ?? 0) + 2);

const quoted = (phrase: string) => (/[\s-]/.test(phrase) ? `"${phrase}"` : phrase);

/** Stack Exchange sites worth asking, from the words in the playbook. Software Recommendations is where people ask for tools. */
export function stackSites(profile: IntentProfile): string[] {
  const text = [profile.oneLiner, profile.category, ...profile.pains.map((p) => p.label), ...profile.personas, ...profile.alternatives].join(" ").toLowerCase();
  const sites: string[] = [];
  const add = (s: string) => {
    if (!sites.includes(s)) sites.push(s);
  };
  if (profile.consumer) {
    const map: [RegExp, string][] = [
      [/\b(run|running|marathon|workout|gym|fitness|training|strength)\b/, "fitness"],
      [/\b(parent|baby|toddler|kid|child|newborn)\b/, "parenting"],
      [/\b(cook|recipe|meal|kitchen|baking)\b/, "cooking"],
      [/\b(travel|trip|flight|hotel)\b/, "travel"],
      [/\b(budget|money|savings|invest|debt|tax)\b/, "money"],
      [/\b(photo|camera|lens)\b/, "photo"],
      [/\b(garden|plant|lawn)\b/, "gardening"],
      [/\b(pet|dog|cat)\b/, "pets"],
    ];
    for (const [re, site] of map) if (re.test(text)) add(site);
    add("softwarerecs");
    return sites.slice(0, 3);
  }
  add("softwarerecs");
  const map: [RegExp, string][] = [
    [/\b(api|sdk|developer|engineer|code|kubernetes|deploy|pipeline|warehouse|dbt|sql)\b/, "stackoverflow"],
    [/\b(devops|infrastructure|ci|cd|kubernetes|observability)\b/, "devops"],
    [/\b(security|compliance|soc ?2|vulnerability|audit)\b/, "security"],
    [/\b(database|postgres|mysql|query|warehouse)\b/, "dba"],
    [/\b(data science|machine learning|model|analytics)\b/, "datascience"],
    [/\b(invoice|billing|accounting|bookkeeping|finance|revenue|tax|payroll)\b/, "money"],
    [/\b(project|roadmap|sprint|agile)\b/, "pm"],
  ];
  for (const [re, site] of map) if (re.test(text)) add(site);
  return sites.slice(0, 3);
}

export interface QueryPlan {
  queries: IntentQuery[];
  retired: IntentQuery[];
}

/**
 * Queries for each source, best first: the playbook's phrases ranked by what the founder kept, then competitor names
 * pinned to the space with the anchor word. Retired queries are listed separately so the panel can bring them back.
 */
export function planIntentQueries(
  profile: IntentProfile,
  feedback: Record<string, IntentFeedback> = {},
  opts: { reddit?: boolean; github?: boolean } = {},
): QueryPlan {
  const queries: IntentQuery[] = [];
  const retired: IntentQuery[] = [];
  const phrases = profile.phrases;
  const competitorQueries = profile.competitors.slice(0, 3).map((c) => ({
    query: profile.anchor && !words(c.label).includes(profile.anchor) ? `${quoted(c.label)} ${profile.anchor}` : quoted(c.label),
    from: { kind: "competitor", label: c.label } as IntentMatch,
  }));
  const phraseQueries = phrases.map((p) => ({ query: quoted(p.phrase), from: p.from }));
  const add = (source: IntentSourceId, list: { query: string; from: IntentMatch }[], max: number, site?: string) => {
    const ranked = list
      .map((q, i) => ({ ...q, i, key: queryKey(source, q.query, site) }))
      .sort((a, b) => queryScore(feedback[b.key]) - queryScore(feedback[a.key]) || a.i - b.i);
    let taken = 0;
    for (const q of ranked) {
      const row: IntentQuery = { source, query: q.query, key: q.key, from: q.from, ...(site ? { site } : {}) };
      if (isRetired(feedback[q.key])) retired.push(row);
      else if (taken < max) {
        queries.push(row);
        taken++;
      }
    }
  };
  add("hn", [...phraseQueries.slice(0, 5), ...competitorQueries.slice(0, 2)], 6);
  // Stack Exchange matches every word anywhere in the question; unquoted phrases read better there.
  const plain = phrases.map((p) => ({ query: p.phrase, from: p.from }));
  for (const site of stackSites(profile)) add("stackexchange", plain.slice(0, 4), 2, site);
  // On GitHub a competitor's name finds the issues people file about it; the buyer's phrases come after.
  if (opts.github !== false && !profile.consumer) add("github", [...competitorQueries.slice(0, 2), ...phraseQueries.slice(0, 3)], 3);
  if (opts.reddit) add("reddit", [...phraseQueries.slice(0, 2), ...competitorQueries.slice(0, 1)], 2);
  return { queries, retired };
}

/* ─────────────────────────── Lexical prefilter ─────────────────────────── */

/**
 * How many playbook terms a post mentions, in code: a competitor's name counts double, a pain counts once when at
 * least half of its content words appear. Posts that mention nothing are never sent to the model.
 */
export function lexicalScore(text: string, profile: IntentProfile): { score: number; matched: IntentMatch[] } {
  const bag = new Set(words(text));
  const flat = ` ${words(text).join(" ")} `;
  const matched: IntentMatch[] = [];
  let score = 0;
  for (const c of profile.competitors) {
    if (c.tokens.length && flat.includes(` ${c.tokens.join(" ")} `)) {
      score += 2;
      matched.push({ kind: "competitor", label: c.label });
    }
  }
  for (const p of [...profile.pains, ...profile.categoryTerms]) {
    const toks = p.tokens.filter((t) => t.length > 2);
    if (!toks.length) continue;
    const hits = toks.filter((t) => bag.has(t) || bag.has(t.replace(/s$/, "")) || bag.has(`${t}s`)).length;
    if (hits >= Math.max(2, Math.ceil(toks.length / 2))) {
      score += 1;
      matched.push({ kind: p.kind, label: p.label });
    }
  }
  for (const ph of profile.phrases) if (flat.includes(` ${words(ph.phrase).join(" ")} `)) score += 1;
  // Three of the playbook's distinctive words together ("usage", "invoice", "billed") also count: the post talks about this.
  const has = (t: string) => bag.has(t) || bag.has(t.replace(/s$/, "")) || bag.has(`${t}s`);
  if ((profile.vocab ?? []).filter(has).length >= 3) score += 1;
  return { score, matched };
}
