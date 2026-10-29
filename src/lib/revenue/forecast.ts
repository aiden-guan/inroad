import { addDays, daysBetween, weekOf } from "@/lib/domain/ids";
import { STAGE_LABELS, type Deal, type ForecastCategory, type ForecastSnapshot, type ISODate, type Workspace } from "@/lib/domain/types";
import { conversationsBetween } from "@/lib/moves/scoreboard";
import { first } from "@/lib/moves/util";
import { dealRisks, healthBand, healthOf, type Risk } from "./risk";
import {
  closedOn,
  daysInStage,
  dealAmount,
  nextPeriod,
  openStage,
  PRIORS,
  periodOf,
  revenueStats,
  startedOn,
  type Amount,
  type Observed,
  type OpenStage,
  type Period,
  type RevenueStats,
} from "./stats";

/**
 * The forecast call and the plan behind the number, in code. Each open deal gets a category from
 * evidence on file (stage, economic buyer, a dated buyer-agreed next step, close date, risk); the
 * owner of the number can call it differently and the override is shown next to the code's call.
 * The plan works backward from what's left to close to the meetings it takes, and says when the
 * calendar makes new pipeline too late for this period.
 */

export const CATEGORY_LABELS: Record<ForecastCategory, string> = {
  commit: "Commit",
  best_case: "Best case",
  pipeline: "Pipeline",
  omitted: "Not this period",
};
export const CATEGORY_ORDER: ForecastCategory[] = ["commit", "best_case", "pipeline", "omitted"];

export interface DealCall {
  deal: Deal;
  amount: Amount;
  /** The deal's close date, or an estimate from where it is in a typical cycle. */
  closeDate: ISODate;
  closeEstimated: boolean;
  inPeriod: boolean;
  /** What code calls it. */
  codeCategory: ForecastCategory;
  /** What counts: the owner's call when there is one, else code's. */
  category: ForecastCategory;
  called: boolean;
  /** Why code put it where it did, ≤ 16 words. */
  why: string;
  /** The deal's odds from its stage (observed once enough deals closed). */
  probability: number;
  weightedUsd: number;
  risks: Risk[];
  health: number;
  band: "healthy" | "watch" | "at_risk";
}

/** When an undated deal would close if it moves at the usual pace from where it is now. */
function estimatedClose(deal: Deal, stats: RevenueStats, today: ISODate): ISODate {
  const stage = deal.stage as OpenStage;
  const order: OpenStage[] = ["talking", "qualified", "pilot", "proposal"];
  // Remaining typical days: what's left of this stage plus every later stage. Pilots are optional, so skip them unless here.
  let remaining = Math.max(3, stats.stageDays[stage].value - daysInStage(deal, today));
  for (const s of order.slice(order.indexOf(stage) + 1)) if (s !== "pilot") remaining += stats.stageDays[s].value;
  const byCycle = addDays(startedOn(deal), Math.round(stats.cycleDays.value));
  const byStage = addDays(today, Math.round(remaining));
  return byCycle > byStage ? byCycle : byStage;
}

/** The evidence a commit needs (docs/research/12 §C1). Each unmet one is named in the call's why. */
export function commitGaps(deal: Deal, period: Period, today: ISODate): string[] {
  const gaps: string[] = [];
  const late = deal.stage === "proposal" || (deal.stage === "pilot" && !!deal.pilot?.paid && !!deal.pilot.criteria);
  if (!late) gaps.push("not at proposal yet");
  if (!(deal.card?.economicBuyer?.engaged || (deal.qualification?.economicBuyer ?? 0) === 2)) gaps.push("the economic buyer isn't engaged");
  if (!deal.card?.decisionProcess?.value) gaps.push("the paper process isn't known");
  const step = deal.nextStep;
  if (!step?.date) gaps.push("no dated next step");
  else if (step.date < today) gaps.push("the next step is overdue");
  else if (!step.buyerAgreed) gaps.push("the next step isn't buyer-agreed");
  else if (step.date > addDays(today, 14)) gaps.push("the next step is more than two weeks out");
  if (!deal.closeDate || deal.closeDate < today || deal.closeDate > period.end) gaps.push("no current close date in the period");
  const pushed = (deal.closeDateHistory ?? []).some((h, i, all) => i > 0 && h.date > all[i - 1].date && h.at.slice(0, 10) >= addDays(today, -30));
  if (pushed) gaps.push("the close date moved in the last 30 days");
  return gaps;
}

