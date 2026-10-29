import type { Deal, LossReason, PersonaRole, SignalType, Workspace } from "@/lib/domain/types";
import { isColdFirstTouch, sampleLabel } from "@/lib/moves/scoreboard";
import { localDate } from "@/lib/moves/util";
import { closedOn, dealAmount, median, openStage, reached, startedOn, type RevenueStats } from "./stats";
import { daysBetween } from "@/lib/domain/ids";

/**
 * What's working, counted in code: where deals come from and how they convert, which why-now signals and
 * personas get replies and meetings, and why deals are lost. Every rate carries its n and a sample label;
 * below 20 it's an anecdote and the UI says so. No model touches these numbers.
 */

export const SOURCE_LABELS: Record<Deal["source"], string> = {
  warm_intro: "Warm intros",
  signal_cold: "Signal-based outbound",
  investor_intro: "Investor intros",
  community: "Communities",
  content: "Content",
  dinner: "Dinners",
  event: "Events and roundtables",
  inbound: "Inbound",
  network: "Your network",
  referral: "Referrals",
};

export interface SourceRow {
  key: Deal["source"];
  label: string;
  /** Deals that started from this source. */
  deals: number;
  qualified: number;
  won: number;
  lost: number;
  open: number;
  wonUsd: number;
  openUsd: number;
  /** Won ÷ closed, with its n (closed deals). */
  winRate: { value: number; n: number } | null;
  /** Median days from the first conversation to signature, for won deals. */
  cycleDays: number | null;
}

export function bySource(ws: Workspace, stats: RevenueStats): SourceRow[] {
  const groups = new Map<Deal["source"], Deal[]>();
  for (const d of Object.values(ws.deals)) groups.set(d.source, [...(groups.get(d.source) ?? []), d]);
  return [...groups.entries()]
    .map(([key, deals]) => {
      const won = deals.filter((d) => d.stage === "won");
      const lost = deals.filter((d) => d.stage === "lost");
      const open = deals.filter((d) => openStage(d.stage));
      const closed = won.length + lost.length;
      const cycles = won.map((d) => daysBetween(startedOn(d), closedOn(d) ?? startedOn(d)));
      return {
        key,
        label: SOURCE_LABELS[key] ?? key,
        deals: deals.length,
        qualified: deals.filter((d) => d.stage === "won" || ["qualified", "pilot", "proposal"].some((s) => reached(d, s as Deal["stage"]))).length,
        won: won.length,
        lost: lost.length,
        open: open.length,
        wonUsd: won.reduce((n, d) => n + dealAmount(d, stats.avgDealUsd).usd, 0),
        openUsd: open.reduce((n, d) => n + dealAmount(d, stats.avgDealUsd).usd, 0),
        winRate: closed ? { value: won.length / closed, n: closed } : null,
        cycleDays: median(cycles),
      };
    })
    .sort((a, b) => b.wonUsd + b.openUsd - (a.wonUsd + a.openUsd) || b.deals - a.deals);
}

export interface TouchRow {
  key: string;
  label: string;
  /** People who got a first cold touch. */
  touched: number;
  replied: number;
  positive: number;
  /** Of those, how many companies are now a deal that started after the touch. */
  meetings: number;
  sample: "anecdote" | "directional" | "reliable";
}

interface FirstTouch {
  personId: string;
  domain?: string;
  at: string;
  signal?: SignalType;
  role?: PersonaRole;
}

function firstTouches(ws: Workspace): FirstTouch[] {
  const byPerson = new Map<string, FirstTouch>();
  for (const a of ws.activities) {
    if (!isColdFirstTouch(ws, a) || !a.personId) continue;
    const prev = byPerson.get(a.personId);
    if (prev && prev.at <= a.at) continue;
    byPerson.set(a.personId, { personId: a.personId, domain: a.accountDomain, at: a.at, signal: a.signalType, role: ws.people[a.personId]?.role });
  }
  // Touches logged without a draft (from a sequencer or by hand) still count when they carry a signal.
  for (const a of ws.activities) {
    if (a.kind !== "touch_sent" || a.outcome === "not_sent" || !a.personId || !a.signalType || a.dealId || byPerson.has(a.personId)) continue;
    byPerson.set(a.personId, { personId: a.personId, domain: a.accountDomain, at: a.at, signal: a.signalType, role: ws.people[a.personId]?.role });
  }
  return [...byPerson.values()];
}

