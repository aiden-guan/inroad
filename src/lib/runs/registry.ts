import "server-only";
import { runAgent, type RunResult } from "@/lib/ai/engine";
import { AgentError } from "@/lib/ai/errors";
import type { AgentEvent } from "@/lib/ai/events";
import { addUsage, emptyUsage, type ModelTier, type Usage } from "@/lib/ai/models";
import { monthKey, newId, nowISO } from "@/lib/domain/ids";
import type { ModelTierName, RunReceipt, RunStep, RunSummary, WorkflowId } from "@/lib/domain/types";
import { FileDB, singletonDB } from "@/lib/store/file-db";
import { mutateWorkspace, readWorkspace } from "@/lib/store/workspace";
import type { WorkflowContext, WorkflowDef } from "@/lib/workflows/types";

/**
 * Runs outlive the HTTP request that started them. The registry keeps each live run's event
 * buffer in memory so any tab can attach (and re-attach after a reload) and replay the log.
 * Finished runs persist a summary + receipt in the workspace and their step log in runs.json.
 */

interface LiveRun {
  summary: RunSummary;
  events: AgentEvent[];
  listeners: Set<(event: AgentEvent) => void>;
  done: boolean;
  abort: AbortController;
}

const MAX_HEAVY = 3;
const TIER_RANK: Record<ModelTierName, number> = { none: 0, fast: 1, operator: 2, strategist: 3 };

const state = (() => {
  const g = globalThis as unknown as { __inroadRuns?: { live: Map<string, LiveRun>; heavyRunning: number; queue: (() => void)[] } };
  g.__inroadRuns ??= { live: new Map(), heavyRunning: 0, queue: [] };
  return g.__inroadRuns;
})();

const stepsDB = () =>
  singletonDB<Record<string, RunStep[]>>("runs.json", () => new FileDB<Record<string, RunStep[]>>("runs.json", () => ({})));

/** The step log is a nicety: if runs.json can't be read, show no steps rather than fail the run. */
function storedSteps(runId: string): RunStep[] {
  try {
    return stepsDB().read()[runId] ?? [];
  } catch {
    return [];
  }
}

function toStep(event: AgentEvent): RunStep | null {
  const at = nowISO();
  switch (event.type) {
    case "status":
    case "thinking":
    case "action":
      return { at, type: event.type, text: event.text };
    case "search":
      return { at, type: "search", text: event.query };
    case "read":
      return { at, type: "read", text: event.host, url: event.url, host: event.host };
    case "sources":
      return { at, type: "sources", text: event.sources.map((s) => s.host).join(", ") };
    case "error":
      return { at, type: "error", text: event.message };
    default:
      return null;
  }
}

async function saveSummary(summary: RunSummary) {
  await mutateWorkspace((ws) => {
    const i = ws.runs.findIndex((r) => r.id === summary.id);
    if (i === -1) ws.runs.unshift(summary);
    else ws.runs[i] = { ...ws.runs[i], ...summary };
    ws.runs = ws.runs.slice(0, 200);
  });
}

/** Resolves true once a slot is taken, or false if the run is stopped while it waits. */
function acquireHeavySlot(signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);
  if (state.heavyRunning < MAX_HEAVY) {
    state.heavyRunning++;
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const grant = () => {
      signal.removeEventListener("abort", cancel);
      state.heavyRunning++;
      resolve(true);
    };
    const cancel = () => {
      const i = state.queue.indexOf(grant);
      if (i !== -1) state.queue.splice(i, 1);
      resolve(false);
    };
    state.queue.push(grant);
    signal.addEventListener("abort", cancel, { once: true });
  });
}

function releaseHeavySlot() {
  state.heavyRunning = Math.max(0, state.heavyRunning - 1);
  state.queue.shift()?.();
}

export function monthSpend(): number {
  return readWorkspace().usage[monthKey()]?.costUsd ?? 0;
}

