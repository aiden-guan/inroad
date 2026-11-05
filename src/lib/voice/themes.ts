import type { ObjectionCard, Workspace } from "@/lib/domain/types";
import { bestCard } from "./alternatives";
import type { Corpus } from "./corpus";
import { CONCERN, SEED_BY_KEY, THEME_SEEDS, WANT, type ThemeSeed } from "./lexicon";
import { conversationsOf, heardDecided, openDeals, stagesOf, trendOf, winSplit } from "./stats";
import { containsText, hashKey, idf, similarity, terms, topPhrases, words } from "./text";
import type { ThemeKind, VoiceNames, VoiceSnippet, VoiceTheme } from "./types";

/**
 * Themes, clustered in code. A snippet joins every seed whose pattern it matches (an objection category, a
 * buying-process fact, a shape of pain or wanted outcome), the category of a playbook objection card it reads
 * like, and, when a vendor is named, "another tool should cover it". Card fields the debrief cited it for are
 * hints when no pattern placed it. What's left is grouped by similarity into new themes, kept only once two
 * conversations share one. A cached model pass may then rename themes, merge two of the same kind, or drop a
 * quote that doesn't belong; it never changes a count, because every number is recounted here from members.
 */

export const CATEGORY_SEED: Record<ObjectionCard["category"], string> = {
  build: "objection:build",
  security: "objection:security",
  budget: "objection:price",
  timing: "objection:timing",
  priority: "objection:timing",
  status_quo: "objection:status_quo",
  competitor: "objection:competitor",
  startup_risk: "objection:startup_risk",
  info_request: "objection:info",
  team: "objection:owner",
};

/** How alike two texts must be for a quote to join a card's category, or two leftovers to share a theme. */
const CARD_SIMILARITY = 0.3;
const CLUSTER_SIMILARITY = 0.3;
/** Leftovers clustered at most (the newest), so a large workspace stays fast. */
const MAX_LEFTOVERS = 160;

export const kindOf = (key: string) => key.split(":")[0] as ThemeKind;
const unique = <T,>(xs: T[]) => [...new Set(xs)];

/** Seeds a snippet matches by pattern, with a seed's `unless` applied (a review that "takes two weeks" isn't a pain). */
export function seedMatches(text: string): string[] {
  const hit = THEME_SEEDS.filter((s) => s.patterns.some((p) => p.test(text))).map((s) => s.key);
  return hit.filter((k) => !SEED_BY_KEY.get(k)!.unless?.some((u) => hit.includes(u)));
}

/** Average-linkage clustering over weighted term similarity; clusters merge while the closest pair is alike enough. */
export function agglomerate(items: VoiceSnippet[], weights: Map<string, number>, threshold = CLUSTER_SIMILARITY): VoiceSnippet[][] {
  const n = items.length;
  if (n < 2) return items.map((s) => [s]);
  const sim: number[][] = items.map((a, i) => items.map((b, j) => (i === j ? 0 : similarity(a.terms, b.terms, weights))));
  const members: number[][] = items.map((_, i) => [i]);
  const alive = items.map(() => true);
  for (;;) {
    let best = -1;
    let bi = -1;
    let bj = -1;
    for (let i = 0; i < n; i++) {
      if (!alive[i]) continue;
      for (let j = i + 1; j < n; j++) {
        if (alive[j] && sim[i][j] > best) {
          best = sim[i][j];
          bi = i;
          bj = j;
        }
      }
    }
    if (bi < 0 || best < threshold) break;
    const a = members[bi].length;
    const b = members[bj].length;
    for (let k = 0; k < n; k++) {
      if (!alive[k] || k === bi || k === bj) continue;
      const v = (a * sim[bi][k] + b * sim[bj][k]) / (a + b);
      sim[bi][k] = v;
      sim[k][bi] = v;
    }
    members[bi] = [...members[bi], ...members[bj]];
    alive[bj] = false;
  }
  return members.filter((_, i) => alive[i]).map((idx) => idx.map((i) => items[i]));
}

