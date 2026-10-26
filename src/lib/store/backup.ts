import "server-only";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { todayISO } from "@/lib/domain/ids";
import type { Suppression, Workspace } from "@/lib/domain/types";
import { ensureDataDir, writeFileAtomic } from "./data-file";
import { DATA_DIR } from "./settings";
import { holdsRealWork, readWorkspace } from "./workspace";

/**
 * Backups: one bundle with every file that makes up a workspace, so nothing is ever gone for good.
 *  - Snapshots in `<data>/backups/`: one a day, the first time Inroad opens that day, and one before
 *    anything replaces the workspace (a reset, the sample, a restore) or the app (an update). Each is kept 14 days at most (and
 *    no more than the last 14 daily and 10 others), so someone deleted is gone from them within 14 days.
 *  - Export: the same bundle, downloaded from Settings → Data.
 *  - Restore: from a snapshot or a downloaded file (src/lib/sample/store.ts does the replacing).
 *
 * Files that belong to this machine (settings.json with the Anthropic key, secrets.json, keys.json) are
 * never in a bundle, and a restore never touches them. Caches hold public web data and refill themselves.
 */

export const BACKUP_FORMAT = "inroad-backup";
export const BACKUP_DIR = () => path.join(DATA_DIR, "backups");

/** Every file a workspace is made of. A bundle holds the ones that exist; a restore replaces all of them. */
export const WORKSPACE_FILES = ["workspace.json", "threads.json", "connections.json", "network.json", "desk.json", "runs.json", "hub.json"] as const;
export type WorkspaceFile = (typeof WORKSPACE_FILES)[number];

export type BackupReason = "daily" | "before_reset" | "before_sample" | "before_restore" | "before_update" | "export";

const KEEP = { daily: 14, event: 10 } as const;
/** No snapshot outlives this, whatever its kind: Settings promises "the last 14 days". */
export const BACKUP_MAX_AGE_DAYS = 14;

export interface BackupSummary {
  company: string | null;
  companies: number;
  people: number;
  deals: number;
  sample: boolean;
}

export interface BackupBundle {
  format: typeof BACKUP_FORMAT;
  version: 1;
  createdAt: string;
  reason: BackupReason;
  summary: BackupSummary;
  files: Partial<Record<WorkspaceFile, unknown>>;
  /** Set when read from an older workspace-only export: a restore then replaces workspace.json alone. */
  legacy?: true;
}

/** One snapshot on disk, as Settings lists it. */
export interface BackupEntry {
  name: string;
  at: string;
  reason: BackupReason;
  bytes: number;
}

export function summarize(ws: Workspace): BackupSummary {
  return {
    company: ws.company?.name ?? null,
    companies: Object.keys(ws.accounts ?? {}).length,
    people: Object.keys(ws.people ?? {}).length,
    deals: Object.keys(ws.deals ?? {}).length,
    sample: ws.sample === true,
  };
}

/**
 * Reads the workspace files as they are on disk now. Every write is atomic and synchronous, so disk
 * matches what each store holds. A missing file is left out; a file that can't be parsed throws, so a
 * backup is never silently partial.
 */
export function buildBundle(reason: BackupReason, now = new Date()): BackupBundle {
  const files: BackupBundle["files"] = {};
  for (const name of WORKSPACE_FILES) {
    let text: string;
    try {
      text = fs.readFileSync(path.join(DATA_DIR, name), "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw err;
    }
    try {
      files[name] = JSON.parse(text);
    } catch {
      throw new Error(`${name} could not be read, so I didn't make a backup. Fix or remove the file, then try again.`);
    }
  }
  // The workspace as the app sees it (migrated, or empty on a fresh install), so a bundle always has one.
  const ws = readWorkspace();
  files["workspace.json"] ??= ws;
  return { format: BACKUP_FORMAT, version: 1, createdAt: now.toISOString(), reason, summary: summarize(ws), files };
}

const REASONS: BackupReason[] = ["daily", "before_reset", "before_sample", "before_restore", "before_update", "export"];
// 2026-10-22T16-05-00-123Z-daily.json.gz: sortable, and safe on every file system.
const NAME = /^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)-([a-z_]+)\.json\.gz$/;

