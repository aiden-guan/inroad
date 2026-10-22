import { describe, expect, it } from "vitest";
import { MODEL_IDS, WEB_SEARCH_PRICE, costOf, emptyUsage, priceFor, requestCost, type Usage } from "./models";

/**
 * The price table receipts and the monthly budget are computed from. Pinned per tier from Anthropic's
 * pricing page (USD per million tokens): a change here changes every receipt, so it should be deliberate.
 */

const million = (patch: Partial<Usage>): Usage => ({ ...emptyUsage(), ...patch });

describe("price table", () => {
  it.each([
    // tier, input, output, cache read (0.05x on Opus and Sonnet 5.5, 0.1x on Haiku 5.5)
    ["strategist", 4, 20, 0.2],
    ["operator", 2, 10, 0.1],
    ["fast", 0.1, 0.5, 0.01],
  ] as const)("prices %s at $%s in, $%s out, $%s cache reads", (tier, input, output, cacheRead) => {
    expect(costOf(tier, million({ inputTokens: 1e6 }))).toBeCloseTo(input, 10);
    expect(costOf(tier, million({ outputTokens: 1e6 }))).toBeCloseTo(output, 10);
    expect(costOf(tier, million({ cacheReadTokens: 1e6 }))).toBeCloseTo(cacheRead, 10);
    // Cache writes: 1.25x input for 5 minutes, 2x for 1 hour.
    expect(costOf(tier, million({ cacheWriteTokens: 1e6 }))).toBeCloseTo(input * 1.25, 10);
    expect(costOf(tier, million({ cacheWriteTokens: 1e6, cacheWrite1hTokens: 1e6 }))).toBeCloseTo(input * 2, 10);
    expect(costOf(tier, million({ cacheWriteTokens: 2e6, cacheWrite1hTokens: 1e6 }))).toBeCloseTo(input * 3.25, 10);
  });

  it("adds $10 per thousand web searches", () => {
    expect(WEB_SEARCH_PRICE).toBe(0.01);
    expect(costOf("operator", million({ webSearches: 3 }))).toBeCloseTo(0.03, 10);
  });
});

describe("requestCost", () => {
  it("prices a request by the model that served it", () => {
    const u = million({ inputTokens: 1e6, outputTokens: 1e6 });
    expect(requestCost("strategist", MODEL_IDS.strategist, u)).toBeCloseTo(24, 10);
    // A refused Opus 5.5 turn answered by the default fallback bills at Opus 4.8's $5 / $25.
    expect(requestCost("strategist", "claude-opus-4-8", u)).toBeCloseTo(30, 10);
    expect(requestCost("operator", "claude-sonnet-5", million({ cacheReadTokens: 1e6 }))).toBeCloseTo(0.2, 10);
    // Unknown models fall back to the tier's rates.
    expect(requestCost("operator", "claude-something-new", u)).toBeCloseTo(12, 10);
    expect(priceFor("fast")).toEqual({ input: 0.1, output: 0.5, cacheRead: 0.01 });
  });

  it("bills a Haiku request with a prompt over 100K tokens at five times the rate", () => {
    const small = million({ inputTokens: 100_000, outputTokens: 1000 });
    const big = million({ inputTokens: 60_000, cacheReadTokens: 30_000, cacheWriteTokens: 10_001, outputTokens: 1000 });
    expect(requestCost("fast", MODEL_IDS.fast, small)).toBeCloseTo((100_000 * 0.1 + 1000 * 0.5) / 1e6, 12);
    expect(requestCost("fast", MODEL_IDS.fast, big)).toBeCloseTo((5 * (60_000 * 0.1 + 30_000 * 0.01 + 10_001 * 0.125 + 1000 * 0.5)) / 1e6, 12);
    // Only Haiku has the long-prompt rate.
    expect(requestCost("operator", MODEL_IDS.operator, big)).toBeCloseTo(costOf("operator", big), 12);
  });
});
