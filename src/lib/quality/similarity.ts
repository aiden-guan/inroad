/**
 * Template-convergence checks, done locally (no embeddings provider): skeleton diversity and
 * near-duplicate detection with TF-IDF over word 1–2-grams after masking entities.
 * Pure and fast enough to run on every keystroke in the editor.
 */

const URL_RE = /https?:\/\/\S+|www\.\S+/g;
const QUOTED_RE = /["“][^"”]{1,200}["”]/g;
const GREETING_LINE = /^(hi|hey|hello|dear)\b[^\n]{0,40}$/i;

/** Masks names, numbers, quotes and URLs so two drafts compare on structure, not on who they're about. */
export function maskEntities(text: string): string[] {
  const cleaned = text.replace(URL_RE, " URL ").replace(QUOTED_RE, " QUOTE ");
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let sentenceStart = true;
  for (const raw of tokens) {
    const word = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}']+$/gu, "");
    const endsSentence = /[.!?:]["”')]*$/.test(raw);
    if (!word) {
      sentenceStart = endsSentence || sentenceStart;
      continue;
    }
    let token: string;
    if (word === "URL" || word === "QUOTE") token = word.toLowerCase();
    else if (/\d/.test(word)) token = "#";
    else if (!sentenceStart && /^\p{Lu}/u.test(word) && word !== "I") token = "x";
    else token = word.toLowerCase().replace(/['’]s$/, "");
    out.push(token);
    sentenceStart = endsSentence;
  }
  return out;
}

/** Drops a leading greeting line ("Hi Dana,") and a leading "Dana," so line 1 is the real opener. */
export function stripGreeting(body: string): string {
  const lines = body.split("\n");
  while (lines.length && !lines[0].trim()) lines.shift();
  if (lines.length > 1 && GREETING_LINE.test(lines[0].trim()) && lines[0].trim().split(/\s+/).length <= 4) lines.shift();
  while (lines.length && !lines[0].trim()) lines.shift();
  const first = (lines[0] ?? "").replace(/^\s*(hi|hey|hello|dear)\s+/i, "").replace(/^\s*\p{Lu}[\p{L}'’.-]*(\s\p{Lu}[\p{L}'’.-]*)?\s*[,—–]\s*/u, "");
  lines[0] = first;
  return lines.join("\n").trim();
}

export function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => /[\p{L}\p{N}]/u.test(s));
}

/** First 4 masked tokens of the opening sentence. */
export function openerSkeleton(body: string): string {
  const first = sentences(stripGreeting(body))[0] ?? "";
  return maskEntities(first).slice(0, 4).join(" ");
}

/** First 5 masked tokens of the last question. */
export function ctaSkeleton(body: string): string {
  const qs = sentences(body).filter((s) => s.endsWith("?"));
  const last = qs[qs.length - 1];
  return last ? maskEntities(last).slice(0, 5).join(" ") : "";
}

function grams(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (let i = 0; i < tokens.length; i++) {
    tf.set(tokens[i], (tf.get(tokens[i]) ?? 0) + 1);
    if (i + 1 < tokens.length) {
      const bi = `${tokens[i]} ${tokens[i + 1]}`;
      tf.set(bi, (tf.get(bi) ?? 0) + 1);
    }
  }
  return tf;
}

/** TF-IDF cosine of `target` against each of `others`, IDF computed over the whole set. */
export function tfidfSimilarities(target: string, others: string[]): number[] {
  if (!others.length) return [];
  const docs = [target, ...others].map((d) => grams(maskEntities(d)));
  const df = new Map<string, number>();
  for (const d of docs) for (const g of d.keys()) df.set(g, (df.get(g) ?? 0) + 1);
  const n = docs.length;
  const vec = (d: Map<string, number>) => {
    const v = new Map<string, number>();
    for (const [g, tf] of d) v.set(g, tf * (Math.log((1 + n) / (1 + (df.get(g) ?? 0))) + 1));
    return v;
  };
  const norm = (v: Map<string, number>) => Math.sqrt([...v.values()].reduce((s, x) => s + x * x, 0)) || 1;
  const t = vec(docs[0]);
  const tn = norm(t);
  return docs.slice(1).map((d) => {
    const o = vec(d);
    let dot = 0;
    for (const [g, w] of t) dot += w * (o.get(g) ?? 0);
    return dot / (tn * norm(o));
  });
}

export interface RecentDraft {
  body: string;
  sameAccount: boolean;
  ageDays: number;
  /** Shown in the detail line ("your draft to Lumen"). */
  label?: string;
}

export interface ConvergenceIssue {
  code: "SKELETON_REPEAT" | "NEAR_DUPLICATE";
  detail: string;
}

/**
 * SKELETON_REPEAT: over the last 7 days of cold drafts (at least 6), more than 30% share this
 * draft's opener or CTA skeleton. NEAR_DUPLICATE: cosine > 0.85 against a different company
 * within 14 days, or > 0.80 against the same company within 7 days.
 */
export function convergence(body: string, recent: RecentDraft[]): ConvergenceIssue[] {
  const issues: ConvergenceIssue[] = [];
  const week = recent.filter((r) => r.ageDays <= 7);
  if (week.length >= 6) {
    const opener = openerSkeleton(body);
    const cta = ctaSkeleton(body);
    const sameOpener = opener ? week.filter((r) => openerSkeleton(r.body) === opener).length : 0;
    const sameCta = cta ? week.filter((r) => ctaSkeleton(r.body) === cta).length : 0;
    if (sameOpener / week.length > 0.3) {
      issues.push({ code: "SKELETON_REPEAT", detail: `Opens the same way as ${sameOpener} of your last ${week.length} drafts. Try a different first line.` });
    } else if (sameCta / week.length > 0.3) {
      issues.push({ code: "SKELETON_REPEAT", detail: `Ends with the same question shape as ${sameCta} of your last ${week.length} drafts.` });
    }
  }
  const window = recent.filter((r) => (r.sameAccount ? r.ageDays <= 7 : r.ageDays <= 14));
  const sims = tfidfSimilarities(body, window.map((r) => r.body));
  let worst: { sim: number; r: RecentDraft } | null = null;
  sims.forEach((sim, i) => {
    const r = window[i];
    const limit = r.sameAccount ? 0.8 : 0.85;
    if (sim > limit && (!worst || sim > worst.sim)) worst = { sim, r };
  });
  if (worst) {
    const { sim, r } = worst as { sim: number; r: RecentDraft };
    issues.push({
      code: "NEAR_DUPLICATE",
      detail: `Nearly the same as ${r.label ?? (r.sameAccount ? "another draft to this company" : "a recent draft")} (${sim.toFixed(2)}). Write it for this reader.`,
    });
  }
  return issues;
}
