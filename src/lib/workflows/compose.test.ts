import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetCompat } from "@/lib/ai/engine";
import { MODEL_IDS } from "@/lib/ai/models";
import { readWorkspace, replaceWorkspace } from "@/lib/store/workspace";
import { makeAccount, makePerson, makeWorkspace } from "@/test/factories";
import { startMock, type MockServer } from "@/test/mock-anthropic";
import { runWorkflow } from "@/test/run-workflow";
import compose from "./compose";

/** W5 against the mock: what happens when the model calls behind a draft fail. */

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
  await replaceWorkspace(
    makeWorkspace({
      accounts: { "acme.com": makeAccount("acme.com", { peopleIds: ["per_ana"] }) },
      people: { per_ana: makePerson("per_ana", "acme.com", { name: "Ana Ruiz", title: "VP Finance" }) },
    }),
  );
});

const reply = { domain: "acme.com", personId: "per_ana", mode: "reply", replyText: "Interesting. What does a pilot cost, and how long until we see numbers?" };

describe("reading a reply", () => {
  it("falls back to Sonnet once when Haiku can't read it, then drafts", async () => {
    // Four 529s outlast the SDK's three retries on the fast tier.
    await mock.fault({ type: "overloaded", times: 4, when: { tool: "submit_reply_read", model: MODEL_IDS.fast } });
    const { summary } = await runWorkflow(compose, reply);
    expect(summary.status).toBe("done");
    const reads = (await mock.requests()).filter((r) => r.tools.includes("submit_reply_read"));
    expect(reads.map((r) => [r.model, r.status])).toEqual([
      ...Array.from({ length: 4 }, () => [MODEL_IDS.fast, 529]),
      [MODEL_IDS.operator, 200],
    ]);
    const pkg = Object.values(readWorkspace().outreach).find((p) => p.mode === "reply");
    expect(pkg?.steps).toHaveLength(1);
  });

  it("stops with a plain message, and saves nothing, when the second read fails too", async () => {
    await mock.fault({ type: "overloaded", times: 8, when: { tool: "submit_reply_read" } });
    const { summary } = await runWorkflow(compose, reply);
    expect(summary.error).toMatchObject({ code: "overloaded", message: "I couldn't read their reply just now. Nothing was saved; try again in a minute." });
    const ws = readWorkspace();
    expect(ws.activities.filter((a) => a.kind === "reply_received")).toEqual([]);
    expect(Object.values(ws.outreach)).toEqual([]);
  });

  it("doesn't spend a second model on a failure retrying can't fix", async () => {
    await mock.fault({ type: "credit", when: { tool: "submit_reply_read" } });
    const { summary } = await runWorkflow(compose, reply);
    expect(summary.error?.code).toBe("no_credit");
    expect((await mock.requests()).filter((r) => r.tools.includes("submit_reply_read"))).toHaveLength(1);
  });

  it("uses a 1-hour cache for the reply read and the draft", async () => {
    await runWorkflow(compose, reply);
    const requests = await mock.requests();
    expect(requests.length).toBeGreaterThanOrEqual(2);
    for (const r of requests) expect(r.cacheControl).toEqual({ type: "ephemeral", ttl: "1h" });
  });
});
