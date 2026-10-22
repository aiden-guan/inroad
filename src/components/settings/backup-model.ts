/**
 * Plain helpers for Settings → Data → Backups: how a backup is named on screen, and what a chosen file
 * holds before it's sent. Types mirror src/lib/store/backup.ts; nothing here touches the server.
 */

export type BackupReason = "daily" | "before_reset" | "before_sample" | "before_restore" | "export";

export interface BackupEntry {
  name: string;
  at: string;
  reason: BackupReason;
  bytes: number;
}

export interface BackupSummary {
  company: string | null;
  companies: number;
  people: number;
  deals: number;
  sample: boolean;
}

/** GET /api/workspace/backups */
export interface BackupsResponse {
  dir: string;
  backups: BackupEntry[];
}

export const REASON_LABEL: Record<BackupReason, string> = {
  daily: "Daily",
  before_reset: "Before a reset",
  before_sample: "Before the sample",
  before_restore: "Before a restore",
  export: "Downloaded",
};

/** "Today, 9:05 AM", "Yesterday, 6:12 PM", "Oct 14, 9:05 AM", in the founder's own time zone. */
export function backupWhen(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const dayKey = (x: Date) => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (dayKey(d) === dayKey(now)) return `Today, ${time}`;
  if (dayKey(d) === dayKey(yesterday)) return `Yesterday, ${time}`;
  const date = d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) });
  return `${date}, ${time}`;
}

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** "Acme: 12 companies, 30 people, 4 deals" (or "the sample workspace: …"). */
export function describeSummary(s: BackupSummary): string {
  const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
  const who = s.sample ? "the sample workspace" : (s.company ?? "a workspace with no company yet");
  return `${who}: ${n(s.companies, "company", "companies")}, ${n(s.people, "person", "people")}, ${n(s.deals, "deal", "deals")}`;
}

/**
 * The chosen file as it's uploaded: gzipped here first, because Next.js passes at most 10 MB of a
 * request body through the app's proxy, and a backup with months of run history can be bigger than
 * that. Backups are JSON, so they shrink about tenfold; the server unzips them (src/lib/store/backup.ts).
 * A file that's already gzipped, or a browser without CompressionStream, goes up as it is.
 */
export async function uploadBody(file: Blob): Promise<Blob> {
  const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  if ((head[0] === 0x1f && head[1] === 0x8b) || typeof CompressionStream === "undefined") return file;
  return new Response(file.stream().pipeThrough(new CompressionStream("gzip"))).blob();
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const count = (v: unknown) => (isObj(v) ? Object.keys(v).length : 0);

/**
 * What a chosen file holds, read in the browser so the confirmation can say it. Null when it's not
 * readable here (a gzipped backup, or not JSON at all); the server still decides whether it restores.
 */
export function summarizeFile(text: string): { createdAt?: string; summary: BackupSummary; workspaceOnly: boolean } | null {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObj(v)) return null;
  const bundle = v.format === "inroad-backup" && isObj(v.files);
  const ws = bundle ? (v.files as Record<string, unknown>)["workspace.json"] : v;
  if (!isObj(ws) || !isObj(ws.accounts) || !isObj(ws.people)) return null;
  const company = isObj(ws.company) && typeof ws.company.name === "string" ? ws.company.name : null;
  return {
    createdAt: bundle && typeof v.createdAt === "string" ? v.createdAt : undefined,
    summary: { company, companies: count(ws.accounts), people: count(ws.people), deals: count(ws.deals), sample: ws.sample === true },
    workspaceOnly: !bundle,
  };
}
