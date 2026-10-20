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
  writeDataFile(SETTINGS_FILE, next, 0o600);
  return next;
}