function codeCall(deal: Deal, inPeriod: boolean, risks: Risk[], period: Period, today: ISODate): { category: ForecastCategory; why: string } {
  if (!inPeriod) return { category: "omitted", why: "Closes after this period." };
  if (deal.stage === "talking") return { category: "pipeline", why: "Early conversation; not qualified yet." };
  const gaps = commitGaps(deal, period, today);
  const high = risks.find((r) => r.severity === "high" && !["no_next_step", "next_step_overdue", "close_passed", "close_slipped", "economic_buyer_not_engaged", "no_economic_buyer"].includes(r.code));
  if (!gaps.length && !high) return { category: "commit", why: "Every commit test passes: economic buyer engaged, paper process known, a buyer-agreed step within two weeks, a firm close date." };
  const late = deal.stage === "proposal" || deal.stage === "pilot";
  const champion = deal.card?.champion?.championStatus;
  const dated = !!deal.closeDate && deal.closeDate >= today && deal.closeDate <= period.end;
  const reasons = [...gaps.filter((g) => g !== "not at proposal yet"), ...(high ? [high.label.toLowerCase()] : [])];
  // Late-stage deals stay best case while they're being worked; a qualified deal earns it with a date and a champion.
  if (late || (dated && (champion === "untested" || champion === "tested") && gaps.length <= 2)) {
    return { category: "best_case", why: `Not commit: ${reasons.slice(0, 2).join(" and ") || "it isn't at the paper stage yet"}.` };
  }
  return { category: "pipeline", why: `Qualified, but ${reasons.slice(0, 2).join(" and ") || "not yet at the paper stage"}.` };
}

export function callDeal(ws: Workspace, deal: Deal, stats: RevenueStats, period: Period, today: ISODate): DealCall {
  const amount = dealAmount(deal, stats.avgDealUsd);
  const closeDate = deal.closeDate ?? estimatedClose(deal, stats, today);
  // A passed close date on an open deal is late, not gone: it counts in the period that's running now.
  const overdue = !!deal.closeDate && deal.closeDate < today;
  const inPeriod = overdue ? today >= period.start && today <= period.end : closeDate >= period.start && closeDate <= period.end;
  const risks = dealRisks(ws, deal, stats, today);
  const code = codeCall(deal, inPeriod, risks, period, today);
  const called = !!deal.forecastCall;
  const category = deal.forecastCall?.category ?? code.category;
  const probability = openStage(deal.stage) ? stats.stageWin[deal.stage].value : 0;
  const health = healthOf(risks);
  return {
    deal,
    amount,
    closeDate,
    closeEstimated: !deal.closeDate,
    inPeriod,
    codeCategory: code.category,
    category,
    called,
    why: code.why,
    probability,
    weightedUsd: Math.round(amount.usd * probability),
    risks,
    health,
    band: healthBand(health, risks),
  };
}

/* ─────────────────────────────── The forecast ─────────────────────────────── */

export interface Forecast {
  today: ISODate;
  period: Period;
  hasTarget: boolean;
  target: number;
  stats: RevenueStats;
  closedWon: { usd: number; deals: Deal[] };
  /** Running totals: commit includes closed won; best case includes commit. */
  commit: number;
  bestCase: number;
  /** All open pipeline closing this period, plus closed won. */
  pipeline: number;
  /** Closed won plus each open deal in the period × its stage odds. */
  weighted: number;
  /**
   * The call: closed won plus each in-period deal × its category's odds (commit .9, best case .5, pipeline .15).
   * Floor is commit, ceiling is best case.
   */
  call: number;
  /** Chance that closed won plus the deals that close reach the target, deals treated as independent. Null with no target. */
  hitChance: number | null;
  /** Open deals with a current close date, an amount, a dated next step and two contacts: how far to trust the rest. */
  dataTrust: { score: number; complete: number; open: number };
  /** Pipeline created over the last four weeks, against the weekly pace next period needs. */
  creation: { perWeek: number; needPerWeek: number | null; deals: number };
  /** What's left to close: target − closed won. */
  remaining: number;
  /** Open pipeline in the period ÷ what's left to close. */
  coverage: number | null;
  coverageNeeded: number;
  calls: DealCall[];
  next: { start: ISODate; end: ISODate; pipeline: number; coverage: number | null };
}

