import "server-only";
import { runAgent, type RunResult } from "@/lib/ai/engine";
import { targetProvider } from "@/lib/ai/routing";
import { AgentError } from "@/lib/ai/errors";
import type { AgentEvent } from "@/lib/ai/events";
import { addUsage, emptyUsage, type ModelTier, type Usage } from "@/lib/ai/models";
import { monthKey, newId, nowISO } from "@/lib/domain/ids";
import type { ModelTierName, RunReceipt, RunStep, RunSummary, WorkflowId } from "@/lib/domain/types";
import { FileDB, singletonDB } from "@/lib/store/file-db";
import { mutateWorkspace, readWorkspace } from "@/lib/store/workspace";
import type { WorkflowContext, WorkflowDef } from "@/lib/workflows/types";
import { runClaudePlan } from "@/lib/studio/claude-plan";

function usesClaudePlan(workflow: WorkflowId, args: unknown): boolean {
  return (workflow === "studio" || workflow === "visual") && !!args && typeof args === "object" && (args as { agentProvider?: string }).agentProvider === "claude_plan";
}

/**
 * Runs outlive the HTTP request that started them. The registry keeps each live run's event
 * buffer in memory so any tab can attach (and re-attach after a reload) and replay the log.
 * Finished runs persist a summary + receipt in the workspace and their step log in runs.json.
 */

