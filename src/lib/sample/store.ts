import "server-only";
import fs from "node:fs";
import path from "node:path";
import type { RunStep, Workspace } from "@/lib/domain/types";
import { liveRunIds, stopRun } from "@/lib/runs/registry";
import { FileDB, singletonDB } from "@/lib/store/file-db";
import { DATA_DIR } from "@/lib/store/settings";
import { emptyWorkspace, readWorkspace, replaceWorkspace } from "@/lib/store/workspace";
import { sampleConnections, sampleRunSteps, sampleWorkspace } from "./index";

/**
 * Files that belong to one workspace. settings.json and secrets.json belong to the machine and are never
 * touched; the signal cache holds public web data and is kept.
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
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(contents, null, 2));
  fs.renameSync(tmp, file);
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

/** True when the current workspace holds the founder's own work (not the sample, past the empty first run). */
export function holdsRealWork(ws: Workspace = readWorkspace()): boolean {
  if (ws.sample) return false;
  return ws.onboarding.status !== "new" || ws.company !== null || Object.keys(ws.accounts).length > 0;
}

export async function loadSampleWorkspace(): Promise<Workspace> {
  await stopLiveRuns();
  const now = new Date();
  const ws = await replaceWorkspace(sampleWorkspace(now));
  for (const name of WORKSPACE_FILES) resetDataFile(name, name === "connections.json" ? sampleConnections(now) : null);
  await replaceRunSteps(sampleRunSteps(now));
  return ws;
}

export async function resetToEmptyWorkspace(): Promise<Workspace> {
  await stopLiveRuns();
  const ws = await replaceWorkspace(emptyWorkspace());
  for (const name of WORKSPACE_FILES) resetDataFile(name, null);
  await replaceRunSteps({});
  return ws;
}
