import { clip } from "@/lib/moves/util";
import { heardIn } from "./index";
import { kindOf } from "./themes";
import type { BuyerVoice, ThemeKind, VoiceNames, VoiceSnippet } from "./types";

/**
 * The one cheap model pass: name the clusters code built, in buyers' words, merge two that are the same concern,
 * and drop a quote that plainly doesn't belong. Code writes the prompt, checks every id the answer uses, and keeps
 * only valid parts. It is cached against the debriefs it read and re-run only when new ones arrive.
 */

export const NAME_MAX_CLUSTERS = 30;
export const NAME_MAX_QUOTES = 5;

export const NAME_RULES = `NAMING RULES
Code grouped what buyers said on sales calls into clusters. You name them; you never count, and you never add facts.
- name: at most 6 words, sentence case, the way a buyer would say it ("Usage tie-out eats days every close").
  Use their words from the quotes where you can. No quote marks, no company or person names, no digits, no hype.
- gist: at most 18 words, plain: what buyers mean by it. Paraphrase only what the quotes say.
- mergeInto: the id of another cluster of the same kind when both are the same concern; otherwise null. Never merge
  across kinds, never into a cluster you also merge away.
- outliers: ids of quotes that plainly aren't about the cluster. Usually none.
- Return every cluster once.`;

export interface NamingCluster {
  key: string;
  kind: ThemeKind;
  /** Prompt quote id → snippet id. */
  quotes: Map<string, string>;
}

export interface NamingInput {
  block: string;
  /** Prompt cluster id (c1…) → its theme. */
  clusters: Map<string, NamingCluster>;
  count: number;
}

const tag = (s: VoiceSnippet) => [s.source === "transcript" ? "transcript" : s.source === "email" ? "email" : s.source === "summary" ? "debrief summary" : "founder's notes", s.title].filter(Boolean).join(", ");

export function namingInput(voice: BuyerVoice): NamingInput {
  const clusters = new Map<string, NamingCluster>();
  const lines: string[] = [];
  let q = 0;
  voice.themes.slice(0, NAME_MAX_CLUSTERS).forEach((t, i) => {
    const id = `c${i + 1}`;
    const quotes = new Map<string, string>();
    const picked = [...t.snippets].sort((a, b) => Number(b.verbatim) - Number(a.verbatim) || b.at.localeCompare(a.at)).slice(0, NAME_MAX_QUOTES);
    lines.push(`<cluster id="${id}" kind="${t.kind}" conversations="${heardIn(t)}" current_label="${t.codeLabel.replace(/"/g, "'")}">`);
    for (const s of picked) {
      const sid = `s${++q}`;
      quotes.set(sid, s.id);
      lines.push(`${sid} [${tag(s)}]: "${clip(s.text, 220).replace(/"/g, "'")}"`);
    }
    lines.push("</cluster>");
    clusters.set(id, { key: t.key, kind: t.kind, quotes });
  });
  return { block: lines.join("\n"), clusters, count: clusters.size };
}

export interface NamingOut {
  clusters: { id: string; name: string; gist: string; mergeInto: string | null; outliers: string[] }[];
}

const cleanName = (s: string) => s.replace(/["“”]/g, "").replace(/\s+/g, " ").trim().replace(/[.!]+$/, "");
const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

/** What's wrong with an answer, for one resubmission (unknown ids, cross-kind merges, digits or length in names). */
export function namingProblems(out: NamingOut, input: NamingInput): string[] {
  const problems: string[] = [];
  const merged = new Set(out.clusters.filter((c) => c.mergeInto).map((c) => c.id));
  for (const c of out.clusters) {
    const cluster = input.clusters.get(c.id);
    if (!cluster) {
      problems.push(`${c.id} isn't a cluster id`);
      continue;
    }
    if (wordCount(c.name) > 7) problems.push(`${c.id}: name is ${wordCount(c.name)} words; keep it ≤6`);
    if (/\d/.test(c.name)) problems.push(`${c.id}: no digits in names`);
    if (wordCount(c.gist) > 24) problems.push(`${c.id}: gist is ${wordCount(c.gist)} words; keep it ≤18`);
    if (c.mergeInto) {
      const target = input.clusters.get(c.mergeInto);
      if (!target || c.mergeInto === c.id) problems.push(`${c.id}: mergeInto must be another cluster id`);
      else if (target.kind !== cluster.kind) problems.push(`${c.id}: can't merge a ${cluster.kind} into a ${target.kind}`);
      else if (merged.has(c.mergeInto)) problems.push(`${c.id}: ${c.mergeInto} is merged away itself`);
    }
    const bad = c.outliers.filter((o) => !cluster.quotes.has(o));
    if (bad.length) problems.push(`${c.id}: outliers ${bad.join(", ")} aren't quotes in that cluster`);
  }
  return problems;
}

/** The answer as the cache keeps it: only valid parts, keyed by theme key and snippet id. */
export function applyNaming(out: NamingOut, input: NamingInput, meta: { fingerprint: string; calls: number; at: string; runId?: string; costUsd?: number }): VoiceNames {
  const entries: VoiceNames["entries"] = {};
  const merges: VoiceNames["merges"] = {};
  const outliers: VoiceNames["outliers"] = {};
  const mergedAway = new Set(out.clusters.filter((c) => c.mergeInto && input.clusters.has(c.mergeInto)).map((c) => c.id));
  for (const c of out.clusters) {
    const cluster = input.clusters.get(c.id);
    if (!cluster) continue;
    const name = cleanName(c.name);
    if (name && wordCount(name) <= 8 && !/\d/.test(name)) entries[cluster.key] = { name: name.charAt(0).toUpperCase() + name.slice(1), ...(c.gist.trim() ? { gist: clip(c.gist.trim(), 160) } : {}) };
    const target = c.mergeInto ? input.clusters.get(c.mergeInto) : undefined;
    if (target && c.mergeInto !== c.id && target.kind === cluster.kind && !mergedAway.has(c.mergeInto!) && kindOf(target.key) === kindOf(cluster.key)) merges[cluster.key] = target.key;
    const ids = c.outliers.map((o) => cluster.quotes.get(o)).filter((x): x is string => !!x);
    // Never empty a theme: a cluster whose every quote is an outlier keeps them.
    if (ids.length && ids.length < cluster.quotes.size) outliers[cluster.key] = ids;
  }
  return { fingerprint: meta.fingerprint, calls: meta.calls, at: meta.at, ...(meta.runId ? { runId: meta.runId } : {}), ...(meta.costUsd !== undefined ? { costUsd: meta.costUsd } : {}), entries, merges, outliers };
}
