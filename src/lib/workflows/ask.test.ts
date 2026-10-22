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
    const second = await runWorkflow(ask, { threadId: "thr_test", message: "And what if she pushes back on the price?", context });
    await expectHealthyRun([first.summary, second.summary], tape);

    const thread = getThread("thr_test")!;
    const answers = thread.turns.filter((t) => t.role === "agent");
    expect(answers).toHaveLength(2);
    for (const a of answers) {
      expect(a.text.length).toBeGreaterThan(0);
      expect(a.error).toBeUndefined();
    }
    // Append-only: the second request starts with every message of the first.
    const [, ...rest] = tape.messages();
    const followUp = rest.at(-1)!;
    expect(followUp.usage.cache_read_input_tokens).toBeGreaterThan(0);
  });
});
