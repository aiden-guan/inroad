import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetCompat } from "@/lib/ai/engine";
import { sampleWorkspace } from "@/lib/sample";
import { DOMAIN } from "@/lib/sample/ids";
import { getThread } from "@/lib/store/threads";
import { replaceWorkspace } from "@/lib/store/workspace";
import { useTape, type Tape } from "@/test/anthropic-tape";
import { freshRun } from "@/test/deterministic";
import { NOW } from "@/test/factories";
import { runWorkflow } from "@/test/run-workflow";
import { expectHealthyRun } from "@/test/tape-checks";
import ask from "./ask";

/**
 * W12 Ask, two turns of one thread on recorded Anthropic exchanges. The system blocks and tools are
 * byte-stable and the thread is append-only, so the second turn reads the first from the prompt cache:
 * the claim in "How it keeps your token spend low", checked on the wire.
 */

vi.mock("@/lib/domain/ids", async (actual) => (await import("@/test/deterministic")).deterministicIds(await actual()));

let tape: Tape;

beforeEach(async () => {
  freshRun(NOW);
  resetCompat();
  await replaceWorkspace(sampleWorkspace(NOW));
});

afterEach(async () => {
  await tape?.close();
  vi.useRealTimers();
});

describe("an Ask thread", () => {
  it("answers, then answers a follow-up from the cached thread", async () => {
    tape = await useTape("ask-thread");
    const context = { kind: "account" as const, id: DOMAIN.northwind };
    const first = await runWorkflow(ask, { threadId: "thr_test", message: "What should I say to Northwind's CFO about pricing?", context });
    const firstTurn = tape.exchanges();
    const second = await runWorkflow(ask, { threadId: "thr_test", message: "And what if she pushes back on the price?", context });
    await expectHealthyRun([first.summary, second.summary], tape);

    const thread = getThread("thr_test")!;
    const answers = thread.turns.filter((t) => t.role === "agent");
    expect(answers).toHaveLength(2);
    for (const a of answers) {
      expect(a.text.length).toBeGreaterThan(0);
      expect(a.error).toBeUndefined();
    }
    // What makes the follow-up a cache read, checked on what was sent: the same tools and system, and a
    // history that starts with every message of the first turn's last request (append-only).
    const before = firstTurn.at(-1)!.request;
    const followUp = tape.exchanges()[firstTurn.length].request;
    expect(followUp.prefix).toBe(before.prefix);
    expect(followUp.turns!.slice(0, before.turns!.length)).toEqual(before.turns);
    expect(followUp.turns!.length).toBeGreaterThan(before.turns!.length);
    // On the real API (the live smoke), the response says so too.
    if (tape.mode === "live") expect(tape.messages()[firstTurn.length].usage.cache_read_input_tokens).toBeGreaterThan(0);
  });
});
