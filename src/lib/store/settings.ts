import "server-only";
import path from "node:path";
import type { ModelTier } from "@/lib/ai/models";
import type { ProviderId } from "@/lib/ai/providers";
import type { KeyStore } from "./ai-keys";
import { readDataFile, writeDataFile } from "./data-file";

/** Per-million-token prices for a model the app has no price table for (set by the founder, or read from OpenRouter). */
export interface ModelPrice {
  input: number;
  output: number;
  cacheRead?: number;
}

/**
 * Which AI provider runs the work. Keys are never here: they live in the OS keychain or the encrypted
 * key file (store/ai-keys.ts); `keys` only remembers that one is saved, where, and its last four characters.
 */
export interface AiSettings {
  provider: ProviderId;
  /** Custom endpoints and a non-default Ollama address. */
  baseUrl?: string;
  /** The model that runs everything (providers other than Anthropic). */
  model?: string;
  /** Per-task overrides of `model`. */
  models?: Partial<Record<ModelTier, string>>;
  /** The provider's chat models when the key was checked, for the picker and the quick-tier sibling. */
  available?: string[];
  prices?: Record<string, ModelPrice>;
  keys?: Partial<Record<ProviderId, { hint: string; store: KeyStore; savedAt: string }>>;
}

/** Local-only settings. Lives next to the workspace data and never leaves this machine. */
export interface Settings {
  /** Before keys moved to the keychain. Read once, moved into the key store, then removed (client.ts). */
  anthropicApiKey?: string;
  ai?: AiSettings;
  /**
   * Where free news signals come from. Google News RSS gives the best results but its feed terms
   * allow personal, non-commercial use only, so it is opt-in. GDELT is open but noisier.
   */
  newsSource?: "gdelt" | "google_news" | "off";
  /**
   * Places the built-in city list doesn't know (and venue addresses) are looked up on OpenStreetMap's
   * Nominatim. Only the place text is sent, never a name or company. "off" keeps the map to known cities.
   */
  geocoder?: "osm" | "off";
  /**
   * Company marks. "letters" (the default) shows each company's first letter and sends nothing anywhere.
   * "site" fetches each company's icon from its own website, server-side, and caches it (signals/icons.ts).
   * Never a third-party favicon service, which would learn the whole target list.
   */
  companyIcons?: "letters" | "site";
  /**
   * Optional GitHub token (fine-grained, no scopes) for stargazer imports and org lookups: GitHub allows
   * 60 requests an hour without one, 5,000 with. Kept here, never exported.
   */
  githubToken?: string;
  /**
   * An email for SEC EDGAR's User-Agent. The SEC asks automated tools to name a contact; without one,
   * Form D lookups still run but may be refused. Sent only to sec.gov.
   */
  secContact?: string;
}

export const DATA_DIR = process.env.GTM_DATA_DIR ?? path.join(process.cwd(), ".data");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");

/**
 * True when the data folder is inside the folder Inroad runs from (the default `.data/`), where deleting
 * or re-cloning the repository, or `git clean -xfd`, deletes the founder's whole history with it.
 */
export function dataDirInsideApp(dir: string = DATA_DIR, app: string = process.cwd()): boolean {
  const rel = path.relative(path.resolve(app), path.resolve(dir));
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

/** Missing file → {}. A corrupt one throws, so writeSettings can't save over it. */
export function readSettings(): Settings {
  return readDataFile<Settings>(SETTINGS_FILE, () => ({}));
}

export function writeSettings(patch: Partial<Settings>): Settings {
  const next = { ...readSettings(), ...patch };
  for (const key of Object.keys(next) as (keyof Settings)[]) {
    if (next[key] === undefined || next[key] === "") delete next[key];
  }
  writeDataFile(SETTINGS_FILE, next);
  return next;
}
