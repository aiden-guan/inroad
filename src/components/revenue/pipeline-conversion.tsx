"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { useClock } from "@/components/today/use-today";
import { Card, SectionLabel } from "@/components/ui/card";
import { shortDate } from "@/lib/client/format";
import { isConsumer } from "@/lib/consumer/market";
import { pipelinePulse } from "@/lib/revenue/funnel";
import { money } from "@/lib/revenue/forecast";

export function PipelineConversion() {
  const { ws } = useWorkspace();
  const now = useClock(60_000);
  const pulse = useMemo(() => ws && !isConsumer(ws) ? pipelinePulse(ws, new Date(now)) : null, [ws, now]);
  if (!pulse) return null;
  const change = pulse.recent.count - pulse.previous.count;
  const concern = [...pulse.rows].filter((r) => r.conversion !== null && r.lost > 0).sort((a, b) => a.conversion! - b.conversion! || b.lost - a.lost)[0];
  return <section id="pipeline-conversion" aria-labelledby="pipeline-conversion-title" className="mt-12 scroll-mt-24">
    <SectionLabel><span id="pipeline-conversion-title">Where the pipeline slows down</span></SectionLabel>
    <Card className="overflow-hidden">
      <div className="grid gap-5 border-b border-border px-5 py-5 sm:grid-cols-3">
        <div><p className="text-[12px] text-fg-3">New qualified deals · 30 calendar days</p><p className="mt-1 font-mono text-[28px] tnum">{pulse.recent.count}</p><p className="mt-1 text-[12px] text-fg-3">{change > 0 ? "+" : ""}{change} vs {pulse.previous.count} in the preceding 30 days</p></div>
        <div><p className="text-[12px] text-fg-3">Their current stated value</p><p className="mt-1 font-mono text-[28px] tnum">{money(pulse.recent.knownUsd)}</p><p className="mt-1 text-[12px] text-fg-3">{pulse.recent.missingValues ? `${pulse.recent.missingValues} unpriced ${pulse.recent.missingValues === 1 ? "deal excluded" : "deals excluded"}` : "No estimated deal values"}</p></div>
        <div><p className="text-[12px] text-fg-3">Qualified deals still open</p><p className="mt-1 font-mono text-[28px] tnum">{pulse.openQualified}</p><p className="mt-1 text-[12px] text-fg-3">Qualified, pilot and proposal stages</p></div>
      </div>
      {concern && <p className="border-b border-border px-5 py-4 text-[13px] leading-5 text-fg-2">Inspect {concern.label.toLowerCase()}: {concern.lost} of {concern.advanced + concern.lost} decided exits were lost before moving forward. {concern.waiting} are still unresolved. <a href="#gtm-initiatives" className="font-medium underline underline-offset-2">Plan an improvement</a></p>}
      <div className="divide-y divide-border md:hidden">{pulse.rows.map((r) => <div key={r.stage} className="px-5 py-4">
        <div className="flex items-baseline justify-between gap-4"><h4 className="text-[14px] font-medium">{r.label}</h4><p className="text-[12px] text-fg-3"><span className="font-mono text-fg">{r.advanced}/{r.advanced + r.lost}</span> forward / decided</p></div>
        <p className="mt-1 text-[12px] text-fg-3">{r.conversion === null ? "Need 10 decided exits for a rate" : `${(r.conversion * 100).toFixed(0)}% moved forward`}</p>
        <dl className="mt-3 grid grid-cols-2 gap-x-5 gap-y-2 text-[12px]">{[["Entered", r.entered], ["Moved forward", r.advanced], ["Lost first", r.lost], ["Unresolved", r.waiting], ["Undated outcomes", r.unknown], ["Median to move", r.medianDays === null ? "—" : `${r.medianDays.toFixed(1)}d`]].map(([label, value]) => <div key={label} className="flex justify-between gap-2"><dt className="text-fg-3">{label}</dt><dd className="font-mono">{value}</dd></div>)}</dl>
      </div>)}</div>
      <div className="hidden overflow-x-auto md:block"><table className="w-full min-w-[640px] text-left text-[13px]"><caption className="sr-only">Conversion for deals first recorded in each stage over the last 90 calendar days</caption><thead className="border-b border-border text-[11px] text-fg-3"><tr>{["Entered stage", "Entered", "Moved forward", "Lost first", "Unresolved", "Forward / decided", "Median to move"].map((label, i) => <th key={label} scope="col" className={`px-4 py-3 font-medium ${i ? "text-right" : ""}`}>{label}</th>)}</tr></thead><tbody className="divide-y divide-border">{pulse.rows.map((r) => <tr key={r.stage}><th scope="row" className="px-4 py-3 font-medium">{r.label}</th><td className="px-4 py-3 text-right font-mono">{r.entered}</td><td className="px-4 py-3 text-right font-mono">{r.advanced}</td><td className="px-4 py-3 text-right font-mono">{r.lost}</td><td className="px-4 py-3 text-right font-mono">{r.waiting}{r.unknown > 0 && <span className="block font-sans text-[11px] text-fg-3">+ {r.unknown} undated</span>}</td><td className="px-4 py-3 text-right"><span className="font-mono">{r.advanced}/{r.advanced + r.lost}</span><span className="block text-[11px] text-fg-3">{r.conversion === null ? "Need 10 decided exits" : `${(r.conversion * 100).toFixed(0)}%`}</span></td><td className="px-4 py-3 text-right font-mono">{r.medianDays === null ? "—" : `${r.medianDays.toFixed(1)}d`}</td></tr>)}</tbody></table></div>
      <details className="border-t border-border px-5 py-4 text-[12px] leading-5 text-fg-3"><summary className="w-fit cursor-pointer">Definitions and deals to inspect</summary><p className="mt-3">New pipeline: first recorded Qualified entry from {shortDate(pulse.from)} through {shortDate(pulse.asOf)}, compared with {shortDate(pulse.previousFrom)} through the preceding day. Re-entry does not count twice. Dollar totals use current stated USD values, so they are not historical pipeline valuations.</p><p className="mt-2">Stage rows use first recorded entries over 90 calendar days. The first later forward move or loss decides the outcome, even if a lost deal is reopened. Moving to any later stage counts once, including skipped stages. Rates use forward moves divided by decided exits; unresolved and undated outcomes are excluded. Rates appear after 10 decided exits; this is a display threshold, not statistical confidence. Median time uses observed forward moves only. These are descriptive cohorts, not A/B results.</p>{pulse.undatedQualified > 0 && <p className="mt-2 text-warning">{pulse.undatedQualified} qualified open deals lack a dated Qualified entry and are excluded from new-pipeline counts.</p>}
        <ul className="mt-3 space-y-2">{pulse.rows.flatMap((r) => r.waitingDeals.slice(0, 3).map((d) => <li key={`${r.stage}:${d.id}`}><Link className="underline underline-offset-2" href={`/companies?c=${encodeURIComponent(d.domain)}`}>{d.name}</Link> · {r.label} · {d.days} days since the recorded entry</li>))}</ul>
      </details>
    </Card>
  </section>;
}
