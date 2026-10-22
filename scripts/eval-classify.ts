import { describe, expect, it } from "vitest";
import { isConfigured } from "@/lib/ai/client";
import { runClassifyEval } from "@/lib/quality/critic-eval";
import { CLASSIFY_GATE } from "@/lib/quality/reply-set";
import { startMockModel } from "@/test/offline-workflow";

/**
 * The reply classifier's eval (SPEC §4.0 engine extension 9): on a frozen, hand-labeled bench of replies, the tier that
 * reads replies must agree with the labels at least 95% of the time and drop at most 3% of live replies (a yes read
 * as negative, unsubscribe or out of office). Fails when it doesn't, so a cheaper tier only takes over once it passes.
 *
 *   npm run eval:classify                       # the fast tier (Haiku); needs ANTHROPIC_API_KEY (about $0.05)
 *   EVAL_TIER=operator npm run eval:classify    # compare another tier
 *   EVAL_MOCK=1 npm run eval:classify           # the mock model: checks the plumbing, judges nothing
 */
const mock = process.env.EVAL_MOCK === "1";
if (mock) startMockModel();
const tier = process.env.EVAL_TIER === "operator" || process.env.EVAL_TIER === "strategist" ? process.env.EVAL_TIER : "fast";

describe("reply classifier", () => {
  it("agrees with the labels", async () => {
    if (!mock && !isConfigured()) {
      console.log("eval:classify: no API key, nothing run. Set ANTHROPIC_API_KEY, or EVAL_MOCK=1 for the mock.");
      return;
    }
    const report = await runClassifyEval({ tier, onItem: (line) => console.log(`  ${line}`) });
    console.log(
      [
        `${tier} tier against ${mock ? "the mock" : "the real model"}: ${report.n} replies`,
        `agreement ${Math.round(report.agreement * 100)}% (gate ${CLASSIFY_GATE.agreement * 100}%)`,
        `live replies dropped ${Math.round(report.droppedLive * 100)}% (gate ≤${CLASSIFY_GATE.droppedLive * 100}%)`,
        report.misses.length ? `misses: ${report.misses.join("; ")}` : "no misses",
        `${report.cost.calls} model calls · $${report.cost.costUsd.toFixed(3)}`,
        report.passed ? "PASS" : "FAIL",
      ].join("\n"),
    );
    if (!mock) expect(report.passed).toBe(true);
  });
});
