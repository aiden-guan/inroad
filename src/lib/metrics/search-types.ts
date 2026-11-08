export const SEARCH_PROVIDER_IDS = ["google-search-console", "bing-webmaster", "posthog-search"] as const;
export type SearchProviderId = (typeof SEARCH_PROVIDER_IDS)[number];

export interface SearchMetric {
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
export interface SearchSnapshot {
  provider: SearchProviderId;
  syncedAt: string;
  windowStart: string;
  windowEnd: string;
  accountLabel: string;
  environment: "live" | "test";
  metrics: SearchMetric[];
  notes: string[];
  comparisonPeriod?: string;
  breakdown?: { label: string; sessions: number; conversions?: number }[];
  links?: { label: string; href: string }[];
}

export function isSearchProvider(id: string): id is SearchProviderId {
  return SEARCH_PROVIDER_IDS.some((value) => value === id);
}
