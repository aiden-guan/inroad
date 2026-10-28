import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineTool, resetCompat } from "@/lib/ai/engine";
import { monthKey } from "@/lib/domain/ids";
import type { AgentEvent } from "@/lib/ai/events";
import { readWorkspace, replaceWorkspace } from "@/lib/store/workspace";
import { makeWorkspace } from "@/test/factories";
import { startMock, type MockServer } from "@/test/mock-anthropic";
import { defineWorkflow } from "@/lib/workflows/types";
import { startRun, subscribe } from "./registry";
import * as claudePlan from "@/lib/studio/claude-plan";
import * as engine from "@/lib/ai/engine";
import { emptyUsage } from "@/lib/ai/models";

/**
 * A run end to end against the mock: what reaches the receipt, the monthly usage and the run's error,
 * which every surface (work log, toasts, Ask, Settings → Usage) shows as is.
 */

let mock: MockServer;

beforeAll(async () => {
  mock = await startMock();
  process.env.ANTHROPIC_BASE_URL = mock.url;
  process.env.ANTHROPIC_API_KEY = "mock";
});

afterAll(() => mock?.stop());

beforeEach(async () => {
  await mock.reset();
  resetCompat();
  await replaceWorkspace(makeWorkspace());
});

const probe = defineWorkflow({
  id: "brief",
  args: z.object({}),
  title: () => "Probe",
  run: async (ctx) => {
    const res = await ctx.agent<{ ok: boolean }>({
      tier: "operator",
      system: "Rules",
      messages: [{ role: "user", content: "Check" }],
      tools: [defineTool({ name: "submit_check", description: "Submit.", terminal: true, schema: z.object({ ok: z.boolean() }) })],
      requireTerminal: true,
    });
    return res.result;
  },
});

/** Starts the run and resolves with every event once it's done. */
async function finished(): Promise<{ id: string; events: AgentEvent[] }> {
  const run = await startRun(probe, {});
  const events: AgentEvent[] = [];
  await new Promise<void>((resolve) => {
    subscribe(run.id, (e) => {
      events.push(e);
      if (e.type === "done") resolve();
    });
  });
  return { id: run.id, events };
}

describe("a run's receipt and error", () => {
  it("bills the receipt and the month from the usage the API reported", async () => {
    const { id } = await finished();
    const ws = readWorkspace();
    const summary = ws.runs.find((r) => r.id === id)!;
    expect(summary.status).toBe("done");
    expect(summary.receipt).toMatchObject({ model: "operator", inputTokens: expect.any(Number), outputTokens: expect.any(Number) });
    expect(summary.receipt!.costUsd).toBeGreaterThan(0);
    expect(Object.values(ws.usage)[0]).toMatchObject({ costUsd: summary.receipt!.costUsd, runs: 1 });
  });

  it("keeps an API failure in plain words, with the request id for Copy details", async () => {
    await mock.fault({ type: "auth" });
    const { id, events } = await finished();
    const summary = readWorkspace().runs.find((r) => r.id === id)!;
    expect(summary.status).toBe("error");
    expect(summary.error).toEqual({
      code: "auth",
      message: "Your Anthropic API key was rejected. Update it in Settings.",
      requestId: expect.stringMatching(/^req_mock/),
      detail: "401 · authentication_error · invalid x-api-key",
    });
    expect(events.find((e) => e.type === "error")).toEqual({ type: "error", ...summary.error });
    // A late subscriber (another tab, after a reload) replays the same error.
    const replay: AgentEvent[] = [];
    subscribe(id, (e) => replay.push(e));
    expect(replay.find((e) => e.type === "error")).toEqual({ type: "error", ...summary.error });
  });

  it("marks a run that went without a rejected feature on its receipt", async () => {
    await mock.fault({ type: "reject_betas" });
    const { id } = await finished();
    const receipt = readWorkspace().runs.find((r) => r.id === id)!.receipt!;
    expect(receipt.compat).toEqual({ features: ["fallback"], reason: expect.stringContaining("anthropic-beta") });
  });
});

