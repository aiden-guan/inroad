import { describe, expect, it } from "vitest";
import type { DraftCritic } from "@/lib/domain/types";
import { readInCode } from "@/lib/workflows/compose";
import { startMockModel } from "@/test/offline-workflow";
import { CALIBRATION_SET, scoreCalibration } from "./calibration";
import { makeWorkspace } from "@/test/factories";
import { calibrationSet, runClassifyEval, runCriticEval } from "./critic-eval";
import { lintDraft } from "./lint";
import { REPLY_SET, scoreClassify } from "./reply-set";

/**
 * The draft-quality gates, offline: the labeled sets, the deterministic half of the gate (lint), the scoring, and the
 * eval harness end to end against the mock model. The real-model gate runs in scripts/eval-*.ts when a key is set.
 */
const mock = startMockModel();

const verdict = (wouldReply: boolean): DraftCritic => ({ wouldReply, preferredOverReference: wouldReply, povObvious: false, fatal: [], rewrite: "", unsupportedSpans: [], referenceId: "ref", at: "" });

describe("the calibration set", () => {
  it("holds 20 emails that got replies and 20 AI-SDR emails, with unique ids", () => {
    expect(CALIBRATION_SET.filter((e) => e.label === "replied")).toHaveLength(20);
    expect(CALIBRATION_SET.filter((e) => e.label === "ai_sdr")).toHaveLength(20);
    expect(new Set(CALIBRATION_SET.map((e) => e.id)).size).toBe(40);
  });

  it("lint passes every email that got a reply and fails the obvious AI-SDR ones; six are left for the critic", () => {
    const errors = (e: (typeof CALIBRATION_SET)[number]) =>
      lintDraft({ subject: e.subject, body: e.body, frame: e.frame, step: 1, kind: "email", sourcedText: e.body, thread: "new" }).violations.filter((v) => v.severity === "error");
    expect(CALIBRATION_SET.filter((e) => e.label === "replied" && errors(e).length).map((e) => e.id)).toEqual([]);
    expect(CALIBRATION_SET.filter((e) => e.label === "ai_sdr" && !errors(e).length).map((e) => e.id)).toEqual(["a12", "a13", "a16", "a18", "a19", "a20"]);
  });

  it("scores against the gate: accept 70% of replied emails, reject 85% of AI-SDR ones", () => {
    const all = (acceptReplied: number, acceptSdr: number) =>
      CALIBRATION_SET.map((e, i) => ({ id: e.id, label: e.label, accepted: e.label === "replied" ? i < acceptReplied : i - 20 < acceptSdr }));
    expect(scoreCalibration(all(14, 3))).toMatchObject({ acceptReplied: 0.7, rejectAiSdr: 0.85, passed: true });
    expect(scoreCalibration(all(13, 3)).passed).toBe(false);
    expect(scoreCalibration(all(20, 4))).toMatchObject({ rejectAiSdr: 0.8, passed: false, misses: ["a01", "a02", "a03", "a04"] });
    // No verdict isn't a pass.
    expect(scoreCalibration(CALIBRATION_SET.map((e) => ({ id: e.id, label: e.label, accepted: null })))).toMatchObject({ unjudged: 40, passed: false });
    // No verdict counts the way compose treats it, as accepted: a critic that fails on 19 of the 20 AI-SDR
    // emails and rejects the one it judged lets those 19 ship, so it fails the gate.
    const failsOnSdr = CALIBRATION_SET.map((e, i) => ({ id: e.id, label: e.label, accepted: e.label === "replied" ? true : i === 20 ? false : null }));
    expect(scoreCalibration(failsOnSdr)).toMatchObject({ unjudged: 19, rejectAiSdr: 0.05, passed: false });
  });
});

describe("calibrationSet", () => {
  it("adds the founder's pasted AI-written emails as negatives", () => {
    const ws = makeWorkspace();
    ws.voice = { samples: [], summary: "", signOff: "", updatedAt: "", badExamples: [{ at: "", text: "Hi Dana, I hope this finds you well. Our platform helps teams like yours." }] };
    const { set, source } = calibrationSet(ws);
    expect(source).toBe("bundled");
    expect(set).toHaveLength(41);
    expect(set.at(-1)).toMatchObject({ id: "ws1", label: "ai_sdr" });
  });
});

