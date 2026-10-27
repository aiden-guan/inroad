import "server-only";
import { activeProvider, connectionProvider, legacyProvider, requireProvider, type ActiveProvider } from "./client";
import { routingStatus } from "./connections";
import { AgentError } from "./errors";
import { type ModelTier, MODEL_IDS, PRICING } from "./models";
import { TargetSchema } from "./connections";
import type { AiTask, ModelTarget } from "./routing-types";

export function targetProvider(target: ModelTarget): ActiveProvider {
  TargetSchema.parse(target);
  const status = routingStatus();
  const connection = status.connections.find((c) => c.id === target.connectionId);
  const provider = connection?.id === "legacy" ? legacyProvider() : connection ? connectionProvider(connection) : null;
  if (!provider || !connection) throw new AgentError("The selected AI connection is unavailable. Check task routing in Settings.", "no_key");
  if (target.model) {
    if (![connection.model, ...Object.values(connection.models), ...connection.available].includes(target.model)) throw new AgentError("Add the selected model to its connection in Settings first.", "bad_request");
    if (connection.cloudflare?.dynamicRoute && target.model !== connection.model) throw new AgentError("This Cloudflare connection uses a fixed dynamic route.", "bad_request");
    provider.models = { strategist: target.model, operator: target.model, fast: target.model };
  }
  return provider;
}

export interface RouteChoice { provider: ActiveProvider; reason: string; explicit: boolean }
/** Resolve once per agent loop; never move an in-progress tool sequence to another account. */
export function routeProvider(input: { task?: AiTask; tier: ModelTier; route?: ModelTarget; nativeSearch?: boolean; promptTokens?: number }): RouteChoice {
  // Native search is an explicitly selected search source, separate from the task's synthesis model.
  if (input.nativeSearch) {
    const provider = activeProvider();
    if (provider?.kind !== "anthropic") throw new AgentError("Native web search requires a default Anthropic connection.", "no_key");
    return { provider, reason: "Anthropic native search source", explicit: true };
  }
  if (input.route) return { provider: targetProvider(input.route), reason: "Selected for this run", explicit: true };
  const status = routingStatus();
  const taskTarget = input.task ? status.routing.tasks[input.task] : undefined;
  if (taskTarget) return { provider: targetProvider(taskTarget), reason: "Task selection", explicit: true };
  if (status.routing.mode !== "auto") return { provider: requireProvider(), reason: "Default connection", explicit: false };
  const strength = input.tier === "fast" ? "fast" : input.tier === "strategist" ? "reasoning" : input.task && ["compose", "asset", "studio"].includes(input.task) ? "writing" : "research";
  const candidates = status.connections.filter((c) => c.auto && status.ready[c.id] && (!c.contextWindow || !input.promptTokens || c.contextWindow >= input.promptTokens)).flatMap((c) => {
    const provider = c.id === "legacy" ? legacyProvider() : connectionProvider(c);
    if (!provider) return [];
    const model = provider.models[input.tier];
    const price = provider.prices[model] ?? (provider.kind === "anthropic" ? Object.entries(MODEL_IDS).find(([, id]) => id === model)?.[0] : undefined);
    const rates = typeof price === "string" ? PRICING[price as ModelTier] : price;
    // Task fit comes from the user's connection preferences and configured tier models, never a claim
    // that a vendor's model name establishes benchmark quality. Unknown prices cannot win a cost race.
    const fit = (c.strengths.includes(strength) ? 2 : 0) + (c.models[input.tier] && c.models[input.tier] !== c.model ? 1 : 0);
    const cost = rates ? rates.input + rates.output * 0.3 : undefined;
    return [{ provider, fit, cost, default: c.id === (status.routing.defaultConnectionId ?? "legacy") }];
  });
  if (!candidates.length) throw new AgentError("No enabled automatic route fits this task. Enable a connection or select one for the task in Settings.", "no_key");
  candidates.sort((a, b) => {
    if (status.routing.policy === "cost") return (a.cost ?? Infinity) - (b.cost ?? Infinity) || b.fit - a.fit || Number(b.default) - Number(a.default);
    if (status.routing.policy === "quality") return b.fit - a.fit || Number(b.default) - Number(a.default);
    return b.fit - a.fit || (a.cost ?? Infinity) - (b.cost ?? Infinity) || Number(b.default) - Number(a.default);
  });
  return { provider: candidates[0].provider, reason: `Automatic · ${status.routing.policy} · ${strength} fit`, explicit: true };
}