describe("the monthly budget", () => {
  /** A run that waits until released, so it's still in flight while others start. */
  const held = () => {
    let release = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const def = defineWorkflow({ id: "prep", args: z.object({}), title: () => "Brief ahead", run: async () => void (await gate) });
    return { def, release };
  };
  const over = (spent: number, budget: number) =>
    replaceWorkspace({ ...makeWorkspace(), caps: { ...makeWorkspace().caps, monthlyBudgetUsd: budget }, usage: { [monthKey()]: { costUsd: spent, runs: 1, byWorkflow: {}, freeSignals: 0 } } });

  it("does not charge or block ChatGPT image-only work against the API budget", async () => {
    await over(2, 2);
    const def = defineWorkflow({ id: "visual", args: z.object({ mode: z.string(), imageProvider: z.string() }), title: () => "ChatGPT image", run: async () => ({ imageId: "test" }) });
    const run = await startRun(def, { mode: "image", imageProvider: "chatgpt" });
    await new Promise<void>((resolve) => subscribe(run.id, (event) => event.type === "done" && resolve()));
    expect(readWorkspace().usage[monthKey()].costUsd).toBe(2);
    await expect(startRun(def, { mode: "design", imageProvider: "chatgpt" })).rejects.toThrow("budget");
  });

  it("routes Claude-plan Studio work without API calls or dollar-budget holds, including combined ChatGPT images", async () => {
    await over(2, 2);
    const plan = vi.spyOn(claudePlan, "runClaudePlan").mockResolvedValue({ result: { ok: true }, text: "", messages: [], stopReason: "tool_use", costUsd: 0, usage: emptyUsage(), modelName: "Claude plan · Sonnet" });
    const api = vi.spyOn(engine, "runAgent");
    try {
      for (const id of ["studio", "visual"] as const) {
        const def = defineWorkflow({ id, title: () => "Plan probe", args: z.object({ agentProvider: z.string(), generate: z.boolean().optional(), imageProvider: z.string().optional() }), run: (ctx) => probe.run({ ...ctx, args: {} }) });
        const run = await startRun(def, { agentProvider: "claude_plan", ...(id === "visual" ? { generate: true, imageProvider: "chatgpt" } : {}) });
        await new Promise<void>((resolve) => subscribe(run.id, (event) => event.type === "done" && resolve()));
        expect(readWorkspace().runs.find((entry) => entry.id === run.id)).toMatchObject({ status: "done", receipt: { costUsd: 0, modelName: "Claude plan · Sonnet" } });
        expect(readWorkspace().usage[monthKey()].costUsd).toBe(2);
        if (id === "visual") {
          await expect(startRun(def, { agentProvider: "claude_plan", generate: true, imageProvider: "openai" })).rejects.toThrow("budget");
          await expect(startRun(def, { agentProvider: "claude_plan", generate: true })).rejects.toThrow("budget");
        }
        await expect(startRun(def, { agentProvider: "api" })).rejects.toThrow("budget");
      }
      expect(plan).toHaveBeenCalledTimes(2);
      expect(api).not.toHaveBeenCalled();
    } finally { plan.mockRestore(); api.mockRestore(); }
  });

  it("holds what runs in flight may cost, so a burst of automatic runs stops before it can pass the budget", async () => {
    await over(1.5, 2);
    const { def, release } = held();
    // A brief prepared ahead may cost up to $0.40: the first fits ($1.90), the second wouldn't ($2.30).
    const first = await startRun(def, {}, { automatic: true });
    await expect(startRun(def, {}, { automatic: true })).rejects.toThrow(/budget \(\$2\) is used up/);
    // The founder's own run still starts while there's budget left, even if its worst case is over.
    const mine = await startRun(def, {});
    release();
    for (const id of [first.id, mine.id]) await new Promise<void>((resolve) => subscribe(id, (e) => e.type === "done" && resolve()));
    // Ended (and cheap): the hold is gone, so the next automatic run fits again.
    const again = await startRun(def, {}, { automatic: true });
    await new Promise<void>((resolve) => subscribe(again.id, (e) => e.type === "done" && resolve()));
  });
});
