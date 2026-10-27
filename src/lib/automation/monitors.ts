import "server-only";
import { stopReadTasks } from "./tasks";
import { createHash } from "node:crypto";
import { readWorkspace } from "@/lib/store/workspace";
import { canonicalUrl } from "@/lib/search/quality";
import { ResearchInput, researchWeb } from "@/lib/search/research";
import { readResearchPage } from "@/lib/search/pages";
import { MonitorInput, type Monitor } from "./types";
import { readAutomation, recordOperation, updateAutomation } from "./store";

const runtime = globalThis as unknown as {
  __inroadMonitorTimer?: ReturnType<typeof setInterval>;
  __inroadMonitorRuns?: Map<string, { abort: AbortController; done: Promise<void> }>;
  __inroadAutomationEpoch?: number;
};
const runs = (runtime.__inroadMonitorRuns ??= new Map());
const fingerprint = (text: string) => createHash("sha256").update(text).digest("hex");

export async function saveMonitor(raw: unknown, id?: string) {
  const input = MonitorInput.parse(raw);
  if (input.kind === "page" && !canonicalUrl(input.query)) throw new Error("Enter a valid public page URL.");
  if (id && !input.enabled) runs.get(id)?.abort.abort();
  return (
    await updateAutomation((data) => {
      const existing = data.monitors.find((m) => m.id === id);
      if (id && !existing) throw new Error("This monitor no longer exists.");
      const changed =
        existing && (existing.kind !== input.kind || existing.query !== input.query || JSON.stringify(existing.keywords) !== JSON.stringify(input.keywords));
      if (changed) runs.get(existing.id)?.abort.abort();
      const row: Monitor = {
        ...(existing ?? {}),
        ...input,
        id: existing?.id ?? crypto.randomUUID(),
        createdAt: existing?.createdAt ?? new Date().toISOString(),
        nextRunAt: new Date().toISOString(),
        failures: 0,
        ...(changed
          ? { fingerprint: undefined, seen: undefined, leaseUntil: undefined, lastError: undefined, lastRunAt: undefined }
          : !input.enabled
            ? { leaseUntil: undefined }
            : {}),
      };
      data.monitors = [...data.monitors.filter((m) => m.id !== row.id), row];
      return row;
    })
  ).value;
}
export async function removeMonitor(id: string) {
  runs.get(id)?.abort.abort();
  await updateAutomation((data) => {
    data.monitors = data.monitors.filter((m) => m.id !== id);
    data.observations = data.observations.filter((o) => o.monitorId !== id);
  });
}

