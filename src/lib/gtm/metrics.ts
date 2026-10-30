import { isConsumer } from "@/lib/consumer/market";
import type { IntegrationState, Workspace } from "@/lib/domain/types";
import { METRIC_PROVIDERS } from "@/lib/metrics/catalog";
import { METRIC_PROVIDER_IDS, type BusinessMetric, type MetricSnapshot } from "@/lib/metrics/types";
import { pipelinePulse } from "@/lib/revenue/funnel";
import type { MetricDescriptor, MetricPoint, MetricReading, MetricSeries } from "./types";

const DAY = 86_400_000;
export const STALE_METRIC_MS = DAY;

/** Keys contain only explicit non-secret identity/definition fields, never arbitrary connector settings. */
function describeMetric(snapshot: MetricSnapshot, state: IntegrationState, metric: BusinessMetric): MetricDescriptor {
  const cfg = state.config;
  const connection = cfg.metricConnectionId ?? `legacy:${snapshot.provider}:${state.connectedAt ?? ""}`;
  const filters = snapshot.provider === "posthog" ? [cfg.region ?? "us", String(cfg.projectId ?? ""), cfg.activityEvent ?? "$pageview", cfg.identifiedOnly !== false] : snapshot.provider === "stripe" ? [String(cfg.currency ?? "all").toLowerCase()] : [cfg.organizationId ?? "scoped-token"];
  const id = JSON.stringify([snapshot.provider, connection, snapshot.environment, filters, metric.key, metric.currency ?? "", metric.period, metric.definition]);
  return { id, provider: snapshot.provider, key: metric.key, label: metric.label, sourceLabel: `${METRIC_PROVIDERS[snapshot.provider].name} · ${snapshot.accountLabel}`, currency: metric.currency, period: metric.period, definition: metric.definition, test: snapshot.environment === "test", href: `/integrations#${snapshot.provider}` };
}

/** Preserve the first baseline and the latest daily observation, without inventing missing days. */
export function recordDaily(points: MetricPoint[], point: MetricPoint): MetricPoint[] {
  if (!Number.isFinite(point.value) || !Number.isFinite(Date.parse(point.at))) return points;
  if (points.length && point.at < points.at(-1)!.at) return points;
  const next = [...points];
  const index = next.findLastIndex((p) => p.at.slice(0, 10) === point.at.slice(0, 10));
  if (index < 0 || (index === 0 && next[0].value !== point.value && next[0].at !== point.at)) next.push(point);
  else if (index !== 0 || next[0].at === point.at) next[index] = point;
  return next;
}

export function recordProviderHistory(ws: Workspace, snapshot: MetricSnapshot, state: IntegrationState) {
  const history = ws.metricHistory ??= {};
  for (const metric of snapshot.metrics) {
    const descriptor = describeMetric(snapshot, state, metric);
    const before = history[descriptor.id];
    history[descriptor.id] = { ...descriptor, points: recordDaily(before?.points ?? [], { at: snapshot.syncedAt, value: metric.value }) };
  }
}

function freshness(at: string, now: Date, error?: string): string | undefined {
  if (error) return error;
  const time = Date.parse(at);
  if (!Number.isFinite(time) || time > now.getTime() + 5 * 60_000) return "The source time needs checking.";
  return now.getTime() - time > STALE_METRIC_MS ? "Last successful sync was more than 24 hours ago." : undefined;
}

export function currentMetrics(ws: Workspace, now = new Date(), options: { pipeline?: boolean } = {}): MetricReading[] {
  const readings: MetricReading[] = [];
  for (const id of METRIC_PROVIDER_IDS) {
    const state = ws.integrations[id]; const snapshot = ws.businessMetrics?.[id];
    if (!state?.enabled || !snapshot || snapshot.provider !== id) continue;
    for (const metric of snapshot.metrics) {
      if (!Number.isFinite(metric.value)) continue;
      readings.push({ ...describeMetric(snapshot, state, metric), value: metric.value, at: snapshot.syncedAt, problem: freshness(snapshot.syncedAt, now, state.lastError?.message) });
    }
  }
  const waitlist = ws.waitlist;
  if (isConsumer(ws) && waitlist?.enabled && Number.isFinite(waitlist.current.total)) readings.push({ id: JSON.stringify(["waitlist", waitlist.source.id, "total"]), provider: "waitlist", key: "total", label: "Waitlist signups", sourceLabel: waitlist.source.label, period: "Current", definition: "Rows in the signup table visible to this connection. Net changes include additions and removals.", href: "/growth#waitlist", value: waitlist.current.total, at: waitlist.current.at, problem: freshness(waitlist.current.at, now, waitlist.lastError) });
  if (!isConsumer(ws) && options.pipeline !== false) {
    const pulse = pipelinePulse(ws, now);
    const scope = ws.company?.domain ?? "workspace";
    for (const [key, label, value, period, definition, currency] of [
      ["qualified_30d", "New qualified deals", pulse.recent.count, "30 calendar days", "Deals with a first recorded Qualified entry in the last 30 local calendar dates, including today. Re-entry never counts twice.", undefined],
      ["qualified_open", "Qualified open deals", pulse.openQualified, "Current", "Deals currently Qualified, in Pilot or at Proposal.", undefined],
      ["open_usd", "Known qualified pipeline", pulse.knownOpenUsd, "Current", "Current stated USD values of qualified open deals. Missing values are excluded; no average deal sizes are substituted.", "USD"],
    ] as const) readings.push({ id: JSON.stringify(["pipeline", scope, key]), provider: "pipeline", key, label, value, period, definition, currency, sourceLabel: "Tracked deals", href: "/revenue#pipeline-conversion", at: now.toISOString() });
    for (const row of pulse.rows) if (row.conversion !== null) readings.push({ id: JSON.stringify(["pipeline", scope, `conversion_${row.stage}`, 90]), provider: "pipeline", key: `conversion_${row.stage}`, label: `${row.label} progression`, value: row.conversion * 100, unit: "percent", n: row.advanced + row.lost, period: "90-day entry cohort", definition: "Share of decided stage exits that moved forward. Open and undated outcomes are excluded. This describes observed cohorts, not an A/B test.", sourceLabel: "Tracked stage history", href: "/revenue#pipeline-conversion", at: now.toISOString() });
  }
  return readings;
}

export function historyFor(ws: Workspace, reading: MetricReading): MetricSeries {
  if (reading.provider === "waitlist") return { ...reading, points: (ws.waitlist?.history ?? []).filter((p) => p.sourceId === ws.waitlist?.source.id).map((p) => ({ at: p.at, value: p.total })) };
  return ws.metricHistory?.[reading.id] ?? { ...reading, points: [] };
}

export function observedChange(series: MetricSeries, reading: MetricPoint): { delta: number; percent: number | null; since: string; baseline: number } | null {
  const eligible = series.points.filter((p) => p.at < reading.at && Number.isFinite(p.value));
  if (!eligible.length) return null;
  const cutoff = new Date(Date.parse(reading.at) - 7 * DAY).toISOString();
  const base = eligible.filter((p) => p.at <= cutoff).at(-1) ?? eligible[0];
  return { delta: reading.value - base.value, percent: base.value <= 0 ? null : 100 * (reading.value - base.value) / base.value, since: base.at, baseline: base.value };
}

export function metricDescriptor(reading: MetricReading): MetricDescriptor {
  return { id: reading.id, provider: reading.provider, key: reading.key, label: reading.label, sourceLabel: reading.sourceLabel, period: reading.period, definition: reading.definition, currency: reading.currency, unit: reading.unit, test: reading.test, href: reading.href };
}
