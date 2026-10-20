import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { readSettings } from "@/lib/store/settings";
import { AgentError } from "./errors";

/**
 * Resolves credentials in this order: a key saved in Settings, then the SDK defaults
 * (ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, or an `ant auth login` profile).
 */
export function getAnthropicClient(): Anthropic {
  const saved = readSettings().anthropicApiKey;
  if (saved) return new Anthropic({ apiKey: saved, maxRetries: 3 });
  if (!hasEnvCredentials()) {
    throw new AgentError("Add your Anthropic API key in Settings to put your Head of GTM to work.", "no_key");
  }
  return new Anthropic({ maxRetries: 3 });
}

function hasEnvCredentials(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_PROFILE);
}

export function isConfigured(): boolean {
  return Boolean(readSettings().anthropicApiKey) || hasEnvCredentials();
}
