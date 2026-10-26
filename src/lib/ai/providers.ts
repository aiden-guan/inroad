/**
 * The AI providers a founder can run Inroad on. Shared by the server and the Settings screen.
 *
 * Anthropic runs on its own API (the engine's native path: adaptive thinking, server-side web tools,
 * prompt caching). Everyone else speaks the OpenAI-style Chat Completions API, so one adapter
 * (openai-compat.ts) covers OpenAI, Gemini, Grok, Groq, OpenRouter, Mistral, DeepSeek, Together, a
 * local Ollama, and any other OpenAI-compatible endpoint.
 *
 * Model names change faster than releases of this app, so nothing here pins one: after a key is
 * checked, the provider's own /models list is read and the founder picks from what their key can use.
 * `prefer` only orders that list for the first suggestion.
 */

import type { ModelTier } from "./models";

export type ProviderId = "anthropic" | "openai" | "gemini" | "xai" | "groq" | "openrouter" | "mistral" | "deepseek" | "together" | "ollama" | "custom";

/** Optional request fields a provider is known to accept. Anything not listed is left out (compat mode drops a rejected one). */
export interface ProviderCaps {
  /** `reasoning_effort` (reasoning models). */
  reasoningEffort: boolean;
  /** `stream_options: { include_usage: true }` (token counts at the end of a stream). */
  streamUsage: boolean;
  /** The output cap's field name, when a caller sets one. */
  tokenParam: "max_tokens" | "max_completion_tokens";
}

export interface ProviderPreset {
  id: ProviderId;
  name: string;
  /** Wire protocol. */
  kind: "anthropic" | "openai";
  /** Default API base. Custom and Ollama can be changed in Settings. */
  baseUrl: string;
  /** False for a local server that takes no key (Ollama). */
  needsKey: boolean;
  /** Where to make a key (or install the server). */
  keyUrl: string;
  /** Where to add credits when the provider says the balance is used up. */
  billingUrl: string;
  /** Recognizes a pasted key. Ambiguous prefixes ("sk-") only suggest; the founder can switch. */
  keyPattern?: RegExp;
  placeholder: string;
  /** Environment variables that hold a key, first wins. */
  env: string[];
  caps: ProviderCaps;
  /** Orders the /models list for the first suggestion. */
  prefer: RegExp[];
  /** One line under the picker. */
  blurb: string;
}

const NONE: ProviderCaps = { reasoningEffort: false, streamUsage: false, tokenParam: "max_tokens" };

export const PROVIDERS: ProviderPreset[] = [
  {
    id: "anthropic",
    name: "Anthropic (Claude)",
    kind: "anthropic",
    baseUrl: "https://api.anthropic.com",
    needsKey: true,
    keyUrl: "https://console.anthropic.com/settings/keys",
    billingUrl: "https://console.anthropic.com/settings/billing",
    keyPattern: /^sk-ant-/,
    placeholder: "sk-ant-…",
    env: ["ANTHROPIC_API_KEY"],
    caps: NONE,
    prefer: [],
    blurb: "What Inroad was built on: built-in web search and the best results.",
  },
  {
    id: "openai",
    name: "OpenAI",
    kind: "openai",
    baseUrl: "https://api.openai.com/v1",
    needsKey: true,
    keyUrl: "https://platform.openai.com/api-keys",
    billingUrl: "https://platform.openai.com/settings/organization/billing",
    keyPattern: /^sk-(proj|svcacct)-|^sk-(?!ant-|or-)[A-Za-z0-9_-]{20,}$/,
    placeholder: "sk-…",
    env: ["OPENAI_API_KEY"],
    caps: { reasoningEffort: true, streamUsage: true, tokenParam: "max_completion_tokens" },
    prefer: [/^gpt-5(\.\d+)?$/, /^gpt-5/, /^gpt-4\.1$/, /^gpt-4o$/, /^o\d/],
    blurb: "GPT models with your OpenAI key.",
  },
  {
    id: "gemini",
    name: "Google Gemini",
    kind: "openai",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    needsKey: true,
    keyUrl: "https://aistudio.google.com/apikey",
    billingUrl: "https://aistudio.google.com",
    keyPattern: /^AIza[0-9A-Za-z_-]{20,}$/,
    placeholder: "AIza…",
    env: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
    caps: { ...NONE, streamUsage: true },
    prefer: [/^gemini-[\d.]+-pro$/, /^gemini-.*-pro/, /^gemini-[\d.]+-flash$/, /^gemini/],
    blurb: "Gemini models with a Google AI Studio key.",
  },
  {
    id: "xai",
    name: "xAI (Grok)",
    kind: "openai",
    baseUrl: "https://api.x.ai/v1",
    needsKey: true,
    keyUrl: "https://console.x.ai",
    billingUrl: "https://console.x.ai",
    keyPattern: /^xai-/,
    placeholder: "xai-…",
    env: ["XAI_API_KEY"],
    caps: NONE,
    prefer: [/^grok-\d+$/, /^grok-\d/, /^grok/],
    blurb: "Grok models with your xAI key.",
  },
  {
    id: "groq",
    name: "Groq",
    kind: "openai",
    baseUrl: "https://api.groq.com/openai/v1",
    needsKey: true,
    keyUrl: "https://console.groq.com/keys",
    billingUrl: "https://console.groq.com/settings/billing",
    keyPattern: /^gsk_/,
    placeholder: "gsk_…",
    env: ["GROQ_API_KEY"],
    caps: NONE,
    prefer: [/gpt-oss-120b/, /llama-3\.3-70b/, /kimi/, /qwen/, /llama/],
    blurb: "Open models (Llama, Qwen, gpt-oss) on Groq's fast hardware.",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    kind: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    needsKey: true,
    keyUrl: "https://openrouter.ai/keys",
    billingUrl: "https://openrouter.ai/credits",
    keyPattern: /^sk-or-/,
    placeholder: "sk-or-…",
    env: ["OPENROUTER_API_KEY"],
    caps: NONE,
    prefer: [/^openrouter\/auto$/],
    blurb: "Hundreds of models from one key. Prices come with the model list.",
  },
  {
    id: "mistral",
    name: "Mistral",
    kind: "openai",
    baseUrl: "https://api.mistral.ai/v1",
    needsKey: true,
    keyUrl: "https://console.mistral.ai/api-keys",
    billingUrl: "https://console.mistral.ai",
    placeholder: "Your Mistral key",
    env: ["MISTRAL_API_KEY"],
    caps: NONE,
    prefer: [/^mistral-large-latest$/, /^mistral-medium-latest$/, /^mistral-large/, /^mistral-medium/],
    blurb: "Mistral's models with your La Plateforme key.",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    kind: "openai",
    baseUrl: "https://api.deepseek.com/v1",
    needsKey: true,
    keyUrl: "https://platform.deepseek.com/api_keys",
    billingUrl: "https://platform.deepseek.com",
    placeholder: "sk-…",
    env: ["DEEPSEEK_API_KEY"],
    caps: { ...NONE, streamUsage: true },
    prefer: [/^deepseek-chat$/],
    blurb: "DeepSeek's models with your DeepSeek key.",
  },
  {
    id: "together",
    name: "Together AI",
    kind: "openai",
    baseUrl: "https://api.together.xyz/v1",
    needsKey: true,
    keyUrl: "https://api.together.ai",
    billingUrl: "https://api.together.ai",
    placeholder: "Your Together key",
    env: ["TOGETHER_API_KEY"],
    caps: NONE,
    prefer: [/Llama-3\.3-70B-Instruct-Turbo/i, /Qwen/i, /DeepSeek-V3/i],
    blurb: "Open models hosted by Together.",
  },
  {
    id: "ollama",
    name: "Ollama (on this computer)",
    kind: "openai",
    baseUrl: "http://localhost:11434/v1",
    needsKey: false,
    keyUrl: "https://ollama.com/download",
    billingUrl: "https://ollama.com",
    placeholder: "",
    env: [],
    caps: NONE,
    prefer: [],
    blurb: "Free and private: models running on your own machine. Pick one that supports tools.",
  },
  {
    id: "custom",
    name: "Other (OpenAI-compatible)",
    kind: "openai",
    baseUrl: "",
    needsKey: true,
    keyUrl: "",
    billingUrl: "",
    placeholder: "Your key",
    env: ["INROAD_AI_KEY"],
    caps: NONE,
    prefer: [],
    blurb: "Any service with an OpenAI-compatible API: paste its base URL and key.",
  },
];

