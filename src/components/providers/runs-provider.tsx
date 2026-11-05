"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { toast } from "sonner";
import type { AgentEvent } from "@/lib/ai/events";
import { readAgentStream } from "@/lib/ai/read-stream";
import type { EntityRef, RunSummary, WorkflowId } from "@/lib/domain/types";
import { TERMINAL, createRunsStore, fromSummary, reduceRun, sameRun, type RunState, type Runs, type RunsStore } from "./run-state";
import { useWorkspace } from "./workspace-provider";

export type { LogStep, RunState } from "./run-state";

interface StartOptions {
  route?: import("@/lib/ai/routing-types").ModelTarget;
  /** Toast when finished (default true). A function is asked at the end, e.g. "unless that sheet is still open". */
  notify?: boolean | (() => boolean);
  /** Called once with the run's result. */
  onResult?: (result: unknown) => void;
  /** Called instead of the toast when the run doesn't start; `code` is the server's error code (e.g. rate_limit). */
  onError?: (error: { message: string; code?: string }) => void;
}

interface RunActions {
  start: (workflow: WorkflowId, args: unknown, opts?: StartOptions) => Promise<RunState | null>;
  stop: (runId: string) => Promise<void>;
  attach: (runId: string, title?: string) => void;
}

interface RunsContextValue extends RunActions {
  runs: Record<string, RunState>;
}

/* ─────────────────────────────── The provider ─────────────────────────────── */

const RunsContext = createContext<{ store: RunsStore; actions: RunActions } | null>(null);

export function RunsProvider({ children }: { children: ReactNode }) {
  const { ws, refresh } = useWorkspace();
  const [store] = useState(createRunsStore);
  const attached = useRef(new Set<string>());
  const options = useRef(new Map<string, StartOptions>());
  /** Initial state for runs we attach to without having started them (other tab, reload). */
  const seed = useRef(new Map<string, RunState>());
  const queue = useRef(new Map<string, AgentEvent[]>());
  const scheduled = useRef<{ frame?: number; timer?: ReturnType<typeof setTimeout> } | null>(null);

  /** Lands every queued event: one store update, one round of re-renders. */
  const flush = useCallback(() => {
    if (scheduled.current) {
      if (scheduled.current.frame !== undefined) cancelAnimationFrame(scheduled.current.frame);
      if (scheduled.current.timer !== undefined) clearTimeout(scheduled.current.timer);
      scheduled.current = null;
    }
    if (!queue.current.size) return;
    const next = { ...store.local() };
    for (const [id, events] of queue.current) {
      let state = next[id] ?? seed.current.get(id);
      if (!state) continue;
      for (const event of events) state = reduceRun(state, event);
      next[id] = state;
    }
    queue.current.clear();
    store.setLocal(next);
  }, [store]);

  const enqueue = useCallback(
    (runId: string, event: AgentEvent) => {
      const list = queue.current.get(runId);
      if (list) list.push(event);
      else queue.current.set(runId, [event]);
      if (TERMINAL.has(event.type)) return flush();
      if (scheduled.current) return;
      // A hidden tab gets no animation frames: land its events on a slow timer instead.
      scheduled.current = document.visibilityState === "visible" ? { frame: requestAnimationFrame(flush) } : { timer: setTimeout(flush, 250) };
    },
    [flush],
  );

  useEffect(
    () => () => {
      if (scheduled.current?.frame !== undefined) cancelAnimationFrame(scheduled.current.frame);
      if (scheduled.current?.timer !== undefined) clearTimeout(scheduled.current.timer);
    },
    [],
  );

  const attach = useCallback(
    (runId: string, title?: string) => {
      if (attached.current.has(runId)) return;
      attached.current.add(runId);
      void (async () => {
        let errorMessage: string | null = null;
        let succeeded = false;
        try {
          const res = await fetch(`/api/runs/${runId}/stream`, { cache: "no-store" });
          for await (const event of readAgentStream(res)) {
            enqueue(runId, event);
            if (event.type === "result") {
              succeeded = true;
              options.current.get(runId)?.onResult?.(event.data);
            }
            if (event.type === "error" && event.code !== "stopped") errorMessage = event.message;
            if (event.type === "done") break;
          }
        } catch {
          // Connection dropped; the run keeps going on the server. Re-attach on next refresh.
          flush();
          attached.current.delete(runId);
          return;
        }
        flush();
        await refresh();
        const notify = options.current.get(runId)?.notify;
        if (typeof notify === "function" ? notify() : notify !== false) {
          if (errorMessage) toast.error(errorMessage);
          else if (succeeded && title) toast(`Done · ${title}`);
        }
      })();
    },
    [enqueue, flush, refresh],
  );

  // Pick up runs that are still going (started in another tab, or before a reload).
  const liveSummaries = useMemo(() => (ws?.runs ?? []).filter((r) => r.status === "running" || r.status === "queued"), [ws]);
  useEffect(() => {
    const before = store.summaries();
    const next: Runs = {};
    for (const r of liveSummaries) {
      const state = fromSummary(r);
      next[r.id] = sameRun(before[r.id], state) ? before[r.id] : state;
    }
    store.setSummaries(next);
    for (const r of liveSummaries) {
      if (!seed.current.has(r.id)) seed.current.set(r.id, next[r.id]);
      attach(r.id, r.title);
    }
  }, [liveSummaries, attach, store]);

  const start = useCallback(
    async (workflow: WorkflowId, args: unknown, opts: StartOptions = {}) => {
      try {
        const res = await fetch("/api/runs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workflow, args, route: opts?.route }),
        });
        const body = await res.json();
        if (!res.ok) throw Object.assign(new Error(body?.error ?? "Couldn't start that."), { code: body?.code as string | undefined });
        const state = fromSummary(body.run as RunSummary);
        options.current.set(state.id, opts);
        store.setLocal({ ...store.local(), [state.id]: state });
        attach(state.id, state.title);
        return state;
      } catch (e) {
        const error = e instanceof Error ? { message: e.message, code: (e as Error & { code?: string }).code } : { message: "Couldn't start that." };
        if (opts.onError) opts.onError(error);
        else toast.error(error.message);
        return null;
      }
    },
    [attach, store],
  );

  const stop = useCallback(async (runId: string) => {
    await fetch(`/api/runs/${runId}/stop`, { method: "POST" });
  }, []);

  const value = useMemo(() => ({ store, actions: { start, stop, attach } }), [store, start, stop, attach]);
  return <RunsContext.Provider value={value}>{children}</RunsContext.Provider>;
}

