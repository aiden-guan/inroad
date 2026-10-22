import "server-only";
import fs from "node:fs";
import path from "node:path";
import type { RunStep, Workspace } from "@/lib/domain/types";
import { liveRunIds, stopRun } from "@/lib/runs/registry";
import { writeFileAtomic } from "@/lib/store/data-file";
import { FileDB, singletonDB } from "@/lib/store/file-db";
import { snapshotBefore, type BackupBundle, type BackupEntry } from "@/lib/store/backup";
import { DATA_DIR } from "@/lib/store/settings";
import { emptyWorkspace, holdsRealWork, migrateWorkspace, replaceWorkspace } from "@/lib/store/workspace";
import { sampleConnections, sampleRunSteps, sampleWorkspace } from "./index";

export { holdsRealWork };

/**
 * Files that belong to one workspace (besides workspace.json and runs.json). settings.json, secrets.json
 * and keys.json belong to the machine and are never touched; the signal cache holds public web data and
 * is kept. Each replacement saves a backup first when there's real work to lose (src/lib/store/backup.ts).
 */
const WORKSPACE_FILES = ["connections.json", "threads.json", "network.json", "desk.json"] as const;

const stepsDB = () =>
  singletonDB<Record<string, RunStep[]>>("runs.json", () => new FileDB<Record<string, RunStep[]>>("runs.json", () => ({})));

/**
 * Other modules own these files and may hold a cached FileDB for them. Drop that instance so their next
 * read comes from disk, then write (or remove) the file atomically.
 */
function resetDataFile(name: string, contents: unknown | null) {
  const g = globalThis as unknown as { __fileDBs?: Map<string, unknown> };
  g.__fileDBs?.delete(name);
  const file = path.join(DATA_DIR, name);
  if (contents === null) {
    fs.rmSync(file, { force: true });
    return;
  }
  writeFileAtomic(file, JSON.stringify(contents, null, 2));
}

async function replaceRunSteps(steps: Record<string, RunStep[]>) {
  await stepsDB().update((all) => {
    for (const key of Object.keys(all)) delete all[key];
    Object.assign(all, steps);
  });
}

/**
 * Runs in flight would write their results into the workspace that replaced theirs. Stop them and wait until
 * each has made its last write (thread, usage, summary, steps), so those land in the old files and get replaced.
 */
async function stopLiveRuns(timeoutMs = 15_000) {
  const ids = liveRunIds();
  for (const id of ids) stopRun(id);
  const until = Date.now() + timeoutMs;
  while (Date.now() < until && liveRunIds().some((id) => ids.includes(id))) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

export async function loadSampleWorkspace(): Promise<Workspace> {
  await stopLiveRuns();
  snapshotBefore("before_sample");
  const now = new Date();
  const ws = await replaceWorkspace(sampleWorkspace(now));
  for (const name of WORKSPACE_FILES) resetDataFile(name, name === "connections.json" ? sampleConnections(now) : null);
  await replaceRunSteps(sampleRunSteps(now));
  return ws;
}

export async function resetToEmptyWorkspace(): Promise<Workspace> {
  await stopLiveRuns();
  snapshotBefore("before_reset");
  const ws = await replaceWorkspace(emptyWorkspace());
  for (const name of WORKSPACE_FILES) resetDataFile(name, null);
  await replaceRunSteps({});
  return ws;
}

/**
 * Replaces the workspace with a backup. The current one is backed up first (when it holds real work).
 * A full bundle replaces every workspace file, removing the ones it doesn't have (they didn't exist when
 * it was made); hub.json, the sync bookkeeping, is only replaced when the bundle has it. An older
 * workspace-only export replaces workspace.json alone and leaves the rest as it is.
 */
export async function restoreWorkspace(bundle: BackupBundle): Promise<{ ws: Workspace; backup: BackupEntry | null; files: string[] }> {
  await stopLiveRuns();
  const backup = snapshotBefore("before_restore");
  const ws = await replaceWorkspace(migrateWorkspace(bundle.files["workspace.json"]));
  const files = ["workspace.json"];
  if (!bundle.legacy) {
    for (const name of WORKSPACE_FILES) {
      resetDataFile(name, bundle.files[name] ?? null);
      if (bundle.files[name] !== undefined) files.push(name);
    }
    if (bundle.files["hub.json"] !== undefined) {
      resetDataFile("hub.json", bundle.files["hub.json"]);
      files.push("hub.json");
    }
    const steps = bundle.files["runs.json"];
    await replaceRunSteps(steps && typeof steps === "object" && !Array.isArray(steps) ? (steps as Record<string, RunStep[]>) : {});
    if (steps !== undefined) files.push("runs.json");
  }
  return { ws, backup, files };
}
