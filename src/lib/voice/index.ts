import { todayISO } from "@/lib/domain/ids";
import { STAGE_LABELS, type Workspace } from "@/lib/domain/types";
import { plural } from "@/lib/moves/util";
import { buildAlternatives } from "./alternatives";
import { buyerCorpus, debriefedCalls, voiceFingerprint } from "./corpus";
import { conversationsOf } from "./stats";
import { buildThemes } from "./themes";
import type { BuyerVoice, VoiceAlternative, VoiceHeadline, VoiceTheme } from "./types";

/**
 * Buyer voice, computed: the corpus of what buyers said, its themes and alternatives with every number counted
 * in code, a few headlines written by rules from those numbers, and whether the cached theme names still match
 * the calls on file. Pure and isomorphic: the Playbook, the Revenue card and the workflow all read this.
 */
export function buyerVoice(ws: Workspace, today = todayISO()): BuyerVoice {
  const corpus = buyerCorpus(ws);
  const names = ws.buyerVoice?.names;
  const { alternatives, vendorSnippets } = buildAlternatives(ws, corpus);
  const themes = buildThemes(ws, corpus, today, names, vendorSnippets);
  const { snippets, conversations } = corpus;

  const calls = conversations.filter((c) => c.kind === "call");
  const callIds = new Set(calls.map((c) => c.id));
  const transcripts = new Set(snippets.filter((s) => s.source === "transcript").map((s) => s.conv)).size;
  const deals = new Set(conversations.map((c) => c.dealId).filter(Boolean));
  const companies = new Set(conversations.map((c) => c.domain).filter(Boolean));
  const decided = [...deals].map((id) => ws.deals[id!]).filter((d) => d && (d.stage === "won" || d.stage === "lost")).length;
  const quotes = snippets.filter((s) => s.source !== "summary");
  const verbatim = quotes.filter((s) => s.verbatim).length;

  const fingerprint = voiceFingerprint(ws);
  const debriefed = debriefedCalls(ws);
  const naming: BuyerVoice["naming"] = !names
    ? { status: "none", newCalls: debriefed }
    : names.fingerprint === fingerprint
      ? { status: "fresh", newCalls: 0, at: names.at, costUsd: names.costUsd }
      : { status: "stale", newCalls: Math.max(0, debriefed - names.calls), at: names.at, costUsd: names.costUsd };

  const voice: BuyerVoice = {
    snippets,
    conversations,
    summary: {
      calls: calls.length,
      transcripts,
      notes: calls.length - transcripts,
      replies: conversations.filter((c) => c.kind === "reply").length,
      talks: conversations.filter((c) => c.kind === "talk").length,
      companies: companies.size,
      deals: deals.size,
      quotes: quotes.length,
      verbatim,
      paraphrase: quotes.length - verbatim,
      firstDate: conversations[0]?.date,
      lastDate: conversations.at(-1)?.date,
      decided,
    },
    themes,
    alternatives,
    headlines: [],
    needsAnswer: 0,
    naming,
    fingerprint,
    today,
  };
  voice.headlines = headlines(voice, callIds.size);
  voice.needsAnswer = needsAnswer(voice).length;
  return voice;
}

/** How many conversations raised it: the unit every "n of m" on this page counts in. */
export const heardIn = (x: Pick<VoiceTheme, "snippets"> | Pick<VoiceAlternative, "snippets">) => conversationsOf(x.snippets).size;

/**
 * What keeps coming up with no answer on file at all: an objection or a vendor in 2+ conversations, another alternative
 * in 3+. A draft answer already counts under How we sell → Objections, so it isn't counted twice here.
 */
export function needsAnswer(v: Pick<BuyerVoice, "themes" | "alternatives">): (VoiceTheme | VoiceAlternative)[] {
  const themes = v.themes.filter((t) => t.kind === "objection" && heardIn(t) >= 2 && !t.response);
  const alts = v.alternatives.filter((a) => !a.response && heardIn(a) >= (a.kind === "competitor" ? 2 : 3));
  return [...themes, ...alts];
}

const quoteLabel = (s: string) => `“${s}”`;

/**
 * At most three lines a Head of GTM would want first, written by rules from the counts: what's new or rising, a
 * vendor buyers name that the playbook doesn't, a recurring objection with no approved answer, and the most
 * common theme. Never a cause or a recommendation the numbers don't show.
 */
function headlines(v: BuyerVoice, totalCalls: number): VoiceHeadline[] {
  const out: VoiceHeadline[] = [];
  const used = new Set<string>();
  const push = (h: VoiceHeadline, id: string) => {
    if (used.has(id) || out.length >= 3) return;
    used.add(id);
    out.push(h);
  };
  const rising = v.themes.find((t) => (t.trend.label === "rising" || t.trend.label === "new") && t.trend.recent >= 2);
  if (rising) {
    const t = rising.trend;
    push(
      {
        text: `${quoteLabel(rising.label)} is up: ${t.recent} of the last ${plural(t.recentTotal, "conversation")}, against ${t.before} of ${t.beforeTotal} before.`,
        theme: rising.key,
        tone: "attention",
      },
      rising.key,
    );
  }
  const unlisted = v.alternatives.find((a) => !a.inPlaybook && a.kind === "competitor" && heardIn(a) >= 1);
  if (unlisted) {
    const n = heardIn(unlisted);
    push({ text: `Buyers named ${unlisted.name} in ${plural(n, "conversation")} (${plural(unlisted.deals, "deal")}). It isn't in your playbook.`, alternative: unlisted.key, tone: "attention" }, unlisted.key);
  }
  const unanswered = v.themes.find((t) => t.kind === "objection" && heardIn(t) >= 2 && !t.response?.approved);
  if (unanswered) push({ text: `${quoteLabel(unanswered.label)} came up in ${plural(heardIn(unanswered), "conversation")} and has ${unanswered.response ? "only a draft answer" : "no answer on file"}.`, theme: unanswered.key, tone: "attention" }, unanswered.key);
  const top = v.themes.find((t) => t.calls >= 2);
  if (top) push({ text: `${quoteLabel(top.label)}: ${top.calls} of ${plural(totalCalls, "call")}, across ${plural(top.deals, "deal")}.`, theme: top.key, tone: "neutral" }, top.key);
  const early = v.themes.find((t) => t.kind === "process" && t.stages[0] && t.stages[0].n >= 2 && (t.stages[0].stage === "talking" || t.stages[0].stage === "qualified"));
  if (early) push({ text: `${early.label} comes up as early as ${STAGE_LABELS[early.stages[0].stage]} (${early.stages[0].n} of ${plural(heardIn(early), "conversation")}).`, theme: early.key, tone: "neutral" }, early.key);
  return out;
}

export type { BuyerVoice, VoiceAlternative, VoiceTheme } from "./types";
