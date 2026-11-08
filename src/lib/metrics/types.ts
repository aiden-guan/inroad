export const BUSINESS_PROVIDER_IDS = ["posthog", "stripe", "polar"] as const;
export const SEARCH_PROVIDER_IDS = ["google-search-console", "bing-webmaster", "posthog-search"] as const;
export const METRIC_PROVIDER_IDS = [...BUSINESS_PROVIDER_IDS, ...SEARCH_PROVIDER_IDS] as const;
export type MetricProviderId = (typeof METRIC_PROVIDER_IDS)[number];

export interface BusinessMetric {
  key: string;
  label: string;
  value: number | null;
  format?: "percent" | "decimal";
  previousValue?: number | null;
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
  comparisonPeriod?: string;
  breakdown?: { label: string; sessions: number; conversions?: number }[];
  links?: { label: string; href: string }[];
}

export function isMetricProvider(id: string): id is MetricProviderId {
  return METRIC_PROVIDER_IDS.some((value) => value === id);
}
