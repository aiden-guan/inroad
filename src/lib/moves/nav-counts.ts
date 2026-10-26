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

/** The sidebar's goal line: "Paid pilots 1 of 5 · Customers 0 of 20" (the near-term goal, then the long arc). */
export function goalLine(ws: Workspace): { pilots: [number, number]; customers: [number, number] } {
  return { pilots: [goalWins(ws), ws.goal.target], customers: [customerCount(ws), ws.goal.longArcCustomers] };
}
