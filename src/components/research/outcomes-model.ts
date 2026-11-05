import type { researchMetrics } from "@/lib/search/research";

type Metrics = ReturnType<typeof researchMetrics>;

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The plain answer first, counted in code from the receipts: what research found, what it led to, what it cost. */
export function outcomesLine(metrics: Metrics): string | null {
  if (!metrics.length) return null;
  const sum = (k: "requests" | "acceptedAccounts" | "replies" | "meetings" | "won") => metrics.reduce((t, m) => t + m[k], 0);
  const known = metrics.reduce((t, m) => t + m.knownCostUsd, 0);
  const unknown = metrics.reduce((t, m) => t + m.unknownCost, 0);
  const dollars = known > 0 && known < 0.01 ? known.toFixed(4) : known.toFixed(2);
  const cost = unknown ? `$${dollars} known, plus ${count(unknown, "request")} with no published price` : `$${dollars}`;
  const led = [
    sum("replies") ? count(sum("replies"), "reply", "replies") : null,
    sum("meetings") ? count(sum("meetings"), "meeting") : null,
    sum("won") ? count(sum("won"), "won deal") : null,
  ].filter(Boolean);
  const found = `${count(sum("requests"), "research request")} found ${count(sum("acceptedAccounts"), "company", "companies")} you kept`;
  return `In the last 90 days, ${found}${led.length ? `, linked to ${led.join(", ")}` : ""}. Cost: ${cost}.`;
}
