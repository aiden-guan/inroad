import "server-only";
import { randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { readSettings, writeSettings } from "@/lib/store/settings";
import { readAiKey, saveAiKey, deleteAiKey, keyHint } from "@/lib/store/ai-keys";
import { connectionProvider, legacyProvider } from "./client";
import { cleanBaseUrl, providerById, rankModels, isProviderId, tierModels } from "./providers";
import { listModels } from "./openai-compat";
import { MODEL_IDS } from "./models";
import { AI_TASKS, type AiConnection, type AiRouting, type RoutingStatus } from "./routing-types";

const modelId = z.string().trim().min(1).max(240).regex(/^[a-zA-Z0-9@][a-zA-Z0-9_./:@+-]*$/, "Use the provider's model ID.");
const price = z.object({ input: z.number().finite().min(0), output: z.number().finite().min(0), cacheRead: z.number().finite().min(0).optional() }).strict();
export const TargetSchema = z.object({ connectionId: z.string().min(1).max(100), model: modelId.optional() }).strict();
export const ConnectionInput = z.object({
  id: z.string().uuid().optional(), name: z.string().trim().min(1).max(100),
  provider: z.string().refine(isProviderId, "Choose a provider."),
  key: z.string().trim().min(8).max(4096).regex(/^\S+$/).optional(),
  baseUrl: z.string().max(2000).optional(), model: modelId.optional(),
  models: z.object({ strategist: modelId.optional(), operator: modelId.optional(), fast: modelId.optional() }).strict().default({}),
  prices: z.record(z.string().max(240), price).default({}),
  enabled: z.boolean().default(true), auto: z.boolean().default(true),
  strengths: z.array(z.enum(["reasoning", "writing", "research", "fast"])).max(4).default([]),
  contextWindow: z.number().int().min(1024).max(100_000_000).optional(),
  cloudflare: z.object({
    accountId: z.string().regex(/^[a-fA-F0-9]{32}$/, "Cloudflare account IDs contain 32 hex characters."),
    gatewayId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/, "Use the gateway slug from Cloudflare."),
    collectLogs: z.boolean().default(false),
    dynamicRoute: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/).optional(),
  }).strict().optional(),
}).strict();
export const RoutingInput = z.object({
  includeOriginal: z.boolean().optional(),
  mode: z.enum(["manual", "auto"]), policy: z.enum(["quality", "balanced", "cost"]),
  defaultConnectionId: z.string().min(1).max(100).optional(),
  tasks: z.partialRecord(z.enum(Object.keys(AI_TASKS) as [keyof typeof AI_TASKS, ...(keyof typeof AI_TASKS)[]]), TargetSchema.optional()).default({}),
}).strict();

export function routingStatus(): RoutingStatus {
  const ai = readSettings().ai;
  const connections = [...(ai?.connections ?? [])];
  const legacy = legacyProvider();
  if (legacy) connections.unshift({
    id: "legacy", name: `${legacy.preset.name} (original setup)`, provider: legacy.id,
    baseUrl: legacy.baseUrl, model: legacy.models.operator, models: legacy.models,
    available: ai?.available ?? Object.values(legacy.models), prices: legacy.prices,
    enabled: true, auto: ai?.routing?.includeOriginal ?? true, strengths: [], key: ai?.keys?.[legacy.id],
  });
  return {
    connections, routing: ai?.routing ?? { mode: "manual", policy: "balanced", tasks: {} },
    ready: Object.fromEntries(connections.map((c) => [c.id, Boolean(c.id === "legacy" ? legacy : connectionProvider(c))])),
  };
}

