import { isConsumer } from "@/lib/consumer/market";
import { consumerChannelPlan } from "@/lib/consumer/plan";
import type { ID, Move, Workspace } from "@/lib/domain/types";
import { TOP_MOVES, visibleMoves } from "./rules";
import { goalWins } from "./scoreboard";

/**
 * The numbers the app shell shows on every page, counted the way the pages they point to count them,
 * so the founder never sees two answers to "how much is waiting?".
 */

/** What Today shows: at most TOP_MOVES cards ("ready"), the rest folded under Later. */
export function todayCounts(moves: Record<ID, Move>, today: string): { ready: number; later: number } {
  const n = visibleMoves(moves, today).length;
  return { ready: Math.min(n, TOP_MOVES), later: Math.max(0, n - TOP_MOVES) };
}

/** Customers, as the Customers tab lists them: companies with a won deal, plus customers that came in without one. */
export function customerCount(ws: Workspace): number {
  const domains = new Set<string>();
  for (const d of Object.values(ws.deals)) if (d.stage === "won") domains.add(d.accountDomain);
  for (const a of Object.values(ws.accounts)) if (a.status === "customer") domains.add(a.domain);
  return domains.size;
}

export interface GoalRow {
  label: string;
  value: [number, number];
}

/**
 * The sidebar's goal line: the near-term goal, then the number under it. Business: "Paid pilots 1 of 5 · Customers
 * 0 of 20" (the long arc). Consumer: "Weekly active users 40 of 100 · Signups a week 18 of 25", the second against
 * what the retention-first plan needs each week.
 */
export function goalLine(ws: Workspace, today: string): GoalRow[] {
  if (isConsumer(ws)) {
    const latest = [...(ws.growthLog ?? [])].filter((w) => w.weekOf <= today).sort((a, b) => a.weekOf.localeCompare(b.weekOf)).at(-1);
    const { signupsPerWeek } = consumerChannelPlan(ws, { today }).funnel.consumer!;
    const label = ws.goal.targetLabel.charAt(0).toUpperCase() + ws.goal.targetLabel.slice(1);
    return [
      { label, value: [goalWins(ws), ws.goal.target] },
      { label: "Signups a week", value: [latest?.signups ?? 0, signupsPerWeek] },
    ];
  }
  return [
    { label: "Paid pilots", value: [goalWins(ws), ws.goal.target] },
    { label: "Customers", value: [customerCount(ws), ws.goal.longArcCustomers] },
  ];
}