const EDGE = /^(?:and|or|but|so|the|a|an|of|to|in|on|for|with|this|that|it|its|is|was|we|our|i|my|they|their|instead|of)$/i;

/** The words a seed's pattern matched in a quote, trimmed of edge filler: "five days", "saves us that hire". */
function fragments(text: string, seed: ThemeSeed): string[] {
  const out: string[] = [];
  for (const p of seed.patterns) {
    const m = new RegExp(p.source, p.flags.replace("g", "")).exec(text);
    if (!m) continue;
    const ws = m[0].trim().split(/\s+/);
    while (ws.length && EDGE.test(ws[0].replace(/[^\w']/g, ""))) ws.shift();
    while (ws.length && EDGE.test(ws[ws.length - 1].replace(/[^\w']/g, ""))) ws.pop();
    const frag = ws.join(" ").replace(/[,.;:?!]+$/, "");
    if (ws.length && ws.length <= 7) out.push(frag);
  }
  return out;
}

/** The debrief's customer words (verbatim, kept by the debrief) found in a theme's quotes, most conversations first. */
function debriefWords(snips: VoiceSnippet[], customerWords: Corpus["customerWords"]): string[] {
  const verbatim = snips.filter((s) => s.verbatim);
  const said = unique(verbatim.flatMap((s) => (customerWords.get(s.conv) ?? []).filter((p) => containsText(s.text, p))));
  const convsWith = (p: string) => new Set(verbatim.filter((s) => containsText(s.text, p)).map((s) => s.conv)).size;
  return said.map((p) => ({ p, n: convsWith(p) })).sort((a, b) => b.n - a.n || b.p.length - a.p.length).map((x) => x.p);
}

/**
 * Phrases buyers kept using in a theme, verbatim only, most conversations first: the words its own pattern matched,
 * the debrief's customer words that share a word with those, then phrases two or more conversations used.
 */
function phrasesFor(snips: VoiceSnippet[], customerWords: Corpus["customerWords"], seed: ThemeSeed | undefined): string[] {
  const verbatim = snips.filter((s) => s.verbatim);
  const convsWith = (p: string) => new Set(verbatim.filter((s) => containsText(s.text, p)).map((s) => s.conv)).size;
  const matched = seed ? unique(verbatim.flatMap((s) => fragments(s.text, seed))) : [];
  const frags = matched.filter((f) => f.split(" ").length >= 2);
  const anchor = new Set([...matched.flatMap(terms), ...(seed ? terms(seed.label) : [])]);
  const said = debriefWords(snips, customerWords);
  const fromDebriefs = seed ? said.filter((p) => terms(p).some((t) => anchor.has(t))) : said;
  const shared = topPhrases(verbatim.map((s) => ({ conv: s.conv, text: s.text })), 4, 2).filter((p) => !seed || terms(p).some((t) => anchor.has(t)));
  const ranked = unique([...fromDebriefs, ...frags, ...shared])
    .map((p) => ({ p, n: convsWith(p) + (fromDebriefs.includes(p) ? 0.6 : 0) + (frags.includes(p) ? 0.3 : 0) }))
    .filter((x) => x.n >= 1)
    .sort((a, b) => b.n - a.n || b.p.split(" ").length - a.p.split(" ").length);
  const out: string[] = [];
  const key = (p: string) => terms(p).join(" ");
  for (const { p } of ranked) {
    const k = key(p);
    if (!k || out.some((o) => key(o) === k || containsText(o, p) || containsText(p, o))) continue;
    out.push(p);
    if (out.length >= 3) break;
  }
  return out;
}

const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A new theme's code label: the phrase its conversations share, else the start of its oldest quote. */
function emergentLabel(snips: VoiceSnippet[]): string {
  const shared = topPhrases(snips.map((s) => ({ conv: s.conv, text: s.text })), 1, 2)[0];
  if (shared) return sentence(shared);
  const oldest = [...snips].sort((a, b) => Number(b.verbatim) - Number(a.verbatim) || a.at.localeCompare(b.at))[0];
  const w = oldest.text.replace(/\s+/g, " ").trim().split(" ");
  return w.length > 8 ? `${w.slice(0, 8).join(" ")}…` : oldest.text;
}

interface PlaybookText {
  text: string;
  where: string;
}

/** What the playbook already says about pains and outcomes, with where it says it. */
export function playbookTexts(ws: Workspace): PlaybookText[] {
  const f = ws.foundation;
  if (!f) return [];
  const out: PlaybookText[] = [];
  for (const p of f.personas ?? []) for (const t of p.pains) out.push({ text: t, where: `Pains · ${p.titles[0] ?? p.role.replace(/_/g, " ")}` });
  for (const v of f.positioning?.valueThemes ?? []) out.push({ text: `${v.theme}. ${v.outcome}`, where: `Value theme · ${v.theme}` });
  for (const t of f.messaging?.themes ?? []) out.push({ text: `${t.headline}. ${t.vsAlternative}`, where: `Messaging · ${t.headline}` });
  if (f.messaging?.oneLiner) out.push({ text: f.messaging.oneLiner, where: "One-liner" });
  for (const w of f.messaging?.customerWords ?? []) out.push({ text: w.phrase, where: "Customer words" });
  if (f.icp?.hypothesis?.obstacle) out.push({ text: f.icp.hypothesis.obstacle, where: "Segment bet" });
  return out.filter((x) => x.text.trim());
}

function coverage(seed: ThemeSeed | undefined, phrases: string[], texts: PlaybookText[]): string | undefined {
  for (const t of texts) {
    if (seed?.patterns.some((p) => p.test(t.text))) return t.where;
    if (phrases.some((p) => containsText(t.text, p))) return t.where;
  }
  return undefined;
}

export function buildThemes(ws: Workspace, corpus: Corpus, today: string, names: VoiceNames | undefined, vendorSnippets: Set<string>): VoiceTheme[] {
  const weights = idf(corpus.snippets.map((s) => s.terms));
  const groups = new Map<string, VoiceSnippet[]>();
  const add = (key: string, s: VoiceSnippet) => {
    const g = groups.get(key) ?? groups.set(key, []).get(key)!;
    if (!g.includes(s)) g.push(s);
  };
  const cards = ws.objections.map((o) => ({ o, terms: terms(o.objection) }));
  const leftovers: { s: VoiceSnippet; kind: ThemeKind }[] = [];

  for (const s of corpus.snippets) {
    const keys = seedMatches(s.text);
    if (vendorSnippets.has(s.id)) keys.push("objection:competitor");
    for (const c of cards) {
      const shared = s.terms.filter((t) => c.terms.includes(t));
      if (new Set(shared).size >= 2 && similarity(s.terms, c.terms, weights) >= CARD_SIMILARITY) keys.push(CATEGORY_SEED[c.o.category]);
    }
    // A reply read as "not now" is a timing objection even when its words don't say so.
    if (s.intent === "not_now" && !keys.some((k) => k.startsWith("objection:"))) keys.push("objection:timing");
    const placedProcess = keys.some((k) => k.startsWith("process:"));
    if (!placedProcess && s.fields.includes("criticalEvent")) keys.push("process:deadline");
    if (!placedProcess && s.fields.includes("decisionProcess")) keys.push("process:approval");
    if (keys.length) {
      for (const k of unique(keys)) add(k, s);
      continue;
    }
    const kind: ThemeKind | null =
      s.source === "summary" || s.intent === "objection" || s.intent === "negative" ? "objection" : WANT.test(s.text) ? "outcome" : CONCERN.test(s.text) ? "objection" : s.fields.includes("pain") ? "pain" : null;
    if (kind) leftovers.push({ s, kind });
  }

  const codeLabels = new Map<string, string>();
  for (const kind of ["objection", "pain", "outcome"] as const) {
    const items = leftovers.filter((l) => l.kind === kind).map((l) => l.s).slice(0, MAX_LEFTOVERS);
    for (const cluster of agglomerate(items, weights)) {
      if (conversationsOf(cluster).size < 2) continue;
      const oldest = [...cluster].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id))[0];
      const key = `${kind}:e:${hashKey(oldest.id)}`;
      for (const s of cluster) add(key, s);
      codeLabels.set(key, emergentLabel(cluster));
    }
  }

  // The cached naming pass: merges of two themes of the same kind, then quotes it said don't belong.
  if (names) {
    for (const [from, to] of Object.entries(names.merges)) {
      const a = groups.get(from);
      const b = groups.get(to);
      if (!a || !b || from === to || kindOf(from) !== kindOf(to) || names.merges[to]) continue;
      for (const s of a) if (!b.includes(s)) b.push(s);
      groups.delete(from);
    }
    for (const [key, ids] of Object.entries(names.outliers)) {
      const g = groups.get(key);
      if (g) groups.set(key, g.filter((s) => !ids.includes(s.id)));
    }
  }

  const decided = heardDecided(ws, corpus.conversations);
  const texts = playbookTexts(ws);
  const themes: VoiceTheme[] = [];
  for (const [key, raw] of groups) {
    // A call with a quote doesn't also need the debrief's one-line summary of the same objection.
    const quoted = new Set(raw.filter((s) => s.verbatim).map((s) => s.conv));
    const snips = raw.filter((s) => !(s.source === "summary" && quoted.has(s.conv))).sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
    if (!snips.length) continue;
    const kind = kindOf(key);
    const seed = SEED_BY_KEY.get(key);
    const dealIds = new Set(snips.map((s) => s.dealId).filter((id): id is string => !!id));
    const byKind = (k: VoiceSnippet["convKind"]) => new Set(snips.filter((s) => s.convKind === k).map((s) => s.conv)).size;
    const companies = unique(snips.map((s) => s.company).filter((c): c is string => !!c));
    const phrases = phrasesFor(snips, corpus.customerWords, seed);
    const said = debriefWords(snips, corpus.customerWords);
    const codeLabel = seed?.label ?? codeLabels.get(key) ?? emergentLabel(snips);
    const entry = names?.entries[key];
    const dates = snips.map((s) => s.date).sort();
    const category = seed?.category;
    const card =
      kind === "objection"
        ? bestCard(category ? ws.objections.filter((o) => CATEGORY_SEED[o.category] === key) : cards.filter((c) => snips.some((s) => similarity(s.terms, c.terms, weights) >= CARD_SIMILARITY)).map((c) => c.o))
        : undefined;
    themes.push({
      key,
      kind,
      label: entry?.name || codeLabel,
      codeLabel,
      named: !!entry?.name,
      gist: entry?.gist,
      phrases,
      words: said,
      snippets: snips,
      calls: byKind("call"),
      replies: byKind("reply"),
      talks: byKind("talk"),
      deals: dealIds.size,
      companies,
      dealIds: [...dealIds],
      stages: stagesOf(snips),
      trend: trendOf(snips, corpus.conversations, today),
      win: winSplit(decided, dealIds),
      open: openDeals(ws, dealIds),
      firstHeard: dates[0],
      lastHeard: dates.at(-1)!,
      inPlaybook: kind === "pain" || kind === "outcome" ? coverage(seed, phrases, texts) : undefined,
      category: category ?? (card ? card.category : undefined),
      response: card ? { objectionId: card.id, approved: card.approved, text: card.response } : undefined,
    });
  }

  return themes.sort((a, b) => conversationsOf(b.snippets).size - conversationsOf(a.snippets).size || b.deals - a.deals || b.lastHeard.localeCompare(a.lastHeard) || a.key.localeCompare(b.key));
}

/** Words for the theme in a prompt or a toast: its name, never more than a short line. */
export function themeWords(t: Pick<VoiceTheme, "label">): string {
  const w = words(t.label);
  return w.length > 12 ? `${t.label.split(/\s+/).slice(0, 12).join(" ")}…` : t.label;
}