const sum = (calls: DealCall[]) => calls.reduce((n, c) => n + c.amount.usd, 0);

/** How often deals in each category close in the period, until two quarters of snapshots can calibrate them. */
export const CATEGORY_ODDS: Record<ForecastCategory, number> = { commit: 0.9, best_case: 0.5, pipeline: 0.15, omitted: 0 };

/**
 * The exact chance that independent deals add up to at least `need`, by dynamic programming over $1K steps.
 * Independence is an assumption (one bad quarter hits several deals at once), and the UI says so.
 */
export function chanceToReach(need: number, deals: { usd: number; p: number }[]): number {
  if (need <= 0) return 1;
  const unit = 1000;
  const goal = Math.ceil(need / unit);
  // dist[k] = chance of exactly k steps won so far; everything at or past the goal pools in the last bucket.
  let dist = new Array<number>(goal + 1).fill(0);
  dist[0] = 1;
  for (const d of deals) {
    if (d.p <= 0 || d.usd <= 0) continue;
    const step = Math.max(1, Math.round(d.usd / unit));
    const next = new Array<number>(goal + 1).fill(0);
    for (let k = 0; k <= goal; k++) {
      if (!dist[k]) continue;
      next[k] += dist[k] * (1 - d.p);
      next[Math.min(goal, k + step)] += dist[k] * d.p;
    }
    dist = next;
  }
  return dist[goal];
}

export function computeForecast(ws: Workspace, today: ISODate): Forecast {
  const target = ws.revenue?.target;
  const period = periodOf(target, today);
  const stats = revenueStats(ws, today);
  const deals = Object.values(ws.deals);
  const calls = deals.filter((d) => openStage(d.stage)).map((d) => callDeal(ws, d, stats, period, today));

  const wonDeals = deals.filter((d) => {
    const on = closedOn(d);
    return d.stage === "won" && !!on && on >= period.start && on <= period.end;
  });
  const closedWonUsd = wonDeals.reduce((n, d) => n + dealAmount(d, stats.avgDealUsd).usd, 0);

  const live = calls.filter((c) => c.category !== "omitted");
  const commit = closedWonUsd + sum(live.filter((c) => c.category === "commit"));
  const bestCase = commit + sum(live.filter((c) => c.category === "best_case"));
  const openInPeriod = sum(live);
  const amount = target?.amountUsd ?? 0;
  const remaining = Math.max(0, amount - closedWonUsd);
  // 3× until enough quarters of snapshots exist to use a measured conversion (docs/research/12 §B6).
  const coverageNeeded = target?.coverageTarget ?? PRIORS.coverage;

  const np = nextPeriod(period);
  const nextOpen = calls.filter((c) => c.closeDate >= np.start && c.closeDate <= np.end);
  const nextPipeline = sum(nextOpen);

  const call = closedWonUsd + live.reduce((n, c) => n + c.amount.usd * CATEGORY_ODDS[c.category], 0);
  const complete = calls.filter((c) => !!c.deal.closeDate && c.deal.closeDate >= today && c.amount.source !== "average" && !!c.deal.nextStep?.date && c.deal.nextStep.date >= today && c.deal.contacts.length >= 2).length;
  const since = addDays(today, -27);
  const created = deals.filter((d) => startedOn(d) >= since);
  const createdUsd = created.reduce((n, d) => n + dealAmount(d, stats.avgDealUsd).usd, 0);
  const weeksInPeriod = Math.max(1, Math.round((daysBetween(period.start, period.end) + 1) / 7));

  return {
    today,
    period,
    hasTarget: amount > 0,
    target: amount,
    stats,
    closedWon: { usd: closedWonUsd, deals: wonDeals },
    commit,
    bestCase,
    pipeline: closedWonUsd + openInPeriod,
    weighted: closedWonUsd + live.reduce((n, c) => n + c.weightedUsd, 0),
    call: Math.round(call),
    hitChance: amount > 0 ? chanceToReach(remaining, live.map((c) => ({ usd: c.amount.usd, p: CATEGORY_ODDS[c.category] }))) : null,
    dataTrust: { score: calls.length ? Math.round((complete / calls.length) * 100) : 100, complete, open: calls.length },
    // Next period's target (same size) needs this much new pipeline a week at the current win rate.
    creation: { perWeek: Math.round(createdUsd / 4), needPerWeek: amount > 0 ? Math.round(amount / Math.max(0.05, stats.winRate.value) / weeksInPeriod) : null, deals: created.length },
    remaining,
    coverage: amount > 0 ? (remaining > 0 ? openInPeriod / remaining : null) : null,
    coverageNeeded,
    calls: calls.sort((a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) || b.amount.usd - a.amount.usd),
    next: { ...np, pipeline: nextPipeline, coverage: amount > 0 ? nextPipeline / amount : null },
  };
}

