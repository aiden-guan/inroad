"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { useClock } from "@/components/today/use-today";
import { Card, SectionLabel } from "@/components/ui/card";
import { shortDate } from "@/lib/client/format";
import { isConsumer } from "@/lib/consumer/market";
import { MIN_CONVERSION_EXITS, pipelinePulse, type FunnelRow } from "@/lib/revenue/funnel";
import { money } from "@/lib/revenue/forecast";

const pct = (r: FunnelRow) => `${((r.conversion ?? 0) * 100).toFixed(0)}%`;
const median = (r: FunnelRow) => (r.medianDays === null ? "—" : `${r.medianDays.toFixed(1)}d`);

/**
 * Where the pipeline slows down: new qualified pipeline against the month before, and what happened to deals after
 * they entered each stage. Counts always; a rate only once enough deals have left a stage, and that caveat is
 * said once for the section rather than in every cell.
 */
export function PipelineConversion() {
  const { ws } = useWorkspace();
  const now = useClock(60_000);
  const pulse = useMemo(() => (ws && !isConsumer(ws) ? pipelinePulse(ws, new Date(now)) : null), [ws, now]);
  if (!pulse) return null;
  const change = pulse.recent.count - pulse.previous.count;
  const concern = [...pulse.rows].filter((r) => r.conversion !== null && r.lost > 0).sort((a, b) => a.conversion! - b.conversion! || b.lost - a.lost)[0];
  const thin = pulse.rows.some((r) => r.conversion === null);
  return (
    <section id="pipeline-conversion" aria-labelledby="pipeline-conversion-title" className="scroll-mt-24">
      <SectionLabel>
        <span id="pipeline-conversion-title">Where the pipeline slows down</span>
      </SectionLabel>
      <Card className="overflow-hidden">
        <div className="grid gap-5 border-b border-border px-5 py-5 sm:grid-cols-3">
          <div>
            <p className="text-[12px] text-fg-3">New qualified deals · 30 calendar days</p>
            <p className="mt-1 font-mono text-[28px] tnum">{pulse.recent.count}</p>
            <p className="mt-1 text-[12px] text-fg-3">
              {change > 0 ? "+" : ""}
              {change} vs {pulse.previous.count} in the 30 days before
            </p>
          </div>
          <div>
            <p className="text-[12px] text-fg-3">Their current stated value</p>
            <p className="mt-1 font-mono text-[28px] tnum">{money(pulse.recent.knownUsd)}</p>
            <p className="mt-1 text-[12px] text-fg-3">{pulse.recent.missingValues ? `${pulse.recent.missingValues} unpriced ${pulse.recent.missingValues === 1 ? "deal" : "deals"} left out` : "Every one has an amount"}</p>
          </div>
          <div>
            <p className="text-[12px] text-fg-3">Qualified deals still open</p>
            <p className="mt-1 font-mono text-[28px] tnum">{pulse.openQualified}</p>
            <p className="mt-1 text-[12px] text-fg-3">Qualified, pilot and proposal stages</p>
          </div>
        </div>
        {concern && (
          <p className="border-b border-border px-5 py-4 text-[13px] leading-5 text-fg-2">
            Inspect {concern.label.toLowerCase()}: {concern.lost} of {concern.decided} decided exits were lost before moving forward. {concern.waiting} are still unresolved.{" "}
            <a href="#gtm-initiatives" className="font-medium underline underline-offset-2">
              Plan an improvement
            </a>
          </p>
        )}
        {thin && (
          <p className="border-b border-border bg-bg-subtle/50 px-5 py-3 text-[12.5px] leading-5 text-fg-3">
            A stage shows a rate once {MIN_CONVERSION_EXITS} deals have left it (moved forward, lost, or parked in nurture). Until then, the counts are the honest answer.
          </p>
        )}
        <div className="divide-y divide-border md:hidden">
          {pulse.rows.map((r) => (
            <div key={r.stage} className="px-5 py-4">
              <div className="flex items-baseline justify-between gap-4">
                <h4 className="text-[14px] font-medium">{r.label}</h4>
                <p className="text-right text-[12px] text-fg-3">
                  {r.conversion !== null ? (
                    <>
                      <span className="font-mono text-fg">{pct(r)}</span> moved forward
                    </>
                  ) : (
                    <>
                      <span className="font-mono text-fg">
                        {r.advanced} of {r.decided}
                      </span>{" "}
                      moved forward so far
                    </>
                  )}
                </p>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-5 gap-y-2 text-[12px]">
                {(
                  [
                    ["Entered", r.entered],
                    ["Moved forward", r.advanced],
                    ["Lost first", r.lost],
                    ["To nurture", r.nurtured],
                    ["Unresolved", r.waiting],
                    ["No dated outcome", r.unknown],
                    ["Median to move", median(r)],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-2">
                    <dt className="text-fg-3">{label}</dt>
                    <dd className="font-mono">{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[700px] text-left text-[13px]">
            <caption className="sr-only">What happened to deals first recorded in each stage over the last 90 calendar days</caption>
            <thead className="border-b border-border text-[11px] text-fg-3">
              <tr>
                {["Entered stage", "Entered", "Moved forward", "Lost first", "To nurture", "Unresolved", "Forward / decided", "Median to move"].map((label, i) => (
                  <th key={label} scope="col" className={`px-4 py-3 font-medium ${i ? "text-right" : ""}`}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {pulse.rows.map((r) => (
                <tr key={r.stage}>
                  <th scope="row" className="px-4 py-3 font-medium">
                    {r.label}
                  </th>
                  <td className="px-4 py-3 text-right font-mono">{r.entered}</td>
                  <td className="px-4 py-3 text-right font-mono">{r.advanced}</td>
                  <td className="px-4 py-3 text-right font-mono">{r.lost}</td>
                  <td className="px-4 py-3 text-right font-mono">{r.nurtured}</td>
                  <td className="px-4 py-3 text-right font-mono">
                    {r.waiting}
                    {r.unknown > 0 && <span className="block font-sans text-[11px] text-fg-3">+ {r.unknown} undated</span>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="font-mono">
                      {r.advanced}/{r.decided}
                    </span>
                    {r.conversion !== null && <span className="block text-[11px] text-fg-3">{pct(r)}</span>}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">{median(r)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <details className="border-t border-border px-5 py-4 text-[12px] leading-5 text-fg-3">
          <summary className="w-fit cursor-pointer">Definitions and deals to inspect</summary>
          <p className="mt-3">
            New pipeline: first recorded Qualified entry from {shortDate(pulse.from)} through {shortDate(pulse.asOf)}, compared with {shortDate(pulse.previousFrom)} through the day before. Re-entry
            doesn&apos;t count twice. Dollar totals use current stated USD values, so they aren&apos;t historical pipeline values.
          </p>
          <p className="mt-2">
            Stage rows use first recorded entries over 90 calendar days. The first later forward move, loss or move to nurture decides the outcome, even if the deal comes back later. A
            move to nurture is a decided exit that didn&apos;t move forward, not a loss. Moving to any later stage counts once, including skipped stages. Rates are forward moves divided
            by decided exits; unresolved and undated outcomes are left out. The {MIN_CONVERSION_EXITS}-exit line is a display threshold, not statistical confidence. Median time uses
            observed forward moves only. These describe what happened, not A/B results. Deals imported from a file without stage dates aren&apos;t counted here until they move.
          </p>
          {pulse.undatedQualified > 0 && (
            <p className="mt-2 text-warning">
              {pulse.undatedQualified} qualified open {pulse.undatedQualified === 1 ? "deal has" : "deals have"} no dated Qualified entry, so {pulse.undatedQualified === 1 ? "it's" : "they're"} left out of new-pipeline counts.
            </p>
          )}
          <ul className="mt-3 space-y-2">
            {pulse.rows.flatMap((r) =>
              r.waitingDeals.slice(0, 3).map((d) => (
                <li key={`${r.stage}:${d.id}`}>
                  <Link className="underline underline-offset-2" href={`/companies?c=${encodeURIComponent(d.domain)}`}>
                    {d.name}
                  </Link>{" "}
                  · {r.label} · {d.days} days since the recorded entry
                </li>
              )),
            )}
          </ul>
        </details>
      </Card>
    </section>
  );
}
