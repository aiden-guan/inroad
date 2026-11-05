/**
 * Text handling for buyer voice, in code: words, a few domain synonyms, light stemming, phrases and similarity.
 * Deliberately small and predictable. Two quotes about the same thing in different words ("tie-out", "reconcile",
 * "match") land on the same terms; the cheap model pass only names and merges what this already grouped.
 */

const STOP = new Set(
  (
    "a an the and or but so if then than that this these those there here it its it's itself i i'm i've i'll i'd me my mine we we're we've we'll " +
    "we'd us our ours you you're your yours they they're them their he she him her his hers to of in on at by for with from as into onto about " +
    "over under up down out off is are was were be been being am do does did done doing have has had having can could would should will shall may " +
    "might must not no yes yeah ok okay um uh like just really honestly basically actually literally kind sort thing things stuff lot lots bit " +
    "pretty quite very too also still already again now then what which who whom whose how when where why all any some every each more most " +
    "much many few other another such own same one ones get gets got getting make makes made go goes going went want wants need needs say said " +
    "says tell told know think thought see look looks looked well right sure maybe probably mean means because while since until though even " +
    "only ever never always usually let let's guess put take takes took come came back way ways part"
  ).split(" "),
);

/** Canonical forms: different words buyers use for the same thing. Applied before stemming. */
const GROUPS: [string, string[]][] = [
  ["reconcile", ["reconcile", "reconciles", "reconciled", "reconciling", "reconciliation", "reconciliations", "recon", "tie-out", "tie-outs", "tieout", "tie", "ties", "tied", "tying", "match", "matches", "matched", "matching", "mismatch", "mismatches", "mismatched"]],
  ["spreadsheet", ["spreadsheet", "spreadsheets", "sheet", "sheets", "excel", "workbook", "workbooks", "vlookup", "vlookups", "csv", "csvs"]],
  ["close", ["close", "closes", "closing", "month-end", "monthend"]],
  ["invoice", ["invoice", "invoices", "invoiced", "invoicing", "billed", "overbilled", "underbilled", "overbill", "underbill"]],
  ["audit", ["audit", "audits", "audited", "auditor", "auditors"]],
  ["hire", ["hire", "hires", "hired", "hiring", "headcount", "contractor", "contractors"]],
  ["duration", ["day", "days", "week", "weeks", "hour", "hours"]],
  ["variance", ["variance", "variances", "adjustment", "adjustments", "discrepancy", "discrepancies"]],
  ["explain", ["explain", "explains", "explained", "explaining", "unexplained", "explanation"]],
  ["build", ["build", "builds", "building", "built", "in-house", "inhouse", "homegrown", "dbt"]],
  ["security", ["security", "soc", "soc2", "questionnaire", "infosec"]],
  ["legal", ["legal", "counsel", "lawyer", "lawyers", "redline", "redlines", "contract", "contracts", "msa"]],
  ["budget", ["budget", "budgets", "budgeted", "budgeting"]],
  ["price", ["price", "prices", "pricing", "priced", "expensive", "cheaper", "cost", "costs"]],
  ["warehouse", ["warehouse", "warehouses", "snowflake", "bigquery", "redshift", "databricks", "clickhouse", "postgres", "postgresql"]],
  ["usage", ["usage", "metered", "meter", "meters", "metering", "event", "events"]],
  ["export", ["export", "exports", "exported", "exporting"]],
  ["manual", ["manual", "manually"]],
  ["approve", ["approve", "approves", "approved", "approval", "signoff", "sign-off"]],
];
const SYN = new Map<string, string>(GROUPS.flatMap(([canon, forms]) => forms.map((f) => [f, canon] as const)));

const NUMBER_WORDS = new Set("zero one two three four five six seven eight nine ten eleven twelve fifteen twenty thirty forty fifty sixty hundred thousand million half".split(" "));

