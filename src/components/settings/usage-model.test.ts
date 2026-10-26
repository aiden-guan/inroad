import { describe, expect, it } from "vitest";
import type { RunSummary } from "@/lib/domain/types";
import { NOW, at, makeWorkspace } from "@/test/factories";
import { usageReport } from "./usage-model";

/** Settings → Usage, computed in code from the workspace. */

function run(id: string, startedAt: string, compat?: NonNullable<RunSummary["receipt"]>["compat"]): RunSummary {
  return {
    id,
    workflow: "dossier",
    title: "Researching Acme",
    startedAt,
    endedAt: startedAt,
    status: "done",
    receipt: { durationMs: 1000, sources: 2, searches: 0, fetches: 1, drafts: 0, inputTokens: 1000, outputTokens: 200, cacheReadTokens: 3000, costUsd: 0.01, model: "operator", ...(compat ? { compat } : {}) },
  };
}

describe("usageReport · compatibility mode", () => {
  it("is null when every run had every feature", () => {
    expect(usageReport(makeWorkspace({ runs: [run("run_a", at(-1))] }), NOW).compat).toBeNull();
  });

  it("counts this month's runs that went without a rejected feature, newest reason first", () => {
    const ws = makeWorkspace({
      runs: [
        run("run_new", at(-1), { features: ["betas"], reason: "Unexpected value for the anthropic-beta header" }),
        run("run_ok", at(-2)),
        run("run_old", at(-3), { features: ["strict"], reason: "strict mode is not available" }),
        // Last month doesn't count.
        run("run_prev", at(-40), { features: ["betas"], reason: "old" }),
      ],
    });
    expect(usageReport(ws, NOW).compat).toEqual({ runs: 2, features: ["betas", "strict"], lastAt: at(-1), reason: "Unexpected value for the anthropic-beta header" });
  });
});
