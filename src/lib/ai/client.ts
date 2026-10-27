import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { readAiKey, saveAiKey, keyHint } from "@/lib/store/ai-keys";
import { readSettings, writeSettings, type AiSettings, type ModelPrice } from "@/lib/store/settings";
import { AgentError } from "./errors";
import { MODEL_IDS, type ModelTier } from "./models";
import { cleanBaseUrl, isProviderId, providerById, PROVIDERS, tierModels, type ProviderId, type ProviderPreset } from "./providers";
import type { AiConnection } from "./routing-types";

/**
 * Which provider runs the work, with its key and models. Resolved in this order:
 *  1. the provider chosen in Settings (its key from the keychain or key file, else its env variable)
 *  2. INROAD_AI_PROVIDER (servers and dev scripts), with INROAD_AI_MODEL and INROAD_AI_BASE_URL
 *  3. Anthropic when Anthropic credentials exist (how Inroad worked before providers were a choice)
 *  4. the first provider whose key is in the environment
 */
export interface ActiveProvider {
  connectionId?: string;
  headers?: Record<string, string>;
  preset: ProviderPreset;
  id: ProviderId;
  kind: "anthropic" | "openai";
  name: string;
  apiKey?: string;
  keySource: "saved" | "env" | "none";
  baseUrl: string;
  models: Record<ModelTier, string>;
  prices: Record<string, ModelPrice>;
}

/** Moves a key saved in settings.json by an earlier version into the key store, once. */
function migrateLegacyKey(): AiSettings | undefined {
  const settings = readSettings();
  const legacy = settings.anthropicApiKey;
  if (!legacy) return settings.ai;
  const store = saveAiKey("anthropic", legacy);
  const ai: AiSettings = {
    ...(settings.ai ?? { provider: "anthropic" }),
    keys: { ...settings.ai?.keys, anthropic: { hint: keyHint(legacy), store, savedAt: new Date().toISOString() } },
  };
  writeSettings({ anthropicApiKey: undefined, ai });
  return ai;
}

function envKey(preset: ProviderPreset): string | undefined {
  for (const name of preset.env) if (process.env[name]) return process.env[name];
  if (preset.id === "anthropic") return process.env.ANTHROPIC_AUTH_TOKEN || undefined;
  return undefined;
}

/** Anthropic's SDK also signs in from ANTHROPIC_AUTH_TOKEN or an `ant auth login` profile. */
function hasAnthropicEnv(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_PROFILE);
}

function keyFor(preset: ProviderPreset, ai: AiSettings | undefined): { apiKey?: string; keySource: ActiveProvider["keySource"] } {
  const saved = ai?.keys?.[preset.id] ? readAiKey(preset.id) : undefined;
  if (saved) return { apiKey: saved, keySource: "saved" };
  const env = envKey(preset);
  if (env) return { apiKey: env, keySource: "env" };
  return { keySource: "none" };
}

function baseUrlFor(preset: ProviderPreset, ai: AiSettings | undefined, fromEnv: boolean): string {
  const override = ai?.provider === preset.id ? ai.baseUrl : undefined;
  const env = fromEnv ? process.env.INROAD_AI_BASE_URL : undefined;
  const openaiEnv = preset.id === "openai" ? process.env.OPENAI_BASE_URL : undefined;
  return cleanBaseUrl(override ?? env ?? openaiEnv ?? "") ?? preset.baseUrl;
}

function build(preset: ProviderPreset, ai: AiSettings | undefined, fromEnv: boolean): ActiveProvider | null {
  const { apiKey, keySource } = keyFor(preset, ai);
  if (preset.kind === "anthropic") {
    if (!apiKey && !hasAnthropicEnv()) return null;
    return { preset, id: preset.id, kind: preset.kind, name: "Claude", apiKey, keySource: apiKey ? keySource : "env", baseUrl: preset.baseUrl, models: { ...MODEL_IDS }, prices: {} };
  }
  if (preset.needsKey && !apiKey) return null;
  const baseUrl = baseUrlFor(preset, ai, fromEnv);
  if (!baseUrl) return null;
  const chosen = ai?.provider === preset.id ? ai : undefined;
  const main = chosen?.model ?? (fromEnv ? process.env.INROAD_AI_MODEL : undefined);
  if (!main) return null;
  return {
    preset,
    id: preset.id,
    kind: preset.kind,
    name: preset.name.replace(/ \(.*\)$/, ""),
    apiKey,
    keySource,
    baseUrl,
    models: tierModels(main, chosen?.available ?? [], chosen?.models ?? {}),
    prices: chosen?.prices ?? {},
  };
}

