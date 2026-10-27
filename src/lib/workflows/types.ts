import "server-only";
import type { z } from "zod";
import type { RunOptions, RunResult } from "@/lib/ai/engine";
import type { AgentEvent } from "@/lib/ai/events";
import type { EntityRef, Workspace, WorkflowId } from "@/lib/domain/types";

/** What a workflow receives when it runs. */
export interface WorkflowContext<A> {
  runId: string;
  args: A;
  /** Stream progress to every open client (work log, orb, sidebar). */
  emit: (event: AgentEvent) => void;
  signal: AbortSignal;
  /** Runs one Claude agent loop. Usage and cost roll up into this run's receipt automatically. */
  agent: <T = unknown>(opts: Omit<RunOptions, "emit" | "signal">) => Promise<RunResult<T>>;
  /** Fresh read of the workspace. */
  read: () => Workspace;
  /** Serialized write to the workspace. */
  mutate: <R = void>(fn: (ws: Workspace) => R) => Promise<R>;
  /** Count lookups done in code (job boards, news, crawl) that cost zero tokens; shown on the usage page. */
  noteExternalSearch?: (count?: number) => void;
  noteFreeSignals: (count?: number) => void;
}

export interface WorkflowDef<A = unknown> {
  id: WorkflowId;
  /** Validates the request body. */
  args: z.ZodType<A>;
  /** Shown in the sidebar and work log, e.g. "Researching Northwind". */
  title: (args: A, ws: Workspace) => string;
  /** The entity this run is about, so its sheet can show the live log. */
  ref?: (args: A) => EntityRef | undefined;
  /** Heavy runs (web research) count against the concurrency limit; light ones start immediately. */
  heavy?: boolean;
  run: (ctx: WorkflowContext<A>) => Promise<unknown>;
}

export function defineWorkflow<A>(def: WorkflowDef<A>): WorkflowDef<A> {
  return def;
}
