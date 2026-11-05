import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineTool, resetCompat } from "@/lib/ai/engine";
import { monthKey } from "@/lib/domain/ids";
import type { AgentEvent } from "@/lib/ai/events";
import type { RunSummary } from "@/lib/domain/types";
import { readWorkspace, replaceWorkspace } from "@/lib/store/workspace";
import { makeWorkspace } from "@/test/factories";
import { startMock, type MockServer } from "@/test/mock-anthropic";
import { defineWorkflow } from "@/lib/workflows/types";
import { AgentError } from "@/lib/ai/errors";
import * as store from "@/lib/store/workspace";
import dossier from "@/lib/workflows/dossier";
import foundation from "@/lib/workflows/foundation";
import { committedSpend, liveRunIds, monthSpend, startRun, stopRun, subscribe } from "./registry";
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
  /** A run that waits until released, so it's still in flight while others start. Each `n` is different work. */
  const held = () => {
    let release = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const def = defineWorkflow({ id: "prep", args: z.object({ n: z.number() }), title: () => "Brief ahead", run: async () => void (await gate) });
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
    const first = await startRun(def, { n: 1 }, { automatic: true });
    await expect(startRun(def, { n: 2 }, { automatic: true })).rejects.toThrow(/budget \(\$2\) is used up/);
    // The founder's own run still starts while there's budget left, even if its worst case is over.
    const mine = await startRun(def, { n: 3 });
    release();
    for (const id of [first.id, mine.id]) await new Promise<void>((resolve) => subscribe(id, (e) => e.type === "done" && resolve()));
    // Ended (and cheap): the hold is gone, so the next automatic run fits again.
    const again = await startRun(def, { n: 4 }, { automatic: true });
    await new Promise<void>((resolve) => subscribe(again.id, (e) => e.type === "done" && resolve()));
  });
});

/** Every event of a run once it's done; fails instead of hanging when the run never ends. */
function endOf(runId: string, ms = 4000): Promise<AgentEvent[]> {
  return new Promise((resolve, reject) => {
    const events: AgentEvent[] = [];
    const timer = setTimeout(() => reject(new Error(`run ${runId} never ended`)), ms);
    subscribe(runId, (e) => {
      events.push(e);
      if (e.type !== "done") return;
      clearTimeout(timer);
      resolve(events);
    });
  });
}

/** A workflow whose runs wait until released, counting how many really started. */
function gated(opts: { heavy?: boolean; key?: (a: { id: string; note?: string }) => string } = {}) {
  let release = () => {};
  const gate = new Promise<void>((r) => (release = r));
  const state = { started: 0, release: () => release() };
  const def = defineWorkflow({
    id: "prep",
    args: z.object({ id: z.string(), note: z.string().optional() }),
    title: (a) => `Prep ${a.id}`,
    heavy: opts.heavy,
    key: opts.key,
    run: async (ctx) => {
      state.started++;
      await Promise.race([gate, new Promise((r) => ctx.signal.addEventListener("abort", r))]);
      if (ctx.signal.aborted) throw new AgentError("Stopped.", "stopped");
      return { ok: true };
    },
  });
  return { def, state };
}

describe("starting work that's already running", () => {
  it("returns the run in flight for the same workflow and target, so a double click pays once", async () => {
    const { def, state } = gated({ key: (a) => a.id });
    // Two clicks land together: one run, one summary.
    const [a, b] = await Promise.all([startRun(def, { id: "mtg_1" }), startRun(def, { id: "mtg_1", note: "again" })]);
    expect(b.id).toBe(a.id);
    const other = await startRun(def, { id: "mtg_2" });
    expect(other.id).not.toBe(a.id);
    expect(readWorkspace().runs.map((r) => r.id).sort()).toEqual([a.id, other.id].sort());
    state.release();
    await Promise.all([endOf(a.id), endOf(other.id)]);
    expect(state.started).toBe(2);
    // Once it has ended, the same work is a new run.
    const again = await startRun(def, { id: "mtg_1" });
    expect(again.id).not.toBe(a.id);
    await endOf(again.id);
  });

  it("keys on the exact arguments by default, and starts again after a Stop", async () => {
    const { def, state } = gated();
    const a = await startRun(def, { id: "mtg_1" });
    expect((await startRun(def, { id: "mtg_1" })).id).toBe(a.id);
    const noted = await startRun(def, { id: "mtg_1", note: "with the new deck" });
    expect(noted.id).not.toBe(a.id);
    // Stopped is winding down, not running: the founder's next click is a fresh run.
    expect(stopRun(a.id)).toBe(true);
    const fresh = await startRun(def, { id: "mtg_1" });
    expect(fresh.id).not.toBe(a.id);
    state.release();
    const [stopped] = await Promise.all([endOf(a.id), endOf(noted.id), endOf(fresh.id)]);
    expect(stopped).toContainEqual({ type: "error", code: "stopped", message: "Stopped." });
    expect(state.started).toBe(3);
  });

  it("treats Research and Refresh of one company as the same work, and any two bets", () => {
    expect(dossier.key!({ domain: "https://www.Acme.com/pricing" })).toBe(dossier.key!({ domain: "acme.com", force: true }));
    expect(dossier.key!({ domain: "acme.com" })).not.toBe(dossier.key!({ domain: "northwind.io" }));
    expect(foundation.key!({ url: "acme.com", mode: "onboarding" })).toBe(foundation.key!({ note: "Usage billing for API companies", mode: "refresh" }));
  });
});

describe("a run whose bookkeeping can't be saved", () => {
  it("still ends, tells its clients, and gives back its heavy slot and budget hold", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { def, state } = gated({ heavy: true });
    const runs: RunSummary[] = [];
    for (const id of ["a", "b", "c", "d"]) runs.push(await startRun(def, { id }));
    // Three heavy runs hold every slot; the fourth waits for one.
    expect(runs.map((r) => r.status)).toEqual(["running", "running", "running", "queued"]);
    const ended = runs.map((r) => endOf(r.id));

    // From here the disk refuses every workspace write (full, or permissions changed under it).
    const save = vi.spyOn(store, "mutateWorkspace").mockRejectedValue(new Error("ENOSPC: no space left on device, write"));
    state.release();
    for (const events of await Promise.all(ended)) {
      expect(events.at(-1)).toEqual({ type: "done" });
      expect(events).toContainEqual({ type: "result", data: { ok: true } });
    }
    expect(save).toHaveBeenCalled();
    save.mockRestore();
    expect(liveRunIds()).toEqual([]);
    expect(committedSpend()).toBe(monthSpend());

    // No slot leaked: three new heavy runs all start right away.
    const next: RunSummary[] = [];
    for (const id of ["e", "f", "g"]) next.push(await startRun(def, { id }));
    expect(next.map((r) => r.status)).toEqual(["running", "running", "running"]);
    await Promise.all(next.map((r) => endOf(r.id)));
  });

  it("doesn't start, or block the next start, when its first save fails", async () => {
    const { def, state } = gated();
    const save = vi.spyOn(store, "mutateWorkspace").mockRejectedValueOnce(new Error("EACCES: permission denied, open"));
    await expect(startRun(def, { id: "mtg_1" })).rejects.toThrow("EACCES");
    save.mockRestore();
    expect(liveRunIds()).toEqual([]);
    const run = await startRun(def, { id: "mtg_1" });
    state.release();
    expect(await endOf(run.id)).toContainEqual({ type: "result", data: { ok: true } });
    expect(state.started).toBe(1);
  });
});
