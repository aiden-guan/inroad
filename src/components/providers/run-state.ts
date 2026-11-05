import type { AgentEvent, Source } from "@/lib/ai/events";
import type { EntityRef, RunSummary, WorkflowId } from "@/lib/domain/types";

/**
 * A run as this tab knows it, and how streamed events change it: pure, so it's testable (run-state.test.ts).
 * runs-provider.tsx holds the store and the streams.
 */

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
  /** Every reasoning line this run surfaced, in order: the reasoning stream. Kept in this tab only, never saved. */
  reasoning: string[];
  sources: Source[];
  writingChars: number;
  text: string;
  result?: unknown;
  error?: { message: string; code?: string; requestId?: string; detail?: string };
  costUsd?: number;
}

export type Runs = Record<string, RunState>;

/* ─────────────────────────────── The store ─────────────────────────────── */

/**
 * Runs live outside React state. Streamed events queue up and land once per animation frame (at once for a result,
 * an error or the end), and each component re-renders only when what it reads changed: `useRunFor` when its run
 * did, `useActiveRuns` when an active run did, `useRuns().runs` (all of them) only in components that read it.
 * Before, every token re-rendered every component that used the provider, starters included.
 */
export interface RunsStore {
  get: () => Runs;
  subscribe: (listener: () => void) => () => void;
  /** Runs this tab started or attached to, as their streams tell it. */
  local: () => Runs;
  setLocal: (next: Runs) => void;
  /** Live runs on file (other tabs, before a reload), until their streams say more. */
  summaries: () => Runs;
  setSummaries: (next: Runs) => void;
}

export function createRunsStore(): RunsStore {
  let local: Runs = {};
  let summaries: Runs = {};
  let merged: Runs = {};
  const listeners = new Set<() => void>();
  const publish = () => {
    merged = { ...summaries, ...local };
    for (const l of listeners) l();
  };
  return {
    get: () => merged,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    local: () => local,
    summaries: () => summaries,
    setLocal: (next) => {
      if (next === local) return;
      local = next;
      publish();
    },
    setSummaries: (next) => {
      const keys = Object.keys(next);
      if (keys.length === Object.keys(summaries).length && keys.every((k) => summaries[k] === next[k])) return;
      summaries = next;
      publish();
    },
  };
}

/** Events that land at once instead of waiting for the next frame. */
export const TERMINAL = new Set<AgentEvent["type"]>(["result", "error", "done"]);

export function reduceRun(state: RunState, event: AgentEvent): RunState {
  // A queued run says nothing until it gets its slot ("Starting"): its first word means it's running.
  if (state.status === "queued" && !TERMINAL.has(event.type)) state = { ...state, status: "running" };
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
      return { ...state, thinking: event.text, reasoning: state.reasoning.at(-1) === event.text ? state.reasoning : [...state.reasoning, event.text].slice(-60) };
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
      return { ...state, error: { message: event.message, code: event.code, requestId: event.requestId, detail: event.detail }, status: event.code === "stopped" ? "stopped" : "error" };
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

export function fromSummary(s: RunSummary): RunState {
  return {
    id: s.id,
    workflow: s.workflow,
    title: s.title,
    ref: s.ref,
    status: s.status,
    startedAt: new Date(s.startedAt).getTime(),
    endedAt: s.endedAt ? new Date(s.endedAt).getTime() : undefined,
    steps: [],
    reasoning: [],
    sources: [],
    writingChars: 0,
    text: "",
    error: s.error,
    costUsd: s.receipt?.costUsd,
  };
}

/** The same run as last time, unchanged: keep the object, so nothing that reads it re-renders. */
export function sameRun(a: RunState | undefined, b: RunState): a is RunState {
  return !!a && a.status === b.status && a.title === b.title && a.startedAt === b.startedAt && a.endedAt === b.endedAt && a.error?.message === b.error?.message && a.costUsd === b.costUsd;
}
