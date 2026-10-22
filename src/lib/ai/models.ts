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

export interface Price {
  input: number;
  output: number;
  cacheRead: number;
}

/**
 * USD per million tokens. Cache writes bill at 1.25x input for the 5-minute TTL and 2x for 1 hour. Cache
 * reads are 0.05x input on Opus 5.5 and Sonnet 5.5, 0.1x on Haiku 5.5 (Anthropic pricing page).
 */
const PRICING: Record<ModelTier, Price> = {
  strategist: { input: 4, output: 20, cacheRead: 0.2 },
  operator: { input: 2, output: 10, cacheRead: 0.1 },
  fast: { input: 0.1, output: 0.5, cacheRead: 0.01 },
};

/** Haiku 5.5 bills a request whose prompt is over 100K tokens at 5x ($0.50 / $2.50 per million). */
const LONG_PROMPT: Partial<Record<ModelTier, { above: number; multiplier: number }>> = {
  fast: { above: 100_000, multiplier: 5 },
};

/**
 * Models a server-side fallback (`fallbacks: "default"`) can answer a refused turn with. That turn bills
 * at the fallback model's own rates, so receipts and the budget price it as such.
 */
const FALLBACK_PRICING: Record<string, Price> = {
  "claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5 },
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2 },
};

/** USD per web search request (server-side tool). Web fetch bills only the tokens it reads. */
export const WEB_SEARCH_PRICE = 10 / 1000;

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  /** All cache writes, both TTLs. */
  cacheWriteTokens: number;
  /** The part of cacheWriteTokens written with the 1-hour TTL (billed at 2x input, not 1.25x). */
  cacheWrite1hTokens: number;
  webSearches: number;
  webFetches: number;
}

export function emptyUsage(): Usage {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, cacheWrite1hTokens: 0, webSearches: 0, webFetches: 0 };
}

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    cacheWrite1hTokens: (a.cacheWrite1hTokens ?? 0) + (b.cacheWrite1hTokens ?? 0),
    webSearches: a.webSearches + b.webSearches,
    webFetches: a.webFetches + b.webFetches,
  };
}

function tokenCost(p: Price, u: Usage, multiplier = 1): number {
  const oneHour = Math.min(u.cacheWrite1hTokens ?? 0, u.cacheWriteTokens);
  const fiveMinute = u.cacheWriteTokens - oneHour;
  return (multiplier * (u.inputTokens * p.input + fiveMinute * p.input * 1.25 + oneHour * p.input * 2 + u.cacheReadTokens * p.cacheRead + u.outputTokens * p.output)) / 1_000_000;
}

/** Cost at a tier's standard rates (estimates, the price table, totals already split per request). */
export function costOf(tier: ModelTier, u: Usage): number {
  return tokenCost(PRICING[tier], u) + u.webSearches * WEB_SEARCH_PRICE;
}

/** The rates of the model that actually served a request: one of ours, a fallback model, else the tier's. */
export function priceFor(tier: ModelTier, model?: string | null): Price {
  if (model) {
    const own = (Object.keys(MODEL_IDS) as ModelTier[]).find((t) => model === MODEL_IDS[t] || model.startsWith(`${MODEL_IDS[t]}-`));
    if (own) return PRICING[own];
    const fallback = Object.keys(FALLBACK_PRICING).find((id) => model === id || model.startsWith(`${id}-`));
    if (fallback) return FALLBACK_PRICING[fallback];
  }
  return PRICING[tier];
}

/**
 * One request's cost, priced by the model that served it, with Haiku's long-prompt rate when this
 * request's prompt (input + cache reads + cache writes) is over its threshold.
 */
export function requestCost(tier: ModelTier, model: string | null | undefined, u: Usage): number {
  const servedBy = (Object.keys(MODEL_IDS) as ModelTier[]).find((t) => model === MODEL_IDS[t]) ?? (model ? undefined : tier);
  const long = servedBy ? LONG_PROMPT[servedBy] : undefined;
  const prompt = u.inputTokens + u.cacheReadTokens + u.cacheWriteTokens;
  return tokenCost(priceFor(tier, model), u, long && prompt > long.above ? long.multiplier : 1) + u.webSearches * WEB_SEARCH_PRICE;
}

/** The dynamic-filtering web tools need Opus or Sonnet; Haiku gets the basic versions. */
export function webToolTypes(tier: ModelTier) {
  return tier === "fast"
    ? ({ search: "web_search_20250305", fetch: "web_fetch_20250910" } as const)
    : ({ search: "web_search_20260209", fetch: "web_fetch_20260209" } as const);
}
