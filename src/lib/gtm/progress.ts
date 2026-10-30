import type { GtmInitiative, MetricPoint, MetricReading } from "./types";

export interface InitiativeProgress {
  current?: MetricPoint;
  delta?: number;
  percent?: number;
  targetMet: boolean;
  overdue: boolean;
  problem?: string;
}

export function initiativeProgress(item: GtmInitiative, readings: MetricReading[], today: string): InitiativeProgress {
  const frozen = item.status === "done" ? item.outcomes.at(-1) : undefined;
  const measurement = frozen?.measurement ?? item.measurement;
  const reading = measurement && !frozen ? readings.find((r) => r.id === measurement.metric.id) : undefined;
  const current = frozen ? frozen.current : reading ? { at: reading.at, value: reading.value, n: reading.n } : undefined;
  let problem = frozen ? frozen.problem : reading?.problem;
  if (measurement && !current) problem ??= "The source or metric settings changed. Choose the current metric to start a new baseline.";
  if (measurement && current && current.at < measurement.baseline.at) problem = "Source data is older than the saved baseline.";
  const result: InitiativeProgress = { current, problem, targetMet: false, overdue: item.status === "active" && item.dueOn < today };
  if (!measurement || !current) return result;
  result.delta = current.value - measurement.baseline.value;
  if (measurement.target !== undefined) {
    const increase = measurement.direction === "increase";
    result.targetMet = !problem && (increase ? current.value >= measurement.target : current.value <= measurement.target);
    const distance = increase ? measurement.target - measurement.baseline.value : measurement.baseline.value - measurement.target;
    const moved = increase ? result.delta : -result.delta;
    result.percent = problem ? undefined : distance > 0 ? Math.max(0, Math.min(100, 100 * moved / distance)) : result.targetMet ? 100 : 0;
  }
  return result;
}