const BY_ID = new Map(PROVIDERS.map((p) => [p.id, p]));

export function providerById(id: string | null | undefined): ProviderPreset | undefined {
  return id ? BY_ID.get(id as ProviderId) : undefined;
}

export function isProviderId(id: unknown): id is ProviderId {
  return typeof id === "string" && BY_ID.has(id as ProviderId);
}

/** The provider a pasted key most likely belongs to, or null when the key doesn't say. */
export function detectProvider(key: string): ProviderId | null {
  const k = key.trim();
  if (!k) return null;
  for (const id of ["anthropic", "openrouter", "groq", "xai", "gemini", "openai"] as const) {
    if (BY_ID.get(id)!.keyPattern?.test(k)) return id;
  }
  return null;
}

/** Models that can't hold a conversation with tools: embeddings, speech, images, moderation, search previews. */
const NOT_CHAT = /(embed|whisper|tts|audio|realtime|transcribe|dall-e|image|moderation|search|davinci|babbage|guard|rerank|ocr|speech|computer-use)/i;

/** Chat models from a provider's /models list, the preferred ones first, otherwise in the provider's order. */
export function rankModels(provider: ProviderPreset, ids: string[]): string[] {
  const chat = [...new Set(ids.map(cleanModelId))].filter((id) => id && !NOT_CHAT.test(id));
  const preferred: string[] = [];
  for (const re of provider.prefer) for (const id of chat) if (re.test(id) && !preferred.includes(id)) preferred.push(id);
  return [...preferred, ...chat.filter((id) => !preferred.includes(id))];
}

/** Gemini lists its models as "models/gemini-…"; requests take the bare name. */
export function cleanModelId(id: string): string {
  return id.trim().replace(/^models\//, "");
}

/** Smaller siblings, for the quick tier when the founder hasn't picked one: gpt-x → gpt-x-mini. */
const SMALL = ["-mini", "-flash", "-lite", "-nano", "-small", "-fast"];

/**
 * Which model each tier uses. One chosen model runs everything unless the founder picked per task; the
 * quick tier (classification, short rewrites) takes a smaller sibling of it when the key has one.
 */
export function tierModels(main: string, available: string[] = [], picked: Partial<Record<ModelTier, string>> = {}): Record<ModelTier, string> {
  const small = SMALL.map((s) => `${main}${s}`).find((id) => available.includes(id));
  return {
    strategist: picked.strategist || main,
    operator: picked.operator || main,
    fast: picked.fast || small || main,
  };
}

/** A base URL a founder typed: https anywhere, plain http only for this computer. Returns the cleaned URL or null. */
export function cleanBaseUrl(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  const local = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return null;
  if (url.username || url.password || url.search || url.hash) return null;
  return url.toString().replace(/\/+$/, "");
}