export function legacyProvider(): ActiveProvider | null {
  const ai = migrateLegacyKey();
  const chosen = providerById(ai?.provider);
  if (chosen) return build(chosen, ai, false);
  const fromEnv = process.env.INROAD_AI_PROVIDER;
  if (isProviderId(fromEnv)) return build(providerById(fromEnv)!, ai, true);
  const anthropic = build(providerById("anthropic")!, ai, false);
  if (anthropic) return anthropic;
  for (const p of PROVIDERS) {
    if (p.kind === "openai" && p.needsKey && envKey(p)) {
      const found = build(p, ai, true);
      if (found) return found;
    }
  }
  return null;
}

/** Each saved connection has a separate credential, including multiple accounts at the same vendor. */
export function connectionProvider(connection: AiConnection): ActiveProvider | null {
  if (!connection.enabled) return null;
  const preset = providerById(connection.provider);
  if (!preset) return null;
  const saved = connection.key ? readAiKey(`connection:${connection.id}`) : undefined;
  const apiKey = saved ?? envKey(preset);
  if (preset.needsKey && !apiKey) return null;
  const headers: Record<string, string> = {};
  if (connection.cloudflare) {
    headers["cf-aig-gateway-id"] = connection.cloudflare.gatewayId;
    headers["cf-aig-skip-cache"] = "true";
    headers["cf-aig-collect-log"] = String(connection.cloudflare.collectLogs);
  }
  return {
    preset, id: preset.id, connectionId: connection.id, kind: preset.kind, name: connection.name,
    apiKey, keySource: saved ? "saved" : apiKey ? "env" : "none", baseUrl: connection.baseUrl,
    models: { strategist: connection.model, operator: connection.model, fast: connection.model, ...connection.models },
    prices: connection.prices, headers,
  };
}

export function activeProvider(): ActiveProvider | null {
  const ai = readSettings().ai;
  const id = ai?.routing?.defaultConnectionId;
  if (id && id !== "legacy") {
    const connection = ai?.connections?.find((c) => c.id === id);
    return connection ? connectionProvider(connection) : null;
  }
  return legacyProvider();
}

/** The provider, or a plain-words error saying what's missing. */
export function requireProvider(): ActiveProvider {
  const p = activeProvider();
  if (p) return p;
  const ai = readSettings().ai;
  const preset = providerById(ai?.provider);
  if (preset && preset.kind === "openai" && !ai?.model && (!preset.needsKey || ai?.keys?.[preset.id])) {
    throw new AgentError(`Choose which ${preset.name} model to use in Settings to put your Head of GTM to work.`, "no_key");
  }
  throw new AgentError("Add an AI provider key in Settings to put your Head of GTM to work.", "no_key");
}

/** Anthropic's client, with the saved key or the SDK's own credentials (env, `ant auth login`). */
export function getAnthropicClient(provider: ActiveProvider | null = activeProvider()): Anthropic {
  if (provider?.kind === "anthropic") {
    if (!provider.connectionId) return provider.apiKey && provider.keySource === "saved" ? new Anthropic({ apiKey: provider.apiKey, maxRetries: 3 }) : new Anthropic({ maxRetries: 3 });
    if (provider.keySource === "env" && !process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_AUTH_TOKEN) {
      return new Anthropic({ apiKey: null, authToken: process.env.ANTHROPIC_AUTH_TOKEN, baseURL: provider.baseUrl, maxRetries: 3 });
    }
    return new Anthropic({ apiKey: provider.apiKey, baseURL: provider.baseUrl, maxRetries: 3 });
  }
  const saved = readAiKey("anthropic");
  if (saved) return new Anthropic({ apiKey: saved, maxRetries: 3 });
  if (!hasAnthropicEnv()) throw new AgentError("Add your Anthropic API key in Settings to put your Head of GTM to work.", "no_key");
  return new Anthropic({ maxRetries: 3 });
}

export function isConfigured(): boolean {
  return activeProvider() !== null;
}
