import "server-only";
import { pruneCache } from "@/lib/signals/cache";
import { secureDataDir } from "@/lib/store/data-file";
import { DATA_DIR } from "@/lib/store/settings";
import { resumeNamedTunnel } from "./tunnel";

/**
 * What a server does once when it starts. The launcher (scripts/serve.mjs) asks for it as soon as Next
 * answers (POST /api/startup), so it happens even when nobody opens the app, and the first workspace
 * load asks too, for a server started some other way. Not Next's instrumentation hook: with it, `next
 * dev` (16.4) keeps hot-reloading pages like Today in a loop.
 */
const g = globalThis as unknown as { __inroadStarted?: Promise<void> };

export function ensureStarted(): Promise<void> {
  return (g.__inroadStarted ??= onServerStart());
}

async function onServerStart() {
  try {
    // Files written before owner-only writes (or copied in with a loose umask) become readable by you alone.
    const { changed } = secureDataDir(DATA_DIR);
    if (changed) console.log(`[inroad] Made ${changed} data file${changed === 1 ? "" : "s"} in ${DATA_DIR} readable by you only.`);
  } catch (err) {
    console.warn("[inroad] Couldn't check the data folder's permissions:", err instanceof Error ? err.message : err);
  }
  try {
    // Lookups no read would use again (past the longest TTL) go, so the cache doesn't keep what it found about people.
    pruneCache();
  } catch {
    // best-effort
  }
  // A named tunnel that was on comes back by itself, so the hook and MCP URLs given to other tools keep working.
  // Not awaited: the server answers while cloudflared connects.
  void resumeNamedTunnel(Number(process.env.PORT) || 3000)
    .then((s) => s?.running && console.log(`[inroad] Public URL is back at ${s.url}.`))
    .catch((err) => console.warn("[inroad] Couldn't restart the named tunnel:", err instanceof Error ? err.message : err));
}

/** For tests: forget that this process already started. */
export function resetStarted() {
  delete g.__inroadStarted;
}
