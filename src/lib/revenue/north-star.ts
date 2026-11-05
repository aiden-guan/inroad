import { isConsumer } from "@/lib/consumer/market";
import type { ISODate, Workspace } from "@/lib/domain/types";
import { goalWins } from "@/lib/moves/scoreboard";
import { computeForecast, money } from "./forecast";

/**
 * The one number kept in view on every page, and the words for it, so the sidebar and Today say it the same way.
 * A business with a revenue target reads the forecast: "$66K of $150K committed" (closed won plus commit, the
 * call's floor). Without a target, and for a consumer company, it's the goal from the plan: "2 of 5 paid pilots",
 * "40 of 100 weekly active users". Read-only: nothing here changes how the forecast is called.
 */
export interface NorthStar {
  kind: "revenue" | "goal";
  /** "$66K of $150K committed" · "2 of 5 paid pilots" */
  text: string;
  /** What it counts toward: the period ("Q4 new ARR") or "Goal". */
  label: string;
  value: number;
  target: number;
  /** value ÷ target, between 0 and 1. */
  progress: number;
  /** Where the number is worked: Revenue for a business, Growth for a consumer company. */
  href: "/revenue" | "/growth";
  /** One sentence for a tooltip or a screen reader. */
  description: string;
}

const share = (value: number, target: number) => (target > 0 ? Math.min(1, Math.max(0, value / target)) : 0);

export function northStar(ws: Workspace, today: ISODate): NorthStar {
  const consumer = isConsumer(ws);
  if (!consumer && (ws.revenue?.target?.amountUsd ?? 0) > 0) {
    const f = computeForecast(ws, today);
    const text = `${money(f.commit)} of ${money(f.target)} committed`;
    return {
      kind: "revenue",
      text,
      label: f.period.label,
      value: f.commit,
      target: f.target,
      progress: share(f.commit, f.target),
      href: "/revenue",
      description: `${f.period.label}: ${text}, counted from your deals.`,
    };
  }
  const value = goalWins(ws);
  const target = ws.goal.target;
  const unit = consumer ? ws.goal.targetLabel.trim().toLowerCase() : target === 1 ? "paid pilot" : "paid pilots";
  const text = `${value} of ${target} ${unit}`;
  return {
    kind: "goal",
    text,
    label: "Goal",
    value,
    target,
    progress: share(value, target),
    href: consumer ? "/growth" : "/revenue",
    description: `Your goal, from the plan: ${text}.`,
  };
}
