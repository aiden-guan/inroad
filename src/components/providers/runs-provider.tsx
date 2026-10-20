"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import type { AgentEvent, Source } from "@/lib/ai/events";
import { readAgentStream } from "@/lib/ai/read-stream";
import type { EntityRef, RunSummary, WorkflowId } from "@/lib/domain/types";
import { useWorkspace } from "./workspace-provider";

/** One line in a work log. Present tense while active, past tense once the next step starts. */
export interface LogStep {
  id: number;
  kind: "status" | "search" | "read" | "action" | "writing";
  text: string;
  url?: string;
  host?: string;
  at: number;
  doneAt?: number;
}

export interface RunState {
  id: string;
  workflow: WorkflowId;
  title: string;
  ref?: EntityRef;
  status: RunSummary["status"];
  startedAt: number;
  endedAt?: number;
  steps: LogStep[];
  thinking?: string;
  sources: Source[];
  writingChars: number;
  text: string;
  result?: unknown;
  error?: { message: string; code?: string };
  costUsd?: number;
}

interface StartOptions {
  /** Toast when finished (default true). */
  notify?: boolean;
  /** Called once with the run's result. */
  onResult?: (result: unknown) => void;
  /** Called instead of the toast when the run doesn't start; `code` is the server's error code (e.g. rate_limit). */
  onError?: (error: { message: string; code?: string }) => void;
}

interface RunsContextValue {
  runs: Record<string, RunState>;
  start: (workflow: WorkflowId, args: unknown, opts?: StartOptions) => Promise<RunState | null>;
  stop: (runId: string) => Promise<void>;
  attach: (runId: string, title?: string) => void;
}

const RunsContext = createContext<RunsContextValue | null>(null);

function reduce(state: RunState, event: AgentEvent): RunState {
  const now = Date.now();
  const closeLast = (steps: LogStep[]) => steps.map((s, i) => (i === steps.length - 1 && !s.doneAt ? { ...s, doneAt: now } : s));
  const push = (step: Omit<LogStep, "id" | "at">): RunState => {
    const steps = closeLast(state.steps);
    // Collapse repeated identical statuses ("Filtering results" ×3).
    const last = steps[steps.length - 1];
    if (last && last.kind === step.kind && last.text === step.text) return state;
    return { ...state, steps: [...steps, { ...step, id: steps.length, at: now }] };
  };
  switch (event.type) {
    case "status":
      return push({ kind: "status", text: event.text });
    case "search":
      return push({ kind: "search", text: event.query });
    case "read":
      return push({ kind: "read", text: event.host, url: event.url, host: event.host });
    case "action":
      return push({ kind: "action", text: event.text });
    case "thinking":
      return { ...state, thinking: event.text };
    case "sources": {
      const seen = new Set(state.sources.map((s) => s.url));
      return { ...state, sources: [...state.sources, ...event.sources.filter((s) => !seen.has(s.url))] };
    }
    case "writing":
      return { ...state, writingChars: event.chars };
    case "text":
      return { ...state, text: state.text + event.text };
    case "text_reset":
      return { ...state, text: event.text };
    case "usage":
      return { ...state, costUsd: event.costUsd };
    case "result":
      return { ...state, result: event.data, status: "done" };
    case "error":
      return { ...state, error: { message: event.message, code: event.code }, status: event.code === "stopped" ? "stopped" : "error" };
    case "done":
      return {
        ...state,
        steps: closeLast(state.steps),
        status: state.status === "running" || state.status === "queued" ? (state.error ? "error" : "done") : state.status,
        endedAt: state.endedAt ?? now,
        thinking: undefined,
      };
  }
}

function fromSummary(s: RunSummary): RunState {
  return {
    id: s.id,
    workflow: s.workflow,
    title: s.title,
    ref: s.ref,
    status: s.status,
    startedAt: new Date(s.startedAt).getTime(),
    endedAt: s.endedAt ? new Date(s.endedAt).getTime() : undefined,
    steps: [],
    sources: [],
    writingChars: 0,
    text: "",
    error: s.error,
    costUsd: s.receipt?.costUsd,
  };
}