/* ─────────────────────────────── The plan behind the number ─────────────────────────────── */

export type PlanVerdict = "no_target" | "hit" | "on_track" | "behind" | "too_late";

export interface RevenuePlan {
  verdict: PlanVerdict;
  /** One sentence, the way a Head of GTM would say it in the forecast call. */
  headline: string;
  remaining: number;
  /** What the open pipeline should bring in at its stage odds. */
  expected: number;
  /** What new pipeline has to make up. */
  gap: number;
  avgDeal: Observed;
  winRate: Observed;
  meetingToQualified: Observed;
  cycleDays: Observed;
  dealsNeeded: number;
  qualifiedNeeded: number;
  meetingsNeeded: number;
  /** New first meetings after this date won't close inside the period at the usual cycle. */
  cutoff: ISODate;
  weeksToCutoff: number;
  meetingsPerWeekNeeded: number | null;
  /** First meetings a week over the last four weeks. */
  meetingsPerWeekRecent: number;
  /** Ways to close the gap, strongest first, each a number not an exhortation. */
  levers: string[];
  /** The same new deals from one channel alone, at that channel's starting conversion rates. */
  byChannel: ChannelRow[];
}

export interface ChannelRow {
  key: "warm" | "inbound" | "outbound" | "events";
  label: string;
  /** "intro asks", "cold contacts" */
  unit: string;
  topOfFunnel: number;
  meetings: number;
  qualified: number;
  /** Top of funnel per week until the cutoff; null once it has passed. */
  perWeek: number | null;
}

/**
 * Starting conversion rates by channel (top of funnel → first meeting → qualified → won), from
 * docs/research/12 §1.3. Outbound's first step uses the workspace's own cold meeting rate.
 */
export const CHANNEL_PRIORS: { key: ChannelRow["key"]; label: string; unit: string; tof: number; qual: number; win: number }[] = [
  { key: "warm", label: "Warm intros", unit: "intro asks", tof: 0.5, qual: 0.6, win: 0.35 },
  { key: "inbound", label: "Inbound", unit: "inbound leads", tof: 0.6, qual: 0.45, win: 0.25 },
  { key: "events", label: "Dinners and events", unit: "event conversations", tof: 0.15, qual: 0.35, win: 0.2 },
  { key: "outbound", label: "Cold outbound", unit: "cold contacts", tof: 0.025, qual: 0.3, win: 0.15 },
];

function channelRows(ws: Workspace, deals: number, weeks: number): ChannelRow[] {
  if (deals <= 0) return [];
  return CHANNEL_PRIORS.map((c) => {
    const tof = c.key === "outbound" ? ws.goal.meetingRate || c.tof : c.tof;
    const qualified = Math.ceil(deals / c.win);
    const meetings = Math.ceil(qualified / c.qual);
    const top = Math.ceil(meetings / tof);
    return { key: c.key, label: c.label, unit: c.unit, topOfFunnel: top, meetings, qualified, perWeek: weeks > 0 ? Math.ceil(top / weeks) : null };
  });
}