interface LiveRun {
  summary: RunSummary;
  /** Which work this is (runKey): starting the same work while this runs returns this run. */
  key: string;
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

/**
 * What a run may cost before it ends, held against the budget while it runs (its real cost is only
 * booked at the end): the top of each workflow's range in SPEC's route table.
 */
const RESERVE_USD: Partial<Record<WorkflowDef<unknown>["id"], number>> = {
  foundation: 0.9,
  brief: 0.15,
  discovery: 2,
  dossier: 0.8,
  compose: 0.15,
  prep: 0.4,
  debrief: 0.25,
  review: 0.4,
  network: 0.4,
  ask: 0.5,
  dinner_plan: 0.8,
  // At most 60 posts through the fast model (about $0.003); the radar uses none.
  intent: 0.05,
};
const RESERVE_DEFAULT_USD = 0.3;

/** Reservations of the runs in flight, by run id. */
const reserved = (() => {
  const g = globalThis as unknown as { __inroadReserved?: Map<string, number> };
  g.__inroadReserved ??= new Map();
  return g.__inroadReserved;
})();

/** This month's spend plus what the runs in flight may still cost. */
export function committedSpend(): number {
  return monthSpend() + [...reserved.values()].reduce((n, v) => n + v, 0);
}

/**
 * The work a run does: its workflow plus the workflow's own key (dossier: the company, foundation: the bet), or else
 * its exact arguments (object keys sorted, so the same request always gives the same key).
 */
function runKey<A>(def: WorkflowDef<A>, args: A): string {
  if (def.key) return `${def.id}:${def.key(args)}`;
  const sorted = (_: string, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : v;
  return `${def.id}:${JSON.stringify(args ?? null, sorted)}`;
}

/** The run in flight doing this work. A stopped one is winding down, so it doesn't count: starting again is new work. */
function inFlight(key: string): LiveRun | undefined {
  for (const live of state.live.values()) if (live.key === key && !live.done && !live.abort.signal.aborted) return live;
  return undefined;
}

export interface StartOptions {
  route?: import("@/lib/ai/routing-types").ModelTarget;
  /**
   * Started by Inroad itself (Today's brief, briefs and drafts prepared ahead, a network screen), not by the
   * founder: it only starts when its whole reservation fits under the budget, so a burst of them can't
   * run past it before any has booked its cost.
   */
  automatic?: boolean;
}

export async function startRun<A>(def: WorkflowDef<A>, rawArgs: unknown, opts: StartOptions = {}): Promise<RunSummary> {
  const args = def.args.parse(rawArgs);
  // A second start of work already running (a double click, Enter twice, another tab) joins it: one run, one bill.
  // Checked before any await, and a new run registers before its first await, so two requests can't both start.
  const key = runKey(def, args);
  const running = inFlight(key);
  if (running) return { ...running.summary };
  const claudePlan = usesClaudePlan(def.id, args);
  if (opts.route && !claudePlan) targetProvider(opts.route);
  const ws = readWorkspace();
  const budget = ws.caps.monthlyBudgetUsd;
  const imageArgs = args as { mode?: string; imageProvider?: string; generate?: boolean };
  const subscriptionImage = def.id === "visual" && imageArgs.mode === "image" && imageArgs.imageProvider === "chatgpt";
  const subscriptionStudio = claudePlan && !(def.id === "visual" && imageArgs.generate && imageArgs.imageProvider !== "chatgpt");
  const hold = subscriptionImage || subscriptionStudio ? 0 : RESERVE_USD[def.id] ?? RESERVE_DEFAULT_USD;
  if (hold > 0 && budget > 0 && (committedSpend() >= budget || (opts.automatic && committedSpend() + hold > budget))) {
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
  const live: LiveRun = { summary, key, events: [], listeners: new Set(), done: false, abort: new AbortController() };
  state.live.set(summary.id, live);
  if (budget > 0) reserved.set(summary.id, hold);
  try {
    await saveSummary(summary);
  } catch (err) {
    // It never started: hold no budget and block no later start of the same work.
    state.live.delete(summary.id);
    reserved.delete(summary.id);
    throw err;
  }

  void execute(def, args, live, opts.route).catch((err) => console.error(`[run ${summary.id}] ${def.id} didn't end cleanly:`, err));
  return summary;
}

async function execute<A>(def: WorkflowDef<A>, args: A, live: LiveRun, route?: import("@/lib/ai/routing-types").ModelTarget) {
  const claudePlan = usesClaudePlan(def.id, args);
  const started = Date.now();
  const steps: RunStep[] = [];
  let usage: Usage = emptyUsage();
  let costUsd = 0;
  let topTier: ModelTierName = "none";
  // On providers other than Anthropic: the model behind topTier, and whether any run lacked a price.
  let topModelName: string | undefined;
  let unpriced = false;
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
    noteExternalSearch: (count = 1) => { usage.webSearches += count; },
    noteFreeSignals: (count = 1) => {
      void mutateWorkspace((ws) => {
        const key = monthKey();
        ws.usage[key] ??= { costUsd: 0, runs: 0, byWorkflow: {}, freeSignals: 0 };
        ws.usage[key].freeSignals += count;
      }).catch((err) => console.warn(`[run ${live.summary.id}] couldn't count its free lookups:`, err instanceof Error ? err.message : err));
    },
    agent: async <T>(opts: Parameters<WorkflowContext<A>["agent"]>[0]): Promise<RunResult<T>> => {
      const tier: ModelTier = opts.tier ?? "operator";
      if (TIER_RANK[tier] > TIER_RANK[topTier]) topTier = tier;
      let result: RunResult<T>;
      try {
        result = claudePlan
          ? await runClaudePlan<T>({ ...opts, task: def.id, emit, signal: live.abort.signal })
          : await runAgent<T>({ ...opts, task: def.id, route: route ?? opts.route, emit, signal: live.abort.signal });
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
      if (result.modelName && tier === topTier) topModelName = result.modelName;
      if (result.unpriced) unpriced = true;
      return result;
    },
  };

  let slot = false;
  let result: unknown = null;
  let error: { code: string; message: string; requestId?: string; detail?: string } | undefined;
  try {
    if (def.heavy) {
      slot = await acquireHeavySlot(live.abort.signal);
      if (slot && live.summary.status === "queued") {
        live.summary.status = "running";
        // Only the sidebar's label: the run goes on if this can't be saved, and its end saves the summary again.
        await saveSummary({ ...live.summary }).catch((err) => console.warn(`[run ${live.summary.id}] couldn't save that it started:`, err instanceof Error ? err.message : err));
      }
    }
    emit({ type: "status", text: "Starting" });
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

  // The bookkeeping is best-effort (a save can fail: disk full, permissions, a corrupt file), and whatever happens in
  // it, the run ends: finish() always sends its last events, so no client is left waiting on it.
  try {
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
      ...(def.id === "visual" && (args as { mode?: string }).mode === "image" ? { modelName: "ChatGPT plan" } : topModelName ? { modelName: topModelName } : {}),
      ...(unpriced ? { unpriced } : {}),
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
    })
      .catch((err) => console.error(`[run ${live.summary.id}] couldn't book its cost ($${costUsd.toFixed(4)}):`, err))
      .finally(() => reserved.delete(live.summary.id));
    await saveSummary(live.summary).catch((err) => console.error(`[run ${live.summary.id}] couldn't save how it ended:`, err));
    // One of the first three finished its research: Today re-prepares before anyone hears it ended, so the draft it
    // unlocks is already running when the page refreshes, wherever the founder is (moves/prepare).
    if (def.id === "dossier") {
      await import("@/lib/moves/prepare")
        .then((m) => m.prepareAfterRun(live.summary))
        .catch((err) => console.warn("[today] not prepared after research:", err instanceof Error ? err.message : err));
    }
    await stepsDB()
      .update((all) => {
        all[live.summary.id] = steps.slice(-300);
        const ids = Object.keys(all);
        for (const old of ids.slice(0, Math.max(0, ids.length - 150))) delete all[old];
      })
      .catch((err) => console.error(`[run ${live.summary.id}] couldn't save its steps:`, err));
  } finally {
    finish(live, { error, result, costUsd, model: topTier === "none" ? "fast" : topTier });
  }
}

/** A run's last events: how it ended, what it cost, and `done`. Sent even when the bookkeeping before them failed. */
function finish(live: LiveRun, end: { error?: { code: string; message: string }; result: unknown; costUsd: number; model: ModelTier }) {
  if (live.done) return;
  let error = end.error;
  if (live.summary.status === "running" || live.summary.status === "queued") {
    // Broke off before it recorded how it ended: never left showing as running.
    error ??= { code: "unknown", message: "Something went wrong." };
    live.summary = { ...live.summary, status: "error", endedAt: nowISO(), error };
  }
  reserved.delete(live.summary.id);
  const tell = (event: AgentEvent) => {
    live.events.push(event);
    for (const l of live.listeners) {
      try {
        l(event);
      } catch (err) {
        console.warn(`[run ${live.summary.id}] a listener failed:`, err instanceof Error ? err.message : err);
      }
    }
  };
  // The client maps code "stopped" to status "stopped" (and shows no toast for it).
  if (live.summary.status === "stopped") tell({ type: "error", code: "stopped", message: "Stopped." });
  else if (error) tell({ type: "error", ...error });
  else tell({ type: "result", data: end.result ?? null });
  tell({ type: "usage", costUsd: end.costUsd, model: end.model });
  tell({ type: "done" });
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
