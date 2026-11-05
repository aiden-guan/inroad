import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyUsage } from "@/lib/ai/models";
import type { Workspace } from "@/lib/domain/types";
import { NOW, TODAY, at, makeAccount, makePerson, makeWorkspace } from "@/test/factories";
import { runOffline } from "@/test/offline-workflow";
import brief from "./brief";
import type { WorkflowContext } from "./types";

/** Today's "worth knowing" lines: a later run the same day adds to them, never wipes them. */

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

/** Stands in for the model: writes these lines, each citing the first new item (n1). */
const writes = (...lines: string[]) =>
  (async () => ({ result: { matters: lines.map((text) => ({ text, sourceIds: ["n1"] })) }, text: "", messages: [], stopReason: "tool_use", usage: emptyUsage(), costUsd: 0 })) as WorkflowContext<unknown>["agent"];

function replied(ws: Workspace, id: string, hhmm: string, body: string) {
  ws.activities.push({ id, at: at(0, hhmm), kind: "reply_received", personId: "per_dana", accountDomain: "acme.com", summary: "Replied", body });
}

describe("the daily brief", () => {
  it("keeps the morning's lines when a later run finds nothing worth a sentence, and puts new ones first", async () => {
    const ws = makeWorkspace({ accounts: { "acme.com": makeAccount("acme.com", { peopleIds: ["per_dana"] }) }, people: { per_dana: makePerson("per_dana", "acme.com", { name: "Dana Okafor" }) } });
    replied(ws, "act_1", "08:10", "Can you send pricing for 40 seats?");
    await runOffline(brief, { keys: ["rep:act_1"] }, ws, { agent: writes("Dana at Acme asked for pricing for 40 seats today, so the deal is live.") });
    expect(ws.briefs[TODAY].matters.map((m) => m.text)).toEqual(["Dana at Acme asked for pricing for 40 seats today, so the deal is live."]);

    // Afternoon: a new reply, but nothing clears the bar. The morning's line stays.
    replied(ws, "act_2", "15:30", "Thanks, will read it.");
    await runOffline(brief, { keys: ["rep:act_2"] }, ws, { agent: writes() });
    expect(ws.briefs[TODAY].matters.map((m) => m.text)).toEqual(["Dana at Acme asked for pricing for 40 seats today, so the deal is live."]);
    expect(ws.briefs[TODAY].seen).toEqual(["rep:act_1", "rep:act_2"]);

    // Evening: a new line goes first, the morning's after it.
    replied(ws, "act_3", "18:45", "We'd like to start a pilot next week.");
    await runOffline(brief, { keys: ["rep:act_3"] }, ws, { agent: writes("Dana wants to start a pilot next week: send the pilot plan.") });
    expect(ws.briefs[TODAY].matters.map((m) => m.text)).toEqual(["Dana wants to start a pilot next week: send the pilot plan.", "Dana at Acme asked for pricing for 40 seats today, so the deal is live."]);
  });
});
