import "server-only";
import type { ColumnJob } from "./types";

/**
 * Column runs in flight, in memory: which companies each one covers and which it's researching this moment,
 * so the table can show a running state per cell and progress per column. Pinned to globalThis because route
 * handlers can be bundled separately in dev.
 */

const jobs = (() => {
  const g = globalThis as unknown as { __inroadColumnJobs?: Map<string, ColumnJob> };
  g.__inroadColumnJobs ??= new Map();
  return g.__inroadColumnJobs;
})();

export function startJob(job: Omit<ColumnJob, "active" | "done">): void {
  jobs.set(job.runId, { ...job, active: [], done: 0 });
}

/** Researching `domain` now. */
export function markActive(runId: string, domain: string) {
  const job = jobs.get(runId);
  if (job && !job.active.includes(domain)) job.active = [...job.active, domain];
}

/** Finished with `domain`, answered, skipped or failed. */
export function markDone(runId: string, domain: string) {
  const job = jobs.get(runId);
  if (!job) return;
  job.active = job.active.filter((d) => d !== domain);
  job.done++;
}

export function endJob(runId: string) {
  jobs.delete(runId);
}

export function liveJobs(): ColumnJob[] {
  return [...jobs.values()].map((j) => ({ ...j, domains: [...j.domains], active: [...j.active] }));
}
