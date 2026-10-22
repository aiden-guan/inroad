import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { defineTool, resetCompat } from "@/lib/ai/engine";
import type { AgentEvent } from "@/lib/ai/events";
import { readWorkspace, replaceWorkspace } from "@/lib/store/workspace";
import { makeWorkspace } from "@/test/factories";
import { startMock, type MockServer } from "@/test/mock-anthropic";
import { defineWorkflow } from "@/lib/workflows/types";
import { startRun, subscribe } from "./registry";

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
