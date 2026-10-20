import "server-only";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "@/lib/store/settings";

/**
 * Disk cache for free signal lookups, so repeated research reuses what we already fetched
 * (job boards 24h, news 12h, websites 7d). Keeps both network load and token spend down.
 */
const CACHE_DIR = path.join(DATA_DIR, "cache");

export const TTL = {
  hour: 3_600_000,
  day: 86_400_000,
  week: 7 * 86_400_000,
};

function fileFor(key: string) {
  const hash = crypto.createHash("sha1").update(key).digest("hex").slice(0, 16);
  const safe = key.replace(/[^a-z0-9._-]+/gi, "_").slice(0, 60);
  return path.join(CACHE_DIR, `${safe}.${hash}.json`);
}

export async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const file = fileFor(key);
  try {
    const stat = fs.statSync(file);
    if (Date.now() - stat.mtimeMs < ttlMs) return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    // miss
  }
  const value = await load();
  // null/undefined means the lookup failed (site unreachable, DNS error): retry next time.
  if (value == null) return value;
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value));
  } catch {
    // cache is best-effort
  }
  return value;
}

export function invalidate(key: string) {
  try {
    fs.unlinkSync(fileFor(key));
  } catch {
    // nothing cached
  }
}
