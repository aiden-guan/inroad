import { daysBetween } from "@/lib/domain/ids";
import { OPEN_STAGES, type Deal, type ID, type ISODate, type Stage, type Workspace } from "@/lib/domain/types";
import type { DealRef, VoiceConversation, VoiceSnippet, VoiceTrend, WinSplit } from "./types";

/**
 * The numbers on a theme, all counted in code: how many conversations and deals raised it, when (last 30 days
 * against before), at which stage, and how deals went where it came up against where it didn't. Small samples
 * are shown as counts; a comparison is only called once both sides have enough decided deals.
 */

export const RECENT_DAYS = 30;
export const BUCKETS = 6;
/** Both sides need this many decided deals before "won more/less often when it came up" is said at all. */
export const MIN_SIDE = 5;
/** And this many before a side is shown as a percentage (src/lib/revenue/stats.ts MIN_CLOSED). */
export const MIN_RATE = 10;

const STAGE_ORDER: Stage[] = [...OPEN_STAGES, "won", "lost", "nurture"];

export function conversationsOf(snips: VoiceSnippet[]): Set<string> {
  return new Set(snips.map((s) => s.conv));
}

export function trendOf(snips: VoiceSnippet[], all: VoiceConversation[], today: ISODate): VoiceTrend {
  const hit = conversationsOf(snips);
  let recent = 0;
  let recentTotal = 0;
  let before = 0;
  let beforeTotal = 0;
  const buckets = Array.from({ length: BUCKETS }, () => 0);
  for (const c of all) {
    const age = daysBetween(c.date, today);
    if (age < 0) continue;
    const isRecent = age < RECENT_DAYS;
    if (isRecent) recentTotal++;
    else beforeTotal++;
    if (!hit.has(c.id)) continue;
    if (isRecent) recent++;
    else before++;
    const i = BUCKETS - 1 - Math.floor(age / RECENT_DAYS);
    if (i >= 0) buckets[i]++;
  }
  let label: VoiceTrend["label"] = null;
  if (before === 0 && recent >= 2 && beforeTotal >= 3) label = "new";
  else if (recent >= 2 && beforeTotal >= 2 && recentTotal >= 2 && recent / recentTotal - before / beforeTotal >= 0.25) label = "rising";
  else if (before >= 2 && recent === 0 && recentTotal >= 3) label = "fading";
  return { recent, recentTotal, before, beforeTotal, label, buckets };
}

/** Where deals stood when it came up: one count per conversation, in pipeline order. */
export function stagesOf(snips: VoiceSnippet[]): { stage: Stage; n: number }[] {
  const byConv = new Map<string, Stage>();
  for (const s of snips) if (s.stage && !byConv.has(s.conv)) byConv.set(s.conv, s.stage);
  const counts = new Map<Stage, number>();
  for (const st of byConv.values()) counts.set(st, (counts.get(st) ?? 0) + 1);
  return STAGE_ORDER.filter((st) => counts.has(st)).map((stage) => ({ stage, n: counts.get(stage)! }));
}

/** Won and lost deals with at least one call or reply on file: the only deals where "it didn't come up" means anything. */
export function heardDecided(ws: Workspace, all: VoiceConversation[]): Deal[] {
  const heard = new Set(all.map((c) => c.dealId).filter((id): id is string => !!id));
  return [...heard].map((id) => ws.deals[id]).filter((d): d is Deal => !!d && (d.stage === "won" || d.stage === "lost"));
}

export function winSplit(decided: Deal[], dealIds: Set<ID>): WinSplit {
  const withIt = decided.filter((d) => dealIds.has(d.id));
  const without = decided.filter((d) => !dealIds.has(d.id));
  const won = (list: Deal[]) => list.filter((d) => d.stage === "won").length;
  const split = { with: { won: won(withIt), n: withIt.length }, without: { won: won(without), n: without.length } };
  if (split.with.n < MIN_SIDE || split.without.n < MIN_SIDE) return { ...split, verdict: "too_early" };
  const diff = split.with.won / split.with.n - split.without.won / split.without.n;
  return { ...split, verdict: Math.abs(diff) < 0.15 ? "same" : diff > 0 ? "more" : "less" };
}

/** A deal's dollars only when someone stated them: its amount, else the last price quoted. Never an average. */
export function knownAmount(deal: Deal): number | undefined {
  if (deal.amountUsd && deal.amountUsd > 0) return deal.amountUsd;
  const q = deal.priceQuotes?.at(-1)?.amountUsd;
  return q && q > 0 ? q : undefined;
}

export function dealRef(deal: Deal): DealRef {
  return { dealId: deal.id, name: deal.name, domain: deal.accountDomain, stage: deal.stage, amountUsd: knownAmount(deal) };
}

export function openDeals(ws: Workspace, dealIds: Iterable<ID>): DealRef[] {
  return [...new Set(dealIds)]
    .map((id) => ws.deals[id])
    .filter((d): d is Deal => !!d && OPEN_STAGES.includes(d.stage))
    .sort((a, b) => (knownAmount(b) ?? 0) - (knownAmount(a) ?? 0) || a.name.localeCompare(b.name))
    .map(dealRef);
}

/** "2 of 3": counts, always. A rate joins them only from MIN_RATE decided deals. */
export function fraction(won: number, n: number): string {
  if (!n) return "none decided";
  return n >= MIN_RATE ? `${won} of ${n} (${Math.round((won / n) * 100)}%)` : `${won} of ${n}`;
}

/** One line for a win split, honest about the sample: "Won 1 of 2 where it came up · 0 of 1 where it didn't · too early to call". */
export function winLine(w: WinSplit): string {
  const n = w.with.n + w.without.n;
  if (!n) return "No decided deals with calls on file yet";
  const parts = [`Won ${fraction(w.with.won, w.with.n)} where it came up`, `${fraction(w.without.won, w.without.n)} where it didn't`];
  const call =
    w.verdict === "too_early"
      ? `too early to call (${n} decided)`
      : w.verdict === "same"
        ? "no clear difference"
        : w.verdict === "more"
          ? "won more often when it came up"
          : "won less often when it came up";
  return `${parts.join(" · ")} · ${call}`;
}
