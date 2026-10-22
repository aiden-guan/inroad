import "server-only";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { writeFileAtomic } from "@/lib/store/data-file";
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

/** The longest TTL any lookup uses (GitHub profiles of stargazers): an older file is never served again. */
const MAX_TTL = 4 * TTL.week;

/**
 * Only the kind of lookup is readable in a file name ("podcasts_v1", "gh_owner"): the rest of a key can be
 * a person's name, company or login, so it goes into the hash.
 */
function fileFor(key: string) {
  const hash = crypto.createHash("sha1").update(key).digest("hex").slice(0, 16);
  const kind = key.split(":").slice(0, 2).join("_").replace(/[^a-z0-9._-]+/gi, "_").slice(0, 40);
  return path.join(CACHE_DIR, `${kind}.${hash}.json`);
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
    writeFileAtomic(file, JSON.stringify(value));
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

/**
 * Removes lookups past the longest TTL (no read would use them again), so the folder doesn't keep what it
 * fetched about people indefinitely. Run when the server starts. Returns how many went.
 */
export function pruneCache(now = Date.now()): number {
  let removed = 0;
  let names: string[];
  try {
    names = fs.readdirSync(CACHE_DIR);
  } catch {
    return 0;
  }
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const file = path.join(CACHE_DIR, name);
    try {
      const st = fs.lstatSync(file);
      if (!st.isFile() || now - st.mtimeMs < MAX_TTL) continue;
      fs.unlinkSync(file);
      removed++;
    } catch {
      // gone already
    }
  }
  return removed;
}
