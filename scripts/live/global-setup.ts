import type { TestProject } from "vitest/node";
import type Anthropic from "@anthropic-ai/sdk";
import { billedUsage } from "@/lib/ai/engine";
import { MODEL_IDS, WEB_SEARCH_PRICE, priceFor, type ModelTier } from "@/lib/ai/models";
import { startMock, type MockServer } from "@/test/mock-anthropic";
import { startTapeProxy } from "./tape-proxy.mjs";

/**
 * The live smoke's one gate to the API: a spend-capped recording proxy in this (main) process. Workers
 * never see the API key; their requests carry a placeholder and the proxy swaps the real key in.
 */

const tierOf = (model: string): ModelTier => (Object.keys(MODEL_IDS) as ModelTier[]).find((t) => model.startsWith(MODEL_IDS[t])) ?? "operator";
// What a server-side fallback answers with (fallbacks: "default"): Opus 4.8 for Opus, Sonnet 5 for Sonnet.
const fallbackPrice = (tier: ModelTier) => priceFor(tier, tier === "strategist" ? "claude-opus-4-8" : "claude-sonnet-5");

/** The most a request could cost: its prompt uncached (as a cache write), all of max_tokens, every search, and a fallback attempt. */
function worstCase(body: Anthropic.Beta.Messages.MessageCreateParams & { fallbacks?: unknown }): number {
  const tier = tierOf(String(body.model));
  const p = priceFor(tier, String(body.model));
  const promptTokens = Math.ceil(JSON.stringify({ system: body.system, tools: body.tools, messages: body.messages }).length / 3);
  const oneHour = JSON.stringify(body).includes('"ttl":"1h"');
  const longPrompt = tier === "fast" && promptTokens > 100_000 ? 5 : 1;
  const attempt = (price: typeof p) => (longPrompt * (promptTokens * price.input * (oneHour ? 2 : 1.25) + body.max_tokens * price.output)) / 1_000_000;
  const searches = (body.tools ?? []).reduce((n, t) => n + ("max_uses" in t && t.name === "web_search" ? (t.max_uses ?? 0) : 0), 0) * WEB_SEARCH_PRICE;
  return attempt(p) + (body.fallbacks ? attempt(fallbackPrice(tier)) : 0) + searches;
}

export default async function setup(project: TestProject) {
  const viaMock = process.env.INROAD_SMOKE_UPSTREAM === "mock";
  const key = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  if (!viaMock && !key) throw new Error("The live smoke needs ANTHROPIC_API_KEY (or INROAD_SMOKE_UPSTREAM=mock to try it against the mock).");
  const capUsd = Number(process.env.INROAD_SMOKE_CAP_USD ?? 3);
  let mock: MockServer | undefined;
  if (viaMock) mock = await startMock();
  const upstream = mock?.url ?? process.env.INROAD_SMOKE_UPSTREAM ?? "https://api.anthropic.com";
  const refused: string[] = [];
  const proxy = await startTapeProxy({
    upstream,
    apiKey: viaMock ? "mock" : key,
    capUsd,
    price: { worstCase, actual: (m: Anthropic.Beta.BetaMessage) => billedUsage(tierOf(m.model), m).costUsd },
    log: (line: string) => {
      if (line.includes("refused")) refused.push(line);
      console.warn(line);
    },
  });
  project.provide("liveProxy", proxy.url);
  console.log(`[smoke] ${viaMock ? "mock" : upstream} through ${proxy.url}, hard cap $${capUsd}`);

  return async () => {
    const requests = proxy.exchanges();
    const failed = requests.filter((e: { status: number }) => e.status !== 200).length;
    console.log(`[smoke] ${requests.length} requests (${failed} not 200${refused.length ? `, ${refused.length} refused by the cap` : ""}), $${proxy.spentUsd().toFixed(4)} of the $${capUsd} cap`);
    if (process.env.INROAD_RECORD === "1") console.log("[smoke] tapes saved to src/test/fixtures/anthropic/live/");
    await proxy.close();
    mock?.stop();
  };
}
