import { formatMetric } from "@/lib/metrics/catalog";
import type { MetricSnapshot } from "@/lib/metrics/types";
import { shortDate } from "@/lib/client/format";
import type { MetricPoint } from "@/lib/gtm/types";
import type { observedChange } from "@/lib/gtm/metrics";

export interface MetricTrend { change: ReturnType<typeof observedChange>; points: MetricPoint[] }

function TrendLine({ points, label }: { points: MetricPoint[]; label: string }) {
  const recent = points.slice(-30);
  if (recent.length < 2) return null;
  const low = Math.min(...recent.map((p) => p.value));
  const span = Math.max(1, Math.max(...recent.map((p) => p.value)) - low);
  const start = Date.parse(recent[0].at); const duration = Math.max(1, Date.parse(recent.at(-1)!.at) - start);
  const path = recent.map((p, i) => `${i ? "L" : "M"}${2 + (Date.parse(p.at) - start) / duration * 156},${28 - (p.value - low) / span * 24}`).join(" ");
  return <svg role="img" aria-label={`${label}: observed history from ${shortDate(recent[0].at)} to ${shortDate(recent.at(-1)!.at)}`} preserveAspectRatio="none" viewBox="0 0 160 32" className="mt-3 h-8 w-full max-w-[220px] text-fg-3"><path d={path} stroke="currentColor" fill="none" strokeWidth="1.5" vectorEffect="non-scaling-stroke" /></svg>;
}

export function MetricValues({ snapshot, trends }: { snapshot: MetricSnapshot; trends?: Record<string, MetricTrend> }) {
  return (
    <div>
      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3">
        {snapshot.metrics.map((metric) => (
          <div key={metric.key} className="min-w-0">
            <dt className="text-[12px] leading-5 text-fg-3">{metric.label} <span className="block text-[11px]">{metric.period}{metric.currency && ` · ${metric.currency}`}</span></dt>
            <dd className="mt-1 break-words font-mono text-[24px] leading-8 tracking-tight text-fg tnum">{formatMetric(metric.value, metric.currency)}</dd>
            {trends && <div className="mt-1 text-[11px] leading-4 text-fg-3">{trends[metric.key]?.change ? <span>{trends[metric.key].change!.delta > 0 ? "+" : ""}{formatMetric(trends[metric.key].change!.delta, metric.currency)}{trends[metric.key].change!.percent !== null && ` (${trends[metric.key].change!.percent! > 0 ? "+" : ""}${trends[metric.key].change!.percent!.toFixed(1)}%)`} since {shortDate(trends[metric.key].change!.since)}</span> : <span>{trends[metric.key]?.points.length ? "First observation saved" : "History starts with your next sync"}</span>}<TrendLine points={trends[metric.key]?.points ?? []} label={metric.label} /></div>}
          </div>
        ))}
      </dl>
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
