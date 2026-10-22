import "server-only";
import { secureDataDir } from "@/lib/store/data-file";
import { DATA_DIR } from "@/lib/store/settings";

/** Called by src/instrumentation.ts once per server start. Each step is best-effort: a failure is logged, never fatal. */
export async function onServerStart() {
  try {
    // Files written before owner-only writes (or copied in with a loose umask) become readable by you alone.
    const { changed } = secureDataDir(DATA_DIR);
    if (changed) console.log(`[inroad] Made ${changed} data file${changed === 1 ? "" : "s"} in ${DATA_DIR} readable by you only.`);
  } catch (err) {
    console.warn("[inroad] Couldn't check the data folder's permissions:", err instanceof Error ? err.message : err);
  }
}