function outcome(ws: Workspace, t: FirstTouch) {
  const replies = ws.activities.filter((a) => a.kind === "reply_received" && a.personId === t.personId && a.at > t.at);
  const deal = t.domain ? Object.values(ws.deals).find((d) => d.accountDomain === t.domain && startedOn(d) >= localDate(t.at)) : undefined;
  return { replied: replies.length > 0, positive: replies.some((r) => r.sentiment === "positive" || r.sentiment === "referral"), meeting: !!deal };
}

function touchRows(ws: Workspace, keyOf: (t: FirstTouch) => string | undefined, labelOf: (key: string) => string): TouchRow[] {
  const rows = new Map<string, TouchRow>();
  for (const t of firstTouches(ws)) {
    const key = keyOf(t) ?? "none";
    const row = rows.get(key) ?? { key, label: labelOf(key), touched: 0, replied: 0, positive: 0, meetings: 0, sample: "anecdote" as const };
    const o = outcome(ws, t);
    row.touched++;
    if (o.replied) row.replied++;
    if (o.positive) row.positive++;
    if (o.meeting) row.meetings++;
    rows.set(key, row);
  }
  return [...rows.values()].map((r) => ({ ...r, sample: sampleLabel(r.touched) })).sort((a, b) => b.meetings - a.meetings || b.positive - a.positive || b.touched - a.touched);
}

export function bySignal(ws: Workspace, labels: Partial<Record<SignalType, string>>): TouchRow[] {
  return touchRows(ws, (t) => t.signal, (k) => (k === "none" ? "No dated signal" : labels[k as SignalType] ?? k.replace(/_/g, " ")));
}

export function byPersona(ws: Workspace, labels: Partial<Record<PersonaRole, string>>): TouchRow[] {
  return touchRows(ws, (t) => t.role, (k) => (k === "none" ? "Role not set" : labels[k as PersonaRole] ?? k.replace(/_/g, " ")));
}

export const LOSS_LABELS: Record<LossReason, string> = {
  no_pain: "No real pain",
  no_budget: "No budget",
  timing: "Bad timing",
  competitor: "Chose a competitor",
  build: "Building it themselves",
  price: "Price",
  product_gap: "Product gap",
  went_dark: "Went dark",
  not_icp: "Not a fit",
};

/** What each loss reason says to change. A pattern needs at least two losses before it means anything. */
export const LOSS_LESSON: Record<LossReason, string> = {
  no_pain: "Qualify pain harder on the first call; tighten the ICP filter.",
  no_budget: "Find the economic buyer before the pilot, not after.",
  timing: "Ask for the critical event early; park and revisit on a date.",
  competitor: "Arm the champion with landmine questions earlier.",
  build: "Price against the engineer-months, and show the maintenance cost.",
  price: "Anchor on the cost of the problem before any number.",
  product_gap: "Log the gap; disqualify earlier when it's a must-have.",
  went_dark: "Multi-thread and get dated, buyer-agreed next steps.",
  not_icp: "Add it to Not a fit so discovery stops finding them.",
};

export interface LossRow {
  reason: LossReason;
  label: string;
  lesson: string;
  count: number;
  usd: number;
  /** The stage they died at most often. */
  stage: Deal["stage"] | null;
}

export function lossReasons(ws: Workspace, stats: RevenueStats): LossRow[] {
  const rows = new Map<LossReason, { deals: Deal[] }>();
  for (const d of Object.values(ws.deals)) {
    if (d.stage !== "lost" || !d.lossReason) continue;
    rows.set(d.lossReason, { deals: [...(rows.get(d.lossReason)?.deals ?? []), d] });
  }
  return [...rows.entries()]
    .map(([reason, { deals }]) => {
      const lastOpen = deals.map((d) => [...d.stageHistory].reverse().find((h) => h.stage !== "lost")?.stage ?? "talking");
      const counts = new Map<Deal["stage"], number>();
      for (const s of lastOpen) counts.set(s, (counts.get(s) ?? 0) + 1);
      const stage = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      return { reason, label: LOSS_LABELS[reason], lesson: LOSS_LESSON[reason], count: deals.length, usd: deals.reduce((n, d) => n + dealAmount(d, stats.avgDealUsd).usd, 0), stage };
    })
    .sort((a, b) => b.count - a.count || b.usd - a.usd);
}
