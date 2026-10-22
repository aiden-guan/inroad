import "server-only";
import fs from "node:fs";
import path from "node:path";
import { newId, nowISO } from "@/lib/domain/ids";
import type { RunStep, Workspace } from "@/lib/domain/types";
import { forgetPerson, namesakesOf, personWasForgotten, runsAbout } from "@/lib/people/forget";
import { forgetConnections, forgetInFiles, type ForgottenPerson } from "@/lib/people/forget-files";
import { liveRunIds, stopRun } from "@/lib/runs/registry";
import { writeFileAtomic } from "@/lib/store/data-file";
import { FileDB, singletonDB } from "@/lib/store/file-db";
import { keepSuppressions, snapshotBefore, type BackupBundle, type BackupEntry } from "@/lib/store/backup";
import { readOptOuts, rememberOptOuts } from "@/lib/store/opt-outs";
import { DATA_DIR } from "@/lib/store/settings";
import { emptyWorkspace, holdsRealWork, migrateWorkspace, readWorkspace, replaceWorkspace } from "@/lib/store/workspace";
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
  rememberOptOuts(readWorkspace());
  const now = new Date();
  const ws = await replaceWorkspace(sampleWorkspace(now));
  for (const name of WORKSPACE_FILES) resetDataFile(name, name === "connections.json" ? sampleConnections(now) : null);
  await replaceRunSteps(sampleRunSteps(now));
  return ws;
}

export async function resetToEmptyWorkspace(): Promise<Workspace> {
  await stopLiveRuns();
  snapshotBefore("before_reset");
  rememberOptOuts(readWorkspace());
  const ws = await replaceWorkspace(emptyWorkspace());
  for (const name of WORKSPACE_FILES) resetDataFile(name, null);
  await replaceRunSteps({});
  return ws;
}

/**
 * Replaces the workspace with a backup. The current one is backed up first (when it holds real work).
 * A full bundle replaces every workspace file, removing the ones it doesn't have (they didn't exist when
 * it was made); hub.json, the sync bookkeeping, is only replaced when the bundle has it. An older
 * workspace-only export replaces workspace.json alone and leaves the rest as it is. Either way the
 * suppression list keeps everyone on it now (keepSuppressions), unless what's here now is the sample,
 * and everyone who opted out before a reset or the sample replaced the real workspace (opt-outs.json);
 * anyone on it as requested_delete whom the backup still holds is deleted again (forgetRequested).
 */
export async function restoreWorkspace(bundle: BackupBundle): Promise<{ ws: Workspace; backup: BackupEntry | null; files: string[]; keptSuppressions: number; forgotten: number }> {
  await stopLiveRuns();
  const backup = snapshotBefore("before_restore");
  const current = readWorkspace();
  rememberOptOuts(current);
  const restored = migrateWorkspace(bundle.files["workspace.json"]);
  const optOuts = readOptOuts();
  const since = [...optOuts.suppression, ...(current.sample ? [] : (current.suppression ?? []))];
  const { list, kept: keptSuppressions } = keepSuppressions(restored.suppression ?? [], since);
  const prints = [...new Set([...(restored.forgotten ?? []), ...optOuts.forgotten, ...(current.sample ? [] : (current.forgotten ?? []))])];
  const next: Workspace = { ...restored, suppression: list, ...(prints.length ? { forgotten: prints } : {}) };
  keepTunnelState(next, current);
  const forgotten = forgetRequested(next);
  const ws = await replaceWorkspace(next);
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
  // The files just restored (connections, Ask threads, run logs, CRM links) may still hold them too,
  // and a LinkedIn connection row may be from before they became a person here.
  for (const f of forgotten) await forgetInFiles(f);
  await forgetConnections(ws);
  return { ws, backup, files, keptSuppressions, forgotten: forgotten.length };
}

/**
 * Whether the public URL comes back by itself, and the address a running tunnel gave, belong to this
 * computer now (its token is in secrets.json, which a restore never touches), not to the backup: a restore
 * never turns a tunnel the founder switched off back on at the next start, nor shows a dead tunnel's
 * address. In place.
 */
function keepTunnelState(next: Workspace, current: Workspace) {
  const now = current.integrations.webhook_in?.config ?? {};
  const was = next.integrations.webhook_in;
  if (!was) return;
  const config = { ...was.config };
  if (now.namedTunnelAuto === undefined) delete config.namedTunnelAuto;
  else config.namedTunnelAuto = now.namedTunnelAuto;
  if (now.publicUrlTunnel === true) Object.assign(config, { publicUrl: now.publicUrl, publicUrlTunnel: true });
  else if (config.publicUrlTunnel === true) {
    delete config.publicUrl;
    delete config.publicUrlTunnel;
  }
  next.integrations = { ...next.integrations, webhook_in: { ...was, config } };
}

/**
 * A backup made before someone asked to be deleted still holds their record. Their address is on the
 * suppression list as requested_delete (keepSuppressions carries it over), or their profile or name at
 * their company is among the deletion fingerprints, so "Delete their details" runs on them again: a
 * restore never brings back someone the founder promised to forget. In place.
 */
function forgetRequested(ws: Workspace): ForgottenPerson[] {
  const out: ForgottenPerson[] = [];
  for (const person of Object.values(ws.people)) {
    if (!personWasForgotten(ws, person)) continue;
    out.push({ person: structuredClone(person), company: ws.accounts[person.accountDomain]?.name, runIds: runsAbout(ws, person), namesake: namesakesOf(ws, person).length > 0 });
    forgetPerson(ws, person.id, nowISO(), newId("sup"));
  }
  return out;
}
