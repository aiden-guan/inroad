import type { ID, Move } from "@/lib/domain/types";
import { TOP_MOVES, visibleMoves } from "./rules";

/**
 * The numbers the app shell shows on every page, counted the way the pages they point to count them,
 * so the founder never sees two answers to "how much is waiting?".
 */

/** What Today shows: at most TOP_MOVES cards ("ready"), the rest folded under Later. */
export function todayCounts(moves: Record<ID, Move>, today: string): { ready: number; later: number } {
  const n = visibleMoves(moves, today).length;
  return { ready: Math.min(n, TOP_MOVES), later: Math.max(0, n - TOP_MOVES) };
}
