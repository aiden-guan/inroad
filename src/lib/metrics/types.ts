export const METRIC_PROVIDER_IDS = ["posthog", "stripe", "polar"] as const;
export type MetricProviderId = (typeof METRIC_PROVIDER_IDS)[number];

export interface BusinessMetric {
  key: string;
  label: string;
  value: number;
  /** Currency values are in major units, never cents. */
  currency?: string;
  period: string;
  definition: string;
}

/** Only aggregate data is persisted. No customer identities or events leave the adapter. */
export interface MetricSnapshot {
  provider: MetricProviderId;
  syncedAt: string;
  windowStart: string;
  windowEnd: string;
  accountLabel: string;
  environment: "live" | "test";
  metrics: BusinessMetric[];
  notes: string[];
}

export function isMetricProvider(id: string): id is MetricProviderId {
  return METRIC_PROVIDER_IDS.some((value) => value === id);
}
