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
 * a reset or the sample came in between. Holds addresses and deletion fingerprints only (forgetKeys);
 * never in a backup or an export.
 */

export const OPT_OUTS_FILE = "opt-outs.json";

export interface OptOuts {
  suppression: Suppression[];
  /** `ws.forgotten` of every real workspace that was replaced. */
  forgotten: string[];
}

/** The reasons that come from the person, not the founder: these always outlive a replaced workspace. */
const THEIRS: Suppression["reason"][] = ["requested_delete", "unsubscribe", "bounce"];

const file = () => path.join(DATA_DIR, OPT_OUTS_FILE);

const listOf = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

export function readOptOuts(): OptOuts {
  return readDataFile<OptOuts>(
    file(),
    () => ({ suppression: [], forgotten: [] }),
    (raw) => ({ suppression: listOf<Suppression>((raw as OptOuts)?.suppression), forgotten: listOf<string>((raw as OptOuts)?.forgotten).filter((k) => typeof k === "string") }),
  );
}

/**
 * Adds the workspace's opt-outs to the file before something replaces it. The sample's are made up and
 * never count. Throws when it can't write, so the caller can refuse to replace anything.
 */
export function rememberOptOuts(ws: Workspace): void {
  if (ws.sample) return;
  const theirs = (ws.suppression ?? []).filter((s) => THEIRS.includes(s.reason));
  if (!theirs.length && !ws.forgotten?.length) return;
  try {
    const now = readOptOuts();
    const { list, kept } = keepSuppressions(now.suppression, theirs);
    const forgotten = [...new Set([...now.forgotten, ...(ws.forgotten ?? [])])];
    if (kept || forgotten.length > now.forgotten.length) writeDataFile(file(), { suppression: list, forgotten });
  } catch (err) {
    const why = err instanceof Error ? err.message : "the disk refused the write";
    throw new Error(`I couldn't save your suppression list first, so nothing was changed. ${why}`);
  }
}