function fileName(at: Date, reason: BackupReason): string {
  return `${at.toISOString().replace(/[:.]/g, "-")}-${reason}.json.gz`;
}

function parseName(name: string): { at: string; reason: BackupReason } | null {
  const m = name.match(NAME);
  if (!m || !REASONS.includes(m[2] as BackupReason)) return null;
  const [d, t] = m[1].split("T");
  const [hh, mm, ss, ms] = t.replace("Z", "").split("-");
  return { at: `${d}T${hh}:${mm}:${ss}.${ms}Z`, reason: m[2] as BackupReason };
}

/** Newest first. */
export function listBackups(): BackupEntry[] {
  let names: string[];
  try {
    names = fs.readdirSync(BACKUP_DIR());
  } catch {
    return [];
  }
  const out: BackupEntry[] = [];
  for (const name of names) {
    const meta = parseName(name);
    if (!meta) continue;
    try {
      out.push({ name, ...meta, bytes: fs.statSync(path.join(BACKUP_DIR(), name)).size });
    } catch {
      // removed while listing
    }
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

/** Writes a snapshot and prunes old ones. Throws when it can't write, so callers can refuse to go on. */
export function snapshot(reason: Exclude<BackupReason, "export">, now = new Date()): BackupEntry {
  const bundle = buildBundle(reason, now);
  ensureDataDir(BACKUP_DIR());
  const name = fileName(now, reason);
  writeFileAtomic(path.join(BACKUP_DIR(), name), zlib.gzipSync(JSON.stringify(bundle)));
  prune(now);
  return { name, at: bundle.createdAt, reason, bytes: fs.statSync(path.join(BACKUP_DIR(), name)).size };
}

/** Drops snapshots past the count limits, and every snapshot older than 14 days (the one just written never is). */
function prune(now: Date) {
  const all = listBackups();
  const daily = all.filter((b) => b.reason === "daily").slice(KEEP.daily);
  const events = all.filter((b) => b.reason !== "daily").slice(KEEP.event);
  const oldest = now.getTime() - BACKUP_MAX_AGE_DAYS * 86_400_000;
  const old = all.filter((b) => new Date(b.at).getTime() < oldest);
  for (const b of new Set([...daily, ...events, ...old])) fs.rmSync(path.join(BACKUP_DIR(), b.name), { force: true });
}

/** Before a reset, the sample, a restore or an update: a snapshot when there's real work to lose, else nothing. */
export function snapshotBefore(reason: "before_reset" | "before_sample" | "before_restore" | "before_update"): BackupEntry | null {
  if (!holdsRealWork()) return null;
  try {
    return snapshot(reason);
  } catch (err) {
    const why = err instanceof Error ? err.message : "the disk refused the write";
    throw new Error(`I couldn't save a backup first, so nothing was changed. ${why}`);
  }
}

const g = globalThis as unknown as { __inroadDailyBackup?: string };

/**
 * The daily snapshot, the first time Inroad opens on a given (local) day. Skips the sample and an empty
 * workspace. Cheap to call on every open: after the first check it's a string comparison.
 */
export function ensureDailySnapshot(now = new Date()): BackupEntry | null {
  const day = todayISO(now);
  if (g.__inroadDailyBackup === day) return null;
  if (!holdsRealWork()) return null;
  const done = listBackups().some((b) => b.reason === "daily" && todayISO(new Date(b.at)) === day);
  const entry = done ? null : snapshot("daily", now);
  g.__inroadDailyBackup = day;
  return entry;
}

/** For tests: forget that today's snapshot was taken. */
export function resetDailyCheck() {
  delete g.__inroadDailyBackup;
}

/* ───────────── Reading a backup back ───────────── */

export class BackupError extends Error {}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** A workspace.json as Inroad writes it: enough fields to tell it from any other JSON file. */
function looksLikeWorkspace(v: unknown): v is Workspace {
  return isObj(v) && typeof v.schemaVersion === "number" && isObj(v.accounts) && isObj(v.people) && isObj(v.onboarding);
}

/**
 * A bundle from anything a founder might hand back: a backup file (plain or gzipped) or the
 * workspace-only JSON that older versions exported (then only workspace.json is in it).
 */
export function parseBackup(raw: Uint8Array | string): BackupBundle {
  let text: string;
  if (typeof raw === "string") text = raw;
  else if (raw[0] === 0x1f && raw[1] === 0x8b) {
    try {
      text = zlib.gunzipSync(raw).toString("utf8");
    } catch {
      throw new BackupError("That file is damaged: it couldn't be unzipped.");
    }
  } else text = Buffer.from(raw).toString("utf8");

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new BackupError("That isn't an Inroad backup. Choose the inroad-backup-….json file you downloaded.");
  }
  if (looksLikeWorkspace(value)) {
    return {
      format: BACKUP_FORMAT,
      version: 1,
      createdAt: value.createdAt ?? new Date().toISOString(),
      reason: "export",
      summary: summarize(value),
      files: { "workspace.json": value },
      legacy: true,
    };
  }
  if (!isObj(value) || value.format !== BACKUP_FORMAT || !isObj(value.files)) {
    throw new BackupError("That isn't an Inroad backup. Choose the inroad-backup-….json file you downloaded.");
  }
  if (value.version !== 1) throw new BackupError("That backup comes from a newer version of Inroad. Update Inroad, then restore it.");
  if (!looksLikeWorkspace(value.files["workspace.json"])) throw new BackupError("That backup has no workspace in it, so there's nothing to restore.");
  const files: BackupBundle["files"] = {};
  for (const name of WORKSPACE_FILES) if (name in value.files) files[name] = value.files[name];
  const ws = files["workspace.json"] as Workspace;
  return {
    format: BACKUP_FORMAT,
    version: 1,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : new Date().toISOString(),
    reason: REASONS.includes(value.reason as BackupReason) ? (value.reason as BackupReason) : "export",
    summary: summarize(ws),
    files,
  };
}

/* ───────────── Restoring without forgetting who opted out ───────────── */

// How strongly an entry says "don't contact": a request from the person themselves outranks the rest.
const RANK: Partial<Record<Suppression["reason"], number>> = { requested_delete: 3, unsubscribe: 2, bounce: 1 };
const addressOf = (s: Suppression) => `${s.email?.trim().toLowerCase() ?? ""}|${s.domain?.trim().toLowerCase() ?? ""}`;

/**
 * The suppression list after a restore: the backup's, plus every entry on the list now that the backup
 * doesn't have. Someone who unsubscribed, bounced or asked to be deleted after the backup was made stays
 * suppressed, so a restore never makes anyone contactable again. When both lists hold an address, the
 * stronger reason wins (asked to be deleted, then unsubscribed, then bounced). `kept` counts the entries
 * the backup lacked or held more weakly.
 */
export function keepSuppressions(restored: Suppression[], current: Suppression[]): { list: Suppression[]; kept: number } {
  const list = restored.map((s) => ({ ...s }));
  const byAddress = new Map(list.map((s) => [addressOf(s), s]));
  const ids = new Set(list.map((s) => s.id));
  let kept = 0;
  for (const s of current) {
    const key = addressOf(s);
    if (key === "|") continue;
    const there = byAddress.get(key);
    if (!there) {
      const entry = { ...s, id: ids.has(s.id) ? `${s.id}_kept` : s.id };
      list.push(entry);
      byAddress.set(key, entry);
      ids.add(entry.id);
      kept++;
    } else if ((RANK[s.reason] ?? 0) > (RANK[there.reason] ?? 0)) {
      there.reason = s.reason;
      there.at = s.at;
      kept++;
    }
  }
  return { list, kept };
}

/** A snapshot from `<data>/backups/`, by the name listBackups gave. Never reads outside that folder. */
export function readSnapshot(name: string): BackupBundle {
  if (!parseName(name) || path.basename(name) !== name) throw new BackupError("There's no backup by that name.");
  let raw: Buffer;
  try {
    raw = fs.readFileSync(path.join(BACKUP_DIR(), name));
  } catch {
    throw new BackupError("That backup isn't there any more. It may have been cleaned up after 14 days.");
  }
  return parseBackup(raw);
}
