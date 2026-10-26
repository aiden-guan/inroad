import { describe, expect, it } from "vitest";
import { isConfigured } from "@/lib/ai/client";
import { CALIBRATION_GATE } from "@/lib/quality/calibration";
import { calibrationSet, runCriticEval } from "@/lib/quality/critic-eval";
import { readWorkspace } from "@/lib/store/workspace";
import { startMockModel } from "@/test/offline-workflow";

/**
 * The critic's pre-launch calibration gate (SPEC §4.0): on 40 labeled first touches, accept at least 70% of the ones
 * that got replies and reject at least 85% of the AI-SDR ones. Fails when the gate fails, so CI catches a critic prompt
 * that regressed.
 *
 *   npm run eval:critic                 # the real model; needs ANTHROPIC_API_KEY (40 Haiku calls, about $0.10)
 *   EVAL_MOCK=1 npm run eval:critic     # the mock model: checks the plumbing, judges nothing
 *
 * Uses calibration.json from the data folder when present (permissioned real emails), else the bundled set, plus the
 * AI-written emails the founder pasted on Today ("Show me what bad looks like") as extra negatives.
 */
const mock = process.env.EVAL_MOCK === "1";
if (mock) startMockModel();

describe("critic calibration", () => {
  it("clears the gate", async () => {
    if (!mock && !isConfigured()) {
      console.log("eval:critic: no API key, nothing run. Set ANTHROPIC_API_KEY, or EVAL_MOCK=1 for the mock.");
      return;
    }
    const { set, source } = calibrationSet(readWorkspace());
    console.log(`eval:critic: ${set.length} emails (${source} set) against ${mock ? "the mock" : "the real model"}`);
    const report = await runCriticEval({ set, onItem: (line) => console.log(`  ${line}`) });
    console.log(
      [
        `accepted ${Math.round(report.acceptReplied * 100)}% of replied emails (gate ${CALIBRATION_GATE.acceptReplied * 100}%, n=${report.replied})`,
        `rejected ${Math.round(report.rejectAiSdr * 100)}% of AI-SDR emails (gate ${CALIBRATION_GATE.rejectAiSdr * 100}%, n=${report.aiSdr})`,
        report.winRateVsReference !== null ? `replied emails preferred over the reference ${Math.round(report.winRateVsReference * 100)}% of the time` : "",
        report.unjudged ? `${report.unjudged} without a verdict` : "",
        report.misses.length ? `misses: ${report.misses.join(", ")}` : "no misses",
        `${report.cost.calls} calls · $${report.cost.costUsd.toFixed(3)}`,
        report.passed ? "PASS" : "FAIL",
      ]
        .filter(Boolean)
        .join("\n"),
    );
    if (!mock) expect(report.passed).toBe(true);
  });
});
