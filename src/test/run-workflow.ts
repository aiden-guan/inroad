import type { AgentEvent } from "@/lib/ai/events";
import type { RunSummary } from "@/lib/domain/types";
import { startRun, subscribe } from "@/lib/runs/registry";
import { readWorkspace } from "@/lib/store/workspace";
import type { WorkflowDef } from "@/lib/workflows/types";

/**
 * Runs a workflow the way the app does (through the run registry, against the workspace in this test
 * file's data folder) and resolves once it's done, with its events, result and stored summary.
 */
export async function runWorkflow<A>(def: WorkflowDef<A>, args: unknown): Promise<{ summary: RunSummary; events: AgentEvent[]; result: unknown; error?: RunSummary["error"] }> {
  const run = await startRun(def, args);
  const events: AgentEvent[] = [];
  await new Promise<void>((resolve) => {
    subscribe(run.id, (e) => {
      events.push(e);
      if (e.type === "done") resolve();
    });
  });
  const summary = readWorkspace().runs.find((r) => r.id === run.id)!;
  const result = events.find((e): e is Extract<AgentEvent, { type: "result" }> => e.type === "result")?.data;
  return { summary, events, result, error: summary.error };
}

/** Status, action and thinking lines, in order: what the work log showed. */
export function logLines(events: AgentEvent[]): string[] {
  return events.flatMap((e) => (e.type === "status" || e.type === "action" ? [e.text] : []));
}

/** Waits for a run something else started (e.g. the discovery a first run kicks off) and returns its summary. */
export async function waitForRun(runId: string): Promise<RunSummary> {
  await new Promise<void>((resolve) => {
    subscribe(runId, (e) => {
      if (e.type === "done") resolve();
    });
  });
  return readWorkspace().runs.find((r) => r.id === runId)!;
}
