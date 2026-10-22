import "server-only";
import path from "node:path";
import type { Suppression, Workspace } from "@/lib/domain/types";
import { keepSuppressions } from "./backup";
import { readDataFile, writeDataFile } from "./data-file";
import { DATA_DIR } from "./settings";

/**
 * Who opted out, kept beside the workspace instead of in it: a reset, the sample and a restore replace
 * workspace.json, but never this file. Before each of those, the founder's real workspace adds its
 * opt-outs here (unsubscribed, bounced, asked to be deleted), and a restore adds them all back to what
 * the backup holds. So restoring a backup made before someone opted out keeps them suppressed even when
 * a reset or the sample came in between. Holds addresses only; never in a backup or an export.
 */

export const OPT_OUTS_FILE = "opt-outs.json";

export interface OptOuts {
  suppression: Suppression[];
}

/** The reasons that come from the person, not the founder: these always outlive a replaced workspace. */
const THEIRS: Suppression["reason"][] = ["requested_delete", "unsubscribe", "bounce"];

const file = () => path.join(DATA_DIR, OPT_OUTS_FILE);

export function readOptOuts(): OptOuts {
  return readDataFile<OptOuts>(file(), () => ({ suppression: [] }), (raw) => ({ suppression: Array.isArray((raw as OptOuts)?.suppression) ? (raw as OptOuts).suppression : [] }));
}

/**
 * Adds the workspace's opt-outs to the file before something replaces it. The sample's are made up and
 * never count. Throws when it can't write, so the caller can refuse to replace anything.
 */
export function rememberOptOuts(ws: Workspace): void {
  if (ws.sample) return;
  const theirs = (ws.suppression ?? []).filter((s) => THEIRS.includes(s.reason));
  if (!theirs.length) return;
  try {
    const now = readOptOuts();
    const { list, kept } = keepSuppressions(now.suppression, theirs);
    if (kept) writeDataFile(file(), { ...now, suppression: list });
  } catch (err) {
    const why = err instanceof Error ? err.message : "the disk refused the write";
    throw new Error(`I couldn't save your suppression list first, so nothing was changed. ${why}`);
  }
}