export function computePlan(ws: Workspace, f: Forecast, now: Date): RevenuePlan {
  const { stats, period } = f;
  const recent = conversationsBetween(ws, addDays(f.today, -27), now) / 4;
  const base = {
    remaining: f.remaining,
    avgDeal: stats.avgDealUsd,
    winRate: stats.winRate,
    meetingToQualified: stats.meetingToQualified,
    cycleDays: stats.cycleDays,
    meetingsPerWeekRecent: Math.round(recent * 10) / 10,
  };
  const cutoff = addDays(period.end, -Math.round(stats.cycleDays.value));
  const weeksToCutoff = Math.max(0, Math.ceil(daysBetween(f.today, cutoff) / 7));
  const expected = Math.round(f.calls.filter((c) => c.category !== "omitted").reduce((n, c) => n + c.weightedUsd, 0));

  if (!f.hasTarget) {
    return {
      ...base,
      verdict: "no_target",
      headline: "Set a revenue target and I'll work backward to the meetings it takes.",
      expected,
      gap: 0,
      dealsNeeded: 0,
      qualifiedNeeded: 0,
      meetingsNeeded: 0,
      cutoff,
      weeksToCutoff,
      meetingsPerWeekNeeded: null,
      levers: [],
      byChannel: [],
    };
  }
  if (f.remaining <= 0) {
    return { ...base, verdict: "hit", headline: `${period.label} is closed: ${money(f.closedWon.usd)} won against ${money(f.target)}.`, expected, gap: 0, dealsNeeded: 0, qualifiedNeeded: 0, meetingsNeeded: 0, cutoff, weeksToCutoff, meetingsPerWeekNeeded: null, levers: [], byChannel: [] };
  }

  const gap = Math.max(0, f.remaining - expected);
  const avg = Math.max(1, stats.avgDealUsd.value);
  const dealsNeeded = gap > 0 ? Math.ceil(gap / avg) : 0;
  const qualifiedNeeded = Math.ceil(dealsNeeded / Math.max(0.05, stats.winRate.value));
  const meetingsNeeded = Math.ceil(qualifiedNeeded / Math.max(0.05, stats.meetingToQualified.value));
  const meetingsPerWeekNeeded = gap <= 0 ? 0 : weeksToCutoff > 0 ? Math.round((meetingsNeeded / weeksToCutoff) * 10) / 10 : null;

  const levers: string[] = [];
  const bestCaseOpen = f.calls.filter((c) => c.category === "best_case" && c.inPeriod);
  if (bestCaseOpen.length) {
    const top = [...bestCaseOpen].sort((a, b) => b.amount.usd - a.amount.usd)[0];
    const blocker = top.risks[0];
    levers.push(`Move ${top.deal.name} (${money(top.amount.usd)}) to commit${blocker ? `: ${blocker.fix.label.toLowerCase()}` : ""}.`);
  }
  if (dealsNeeded > 0 && stats.avgDealUsd.value > 0) {
    const bigger = Math.ceil(gap / Math.max(1, dealsNeeded - 1) / 1000) * 1000;
    if (dealsNeeded > 1) levers.push(`At ${money(bigger)} a deal instead of ${money(avg)}, you'd need ${dealsNeeded - 1} new ${dealsNeeded - 1 === 1 ? "deal" : "deals"}, not ${dealsNeeded}.`);
  }
  if (stats.winRate.value < 0.5 && qualifiedNeeded > 1) {
    const better = Math.min(0.9, stats.winRate.value + 0.1);
    const fewer = Math.ceil(dealsNeeded / better);
    if (fewer < qualifiedNeeded) levers.push(`Win ${Math.round(better * 100)}% instead of ${Math.round(stats.winRate.value * 100)}% and ${fewer} qualified deals do it, not ${qualifiedNeeded}.`);
  }

  let verdict: PlanVerdict;
  let headline: string;
  if (gap <= 0) {
    verdict = "on_track";
    headline = `On track: open deals at their usual odds cover the ${money(f.remaining)} left. Protect them.`;
  } else if (weeksToCutoff <= 0) {
    verdict = "too_late";
    headline = `New pipeline won't close by ${shortDay(period.end)} at a ${Math.round(stats.cycleDays.value)}-day cycle. The ${money(gap)} gap has to come from deals already open.`;
  } else if (meetingsPerWeekNeeded !== null && base.meetingsPerWeekRecent >= meetingsPerWeekNeeded) {
    verdict = "on_track";
    headline = `On pace: ${meetingsPerWeekNeeded} first meetings a week until ${shortDay(cutoff)} closes the ${money(gap)} gap, and you've averaged ${base.meetingsPerWeekRecent}.`;
  } else if (meetingsPerWeekNeeded !== null && meetingsPerWeekNeeded > Math.max(3, base.meetingsPerWeekRecent * 3)) {
    // Out of reach for new pipeline: say so, and point at the deals that can still close.
    const open = f.calls.filter((c) => c.inPeriod).length;
    verdict = "behind";
    headline = `${money(gap)} short after expected wins, and new pipeline can't make it up: ${meetingsNeeded} first meetings by ${shortDay(cutoff)} against ${base.meetingsPerWeekRecent} a week lately. ${period.label} is won or lost in the ${open} open ${open === 1 ? "deal" : "deals"}.`;
  } else {
    verdict = "behind";
    headline = `${money(gap)} short after expected wins. That's ${dealsNeeded} more ${dealsNeeded === 1 ? "deal" : "deals"}, ${meetingsNeeded} first meetings by ${shortDay(cutoff)}: ${meetingsPerWeekNeeded} a week against ${base.meetingsPerWeekRecent} lately.`;
  }

  return { ...base, verdict, headline, expected, gap, dealsNeeded, qualifiedNeeded, meetingsNeeded, cutoff, weeksToCutoff, meetingsPerWeekNeeded, levers, byChannel: channelRows(ws, dealsNeeded, weeksToCutoff) };
}