async function execute(monitor: Monitor, abort: AbortController, epoch: number) {
  const started = Date.now();
  try {
    let hash: string, urls: string[], summary: string;
    if (monitor.kind === "topic") {
      const result = await researchWeb(ResearchInput.parse({ query: monitor.query, fresh: true, limit: 20 }), abort.signal);
      if (result.warnings.some((warning) => !warning.startsWith("Some sources") && !warning.startsWith("No results")))
        throw new Error(result.warnings.join(" "));
      const matching = result.results.filter(
        (r) => !monitor.keywords.length || monitor.keywords.some((k) => `${r.title} ${r.description}`.toLowerCase().includes(k.toLowerCase())),
      );
      urls = matching
        .map((r) => canonicalUrl(r.url)!)
        .filter(Boolean)
        .sort();
      hash = fingerprint(urls.join("\n"));
      const unseen = matching.filter((r) => !(monitor.seen ?? []).includes(canonicalUrl(r.url)!));
      summary = unseen
        .slice(0, 5)
        .map((r) => r.title)
        .join(" · ");
      urls = unseen.map((r) => r.url);
      // Remember all seen URLs, so reordered or temporarily missing results don't notify twice.
      monitor.seen = [...new Set([...(monitor.seen ?? []), ...matching.map((r) => canonicalUrl(r.url)!)])].slice(-1000);
    } else {
      const page = await readResearchPage(monitor.query, { mode: "http", signal: abort.signal });
      const lines = page.text
        .split(/\n|(?<=[.!?])\s+/)
        .map((l) => l.replace(/\s+/g, " ").trim())
        .filter(Boolean);
      const selected = monitor.keywords.length ? lines.filter((line) => monitor.keywords.some((k) => line.toLowerCase().includes(k.toLowerCase()))) : lines;
      hash = fingerprint(selected.join("\n"));
      urls = [page.url];
      summary = selected.slice(0, 3).join(" ").slice(0, 600) || "The watched terms are no longer present on this page.";
    }
    abort.signal.throwIfAborted();
    if ((runtime.__inroadAutomationEpoch ?? 0) !== epoch) return;
    await updateAutomation((data) => {
      const current = data.monitors.find((m) => m.id === monitor.id);
      if (!current || !current.enabled || current.query !== monitor.query || current.leaseUntil !== monitor.leaseUntil) return;
      const changed = !!current.fingerprint && current.fingerprint !== hash && (monitor.kind === "page" || urls.length > 0);
      if (changed) {
        const at = new Date().toISOString();
        current.lastChangedAt = at;
        data.observations.unshift({ id: crypto.randomUUID(), monitorId: monitor.id, at, title: monitor.name, summary, urls: urls.slice(0, 10), read: false });
        data.observations = data.observations.slice(0, 200);
      }
      current.fingerprint = hash;
      current.seen = monitor.seen;
      current.lastRunAt = new Date().toISOString();
      current.lastError = undefined;
      current.failures = 0;
      current.leaseUntil = undefined;
      // Catch up once after sleep/restart, then resume the cadence; never replay every missed check.
      const interval = current.intervalMinutes * 60_000;
      const due = Date.parse(current.nextRunAt);
      current.nextRunAt = new Date(due + Math.max(1, Math.floor((Date.now() - due) / interval) + 1) * interval).toISOString();
    });
    await recordOperation({
      kind: "monitor",
      provider: "Monitor",
      query: monitor.name,
      durationMs: Date.now() - started,
      resultCount: urls.length,
      cached: false,
      costUsd: 0,
    });
  } catch (cause) {
    if ((runtime.__inroadAutomationEpoch ?? 0) !== epoch || abort.signal.aborted) return;
    const error = cause instanceof Error ? cause.message : "The monitor check failed.";
    await updateAutomation((data) => {
      const current = data.monitors.find((m) => m.id === monitor.id);
      if (!current || current.leaseUntil !== monitor.leaseUntil) return;
      current.lastError = error;
      current.lastRunAt = new Date().toISOString();
      current.failures++;
      current.leaseUntil = undefined;
      current.nextRunAt = new Date(Date.now() + Math.min(360, 5 * 2 ** Math.min(current.failures, 6)) * 60_000).toISOString();
    });
  }
}

export async function pollMonitors(options: { forceId?: string; now?: number } = {}) {
  if (readWorkspace().sample) return { checked: 0 };
  const now = options.now ?? Date.now();
  if (!readAutomation().monitors.some((m) => m.enabled && (options.forceId ? m.id === options.forceId : Date.parse(m.nextRunAt) <= now))) return { checked: 0 };
  const claimed = (
    await updateAutomation((data) => {
      const due = data.monitors
        .filter(
          (m) =>
            m.enabled &&
            !runs.has(m.id) &&
            (!m.leaseUntil || Date.parse(m.leaseUntil) <= now) &&
            (options.forceId ? m.id === options.forceId : Date.parse(m.nextRunAt) <= now),
        )
        .slice(0, 3);
      for (const monitor of due) monitor.leaseUntil = new Date(now + 5 * 60_000).toISOString();
      return structuredClone(due);
    })
  ).value;
  const epoch = runtime.__inroadAutomationEpoch ?? 0;
  for (const monitor of claimed) {
    const abort = new AbortController();
    const done = execute(monitor, abort, epoch).finally(() => runs.delete(monitor.id));
    runs.set(monitor.id, { abort, done });
  }
  await Promise.all(claimed.map((m) => runs.get(m.id)?.done));
  return { checked: claimed.length };
}
export function startMonitorScheduler() {
  if (runtime.__inroadMonitorTimer || process.env.NODE_ENV === "test") return;
  const tick = () => {
    void pollMonitors().catch(() => undefined);
  };
  const first = setTimeout(tick, 5000);
  first.unref?.();
  runtime.__inroadMonitorTimer = setInterval(tick, 60_000);
  runtime.__inroadMonitorTimer.unref?.();
}
export async function stopAutomationRuns() {
  runtime.__inroadAutomationEpoch = (runtime.__inroadAutomationEpoch ?? 0) + 1;
  for (const run of runs.values()) run.abort.abort();
  await stopReadTasks();
  await Promise.allSettled([...runs.values()].map((r) => r.done));
}
export const monitorStatus = () => ({ monitors: readAutomation().monitors, observations: readAutomation().observations });
