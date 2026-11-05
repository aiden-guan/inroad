import { addDays, daysBetween } from "@/lib/domain/ids";
import type { Deal, ISODate, RevenueTarget, Stage, Workspace } from "@/lib/domain/types";
import { localDate } from "@/lib/moves/util";

/**
 * What the workspace's own history says, in code. Every rate is either observed (enough closed deals
 * to mean something) or a stated prior, and says which, with its n. Nothing here calls a model.
 * Pure and isomorphic: the Revenue page, Today, Ask and the agent API all read the same numbers.
 */

export type OpenStage = "talking" | "qualified" | "pilot" | "proposal";
export const FUNNEL: OpenStage[] = ["talking", "qualified", "pilot", "proposal"];

/**
 * Small samples are wide: 2 wins in 8 is anywhere from 7% to 59%. So rates are shrunk toward a stated prior,
 * counted as PSEUDO_DEALS deals, until there are MIN_OBSERVED decided deals of the workspace's own
 * (empirical Bayes; docs/research/12 §1.5). Medians need fewer: MIN_WON won deals, MIN_STAGE_EXITS per stage.
 */
export const PSEUDO_DEALS = 10;
export const MIN_OBSERVED = 30;
/** Below this many decided deals a rate is shown as a count, never as a percentage alone. */
export const MIN_CLOSED = 10;
export const MIN_WON = 5;
export const MIN_STAGE_EXITS = 8;

/**
 * Starting assumptions for a seed–Series A B2B team selling mid-market annual contracts, replaced one by
 * one as the workspace's own deals close. Stage odds are the share of deals at that stage that end won.
 */
export const PRIORS = {
  winRate: 0.25,
  cycleDays: 60,
  coverage: 3,
  meetingToQualified: 0.5,
  stageDays: { talking: 14, qualified: 21, pilot: 30, proposal: 14 } satisfies Record<OpenStage, number>,
  stageWin: { talking: 0.08, qualified: 0.25, pilot: 0.6, proposal: 0.65 } satisfies Record<OpenStage, number>,
};

export interface Observed {
  value: number;
  /** "blended": the workspace's own rate shrunk toward the prior; "observed": its own alone. */
  source: "observed" | "blended" | "prior";
  /** Data points behind the value so far. */
  n: number;
  /** Data points needed before the workspace's own value stands alone. */
  need: number;
  prior: number;
  /** The workspace's own raw value, once it has any data. */
  raw?: number;
}

/** A median (deal size, cycle, days in stage): the prior until there's enough data, then the workspace's own. */
function observed(prior: number, value: number | null, n: number, need: number): Observed {
  return value !== null && n >= need ? { value, source: "observed", n, need, prior, raw: value } : { value: prior, source: "prior", n, need, prior, ...(value !== null ? { raw: value } : {}) };
}