/* ─────────────────────────────── Week over week ─────────────────────────────── */

export function takeSnapshot(f: Forecast, takenAt: string): ForecastSnapshot {
  return {
    weekOf: weekOf(f.today),
    takenAt,
    periodEnd: f.period.end,
    target: f.target,
    closedWon: f.closedWon.usd,
    commit: f.commit,
    bestCase: f.bestCase,
    pipeline: f.pipeline,
    call: f.call,
    deals: f.calls.map((c) => ({ id: c.deal.id, name: c.deal.name, stage: c.deal.stage, category: c.category, amountUsd: c.amount.usd, closeDate: c.closeDate })),
  };
}

/** The snapshot to compare against: the latest one from before this week. */
export function baseline(ws: Workspace, today: ISODate): ForecastSnapshot | undefined {
  const week = weekOf(today);
  return [...(ws.revenue?.snapshots ?? [])].filter((s) => s.weekOf < week).sort((a, b) => b.weekOf.localeCompare(a.weekOf))[0];
}

export interface ForecastChange {
  kind: "won" | "lost" | "new" | "pushed" | "pulled" | "up" | "down" | "amount" | "dropped";
  dealId: string;
  name: string;
  text: string;
  /** Change to commit (won, up, down) or to pipeline (the rest), in dollars. */
  deltaUsd: number;
}

const RANK: Record<ForecastCategory, number> = { commit: 3, best_case: 2, pipeline: 1, omitted: 0 };