/* ─────────────────────────────── Reading runs ─────────────────────────────── */

function useRunsContext() {
  const ctx = useContext(RunsContext);
  if (!ctx) throw new Error("useRuns must be used inside RunsProvider");
  return ctx;
}

/** Components that have read `useRuns().runs`: only they re-render when any run changes. */
const readers = new WeakSet<object>();

/**
 * Start, stop and attach to runs, and every run this tab knows (`runs`). Reading `runs` subscribes the component
 * to every run's changes; a component that only starts runs never re-renders for them.
 */
export function useRuns(): RunsContextValue {
  const { store, actions } = useRunsContext();
  const [reader] = useState(() => ({}));
  const subscribe = useCallback((onChange: () => void) => store.subscribe(() => readers.has(reader) && onChange()), [store, reader]);
  // Re-renders a reader when any run changes; `runs` itself is read fresh, so a handler never sees an old copy.
  useSyncExternalStore(subscribe, store.get, store.get);
  return useMemo(
    () => ({
      ...actions,
      get runs() {
        readers.add(reader);
        return store.get();
      },
    }),
    [actions, store, reader],
  );
}

/**
 * A value worked out from the runs, re-rendering only when it changes (`isEqual`, by default the same object).
 * The selector should be stable (useCallback) or cheap.
 */
export function useRunsSelector<T>(select: (runs: Runs) => T, isEqual: (a: T, b: T) => boolean = Object.is): T {
  const { store } = useRunsContext();
  const read = useMemo(() => memoSelect(store, select, isEqual), [store, select, isEqual]);
  return useSyncExternalStore(store.subscribe, read, read);
}

/**
 * The selection for the store's current runs, computed once per change and kept (the same object) while it's equal:
 * what useSyncExternalStore needs from a snapshot reader.
 */
function memoSelect<T>(store: RunsStore, select: (runs: Runs) => T, isEqual: (a: T, b: T) => boolean): () => T {
  let last: { runs: Runs; value: T } | null = null;
  return () => {
    const runs = store.get();
    if (last && last.runs === runs) return last.value;
    const value = select(runs);
    last = { runs, value: last && isEqual(last.value, value) ? last.value : value };
    return last.value;
  };
}

const sameList = (a: readonly RunState[], b: readonly RunState[]) => a.length === b.length && a.every((r, i) => r === b[i]);

/** The newest run for an entity (e.g. the dossier run for an account), live or recent. */
export function useRunFor(ref: EntityRef | undefined, workflow?: WorkflowId): RunState | undefined {
  const kind = ref?.kind;
  const id = ref?.id;
  const select = useCallback(
    (runs: Runs) => {
      if (!kind || !id) return undefined;
      let newest: RunState | undefined;
      for (const r of Object.values(runs)) {
        if (r.ref?.kind === kind && r.ref.id === id && (!workflow || r.workflow === workflow) && (!newest || r.startedAt > newest.startedAt)) newest = r;
      }
      return newest;
    },
    [kind, id, workflow],
  );
  return useRunsSelector(select);
}

const selectActive = (runs: Runs) =>
  Object.values(runs)
    .filter((r) => r.status === "running" || r.status === "queued")
    .sort((a, b) => b.startedAt - a.startedAt);

/** Runs in progress, newest first. Re-renders when one of them changes, not when a finished run does. */
export function useActiveRuns(): RunState[] {
  return useRunsSelector(selectActive, sameList);
}