/** Lowercase words, curly quotes straightened; keeps in-word hyphens and apostrophes ("tie-out", "can't"). */
export function words(text: string): string[] {
  return (
    text
      .toLowerCase()
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      .match(/[a-z0-9]+(?:['-][a-z0-9]+)*/g) ?? []
  );
}

export function stem(w: string): string {
  if (w.length <= 3) return w;
  if (w.endsWith("ies") && w.length > 4) return `${w.slice(0, -3)}y`;
  if (w.endsWith("ing") && w.length > 5) return w.slice(0, -3);
  if (w.endsWith("ed") && w.length > 4) return w.slice(0, -2);
  if (/(ch|sh|x|ss)es$/.test(w)) return w.slice(0, -2);
  if (w.endsWith("s") && !/(ss|us|is)$/.test(w)) return w.slice(0, -1);
  return w;
}

/** Content terms: canonical, stemmed, stopwords out, every number one token. */
export function terms(text: string): string[] {
  const out: string[] = [];
  for (const w of words(text)) {
    if (/^\d/.test(w) || NUMBER_WORDS.has(w)) {
      out.push("#n");
      continue;
    }
    const canon = SYN.get(w);
    if (canon) {
      out.push(canon);
      continue;
    }
    const bare = w.replace(/'s$/, "");
    if (STOP.has(bare) || bare.length < 3 || /'/.test(bare)) continue;
    out.push(stem(bare));
  }
  return out;
}

/** How rare each term is across a set of term lists (inverse document frequency, smoothed). */
export function idf(docs: string[][]): Map<string, number> {
  const df = new Map<string, number>();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1);
  const n = docs.length;
  const out = new Map<string, number>();
  for (const [t, f] of df) out.set(t, Math.log((n + 1) / (f + 0.5)));
  return out;
}

/** Weighted Jaccard over term sets: shared rare words count for more than shared common ones. 0–1. */
export function similarity(a: string[], b: string[], weights: Map<string, number>, fallback = 1): number {
  const A = new Set(a);
  const B = new Set(b);
  let inter = 0;
  let union = 0;
  for (const t of new Set([...A, ...B])) {
    const w = weights.get(t) ?? fallback;
    union += w;
    if (A.has(t) && B.has(t)) inter += w;
  }
  return union ? inter / union : 0;
}

/** Stable short hash (FNV-1a), for keys derived from text. */
export function hashKey(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

const EDGE_STOP = new Set([...STOP, "s", "t"]);

/**
 * Phrases of 2–4 words that several conversations share, most shared first: what buyers keep saying, in their
 * words. Counted once per conversation; a phrase inside a longer one that's as common is dropped.
 */
export function topPhrases(docs: { conv: string; text: string }[], max = 3, minConvs = 2): string[] {
  const counts = new Map<string, Set<string>>();
  for (const d of docs) {
    const ws = words(d.text);
    for (let n = 2; n <= 4; n++) {
      for (let i = 0; i + n <= ws.length; i++) {
        const gram = ws.slice(i, i + n);
        if (EDGE_STOP.has(gram[0]) || EDGE_STOP.has(gram[n - 1])) continue;
        if (gram.every((w) => EDGE_STOP.has(w) || /^\d/.test(w) || NUMBER_WORDS.has(w))) continue;
        const key = gram.join(" ");
        (counts.get(key) ?? counts.set(key, new Set()).get(key)!).add(d.conv);
      }
    }
  }
  const ranked = [...counts.entries()]
    .map(([phrase, convs]) => ({ phrase, n: convs.size }))
    .filter((p) => p.n >= minConvs)
    .sort((a, b) => b.n - a.n || b.phrase.split(" ").length - a.phrase.split(" ").length || a.phrase.localeCompare(b.phrase));
  const out: string[] = [];
  for (const p of ranked) {
    if (out.some((o) => o.includes(p.phrase) || p.phrase.includes(o))) continue;
    out.push(p.phrase);
    if (out.length >= max) break;
  }
  return out;
}

/** Plain-text comparison: case, punctuation and spacing don't matter. */
export function sameText(a: string, b: string): boolean {
  const norm = (s: string) => words(s).join(" ");
  return norm(a) === norm(b);
}

/** True when `needle`'s words appear in order inside `hay` (used to find a card's quote among a debrief's quotes). */
export function containsText(hay: string, needle: string): boolean {
  const h = ` ${words(hay).join(" ")} `;
  const n = words(needle).join(" ");
  return !!n && h.includes(` ${n} `);
}