describe("runCriticEval", () => {
  it("reports the gate with any judge", async () => {
    const perfect = await runCriticEval({ judge: async (e) => verdict(e.label === "replied") });
    expect(perfect).toMatchObject({ acceptReplied: 1, rejectAiSdr: 1, passed: true, winRateVsReference: 1 });
    const pushover = await runCriticEval({ judge: async () => verdict(true) });
    expect(pushover).toMatchObject({ rejectAiSdr: 0, passed: false });
  });

  it("runs the compose critic end to end against the model, offline", async () => {
    const lines: string[] = [];
    const report = await runCriticEval({ set: CALIBRATION_SET.filter((e) => e.id === "h01" || e.id === "a12"), onItem: (l) => lines.push(l) });
    expect(report.cost.calls).toBe(2);
    expect(report.unjudged).toBe(0);
    expect(lines).toHaveLength(2);
    const req = mock.sent.find((r) => r.tools?.some((t) => t.name === "submit_critique"))!;
    expect(req.model).toMatch(/haiku/);
    expect(JSON.stringify(req.messages)).toContain("You are a Controller at a 120-person company.");
  });

  it("counts a critic call that failed as no verdict, and still counts what it spent", async () => {
    // The critic answers in prose instead of calling submit_critique, every time.
    await mock.fault({ type: "no_submit", times: 10, when: { tool: "submit_critique" } });
    const report = await runCriticEval({ set: CALIBRATION_SET.filter((e) => e.id === "a12") }).finally(() => fetch(`${process.env.ANTHROPIC_BASE_URL}/__mock/faults`, { method: "DELETE" }));
    expect(report.unjudged).toBe(1);
    // Shipped unjudged, as compose would: a miss, not a pass.
    expect(report).toMatchObject({ rejectAiSdr: 0, misses: ["a12"] });
    expect(report.cost.costUsd).toBeGreaterThan(0);
  });
});

describe("the reply bench", () => {
  it("covers every intent, with hard cases", () => {
    const intents = new Set(REPLY_SET.map((r) => r.intent));
    expect(intents.size).toBe(8);
    expect(new Set(REPLY_SET.map((r) => r.id)).size).toBe(REPLY_SET.length);
  });

  it("the code path is never wrong when it answers, and catches the plain opt-outs and auto-replies", () => {
    const coded = REPLY_SET.map((r) => ({ id: r.id, expected: r.intent, got: readInCode(r.text) })).filter((x) => x.got);
    expect(coded.filter((x) => x.got !== x.expected)).toEqual([]);
    expect(coded.map((x) => x.id).sort()).toEqual(["u01", "u02", "u03", "u04", "u05", "x01", "x02", "x03"]);
    // A yes inside an auto-reply goes to the model, not to "out of office".
    expect(readInCode(REPLY_SET.find((r) => r.id === "h01")!.text)).toBeNull();
  });

  it("scores agreement and dropped live replies", () => {
    const perfect = scoreClassify(REPLY_SET.map((r) => ({ id: r.id, expected: r.intent, got: r.intent })));
    expect(perfect).toMatchObject({ agreement: 1, droppedLive: 0, passed: true });
    const dropsYes = scoreClassify(REPLY_SET.map((r) => ({ id: r.id, expected: r.intent, got: r.id === "p01" ? "negative" : r.intent })));
    expect(dropsYes.passed).toBe(false);
    expect(dropsYes.misses).toEqual(["p01: positive → negative"]);
  });

  it("runs the reply read end to end against the model, offline", async () => {
    const report = await runClassifyEval({ set: REPLY_SET.filter((r) => r.id === "p02" || r.id === "u01") });
    // The opt-out is read in code; only the yes reaches the model.
    expect(report.cost.calls).toBe(1);
    expect(report.results).toEqual([
      { id: "p02", expected: "positive", got: "positive" },
      { id: "u01", expected: "unsubscribe", got: "unsubscribe" },
    ]);
  });
});
