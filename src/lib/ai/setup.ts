import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { AiStatus } from "@/components/settings/types";
import { aiKeyStore, deleteAiKey, keyHint, readAiKey, saveAiKey } from "@/lib/store/ai-keys";
import { readSettings, writeSettings, type AiSettings, type ModelPrice } from "@/lib/store/settings";
import { activeProvider } from "./client";
import type { ModelTier } from "./models";
import { listModels } from "./openai-compat";
import { activeSearch } from "@/lib/search/search";
import { cleanBaseUrl, cleanModelId, detectProvider, PROVIDERS, providerById, rankModels, type ProviderId, type ProviderPreset } from "./providers";

/**
 * Choosing and changing the AI provider (Settings and first run). A key is checked with the provider before
 * it's saved, by listing the models it can use, which also fills the model picker.
 */

export function aiStatus(): AiStatus {
  const ai = readSettings().ai;
  const active = activeProvider();
  const saved: AiStatus["saved"] = {};
  for (const [id, v] of Object.entries(ai?.keys ?? {})) if (v) saved[id as ProviderId] = { hint: v.hint, store: aiKeyStore(id as ProviderId, v.store) };
  const env = PROVIDERS.filter((p) => p.env.some((name) => process.env[name])).map((p) => p.id);
  if (process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_PROFILE) if (!env.includes("anthropic")) env.push("anthropic");
  const inUse = active && active.kind === "openai" ? [...new Set(Object.values(active.models))] : [];
  return {
    active: active ? { id: active.id, ...(active.connectionId ? { connectionId: active.connectionId } : {}), name: active.name, kind: active.kind, models: active.models, billingUrl: active.preset.billingUrl } : null,
    chosen: ai?.provider ?? null,
    baseUrl: ai?.baseUrl ?? null,
    model: ai?.model ?? null,
    models: ai?.models ?? {},
    available: ai?.available ?? [],
    prices: ai?.prices ?? {},
    saved,
    keychain: process.platform === "darwin" ? "your Mac's Keychain" : process.platform === "win32" ? "Windows Credential Manager" : "your system keyring",
    defaultKeyStore: ["prefer-file", "off"].includes(process.env.INROAD_KEYCHAIN ?? "") ? "file" : "keychain",
    env,
    unpriced: inUse.some((m) => !active?.prices[m]),
    webSearch: active?.kind === "anthropic" ? "built_in" : (activeSearch()?.id ?? "none"),
  };
}

export interface AiSetupInput {
  provider: ProviderId;
  /** A key to check and save. Leave out to keep the one saved (or use the environment's). */
  key?: string;
  /** Custom endpoints and Ollama. */
  baseUrl?: string;
  model?: string;
  models?: Partial<Record<ModelTier, string | null>>;
  prices?: Record<string, ModelPrice | null>;
  /** Read the model list again. */
  refresh?: boolean;
}

export type SetupResult = { ok: true } | { ok: false; error: string };

const fail = (error: string): SetupResult => ({ ok: false, error });

/** "OpenAI", "xAI", "Ollama": the provider's name without the note in brackets. */
const label = (p: ProviderPreset) => p.name.replace(/ \(.*\)$/, "");

/** A key pasted under the wrong provider, when its prefix says so for certain. */
function mismatch(preset: ProviderPreset, key: string): string | null {
  const detected = detectProvider(key);
  if (!detected || detected === preset.id) return null;
  // "sk-…" without proj/svcacct could be DeepSeek, Together or a custom endpoint's: not certain enough.
  if (detected === "openai" && !/^sk-(proj|svcacct)-/.test(key)) return null;
  const other = providerById(detected)!;
  const a = (p: ProviderPreset) => `${/^[AEIOU]/.test(label(p)) ? "an" : "a"} ${label(p)}`;
  return `That looks like ${a(other)} key. Pick ${other.name} above, or paste ${a(preset)} key.`;
}

async function checkAnthropic(key: string): Promise<string | null> {
  if (!key.startsWith("sk-ant-")) return "That doesn't look like an Anthropic API key. It starts with sk-ant-.";
  try {
    await new Anthropic({ apiKey: key, maxRetries: 1, timeout: 10_000 }).models.list({ limit: 1 });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) return "Anthropic rejected that key. Check it and try again.";
    // A network hiccup shouldn't block saving a plausible key.
  }
  return null;
}