export async function startRun<A>(def: WorkflowDef<A>, rawArgs: unknown): Promise<RunSummary> {
  const args = def.args.parse(rawArgs);
  const ws = readWorkspace();
  const budget = ws.caps.monthlyBudgetUsd;
  if (budget > 0 && monthSpend() >= budget) {
    throw new AgentError(`This month's AI budget ($${budget}) is used up. Raise it in Settings → Usage to keep going.`, "rate_limit");
  }

  const summary: RunSummary = {
    id: newId("run"),
    workflow: def.id,
    title: def.title(args, ws),
    ref: def.ref?.(args),
    startedAt: nowISO(),
    status: def.heavy && state.heavyRunning >= MAX_HEAVY ? "queued" : "running",
  };
  const live: LiveRun = { summary, events: [], listeners: new Set(), done: false, abort: new AbortController() };
  state.live.set(summary.id, live);
  await saveSummary(summary);

  void execute(def, args, live);
  return summary;
}

async function execute<A>(def: WorkflowDef<A>, args: A, live: LiveRun) {
  const started = Date.now();
  const steps: RunStep[] = [];
  let usage: Usage = emptyUsage();
  let costUsd = 0;
  let topTier: ModelTierName = "none";
  let sources = 0;
  let drafts = 0;
  let compat: RunReceipt["compat"];
  const noteCompat = (c: RunReceipt["compat"]) => {
    if (!c) return;
    compat = { features: [...new Set([...(compat?.features ?? []), ...c.features])], reason: compat?.reason || c.reason };
  };

  const emit = (event: AgentEvent) => {
    if (live.done) return;
    if (event.type === "sources") sources += event.sources.length;
    if (event.type === "usage") return; // aggregated into the receipt instead
    live.events.push(event);
    const step = toStep(event);
    if (step) steps.push(step);
    for (const listener of live.listeners) listener(event);
  };

  const ctx: WorkflowContext<A> = {
    runId: live.summary.id,
    args,
    emit,
    signal: live.abort.signal,
    read: readWorkspace,
    mutate: async (fn) => (await mutateWorkspace(fn)).value,
    noteFreeSignals: (count = 1) => {
      void mutateWorkspace((ws) => {
        const key = monthKey();
        ws.usage[key] ??= { costUsd: 0, runs: 0, byWorkflow: {}, freeSignals: 0 };
        ws.usage[key].freeSignals += count;
      });
    },
    agent: async <T>(opts: Parameters<WorkflowContext<A>["agent"]>[0]): Promise<RunResult<T>> => {
      const tier: ModelTier = opts.tier ?? "operator";
      if (TIER_RANK[tier] > TIER_RANK[topTier]) topTier = tier;
      let result: RunResult<T>;
      try {
        result = await runAgent<T>({ ...opts, emit, signal: live.abort.signal });
      } catch (err) {
        // Turns billed before a failure, Stop or truncation still count toward the receipt and budget.
        if (err instanceof AgentError && err.usage) {
          usage = addUsage(usage, err.usage);
          costUsd += err.costUsd ?? 0;
        }
        if (err instanceof AgentError) noteCompat(err.compat);
        throw err;
      }
      usage = addUsage(usage, result.usage);
      costUsd += result.costUsd;
      noteCompat(result.compat);
      return result;
    },
  };

  let slot = false;
  if (def.heavy) {
    slot = await acquireHeavySlot(live.abort.signal);
    if (slot && live.summary.status === "queued") {
      live.summary.status = "running";
      await saveSummary({ ...live.summary });
    }
  }

  emit({ type: "status", text: "Starting" });
  let result: unknown = null;
  let error: { code: string; message: string; requestId?: string; detail?: string } | undefined;
  try {
    // Stopped while queued: end now instead of running against a slot it never got.
    if (live.abort.signal.aborted) throw new AgentError("Stopped.", "stopped");
    result = await def.run(ctx);
    if (result && typeof result === "object" && "drafts" in result && typeof (result as { drafts: unknown }).drafts === "number") {
      drafts = (result as { drafts: number }).drafts;
    }
  } catch (err) {
    const code = err instanceof AgentError ? err.code : "unknown";
    const message = err instanceof Error ? err.message : "Something went wrong.";
    if (!(err instanceof AgentError)) console.error(`[run ${live.summary.id}] ${def.id} failed:`, err);
    error = { code, message };
    if (err instanceof AgentError && err.requestId) error.requestId = err.requestId;
    if (err instanceof AgentError && err.detail) error.detail = err.detail;
  } finally {
    if (slot) releaseHeavySlot();
  }

  const receipt: RunReceipt = {
    durationMs: Date.now() - started,
    sources,
    searches: usage.webSearches,
    fetches: steps.filter((s) => s.type === "read").length,
    drafts,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    costUsd,
    model: topTier,
    ...(compat ? { compat } : {}),
  };

  const stopped = live.abort.signal.aborted;
  live.summary = {
    ...live.summary,
    status: error ? (stopped ? "stopped" : "error") : "done",
    endedAt: nowISO(),
    receipt,
    error: stopped ? undefined : error,
  };

  await mutateWorkspace((ws) => {
    const key = monthKey();
    ws.usage[key] ??= { costUsd: 0, runs: 0, byWorkflow: {}, freeSignals: 0 };
    ws.usage[key].costUsd += costUsd;
    ws.usage[key].runs += 1;
    ws.usage[key].byWorkflow[def.id] = (ws.usage[key].byWorkflow[def.id] ?? 0) + costUsd;
  });
  await saveSummary(live.summary);
  await stepsDB()
    .update((all) => {
      all[live.summary.id] = steps.slice(-300);
      const ids = Object.keys(all);
      for (const old of ids.slice(0, Math.max(0, ids.length - 150))) delete all[old];
    })
    .catch((err) => console.error(`[run ${live.summary.id}] couldn't save its steps:`, err));

  if (error) {
    // The client maps code "stopped" to status "stopped" (and shows no toast for it).
    const errEvent: AgentEvent = stopped ? { type: "error", code: "stopped", message: "Stopped." } : { type: "error", ...error };
    live.events.push(errEvent);
    for (const l of live.listeners) l(errEvent);
  } else {
    const resEvent: AgentEvent = { type: "result", data: result ?? null };
    live.events.push(resEvent);
    for (const l of live.listeners) l(resEvent);
  }
  const usageEvent: AgentEvent = { type: "usage", costUsd, model: topTier === "none" ? "fast" : topTier };
  const doneEvent: AgentEvent = { type: "done" };
  live.events.push(usageEvent, doneEvent);
  for (const l of live.listeners) {
    l(usageEvent);
    l(doneEvent);
  }
  live.done = true;
  // Keep finished runs around briefly so late subscribers can replay, then free memory.
  setTimeout(() => state.live.delete(live.summary.id), 10 * 60_000);
}