export function forecastChanges(ws: Workspace, prev: ForecastSnapshot | undefined, f: Forecast): ForecastChange[] {
  if (!prev) return [];
  const out: ForecastChange[] = [];
  const now = new Map(f.calls.map((c) => [c.deal.id, c]));
  for (const was of prev.deals) {
    const c = now.get(was.id);
    const deal = ws.deals[was.id];
    if (!c) {
      // A commit that closed doesn't change commit; anything else that closed adds to it.
      if (deal?.stage === "won") out.push({ kind: "won", dealId: was.id, name: was.name, text: `${was.name} closed won (${money(deal.amountUsd ?? was.amountUsd)}).`, deltaUsd: was.category === "commit" ? 0 : deal.amountUsd ?? was.amountUsd });
      else if (deal?.stage === "lost") out.push({ kind: "lost", dealId: was.id, name: was.name, text: `${was.name} was lost${deal.lossReason ? ` (${deal.lossReason.replace(/_/g, " ")})` : ""}.`, deltaUsd: -was.amountUsd });
      else if (deal) out.push({ kind: "dropped", dealId: was.id, name: was.name, text: `${was.name} moved to nurture.`, deltaUsd: -was.amountUsd });
      continue;
    }
    if (was.closeDate && c.closeDate > was.closeDate && was.category !== "omitted") {
      const out_ = c.category === "omitted";
      out.push({ kind: "pushed", dealId: was.id, name: was.name, text: `${was.name} pushed from ${shortDay(was.closeDate)} to ${shortDay(c.closeDate)}${out_ ? ", out of this period" : ""}.`, deltaUsd: out_ ? -was.amountUsd : 0 });
    } else if (was.closeDate && c.closeDate < was.closeDate && was.category === "omitted" && c.category !== "omitted") {
      out.push({ kind: "pulled", dealId: was.id, name: was.name, text: `${was.name} pulled into this period (${shortDay(c.closeDate)}).`, deltaUsd: c.amount.usd });
    }
    if (RANK[c.category] !== RANK[was.category] && !(was.category === "omitted" || c.category === "omitted")) {
      const up = RANK[c.category] > RANK[was.category];
      out.push({
        kind: up ? "up" : "down",
        dealId: was.id,
        name: was.name,
        text: `${was.name} moved ${up ? "up" : "down"} from ${CATEGORY_LABELS[was.category]} to ${CATEGORY_LABELS[c.category]}${c.called ? " (your call)" : ""}.`,
        deltaUsd: c.category === "commit" ? c.amount.usd : was.category === "commit" ? -was.amountUsd : 0,
      });
    }
    if (c.amount.usd !== was.amountUsd && c.amount.source !== "average") {
      out.push({ kind: "amount", dealId: was.id, name: was.name, text: `${was.name} changed from ${money(was.amountUsd)} to ${money(c.amount.usd)}.`, deltaUsd: c.amount.usd - was.amountUsd });
    }
  }
  const before = new Set(prev.deals.map((d) => d.id));
  for (const c of f.calls) {
    if (before.has(c.deal.id) || c.category === "omitted") continue;
    out.push({ kind: "new", dealId: c.deal.id, name: c.deal.name, text: `New this week: ${c.deal.name} at ${STAGE_LABELS[c.deal.stage]} (${money(c.amount.usd)}${c.amount.source === "average" ? " est." : ""}).`, deltaUsd: c.amount.usd });
  }
  return out;
}

/* ─────────────────────────────── Small formatting (shared with the UI) ─────────────────────────────── */

export function money(n: number | undefined): string {
  if (n === undefined || Number.isNaN(n)) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(abs % 1_000_000 ? 1 : 0)}M`;
  if (abs >= 1000) return `${sign}$${Math.round(abs / 1000)}K`;
  return `${sign}$${Math.round(abs)}`;
}

export function shortDay(date: ISODate): string {
  const d = new Date(`${date}T12:00:00`);
  return Number.isNaN(d.getTime()) ? date : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function pctLabel(o: Observed): string {
  return `${Math.round(o.value * 100)}%`;
}

/** Says where a number comes from: the workspace's own, a blend toward the starting default, or the default. */
export function observedNote(o: Observed, unit: string): string {
  if (o.source === "observed") return `Your own, from ${o.n} ${unit}.`;
  const p = (v: number) => (v < 1 ? `${Math.round(v * 100)}%` : `${Math.round(v)}`);
  if (o.source === "blended")
    return `Blended: your own ${p(o.raw ?? 0)} from ${o.n} ${unit}, shrunk toward the ${p(o.prior)} starting default (counted as 10). Yours alone from ${o.need}.`;
  return `A starting default (${p(o.prior)}) until you have ${o.need} ${unit}${o.n ? `; you have ${o.n}${o.raw !== undefined ? ` at ${p(o.raw)}` : ""}` : ""}.`;
}

/** The deal's champion's first name, for copy. */
export function championOf(ws: Workspace, deal: Deal): string | undefined {
  const named = deal.card?.champion?.name;
  if (named) return first(named);
  const c = deal.contacts.find((x) => x.role === "champion") ?? deal.contacts[0];
  return c ? first(ws.people[c.personId]?.name) : undefined;
}