/** A rate: (hits + prior × 10) ÷ (n + 10) until 30 decided, then the workspace's own. */
export function blended(prior: number, hits: number, n: number): Observed {
  if (n <= 0) return { value: prior, source: "prior", n: 0, need: MIN_OBSERVED, prior };
  const raw = hits / n;
  if (n >= MIN_OBSERVED) return { value: raw, source: "observed", n, need: MIN_OBSERVED, prior, raw };
  return { value: (hits + prior * PSEUDO_DEALS) / (n + PSEUDO_DEALS), source: "blended", n, need: MIN_OBSERVED, prior, raw };
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/* ─────────────────────────────── Dates on a deal ─────────────────────────────── */

/** When the deal entered `stage` most recently, or undefined if it never did. */
export function enteredAt(deal: Deal, stage: Stage): string | undefined {
  for (let i = deal.stageHistory.length - 1; i >= 0; i--) if (deal.stageHistory[i].stage === stage) return deal.stageHistory[i].at;
  return undefined;
}

export function reached(deal: Deal, stage: Stage): boolean {
  return deal.stage === stage || deal.stageHistory.some((h) => h.stage === stage);
}

/** The first real conversation: a deal starts at Talking. */
export function startedOn(deal: Deal): ISODate {
  return localDate(deal.stageHistory[0]?.at ?? deal.createdAt);
}

/** The day a won or lost deal closed. */
export function closedOn(deal: Deal): ISODate | undefined {
  if (deal.stage !== "won" && deal.stage !== "lost") return undefined;
  return localDate(enteredAt(deal, deal.stage) ?? deal.updatedAt);
}

export function daysInStage(deal: Deal, today: ISODate): number {
  return Math.max(0, daysBetween(localDate(enteredAt(deal, deal.stage) ?? deal.createdAt), today));
}

/** Distinct later close dates after the first one promised: each is a slip. */
export function closeDateSlips(deal: Deal): number {
  const dates = (deal.closeDateHistory ?? []).map((h) => h.date);
  let slips = 0;
  for (let i = 1; i < dates.length; i++) if (dates[i] > dates[i - 1]) slips++;
  return slips;
}

/* ─────────────────────────────── Periods ─────────────────────────────── */

export interface Period {
  start: ISODate;
  end: ISODate;
  label: string;
  /** Calendar days left including today (0 once the period is over). */
  daysLeft: number;
  weeksLeft: number;
  /** Share of the period already gone, 0–1. */
  elapsed: number;
}

/** The calendar quarter that contains `today`. */
export function quarterOf(today: ISODate): { start: ISODate; end: ISODate; label: string } {
  const [y, m] = today.split("-").map(Number);
  const q = Math.floor((m - 1) / 3);
  const start = `${y}-${String(q * 3 + 1).padStart(2, "0")}-01`;
  const next = q === 3 ? `${y + 1}-01-01` : `${y}-${String(q * 3 + 4).padStart(2, "0")}-01`;
  return { start, end: addDays(next, -1), label: `Q${q + 1} ${y}` };
}

/**
 * The saved target, while it still governs: during its period, or before it starts (a target set ahead for next
 * quarter). Once its period has ended it's last period's number, not this one's, so the forecast rolls on.
 */
export function liveTarget(target: RevenueTarget | undefined, today: ISODate): RevenueTarget | undefined {
  return target && target.periodEnd >= today ? target : undefined;
}

/** A saved target whose period is over: history, and the default offered for the period running now. */
export function endedTarget(target: RevenueTarget | undefined, today: ISODate): RevenueTarget | undefined {
  return target && target.periodEnd < today ? target : undefined;
}

/** The period the forecast calls: the live target's, else the calendar quarter that contains `today`. */
export function periodOf(target: RevenueTarget | undefined, today: ISODate): Period {
  const live = liveTarget(target, today);
  const q = quarterOf(today);
  const start = live?.periodStart ?? q.start;
  const end = live?.periodEnd ?? q.end;
  const total = Math.max(1, daysBetween(start, end) + 1);
  const daysLeft = today > end ? 0 : Math.max(0, daysBetween(today < start ? start : today, end) + 1);
  return {
    start,
    end,
    label: live?.label || q.label,
    daysLeft,
    weeksLeft: Math.ceil(daysLeft / 7),
    elapsed: Math.min(1, Math.max(0, (total - daysLeft) / total)),
  };
}

/** Whole calendar months from `start` (a 1st) to `end` (a month's last day), or null when the period isn't month-aligned. */
function wholeMonths(start: ISODate, end: ISODate): number | null {
  if (start.slice(8, 10) !== "01" || addDays(end, 1).slice(8, 10) !== "01") return null;
  const [sy, sm] = start.split("-").map(Number);
  const [ey, em] = end.split("-").map(Number);
  const n = (ey - sy) * 12 + (em - sm) + 1;
  return n > 0 ? n : null;
}

/** The 1st of the month `n` months after `first` (itself a 1st). */
function monthsAfter(first: ISODate, n: number): ISODate {
  const [y, m] = first.split("-").map(Number);
  const k = m - 1 + n;
  return `${y + Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, "0")}-01`;
}

/**
 * The period right after this one (next quarter's coverage is this quarter's early warning). Calendar boundaries,
 * not day counts: after a quarter comes the next calendar quarter (Q4 → Jan 1–Mar 31, never Apr 2), after any
 * whole-month period the same number of months. Only a period that doesn't start and end on month edges repeats
 * its length in days.
 */
export function nextPeriod(p: { start: ISODate; end: ISODate }): { start: ISODate; end: ISODate } {
  const start = addDays(p.end, 1);
  const months = wholeMonths(p.start, p.end);
  if (months) return { start, end: addDays(monthsAfter(start, months), -1) };
  return { start, end: addDays(start, daysBetween(p.start, p.end)) };
}

/* ─────────────────────────────── Amounts ─────────────────────────────── */

export interface Amount {
  usd: number;
  /** "deal": set on the deal; "quote": the last price quoted; "average": the typical deal, until one is known. */
  source: "deal" | "quote" | "average";
}

export function dealAmount(deal: Deal, avgDeal: Observed): Amount {
  if (deal.amountUsd && deal.amountUsd > 0) return { usd: deal.amountUsd, source: "deal" };
  const quote = deal.priceQuotes?.at(-1)?.amountUsd;
  if (quote && quote > 0) return { usd: quote, source: "quote" };
  return { usd: Math.round(avgDeal.value), source: "average" };
}

/* ─────────────────────────────── The workspace's own rates ─────────────────────────────── */

export interface RevenueStats {
  /** Won ÷ closed, over deals that reached Qualified. */
  winRate: Observed;
  /** Median annual value of won deals. */
  avgDealUsd: Observed;
  /** Median days from the first conversation to signature. */
  cycleDays: Observed;
  /** First conversations that became qualified opportunities. */
  meetingToQualified: Observed;
  /** Median days deals spent in each stage before leaving it. */
  stageDays: Record<OpenStage, Observed>;
  /** Share of closed deals that reached each stage and ended won. */
  stageWin: Record<OpenStage, Observed>;
  won: number;
  lost: number;
}

/** A typical annual deal before any closes: the target's own assumption, then quotes, then the price band. */
function avgDealPrior(ws: Workspace): number {
  const set = ws.revenue?.target?.avgDealUsd;
  if (set && set > 0) return set;
  const quotes = Object.values(ws.deals).flatMap((d) => (d.priceQuotes ?? []).map((q) => q.amountUsd)).filter((n) => n > 0);
  const m = median(quotes);
  if (m) return m;
  const band = ws.foundation?.icp?.employeeBand;
  return band === "lt50" ? 15_000 : band === "gt300" ? 100_000 : 35_000;
}

/* ─────────────────────────────── Deals that came in from a file ─────────────────────────────── */

export type ImportUnknown = NonNullable<NonNullable<Deal["imported"]>["unknown"]>[number];

/** The file had no such date (or contacts, or source): the import time stands in, and code doesn't read it as history. */
export function importUnknown(deal: Deal, what: ImportUnknown): boolean {
  return !!deal.imported?.unknown?.includes(what);
}

/** Arrived already closed. It never went through this workspace's funnel, so it counts toward sizes and cycles, never rates. */
export function importedClosed(deal: Deal): boolean {
  return deal.imported?.stage === "won" || deal.imported?.stage === "lost";
}

/** A stage entry the file wrote rather than one recorded here: on or before the moment of import. */
function fromFile(deal: Deal, entry: { at: string }): boolean {
  return !!deal.imported && Date.parse(entry.at) <= Date.parse(deal.imported.at);
}

/**
 * Days spent in a stage before leaving it, or null when the history can't say. A file only knows a deal's current
 * stage (the ones before it are missing), so a span between two entries it wrote isn't a stage duration, and a
 * span that starts at an entry dated by the import time starts too late.
 */
function stageSpan(deal: Deal, i: number): number | null {
  const from = deal.stageHistory[i];
  const to = deal.stageHistory[i + 1];
  if (!to) return null;
  if (fromFile(deal, from) && (fromFile(deal, to) || (from.at === deal.imported!.at && importUnknown(deal, i === 0 ? "created" : "stage_date")))) return null;
  return Math.max(0, daysBetween(localDate(from.at), localDate(to.at)));
}

export function revenueStats(ws: Workspace, today: ISODate): RevenueStats {
  const deals = Object.values(ws.deals);
  const won = deals.filter((d) => d.stage === "won");
  const lost = deals.filter((d) => d.stage === "lost");
  const closed = [...won, ...lost];
  // Rates come from deals seen through the funnel here. A file of open deals plus this quarter's wins, and none of
  // the losses, would make every rate look better than it is.
  const rated = closed.filter((d) => !importedClosed(d));
  const target = ws.revenue?.target;

  const closedQualified = rated.filter((d) => FUNNEL.slice(1).some((s) => reached(d, s)) || d.stage === "won");
  const wonQualified = closedQualified.filter((d) => d.stage === "won").length;
  const winRate = blended(target?.winRate ?? ws.goal.winRate ?? PRIORS.winRate, wonQualified, closedQualified.length);

  const wonAmounts = won.map((d) => d.amountUsd ?? d.priceQuotes?.at(-1)?.amountUsd ?? 0).filter((n) => n > 0);
  const avgDealUsd = observed(avgDealPrior(ws), median(wonAmounts), wonAmounts.length, MIN_WON);

  const cycles = won.filter((d) => !importUnknown(d, "created")).map((d) => daysBetween(startedOn(d), closedOn(d) ?? today)).filter((n) => n >= 0);
  const cycleDays = observed(target?.cycleDays ?? PRIORS.cycleDays, median(cycles), cycles.length, MIN_WON);

  // A first conversation has had its chance to qualify once it qualified or closed. A deal that arrived already past
  // Talking is a survivor (the file has no first meetings that went nowhere), so it doesn't count either way.
  const decided = deals.filter((d) => d.stage !== "talking" && d.stage !== "nurture" && (!d.imported || d.imported.stage === "talking"));
  const qualifiedOf = decided.filter((d) => FUNNEL.slice(1).some((s) => reached(d, s)) || d.stage === "won").length;
  const meetingToQualified = blended(ws.goal.discoveryToQualified ?? PRIORS.meetingToQualified, qualifiedOf, decided.length);

  const stageDays = {} as Record<OpenStage, Observed>;
  const stageWin = {} as Record<OpenStage, Observed>;
  for (const stage of FUNNEL) {
    const spans: number[] = [];
    for (const d of deals) {
      const i = d.stageHistory.findIndex((h) => h.stage === stage);
      if (i < 0 || i === d.stageHistory.length - 1) continue; // never in it, or still in it
      const span = stageSpan(d, i);
      if (span !== null) spans.push(span);
    }
    stageDays[stage] = observed(PRIORS.stageDays[stage], median(spans), spans.length, MIN_STAGE_EXITS);
    const through = rated.filter((d) => reached(d, stage) || (stage === "talking" && d.stageHistory.length > 0));
    const throughWon = through.filter((d) => d.stage === "won").length;
    stageWin[stage] = blended(PRIORS.stageWin[stage], throughWon, through.length);
  }

  return { winRate, avgDealUsd, cycleDays, meetingToQualified, stageDays, stageWin, won: won.length, lost: lost.length };
}

export function openStage(stage: Stage): stage is OpenStage {
  return (FUNNEL as Stage[]).includes(stage);
}