export async function saveConnection(raw: unknown) {
  const input = ConnectionInput.parse(raw);
  const before = readSettings().ai;
  const old = input.id ? before?.connections?.find((c) => c.id === input.id) : undefined;
  if (input.id && !old) throw new Error("That connection was removed. Add a new connection.");
  if (old && old.provider !== input.provider) throw new Error("Add a new connection to use another provider.");
  const preset = providerById(input.provider)!;
  const id = old?.id ?? randomUUID();
  let baseUrl = preset.baseUrl;
  if (preset.id === "custom" || preset.id === "ollama") {
    baseUrl = cleanBaseUrl(input.baseUrl ?? old?.baseUrl ?? preset.baseUrl) ?? "";
    if (!baseUrl) throw new Error("Use an HTTPS API base URL, or HTTP on this computer.");
  }
  if (preset.id === "cloudflare") {
    if (!input.cloudflare) throw new Error("Enter the Cloudflare account and gateway IDs.");
    const cf = input.cloudflare;
    baseUrl = `https://api.cloudflare.com/client/v4/accounts/${cf.accountId}/ai/v1`;
  } else if (input.cloudflare) throw new Error("Cloudflare options require a Cloudflare connection.");
  if (old && old.baseUrl !== baseUrl && old.key && !input.key) throw new Error("Enter the key again when changing an endpoint or account.");
  const key = input.key ?? (old?.key ? readAiKey(`connection:${id}`) : undefined) ?? preset.env.map((n) => process.env[n]).find(Boolean);
  if (preset.needsKey && !key) throw new Error(`Enter a ${preset.name} key, or set ${preset.env[0]} on the server.`);
  let available = old?.available ?? [];
  let prices = { ...old?.prices, ...input.prices };
  // Cloudflare's REST API has no documented OpenAI model-list endpoint. Use canonical IDs from its catalog.
  // Saving validates configuration only; do not charge for a completion to test a key.
  if (preset.id !== "cloudflare") {
    if (preset.kind === "anthropic") {
      try {
        const response = await new Anthropic({ apiKey: key, timeout: 15_000, maxRetries: 0 }).models.list({ limit: 100 });
        available = response.data.map((m) => m.id);
      } catch (e) {
        if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) throw new Error("Anthropic rejected that key.");
        if (!input.model && !old?.model) throw new Error("Couldn't list models. Enter a model ID to save without verification.");
      }
    } else {
      const listed = await listModels(baseUrl, key, preset.name);
      if (listed.ok) { available = rankModels(preset, listed.models); prices = { ...listed.prices, ...prices }; }
      else if (listed.status === 401 || listed.status === 403) throw new Error(`${preset.name} rejected that key.`);
      else if (!input.model && !old?.model) throw new Error("Couldn't list models. Enter a model ID to save without verification.");
    }
  }
  const model = input.cloudflare?.dynamicRoute ? `dynamic/${input.cloudflare.dynamicRoute}` : input.model ?? old?.model ?? available[0] ?? (preset.kind === "anthropic" ? MODEL_IDS.operator : undefined);
  if (!model) throw new Error("Choose or enter a tool-capable chat model ID.");
  if ((preset.id === "vercel" || preset.id === "cloudflare") && !model.includes("/")) throw new Error("Gateway model IDs include a provider, for example provider/model. Copy one from the gateway catalog.");
  if (preset.id === "vercel" || preset.id === "cloudflare") for (const tierModel of Object.values(input.models)) {
    if (!tierModel.includes("/")) throw new Error("Every gateway tier model must include its provider prefix.");
  }
  // Re-read after I/O so edits to other connections or routes made meanwhile are retained.
  const latest = readSettings().ai;
  if (old && !latest?.connections?.some((c) => c.id === id)) throw new Error("That connection was removed while checking its models.");
  const connection: AiConnection = { id, name: input.name, provider: preset.id, baseUrl, model,
    models: input.cloudflare?.dynamicRoute ? {} : tierModels(model, available, input.models), available: [...new Set([model, ...Object.values(input.models), ...available])], prices,
    enabled: input.enabled, auto: input.auto, strengths: [...new Set(input.strengths)], contextWindow: input.contextWindow,
    key: input.key ? { hint: keyHint(input.key), store: saveAiKey(`connection:${id}`, input.key), savedAt: new Date().toISOString() } : old?.key,
    cloudflare: input.cloudflare,
  };
  const original = legacyProvider();
  const base = latest ?? (original ? {
    provider: original.id, baseUrl: original.baseUrl, model: original.models.operator,
    models: original.models, available: Object.values(original.models), prices: original.prices,
  } : { provider: preset.id });
  writeSettings({ ai: { ...base, connections: [...(latest?.connections ?? []).filter((c) => c.id !== id), connection], routing: latest?.routing ?? { mode: "manual", policy: "balanced", tasks: {}, defaultConnectionId: original ? undefined : id } } });
  return routingStatus();
}

export function saveRouting(raw: unknown) {
  const routing = RoutingInput.parse(raw) as AiRouting;
  const status = routingStatus();
  const targets = [...Object.values(routing.tasks), ...(routing.defaultConnectionId ? [{ connectionId: routing.defaultConnectionId }] : [])];
  for (const target of targets) {
    if (!target) continue;
    const c = status.connections.find((c) => c.id === target.connectionId);
    if (!c || !status.ready[c.id]) throw new Error("Choose an enabled connection with credentials for every route.");
    if (target.model && ![c.model, ...Object.values(c.models), ...c.available].includes(target.model)) throw new Error("Add that model to the connection before routing to it.");
    if (c.cloudflare?.dynamicRoute && target.model && target.model !== c.model) throw new Error("Dynamic Cloudflare connections use their configured route model.");
  }
  if (routing.mode === "auto" && !status.connections.some((c) => (c.id === "legacy" ? routing.includeOriginal ?? true : c.auto) && status.ready[c.id])) throw new Error("Enable at least one connection for automatic routing.");
  const ai = readSettings().ai;
  writeSettings({ ai: { ...(ai ?? { provider: "anthropic" }), routing } });
  return routingStatus();
}

export function removeConnection(id: string) {
  const ai = readSettings().ai;
  if (!ai?.connections?.some((c) => c.id === id)) throw new Error("Connection not found.");
  const routing = ai.routing ? { ...ai.routing, tasks: { ...ai.routing.tasks } } : undefined;
  if (routing?.defaultConnectionId === id) delete routing.defaultConnectionId;
  if (routing) for (const [task, target] of Object.entries(routing.tasks)) if (target?.connectionId === id) delete routing.tasks[task as keyof typeof AI_TASKS];
  writeSettings({ ai: { ...ai, connections: ai.connections.filter((c) => c.id !== id), routing } });
  deleteAiKey(`connection:${id}`);
  return routingStatus();
}