/** Replays everything so far, then streams live events. Returns an unsubscribe function. */
export function subscribe(runId: string, listener: (event: AgentEvent) => void): () => void {
  const live = state.live.get(runId);
  if (!live) {
    const summary = readWorkspace().runs.find((r) => r.id === runId);
    if (summary && (summary.status === "running" || summary.status === "queued")) {
      // Not live but never finished: the server restarted mid-run. Persist that before telling the
      // client, so the refresh it does after `done` sees the error and doesn't re-attach.
      const error = { code: "interrupted", message: "This run was interrupted when Inroad restarted. Run it again." };
      let open = true;
      void saveSummary({ ...summary, status: "error", endedAt: nowISO(), error })
        .catch(() => undefined)
        .then(() => {
          if (!open) return;
          listener({ type: "error", message: error.message, code: error.code });
          listener({ type: "done" });
        });
      return () => {
        open = false;
      };
    }
    const steps = storedSteps(runId);
    for (const s of steps) {
      if (s.type === "search") listener({ type: "search", query: s.text });
      else if (s.type === "read" && s.url) listener({ type: "read", url: s.url, host: s.host ?? s.text });
      else if (s.type === "status" || s.type === "thinking" || s.type === "action") listener({ type: s.type, text: s.text });
    }
    if (summary?.error) listener({ type: "error", ...summary.error });
    else if (summary?.status === "stopped") listener({ type: "error", code: "stopped", message: "Stopped." });
    if (summary?.receipt) listener({ type: "usage", costUsd: summary.receipt.costUsd, model: summary.receipt.model === "none" ? "fast" : summary.receipt.model });
    listener({ type: "done" });
    return () => {};
  }
  for (const event of live.events) listener(event);
  if (live.done) return () => {};
  live.listeners.add(listener);
  return () => live.listeners.delete(listener);
}

export function stopRun(runId: string): boolean {
  const live = state.live.get(runId);
  if (!live || live.done) return false;
  live.abort.abort();
  return true;
}

export function runSteps(runId: string): RunStep[] {
  return storedSteps(runId);
}

export function liveRunIds(): string[] {
  return [...state.live.values()].filter((r) => !r.done).map((r) => r.summary.id);
}

export type { WorkflowId };
