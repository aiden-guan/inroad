import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetCompat } from "@/lib/ai/engine";
import { MODEL_IDS } from "@/lib/ai/models";
import { sampleWorkspace } from "@/lib/sample";
import { DOMAIN, PERSON } from "@/lib/sample/ids";
import { readWorkspace, replaceWorkspace } from "@/lib/store/workspace";
import { useTape, type Tape } from "@/test/anthropic-tape";
import { freshRun } from "@/test/deterministic";
import { NOW, makeAccount, makePerson, makeWorkspace } from "@/test/factories";
import { startMock, type MockServer } from "@/test/mock-anthropic";
import { runWorkflow } from "@/test/run-workflow";
import { expectHealthyRun } from "@/test/tape-checks";
import compose from "./compose";

/**
 * W5: drafts and replies end to end on recorded Anthropic exchanges (the sample workspace's evidence,
 * angles, POVs and voice), then what happens when the model calls behind a draft fail (live mock).
 */

vi.mock("@/lib/domain/ids", async (actual) => (await import("@/test/deterministic")).deterministicIds(await actual()));

describe("drafting on tape", () => {
  let tape: Tape;

  beforeEach(async () => {
    freshRun(NOW);
    resetCompat();
    // The critic shows the draft as A or B at random; pin it so the tape's order replays.
    vi.spyOn(Math, "random").mockReturnValue(0.25);
    await replaceWorkspace(sampleWorkspace(NOW));
  });

  afterEach(async () => {
    await tape?.close();
    vi.useRealTimers();
  });

  it("writes a cold first touch from a dated signal: cited spans, a POV, the critic's read, an hour of cache", async () => {
    tape = await useTape("compose-cold");
    const { summary, result } = await runWorkflow(compose, { domain: DOMAIN.glassmoor, personId: PERSON.lena, mode: "cold" });
    await expectHealthyRun(summary, tape, { submits: ["submit_draft", "submit_critique"] });

    const ws = readWorkspace();
    const pkg = ws.outreach[(result as { packageId: string }).packageId];
    expect(pkg).toMatchObject({ mode: "cold", accountDomain: DOMAIN.glassmoor, personId: PERSON.lena });
    const [step] = pkg.steps;
    expect(step.body.length).toBeGreaterThan(40);
    expect(step.subject).toBeTruthy();
    // Every personalized phrase cites evidence on file, and the body says it.
    for (const span of step.personalizedSpans) {
      expect(step.body).toContain(span.text);
      expect(ws.evidence[span.evidenceId], span.evidenceId).toBeDefined();
    }
    expect(step.critic).toBeDefined();
    // The mock's drafts are held to the same lint as a founder's; a real model gets one revision for it.
    if (tape.source === "mock") expect(step.lint.passed).toBe(true);
    for (const e of tape.exchanges()) expect(e.request.cacheTtl).toBe("1h");
  });

  it("reads a reply and drafts the answer, logging the reply on the timeline", async () => {
    tape = await useTape("compose-reply");
    const replyText = "Thanks for writing. What would a pilot cost us, and how long until we'd see numbers?";
    const { summary, result } = await runWorkflow(compose, { domain: DOMAIN.glassmoor, personId: PERSON.lena, mode: "reply", replyText });
    await expectHealthyRun(summary, tape, { submits: ["submit_reply_read", "submit_reply"] });
    const ws = readWorkspace();
    const pkg = ws.outreach[(result as { packageId: string }).packageId];
    expect(pkg.mode).toBe("reply");
    expect(pkg.reply?.text).toBe(replyText);
    expect(["positive", "info_request", "objection"]).toContain(pkg.reply?.intent);
    expect(pkg.steps[0].body.length).toBeGreaterThan(10);
    expect(ws.activities.some((a) => a.kind === "reply_received" && a.personId === PERSON.lena && a.body === replyText)).toBe(true);
  });
});

let mock: MockServer;

beforeAll(async () => {
  mock = await startMock();
});

afterAll(() => mock?.stop());

const reply = { domain: "acme.com", personId: "per_ana", mode: "reply", replyText: "Interesting. What does a pilot cost, and how long until we see numbers?" };

describe("reading a reply when the model calls fail", () => {
  beforeEach(async () => {
    process.env.ANTHROPIC_BASE_URL = mock.url;
    process.env.ANTHROPIC_API_KEY = "mock";
    await mock.reset();
    resetCompat();
    await replaceWorkspace(
      makeWorkspace({
        accounts: { "acme.com": makeAccount("acme.com", { peopleIds: ["per_ana"] }) },
        people: { per_ana: makePerson("per_ana", "acme.com", { name: "Ana Ruiz", title: "VP Finance" }) },
      }),
    );
  });

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
