import "server-only";
import fs from "node:fs";
import path from "node:path";
import type { Connection, ISODateTime } from "@/lib/domain/types";
import { FileDB, singletonDB } from "@/lib/store/file-db";
import { DATA_DIR } from "@/lib/store/settings";
import type { ImportBatch } from "./types";

/**
 * Two local files, both reset with the workspace:
 *  - connections.json: the founder's LinkedIn connections as a plain array (other areas read it
 *    directly for warm paths). Names and emails never leave this machine in bulk.
 *  - network.json: import history (for undo) and company-level screen verdicts, reused across
 *    re-imports until the ICP changes, so a monthly re-import only pays for new companies.
 */

export type Fit = "likely" | "unknown" | "unlikely";

export interface NetworkFile {
  schemaVersion: 1;
  /** Newest first. */
  imports: ImportBatch[];
  /** companyNorm → verdict. */
  fits: Record<string, { fit: Fit; reason: string; at: ISODateTime; icpKey: string; domain?: string }>;
}

const MAX_IMPORTS = 40;

function emptyNetwork(): NetworkFile {
  return { schemaVersion: 1, imports: [], fits: {} };
}

const networkDB = () =>
  singletonDB<NetworkFile>("network.json", () => new FileDB("network.json", emptyNetwork, (raw) => ({ ...emptyNetwork(), ...(raw as Partial<NetworkFile>) })));

export function readNetwork(): NetworkFile {
  return networkDB().read();
}

export async function mutateNetwork<R>(fn: (n: NetworkFile) => R): Promise<R> {
  const { value } = await networkDB().update((draft) => {
    const value = fn(draft);
    draft.imports = draft.imports.slice(0, MAX_IMPORTS);
    return value;
  });
  return value;
}

/* ───────────── connections.json (array on disk, read fresh each time) ───────────── */

const CONNECTIONS_FILE = () => path.join(DATA_DIR, "connections.json");

export function readConnections(): Connection[] {
  try {
    const raw = JSON.parse(fs.readFileSync(CONNECTIONS_FILE(), "utf8")) as unknown;
    const list = Array.isArray(raw)
      ? raw
      : raw && typeof raw === "object" && Array.isArray((raw as { connections?: unknown }).connections)
        ? (raw as { connections: unknown[] }).connections
        : [];
    return list.filter((c): c is Connection => !!c && typeof c === "object" && typeof (c as Connection).id === "string");
  } catch {
    return [];
  }
}

const queue = (() => {
  const g = globalThis as unknown as { __inroadConnectionsQueue?: { p: Promise<unknown> } };
  g.__inroadConnectionsQueue ??= { p: Promise.resolve() };
  return g.__inroadConnectionsQueue;
})();

/** Serialized read-modify-write of connections.json; atomic rename so a crash never truncates it. */
export function updateConnections<R>(fn: (rows: Connection[]) => R | Promise<R>): Promise<R> {
  const next = queue.p.then(async () => {
    const rows = readConnections();
    const value = await fn(rows);
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const file = CONNECTIONS_FILE();
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(rows));
    fs.renameSync(tmp, file);
    // Nobody should hold a cached FileDB for this file, but drop one if a module created it.
    (globalThis as unknown as { __fileDBs?: Map<string, unknown> }).__fileDBs?.delete("connections.json");
    return value;
  });
  queue.p = next.catch(() => undefined);
  return next;
}
