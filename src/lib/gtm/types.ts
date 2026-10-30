import type { Market } from "@/lib/domain/types";
import type { MetricProviderId } from "@/lib/metrics/types";

export type GtmMetricProvider = MetricProviderId | "waitlist" | "pipeline";
export interface MetricPoint { at: string; value: number; n?: number }
export interface MetricDescriptor {
  id: string;
  provider: GtmMetricProvider;
  key: string;
  label: string;
  sourceLabel: string;
  period: string;
  definition: string;
  currency?: string;
  unit?: "percent";
  test?: boolean;
  href: string;
}
export interface MetricSeries extends MetricDescriptor { points: MetricPoint[] }
export interface MetricReading extends MetricDescriptor, MetricPoint { problem?: string }

export interface InitiativeMeasurement {
  metric: MetricDescriptor;
  baseline: MetricPoint;
  target?: number;
  direction: "increase" | "decrease";
}
export interface InitiativeOutcome {
  at: string;
  measurement?: InitiativeMeasurement;
  current?: MetricPoint;
  problem?: string;
  note?: string;
}
export interface GtmInitiative {
  id: string;
  market: Market;
  title: string;
  owner: string;
  dueOn: string;
  status: "active" | "done" | "parked";
  measurement?: InitiativeMeasurement;
  /** Prior goals and baselines survive edits; results aren't rewritten after completion. */
  revisions: { at: string; measurement: InitiativeMeasurement }[];
  outcomes: InitiativeOutcome[];
  note?: string;
  createdAt: string;
  updatedAt: string;
  creationSignature?: string;
}
