import "server-only";
import path from "node:path";
import { readDataFile, writeDataFile } from "./data-file";

/** Local-only settings. Lives next to the workspace data and never leaves this machine. */
export interface Settings {
  anthropicApiKey?: string;
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
