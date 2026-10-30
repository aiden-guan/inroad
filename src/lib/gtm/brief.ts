import { marketOf } from "@/lib/consumer/market";
import { todayISO, weekOf } from "@/lib/domain/ids";
import type { Workspace } from "@/lib/domain/types";
import { localDate } from "@/lib/moves/util";
import { initiativeProgress } from "./progress";
import type { MetricDescriptor, MetricReading } from "./types";

export function metricValue(value: number, metric: Pick<MetricDescriptor, "currency" | "unit">): string {
  if (metric.unit === "percent") return `${value.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
  return new Intl.NumberFormat("en-US", metric.currency ? { style: "currency", currency: metric.currency, currencyDisplay: "code" } : { maximumFractionDigits: 2 }).format(value);
}
const text = (s: string) => s.replace(/[\r\n]+/g, " ").replace(/\|/g, "\\|").replace(/[<>]/g, "");

/** A shareable plan built from actual observations; no model call, sending or invented attribution. */
export function weeklyPlan(ws: Workspace, readings: MetricReading[], now = new Date()): string {
  const today = todayISO(now);
  const items = Object.values(ws.gtmInitiatives ?? {}).filter((i) => i.market === marketOf(ws));
  const active = items.filter((i) => i.status === "active").sort((a, b) => a.dueOn.localeCompare(b.dueOn));
  const completed = items.filter((i) => { const at = i.outcomes.at(-1)?.at; return i.status === "done" && !!at && localDate(at) >= weekOf(today) && Date.parse(at) <= now.getTime(); });
  const lines = [`# ${text(ws.company?.name ?? "GTM")} · weekly execution plan`, "", `As of ${now.toISOString()}`, "", "## Priorities", "", "| Initiative | Owner | Review date | Observed progress |", "| --- | --- | --- | --- |"];
  for (const item of active) {
    const result = initiativeProgress(item, readings, today);
    const m = item.measurement;
    const context = m ? `${m.metric.label} · ${m.metric.period} · ${m.metric.sourceLabel}${m.metric.test ? " · TEST DATA" : ""}; ` : "";
    const progress = context + (m && result.current ? `${metricValue(m.baseline.value, m.metric)} → ${metricValue(result.current.value, m.metric)}${m.target !== undefined ? `; target ${metricValue(m.target, m.metric)}` : ""}${result.current.n !== undefined ? `; n=${result.current.n} decided exits` : ""}; source observation ${result.current.at}${result.problem ? `; needs attention: ${result.problem}` : ""}` : result.problem ?? "Unmeasured commitment");
    lines.push(`| ${text(item.title)} | ${text(item.owner)} | ${item.dueOn}${result.overdue ? " (overdue)" : ""} | ${text(progress)} |`);
  }
  if (!active.length) lines.push("| No active initiatives | — | — | — |");
  if (completed.length) {
    lines.push("", "## Completed this week", "");
    for (const item of completed) {
      const outcome = item.outcomes.at(-1)!;
      const m = outcome.measurement;
      lines.push(`- ${text(item.title)} — reviewed ${outcome.at}${m ? `; ${text(m.metric.label)} · ${text(m.metric.period)} · ${text(m.metric.sourceLabel)}${m.metric.test ? " · TEST DATA" : ""}` : ""}${m && outcome.current ? `; ${metricValue(m.baseline.value, m.metric)} → ${metricValue(outcome.current.value, m.metric)}${outcome.current.n !== undefined ? `; n=${outcome.current.n} decided exits` : ""}; source observation ${outcome.current.at}` : ""}${outcome.problem ? `; ${text(outcome.problem)}` : ""}${outcome.note ? `; ${text(outcome.note)}` : ""}`);
    }
  }
  lines.push("", "Observed before/after changes do not establish that an initiative caused the result. Completed readouts are saved at review time.");
  return lines.join("\n");
}
