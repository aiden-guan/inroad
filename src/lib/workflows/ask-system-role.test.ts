import { describe, expect, it } from "vitest";
import { sampleWorkspace } from "@/lib/sample";
import { DOMAIN } from "@/lib/sample/ids";
import { getThread } from "@/lib/store/threads";
import { NOW } from "@/test/factories";
import { runOffline, startMockModel, userText } from "@/test/offline-workflow";
import ask from "./ask";

/**
 * Ask puts today's date and the open record in a system message after the question. A model or route that
 * refuses mid-conversation system messages gets the same note inside the user turn instead, so the turn
 * still answers. Against the mock model, offline.
 */
const mock = startMockModel();

describe("an Ask turn on a model without mid-conversation system messages", () => {
  it("carries the note inside the question and answers", async () => {
    await mock.fault({ type: "system_role" });
    const ws = sampleWorkspace(NOW);
    await runOffline(ask, { threadId: "thr_sys", message: "What should I say to Northwind's CFO about pricing?", context: { kind: "account", id: DOMAIN.northwind } }, ws);

    const withSystem = mock.sent.filter((r) => r.messages.some((m) => (m.role as string) === "system"));
    expect(withSystem).toHaveLength(1);
    const retry = mock.sent.at(-1)!;
    expect(retry.messages.some((m) => (m.role as string) === "system")).toBe(false);
    expect(userText(retry)).toContain("<context>");
    const answer = getThread("thr_sys")!.turns.at(-1)!;
    expect(answer.error).toBeUndefined();
    expect(answer.text.length).toBeGreaterThan(0);
  });
});
