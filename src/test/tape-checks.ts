import { expect } from "vitest";
import type { RunSummary } from "@/lib/domain/types";
import type { Tape } from "./anthropic-tape";

/**
 * The checks the live smoke exists for, asserted on every workflow test (mock tapes offline, the real
 * API under npm run smoke:live): the tape answered every request; no run fell back to compatibility
 * mode; every response finished (no max_tokens cut-offs); the receipt costs what the responses' usage
 * says; and the run ended with its submit tool when it needed one.
 */
export async function expectHealthyRun(summary: RunSummary | RunSummary[], tape: Tape, opts: { submits?: string[] } = {}) {
  await tape.refresh();
  const runs = Array.isArray(summary) ? summary : [summary];
  expect(tape.misses).toEqual([]);
  for (const run of runs) {
    expect(run.status, `${run.title}: ${run.error?.message ?? ""}`).toBe("done");
    expect(run.receipt?.compat).toBeUndefined();
  }
  const messages = tape.messages();
  expect(messages.length).toBeGreaterThan(0);
  expect(messages.filter((m) => m.stop_reason === "max_tokens")).toEqual([]);
  const total = runs.reduce((n, r) => n + (r.receipt?.costUsd ?? 0), 0);
  expect(total).toBeCloseTo(tape.costUsd(), 9);
  const called = new Set(messages.flatMap((m) => m.content.filter((b) => b.type === "tool_use").map((b) => (b as { name: string }).name)));
  for (const name of opts.submits ?? []) expect(called, `expected a ${name} call`).toContain(name);
}
