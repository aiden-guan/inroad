/**
 * Model routing and pricing. Each task uses the cheapest model that holds quality:
 *   strategist → Claude Opus 5.5   (positioning, playbook, hard judgment)
 *   operator   → Claude Sonnet 5.5 (research synthesis, drafting, chat with tools)
 *   fast       → Claude Haiku 5.5  (classification, extraction, short rewrites)
 */

export type ModelTier = "strategist" | "operator" | "fast";

export const MODEL_IDS: Record<ModelTier, string> = {
  strategist: "claude-opus-5-5",
  operator: "claude-sonnet-5-5",
  fast: "claude-haiku-5-5",
};

export const MODEL_LABELS: Record<ModelTier, string> = {
  strategist: "Opus 5.5",
  operator: "Sonnet 5.5",
  fast: "Haiku 5.5",
};

/** USD per million tokens. Cache writes (5-minute TTL) bill at 1.25x input. */
const PRICING: Record<ModelTier, { input: number; output: number; cacheRead: number }> = {
  strategist: { input: 4, output: 20, cacheRead: 0.2 },
  operator: { input: 2, output: 10, cacheRead: 0.1 },
  fast: { input: 0.1, output: 0.5, cacheRead: 0.01 },
};

/** USD per web search request (server-side tool). Web fetch bills only the tokens it reads. */
export const WEB_SEARCH_PRICE = 10 / 1000;

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  webSearches: number;
  webFetches: number;
}

export function emptyUsage(): Usage {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, webSearches: 0, webFetches: 0 };
}

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    webSearches: a.webSearches + b.webSearches,
    webFetches: a.webFetches + b.webFetches,
  };
}

export function costOf(tier: ModelTier, u: Usage): number {
  const p = PRICING[tier];
  const tokens =
    (u.inputTokens * p.input + u.cacheWriteTokens * p.input * 1.25 + u.cacheReadTokens * p.cacheRead + u.outputTokens * p.output) /
    1_000_000;
  return tokens + u.webSearches * WEB_SEARCH_PRICE;
}

/** The dynamic-filtering web tools need Opus or Sonnet; Haiku gets the basic versions. */
export function webToolTypes(tier: ModelTier) {
  return tier === "fast"
    ? ({ search: "web_search_20250305", fetch: "web_fetch_20250910" } as const)
    : ({ search: "web_search_20260209", fetch: "web_fetch_20260209" } as const);
}
