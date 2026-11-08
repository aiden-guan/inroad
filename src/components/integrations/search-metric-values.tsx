import { formatSearchMetric } from "@/lib/metrics/search-catalog";
import type { SearchSnapshot } from "@/lib/metrics/search-types";

export function SearchMetricValues({ snapshot }: { snapshot: SearchSnapshot }) {
  return (
    <div>
      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3">
        {snapshot.metrics.map((metric) => (
          <div key={metric.key} className="min-w-0">
            <dt className="text-[12px] leading-5 text-fg-3">{metric.label} <span className="block text-[11px]">{metric.period}{metric.currency && ` · ${metric.currency}`}</span></dt>
            <dd className="mt-1 break-words font-mono text-[24px] leading-8 tracking-tight text-fg tnum">{formatSearchMetric(metric.value, metric.currency, metric.format)}</dd>
            {metric.previousValue !== undefined && <dd className="mt-1 text-[12px] text-fg-3">Previously {formatSearchMetric(metric.previousValue, metric.currency, metric.format)}{metric.value !== null && metric.previousValue !== null && metric.previousValue !== 0 && <> · {metric.value >= metric.previousValue ? "+" : ""}{new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 }).format((metric.value - metric.previousValue) / metric.previousValue)}</>}</dd>}
          </div>
        ))}
      </dl>
      {snapshot.comparisonPeriod && <p className="mt-4 text-[12px] text-fg-3">Previous period: {snapshot.comparisonPeriod}. Changes describe observed performance, not the effect of a specific optimization.</p>}
      {snapshot.breakdown && <div className="mt-5 overflow-x-auto"><table className="w-full text-left text-[12px]"><caption className="sr-only">Attributed sessions by source</caption><thead><tr className="border-b border-border text-fg-3"><th scope="col" className="py-2 font-medium">Source</th><th scope="col" className="py-2 text-right font-medium">Sessions</th>{snapshot.breakdown.some((r) => r.conversions !== undefined) && <th scope="col" className="py-2 text-right font-medium">Converted sessions</th>}</tr></thead><tbody>{snapshot.breakdown.map((row) => <tr key={row.label} className="border-b border-border/50"><th scope="row" className="py-2 font-normal">{row.label}</th><td className="py-2 text-right font-mono">{formatSearchMetric(row.sessions)}</td>{row.conversions !== undefined && <td className="py-2 text-right font-mono">{formatSearchMetric(row.conversions)}</td>}</tr>)}</tbody></table></div>}
      {snapshot.links && <div className="mt-4 flex flex-wrap gap-3 text-[12px]">{snapshot.links.map((link) => <a key={link.href} href={link.href} target="_blank" rel="noreferrer" className="text-fg-2 underline underline-offset-4">{link.label} ↗</a>)}</div>}
      <details className="mt-4 text-[12px] leading-[19px] text-fg-3">
        <summary className="w-fit cursor-pointer rounded-sm py-1 text-fg-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]">How these numbers are counted</summary>
        <div className="mt-2 space-y-2">
          {snapshot.metrics.map((metric) => <p key={metric.key}><span className="font-medium text-fg-2">{metric.label} · {metric.period}.</span> {metric.definition}</p>)}
          {snapshot.notes.map((note) => <p key={note}>{note}</p>)}
          <p>Window: <time dateTime={snapshot.windowStart}>{new Date(snapshot.windowStart).toUTCString()}</time> to <time dateTime={snapshot.windowEnd}>{new Date(snapshot.windowEnd).toUTCString()}</time>.</p>
        </div>
      </details>
    </div>
  );
}
