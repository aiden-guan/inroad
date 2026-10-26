/** Shapes shared by the settings routes and the settings page. Types only, safe on both sides. */

import type { ModelTier } from "@/lib/ai/models";
import type { ProviderId } from "@/lib/ai/providers";

export type NewsSource = "gdelt" | "google_news" | "off";
export type Geocoder = "osm" | "off";
export type CompanyIcons = "letters" | "site";

export interface ModelPrice {
  input: number;
  output: number;
  cacheRead?: number;
}

/** The AI provider setup. Keys never leave the server: only which providers have one, its last 4, and where it's kept. */
export interface AiStatus {
  /** The provider doing the work, or null when none is set up yet. */
  active: { id: ProviderId; name: string; kind: "anthropic" | "openai"; models: Record<ModelTier, string>; billingUrl: string } | null;
  /** The provider picked in Settings, even before it works (no key or no model yet). */
  chosen: ProviderId | null;
  baseUrl: string | null;
  /** The model that runs everything (not Anthropic), and any per-task overrides. */
  model: string | null;
  models: Partial<Record<ModelTier, string>>;
  /** The chosen provider's chat models, best first, from when its key was checked. */
  available: string[];
  prices: Record<string, ModelPrice>;
  saved: Partial<Record<ProviderId, { hint: string; store: "keychain" | "file" }>>;
  /** What this computer's credential store is called ("your Mac's Keychain"), for saying where a key is kept. */
  keychain: string;
  /** Providers with a key in this computer's environment variables. */
  env: ProviderId[];
  /** No price is known for a model in use, so spend can't be counted in dollars. */
  unpriced: boolean;
  /** How web research runs: Anthropic's own search, the founder's Firecrawl key, or not at all. */
  webSearch: "built_in" | "firecrawl" | "none";
}

/** GET/POST /api/settings. The key itself never leaves the server; only where it came from and its last 4. */
export interface SettingsStatus {
  /** The active provider is ready to work. */
  hasKey: boolean;
  keySource: "settings" | "env" | null;
  keyHint: string | null;
  ai: AiStatus;
  newsSource: NewsSource;
  /** Whether places outside the built-in city list are looked up on OpenStreetMap. */
  geocoder: Geocoder;
  /** Company marks: first letters only (nothing sent), or each company's icon from its own site. */
  companyIcons: CompanyIcons;
  /** A GitHub token is saved (its last 4 only); it lifts GitHub's limit from 60 to 5,000 lookups an hour. */
  githubTokenHint: string | null;
  /** The contact named to SEC EDGAR with Form D lookups, or null. */
  secContact: string | null;
  /** Absolute path of the folder that holds workspace.json, settings.json and the caches. */
  dataDir: string;
  /** The data folder is inside Inroad's own folder (no GTM_DATA_DIR), so deleting or re-cloning Inroad deletes it. */
  dataDirInApp: boolean;
}

export type CheckStatus = "pass" | "warn" | "fail";

export interface DomainCheck {
  id: "mx" | "spf" | "dkim" | "dmarc";
  label: string;
  status: CheckStatus;
  /** One plain sentence: what I found. */
  summary: string;
  /** What to change, when something should change. */
  fix?: string;
  /** A DNS record to paste, when the fix is a record. */
  record?: { host: string; type: "TXT"; value: string };
  /** What is published today, verbatim. */
  found?: string;
}

/** POST /api/settings/domain-health → this. */
export interface DomainHealthReport {
  domain: string;
  provider: "google" | "microsoft" | "other" | "none";
  checks: DomainCheck[];
  checkedAt: string;
  /** DNS queries made (free, no tokens). */
  lookups: number;
}
