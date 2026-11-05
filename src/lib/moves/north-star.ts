import { isConsumer } from "@/lib/consumer/market";
import { todayISO } from "@/lib/domain/ids";
import type { Workspace } from "@/lib/domain/types";
import { computeForecast, computePlan, money } from "@/lib/revenue/forecast";
import { goalLine } from "./nav-counts";
import { computeScoreboard, goalWins } from "./scoreboard";

/**
 * The one number, in one line, computed in code: with a revenue target, commit against it, the chance to hit it and
 * the gap after expected wins ("$66K of $150K committed · 14% to hit · $48K gap"); without one, the goal and this
 * week's conversations. Today's masthead reads it; the sidebar's north star should read the same function so the
 * two never say different things.
 */

export interface NorthStar {
  kind: "revenue" | "goal" | "consumer";
  /** "$66K of $150K committed". */
  headline: string;
  /** "14% to hit", "$48K gap". */
  details: string[];
  value: number;
  max: number;
  /** What the number is, for screen readers and tooltips: "Commit toward Q4 new ARR". */
  label: string;
  href: string;
}

export function northStar(ws: Workspace, now: Date): NorthStar {
  const today = todayISO(now);
  if (isConsumer(ws)) {
    const [goal, signups] = goalLine(ws, today);
    return {
      kind: "consumer",
      headline: `${goal.value[0]} of ${goal.value[1]} ${ws.goal.targetLabel}`,
      details: signups ? [`${signups.value[0]} of ${signups.value[1]} signups a week`] : [],
      value: goal.value[0],
      max: goal.value[1],
      label: `${goal.label} toward your goal`,
      href: "/growth",
    };
  }
  const target = ws.revenue?.target;
  if (target && target.amountUsd > 0) {
    const f = computeForecast(ws, today);
    const plan = computePlan(ws, f, now);
    const details: string[] = [];
    if (f.remaining <= 0) details.push("target reached");
    else {
      if (f.hitChance !== null) details.push(`${Math.round(f.hitChance * 100)}% to hit`);
      details.push(plan.gap > 0 ? `${money(plan.gap)} gap` : "pipeline covers it");
    }
    return { kind: "revenue", headline: `${money(f.commit)} of ${money(f.target)} committed`, details, value: f.commit, max: f.target, label: `Commit toward ${target.label}`, href: "/revenue" };
  }
  const wins = goalWins(ws);
  const [held, perWeek] = computeScoreboard(ws, now).conversations;
  return {
    kind: "goal",
    headline: `${wins} of ${ws.goal.target} ${ws.goal.targetLabel}`,
    details: [`${held} of ${perWeek} conversations this week`],
    value: wins,
    max: ws.goal.target,
    label: "Toward your goal",
    href: "/playbook#plan",
  };
}