export async function saveAiSetup(input: AiSetupInput): Promise<SetupResult> {
  const preset = providerById(input.provider);
  if (preset?.id === "cloudflare") return fail("Add Cloudflare under AI connections, including your account and gateway IDs.");
  if (!preset) return fail("Pick a provider.");
  const settings = readSettings();
  const prev: AiSettings | undefined = settings.ai;
  const same = prev?.provider === preset.id;
  const key = input.key?.trim() || undefined;
  if (key && (/\s/.test(key) || key.length < 8)) return fail("That doesn't look like a whole key. Copy it again and paste all of it.");
  if (key) {
    const wrong = mismatch(preset, key);
    if (wrong) return fail(wrong);
  }

  const next: AiSettings = { ...(same ? prev : {}), provider: preset.id, keys: prev?.keys, connections: prev?.connections, routing: prev?.routing ? { ...prev.routing, defaultConnectionId: undefined } : undefined };
  delete next.baseUrl;

  if (preset.kind === "anthropic") {
    if (key) {
      const problem = await checkAnthropic(key);
      if (problem) return fail(problem);
    } else if (!readAiKey("anthropic") && !process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN && !process.env.ANTHROPIC_PROFILE) {
      return fail("Paste your Anthropic API key. It starts with sk-ant-.");
    }
    if (key) next.keys = { ...next.keys, anthropic: { hint: keyHint(key), store: saveAiKey("anthropic", key), savedAt: new Date().toISOString() } };
    for (const field of ["model", "models", "available", "prices"] as const) delete next[field];
    writeSettings({ ai: { ...next, connections: readSettings().ai?.connections, routing: readSettings().ai?.routing ? { ...readSettings().ai!.routing!, defaultConnectionId: undefined } : undefined }, anthropicApiKey: undefined });
    return { ok: true };
  }

  // Where to reach it: the preset's address (OpenAI's can be moved with OPENAI_BASE_URL, as at run time), or
  // the one typed for a custom endpoint or another Ollama port.
  let baseUrl = (preset.id === "openai" && process.env.OPENAI_BASE_URL && cleanBaseUrl(process.env.OPENAI_BASE_URL)) || preset.baseUrl;
  if (preset.id === "custom" || preset.id === "ollama") {
    const typed = input.baseUrl ?? (same ? prev?.baseUrl : undefined) ?? preset.baseUrl;
    const clean = typed ? cleanBaseUrl(typed) : null;
    if (!clean) return fail(preset.id === "custom" ? "Paste the API's base URL, like https://api.example.com/v1. It has to start with https:// (http:// only for this computer)." : "That address doesn't work. Ollama is usually at http://localhost:11434/v1.");
    baseUrl = clean;
    if (clean !== preset.baseUrl) next.baseUrl = clean;
  }

  const useKey = key ?? readAiKey(preset.id) ?? preset.env.map((n) => process.env[n]).find(Boolean);
  if (preset.needsKey && !useKey) return fail(`Paste your ${label(preset)} API key.`);

  // Check the key and read the models it can use (on a new key, a new address, or when asked).
  if (key || input.refresh || !same || !prev?.available?.length || input.baseUrl !== undefined) {
    const listed = await listModels(baseUrl, useKey, label(preset));
    if (!listed.ok) {
      if (listed.status === 401 || listed.status === 403) {
        const hint = preset.id === "openai" && key?.startsWith("sk-") && !/^sk-(proj|svcacct)-/.test(key) ? " If it's a DeepSeek or Together key, pick that provider above." : "";
        return fail(`${label(preset)} rejected that key. Check it and try again.${hint}`);
      }
      if (listed.status === undefined) {
        // Can't reach it. A key is still worth keeping; the model then has to be typed.
        if (preset.id === "ollama") return fail("Couldn't reach Ollama. Start it (ollama serve), then try again.");
        if (!input.model && !next.model) return fail(`${listed.error} Check the address and your connection, then try again.`);
      } else if (!input.model && !next.model) {
        return fail(`${label(preset)} answered with an error (${listed.status}): ${listed.error.slice(0, 160)}`);
      }
    } else {
      next.available = rankModels(preset, listed.models);
      if (preset.id === "ollama" && !next.available.length) return fail("Ollama is running but has no models yet. Pull one that supports tools (for example: ollama pull qwen3), then try again.");
      // Published prices (OpenRouter) fill in, never over a price the founder set.
      const published = Object.fromEntries(Object.entries(listed.prices).map(([id, p]) => [cleanModelId(id), p]));
      next.prices = { ...published, ...(same ? prev?.prices : {}) };
    }
  }

  if (key && preset.needsKey) next.keys = { ...next.keys, [preset.id]: { hint: keyHint(key), store: saveAiKey(preset.id, key), savedAt: new Date().toISOString() } };

  const model = input.model !== undefined ? cleanModelId(input.model) : next.model;
  next.model = model || next.available?.[0];
  if (!next.model) return fail("Pick or type the model to use.");
  if (input.models) {
    const models = { ...next.models };
    for (const [tier, id] of Object.entries(input.models) as [ModelTier, string | null][]) {
      if (id) models[tier] = cleanModelId(id);
      else delete models[tier];
    }
    next.models = models;
  }
  if (input.prices) {
    const prices = { ...next.prices };
    for (const [id, p] of Object.entries(input.prices)) {
      if (p) prices[cleanModelId(id)] = p;
      else delete prices[cleanModelId(id)];
    }
    next.prices = prices;
  }
  writeSettings({ ai: { ...next, connections: readSettings().ai?.connections, routing: readSettings().ai?.routing ? { ...readSettings().ai!.routing!, defaultConnectionId: undefined } : undefined }, anthropicApiKey: undefined });
  return { ok: true };
}

/** Forgets a provider's saved key. If it was the one in use, Inroad falls back to an environment key or asks again. */
export function removeAiKey(id: ProviderId) {
  deleteAiKey(id);
  const settings = readSettings();
  const ai = settings.ai;
  if (id === "anthropic") writeSettings({ anthropicApiKey: undefined });
  if (!ai) return;
  const keys = { ...ai.keys };
  delete keys[id];
  writeSettings({ ai: { ...ai, keys } });
}
