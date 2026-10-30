import { formatMetric } from "@/lib/metrics/catalog";
import type { MetricSnapshot } from "@/lib/metrics/types";

export function MetricValues({ snapshot }: { snapshot: MetricSnapshot }) {
  return (
    <div>
      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3">
        {snapshot.metrics.map((metric) => (
          <div key={metric.key} className="min-w-0">
            <dt className="text-[12px] leading-5 text-fg-3">{metric.label} <span className="block text-[11px]">{metric.period}{metric.currency && ` · ${metric.currency}`}</span></dt>
            <dd className="mt-1 break-words font-mono text-[24px] leading-8 tracking-tight text-fg tnum">{formatMetric(metric.value, metric.currency)}</dd>
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
