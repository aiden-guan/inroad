import { STAGE_LABELS, type Workspace } from "@/lib/domain/types";
import { SIGNAL_LABELS } from "@/components/playbook/model";
import { computeScoreboard } from "@/lib/moves/scoreboard";
import { bySignal, bySource, lossReasons } from "./attribution";
import { baseline, CATEGORY_LABELS, forecastChanges, money, shortDay, type Forecast, type RevenuePlan } from "./forecast";

/**
 * The weekly GTM update's facts and its numbers table, built in code so the model only writes the story
 * around them and the table can't drift. Shared by the gtm_update workflow, the agent API and the sample.
 */

export interface UpdateFacts {
  facts: string[];
  changes: string[];
  risks: string[];
  working: string[];
  table: string;
}

/** Everything the update may say, as numbered facts. */
export function updateFacts(ws: Workspace, f: Forecast, plan: RevenuePlan, now: Date): UpdateFacts {
  const sb = computeScoreboard(ws, now);
  const facts = [
    `Period: ${f.period.label}, ${shortDay(f.period.start)} to ${shortDay(f.period.end)}, ${f.period.weeksLeft} weeks left.`,
    f.hasTarget ? `Target: ${money(f.target)} new annual contract value.` : "No revenue target is set.",
    `Closed won this period: ${money(f.closedWon.usd)} (${f.closedWon.deals.length} ${f.closedWon.deals.length === 1 ? "deal" : "deals"}).`,
    `Commit (closed won + commit deals): ${money(f.commit)}.`,
    `Best case (commit + best-case deals): ${money(f.bestCase)}.`,
    `Open pipeline closing this period: ${money(f.pipeline - f.closedWon.usd)}.`,
    `Weighted forecast: ${money(f.weighted)}.`,
    f.coverage !== null ? `Coverage: ${f.coverage.toFixed(1)}x of what's left to close; healthy is ${f.coverageNeeded}x.` : "",
    f.next.coverage !== null ? `Next period's pipeline so far: ${money(f.next.pipeline)} (${f.next.coverage.toFixed(1)}x of a same-size target).` : "",
    plan.verdict !== "no_target" ? `Plan: ${plan.headline}` : "",
    `Win rate: ${Math.round(f.stats.winRate.value * 100)}% (${f.stats.winRate.source === "observed" ? `from ${f.stats.winRate.n} closed deals` : `starting default; ${f.stats.winRate.n} closed so far`}).`,
    `This week: ${sb.conversations[0]} conversations held, ${sb.firstTouches[0]} cold first touches, ${sb.replies} replies (${sb.positiveReplies ?? 0} positive), ${sb.meetingsBooked} meetings on the calendar.`,
  ].filter(Boolean);
  const changes = forecastChanges(ws, baseline(ws, f.today), f).map((c) => c.text);
  const risks = f.calls
    .filter((c) => c.category !== "omitted" && c.risks.length)
    .sort((a, b) => a.health - b.health || b.amount.usd - a.amount.usd)
    .slice(0, 5)
    .map((c) => `${c.deal.name} (${STAGE_LABELS[c.deal.stage]}, ${money(c.amount.usd)}, ${CATEGORY_LABELS[c.category]}): ${c.risks.slice(0, 2).map((r) => `${r.label}: ${r.detail}`).join(" ")}`);
  const working = [
    ...bySource(ws, f.stats)
      .filter((r) => r.deals > 0)
      .slice(0, 3)
      .map((r) => `${r.label}: ${r.deals} deals, ${r.won} won, ${money(r.wonUsd)} won${r.winRate ? `, win rate ${r.won} of ${r.winRate.n} closed` : ""}, ${money(r.openUsd)} open.`),
    ...bySignal(ws, SIGNAL_LABELS)
      .filter((r) => r.touched > 0 && r.key !== "none")
      .slice(0, 3)
      .map((r) => `${r.label} signal: ${r.touched} people touched, ${r.replied} replied, ${r.meetings} became deals (n=${r.touched}, ${r.sample}).`),
    ...lossReasons(ws, f.stats)
      .slice(0, 2)
      .map((r) => `Lost to ${r.label.toLowerCase()}: ${r.count} ${r.count === 1 ? "deal" : "deals"}, ${money(r.usd)}.`),
  ];
  const rows = f.calls
    .filter((c) => c.category !== "omitted")
    .map((c) => `| ${c.deal.name.replace(/\|/g, "/")} | ${STAGE_LABELS[c.deal.stage]} | ${CATEGORY_LABELS[c.category]}${c.called ? " (called)" : ""} | ${money(c.amount.usd)}${c.amount.source === "average" ? " est." : ""} | ${shortDay(c.closeDate)}${c.closeEstimated ? " est." : ""} |`);
  const table = [
    `| | ${f.period.label} |`,
    "|---|---|",
    ...(f.hasTarget ? [`| Target | ${money(f.target)} |`] : []),
    `| Closed won | ${money(f.closedWon.usd)} |`,
    `| Commit | ${money(f.commit)} |`,
    `| Best case | ${money(f.bestCase)} |`,
    `| Pipeline | ${money(f.pipeline)} |`,
    ...(f.coverage !== null ? [`| Coverage | ${f.coverage.toFixed(1)}x (healthy ${f.coverageNeeded}x) |`] : []),
    "",
    ...(rows.length ? ["| Deal | Stage | Call | Amount | Close |", "|---|---|---|---|---|", ...rows] : []),
  ].join("\n");
  return { facts, changes, risks, working, table };
}

export interface UpdateProse {
  headline: string;
  forecast: string;
  changes: string[];
  risks: string[];
  working: string[];
  focus: string[];
  asks: string[];
}

function section(title: string, lines: string[]): string {
  return lines.length ? `**${title}**\n\n${lines.map((l) => `- ${l.trim()}`).join("\n")}\n` : "";
}

/** The update as Markdown: the headline, the code-built table, then the story. */
export function updateBody(p: UpdateProse, table: string): string {
  return [
    p.headline.trim(),
    "",
    table,
    "",
    p.forecast.trim(),
    "",
    section("What changed", p.changes),
    section("Risks and what we're doing", p.risks),
    section("What's working", p.working),
    section("Next week", p.focus),
    section("Asks", p.asks),
  ]
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
