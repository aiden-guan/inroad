import "server-only";
import fs from "node:fs";
import path from "node:path";
import { snapshotBefore } from "@/lib/store/backup";
import { readSettings } from "@/lib/store/settings";
import type { UpdateStatus } from "@/lib/updates/types";
// Shared with the launcher, which runs before any build: plain JS.
import { BLOCKED_REASON, type SourceCheck } from "../../../scripts/source-update.mjs";

/**
 * Updates for a git checkout. The launcher (scripts/serve.mjs) does the git, npm and build work, since it
 * has to stop this server to do it; this side asks it over the loopback address and token it was started
 * with, takes a backup first, and turns what the launcher says into an UpdateStatus for the app.
 */

/** GitHub is asked at most this often by itself; "Check now" always asks. */
export const AUTO_CHECK_MS = 6 * 60 * 60 * 1000;
/** A check that takes longer answers from what's known, and finishes in the background. */
const WAIT_FOR_CHECK_MS = 8_000;

interface LauncherUpdate {
  phase: "idle" | "running" | "done" | "failed";
  step: string | null;
  finishedAt: string | null;
  result: { ok: true; to: string } | { ok: false; error: string; rolledBack: boolean } | null;
  backedUp?: boolean;
  log: string[];
}

interface LauncherCheck {
  mode: "dev" | "start";
  check: SourceCheck;
  update: LauncherUpdate;
}

const NO_LAUNCHER =
  "Inroad was started without its launcher, so it can't update itself. Start it with npm start (or npm run dev), or update by hand: git pull, npm ci, npm run build.";

function launcher(): { url: string; token: string } | null {
  const url = process.env.INROAD_LAUNCHER_URL;
  const token = process.env.INROAD_LAUNCHER_TOKEN;
  return url && token ? { url, token } : null;
}

async function ask<T>(pathname: string, init: RequestInit = {}): Promise<{ status: number; body: T }> {
  const l = launcher();
  if (!l) throw new Error(NO_LAUNCHER);
  const res = await fetch(`${l.url}${pathname}`, { ...init, headers: { ...init.headers, authorization: `Bearer ${l.token}` }, cache: "no-store" });
  return { status: res.status, body: (await res.json()) as T };
}

/** What this checkout is called: the package version and the commit. */
function currentLabel(head?: string): string {
  let version = "";
  try {
    version = (JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as { version?: string }).version ?? "";
  } catch {
    // not where it usually is: the commit alone
  }
  return [version, head?.slice(0, 7)].filter(Boolean).join(" · ") || "this version";
}

const g = globalThis as unknown as { __inroadUpdateCheck?: { at: string; data: LauncherCheck }; __inroadUpdateChecking?: Promise<LauncherCheck> };

/** Asks GitHub through the launcher (git fetch), one request at a time, and remembers when it answered. */
function fetchCheck(): Promise<LauncherCheck> {
  g.__inroadUpdateChecking ??= ask<LauncherCheck>("/check?fetch=1")
    .then(({ body }) => {
      if (body.check.kind === "git" && body.check.fetched) g.__inroadUpdateCheck = { at: new Date().toISOString(), data: body };
      return body;
    })
    .finally(() => {
      delete g.__inroadUpdateChecking;
    });
  return g.__inroadUpdateChecking;
}

/** Off in Settings, or for this server (INROAD_UPDATE_CHECK=off: CI, offline tests, a machine that shouldn't ask). */
export function autoCheckOn(): boolean {
  return process.env.INROAD_UPDATE_CHECK !== "off" && readSettings().updateCheck !== "off";
}

/**
 * Where this checkout stands. `check` asks GitHub now; otherwise GitHub is asked when automatic checks are
 * on and the last answer is older than 6 hours, and every other time the answer comes from this checkout.
 */
export async function sourceUpdateStatus({ check = false }: { check?: boolean } = {}): Promise<UpdateStatus> {
  const autoCheck = autoCheckOn();
  const base: UpdateStatus = { channel: "source", phase: "idle", current: currentLabel(), latest: null, checkedAt: g.__inroadUpdateCheck?.at ?? null, autoCheck };
  if (!launcher()) return { ...base, phase: "unavailable", blocked: NO_LAUNCHER };

  let data: LauncherCheck;
  let error: string | null = null;
  try {
    const due = !g.__inroadUpdateCheck || Date.now() - new Date(g.__inroadUpdateCheck.at).getTime() > AUTO_CHECK_MS;
    if (check || (autoCheck && due)) {
      const fetched = fetchCheck();
      const timedOut = new Promise<null>((r) => setTimeout(() => r(null), check ? 90_000 : WAIT_FOR_CHECK_MS));
      data = (await Promise.race([fetched, timedOut])) ?? (await ask<LauncherCheck>("/check")).body;
      fetched.catch(() => {});
    } else {
      data = (await ask<LauncherCheck>("/check")).body;
    }
  } catch (err) {
    return { ...base, error: `Couldn't ask the launcher about updates (${err instanceof Error ? err.message : String(err)}).` };
  }

  const c = data.check;
  const u = data.update;
  const last =
    u.result && u.finishedAt
      ? u.result.ok
        ? { ok: true, at: u.finishedAt, to: u.result.to.slice(0, 7), backedUp: u.backedUp === true }
        : { ok: false, at: u.finishedAt, error: u.result.error, rolledBack: u.result.rolledBack, backedUp: u.backedUp === true }
      : null;
  if (c.kind !== "git") return { ...base, phase: "unavailable", blocked: c.reason, last };
  if (c.fetchError) error = c.fetchError;

  const status: UpdateStatus = { ...base, current: currentLabel(c.head), checkedAt: g.__inroadUpdateCheck?.at ?? null, error, last };
  if (u.phase === "running") return { ...status, phase: "updating", step: u.step };
  if (c.behind > 0) {
    return {
      ...status,
      phase: "available",
      latest: {
        label: `${c.behind} new change${c.behind === 1 ? "" : "s"}`,
        changes: c.changes.map((ch) => ({ subject: ch.subject, date: ch.date, sha: ch.sha.slice(0, 7) })),
        total: c.behind,
      },
      blocked: c.blocked ? BLOCKED_REASON[c.blocked] : null,
    };
  }
  if (c.blocked === "detached" || c.blocked === "no-upstream") return { ...status, phase: "unavailable", blocked: BLOCKED_REASON[c.blocked] };
  return { ...status, phase: status.checkedAt ? "up-to-date" : "idle" };
}

/** Backs up, then asks the launcher to update. It answers before it stops this server. */
export async function startSourceUpdate(): Promise<{ ok: true; changes: number; backedUp: boolean } | { ok: false; error: string; status: number }> {
  if (!launcher()) return { ok: false, error: NO_LAUNCHER, status: 409 };
  // None for the sample or an empty workspace: there's nothing of the founder's to lose.
  const backedUp = snapshotBefore("before_update") !== null;
  const { status, body } = await ask<{ started?: boolean; changes?: number; error?: string }>("/update", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ backedUp }),
  });
  if (status !== 202 || !body.started) return { ok: false, error: body.error ?? "The update didn't start. Try again.", status: status === 202 ? 500 : status };
  delete g.__inroadUpdateCheck;
  return { ok: true, changes: body.changes ?? 0, backedUp };
}

/** For tests: forget the last check. */
export function resetUpdateCheck() {
  delete g.__inroadUpdateCheck;
  delete g.__inroadUpdateChecking;
}