export function RunsProvider({ children }: { children: ReactNode }) {
  const { ws, refresh } = useWorkspace();
  const [runs, setRuns] = useState<Record<string, RunState>>({});
  const attached = useRef(new Set<string>());
  const options = useRef(new Map<string, StartOptions>());
  /** Initial state for runs we attach to without having started them (other tab, reload). */
  const seed = useRef(new Map<string, RunState>());

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
            setRuns((all) => {
              const base = all[runId] ?? seed.current.get(runId);
              return base ? { ...all, [runId]: reduce(base, event) } : all;
            });
            if (event.type === "result") {
              succeeded = true;
              options.current.get(runId)?.onResult?.(event.data);
            }
            if (event.type === "error" && event.code !== "stopped") errorMessage = event.message;
            if (event.type === "done") break;
          }
        } catch {
          // Connection dropped; the run keeps going on the server. Re-attach on next refresh.
          attached.current.delete(runId);
          return;
        }
        await refresh();
        if (options.current.get(runId)?.notify !== false) {
          if (errorMessage) toast.error(errorMessage);
          else if (succeeded && title) toast(`Done · ${title}`);
        }
      })();
    },
    [refresh],
  );

  // Pick up runs that are still going (started in another tab, or before a reload).
  const liveSummaries = useMemo(() => (ws?.runs ?? []).filter((r) => r.status === "running" || r.status === "queued"), [ws]);
  useEffect(() => {
    for (const r of liveSummaries) {
      if (!seed.current.has(r.id)) seed.current.set(r.id, fromSummary(r));
      attach(r.id, r.title);
    }
  }, [liveSummaries, attach]);
  const merged = useMemo(() => {
    const out: Record<string, RunState> = {};
    for (const r of liveSummaries) out[r.id] = fromSummary(r);
    return { ...out, ...runs };
  }, [liveSummaries, runs]);

  const start = useCallback(
    async (workflow: WorkflowId, args: unknown, opts: StartOptions = {}) => {
      try {
        const res = await fetch("/api/runs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workflow, args }),
        });
        const body = await res.json();
        if (!res.ok) throw Object.assign(new Error(body?.error ?? "Couldn't start that."), { code: body?.code as string | undefined });
        const state = fromSummary(body.run as RunSummary);
        options.current.set(state.id, opts);
        setRuns((all) => ({ ...all, [state.id]: state }));
        attach(state.id, state.title);
        return state;
      } catch (e) {
        const error = e instanceof Error ? { message: e.message, code: (e as Error & { code?: string }).code } : { message: "Couldn't start that." };
        if (opts.onError) opts.onError(error);
        else toast.error(error.message);
        return null;
      }
    },
    [attach],
  );

  const stop = useCallback(async (runId: string) => {
    await fetch(`/api/runs/${runId}/stop`, { method: "POST" });
  }, []);

  const value = useMemo(() => ({ runs: merged, start, stop, attach }), [merged, start, stop, attach]);
  return <RunsContext.Provider value={value}>{children}</RunsContext.Provider>;
}

export function useRuns(): RunsContextValue {
  const ctx = useContext(RunsContext);
  if (!ctx) throw new Error("useRuns must be used inside RunsProvider");
  return ctx;
}

/** The newest run for an entity (e.g. the dossier run for an account), live or recent. */
export function useRunFor(ref: EntityRef | undefined, workflow?: WorkflowId): RunState | undefined {
  const { runs } = useRuns();
  return useMemo(() => {
    if (!ref) return undefined;
    return Object.values(runs)
      .filter((r) => r.ref?.kind === ref.kind && r.ref.id === ref.id && (!workflow || r.workflow === workflow))
      .sort((a, b) => b.startedAt - a.startedAt)[0];
  }, [runs, ref, workflow]);
}

export function useActiveRuns(): RunState[] {
  const { runs } = useRuns();
  return useMemo(
    () => Object.values(runs).filter((r) => r.status === "running" || r.status === "queued").sort((a, b) => b.startedAt - a.startedAt),
    [runs],
  );
}
