/**
 * Where Inroad stands on updates, the same shape for both ways it runs: from a git checkout (`npm start`,
 * `npm run dev`; GET /api/update, the launcher does the work) and the Mac app (the shell does it, through
 * window.inroadDesktop). Types only, safe on both sides.
 */

export type UpdateChannel = "source" | "desktop";

export type UpdatePhase =
  /** Not checked yet, or checks are off. */
  | "idle"
  | "checking"
  | "up-to-date"
  /** Something newer exists. On the Mac app it downloads by itself; from source, one click updates. */
  | "available"
  | "downloading"
  /** Mac app: downloaded and checked, one click restarts into it. */
  | "ready"
  /** Installing now: the server is about to stop (source) or the app is about to restart (Mac). */
  | "updating"
  /** This copy can't update itself in one click; `blocked` says why and what to do instead. */
  | "unavailable";

export interface UpdateChange {
  subject: string;
  date?: string;
  sha?: string;
}

export interface UpdateStatus {
  channel: UpdateChannel;
  phase: UpdatePhase;
  /** What runs now, as it's shown: "0.1.0" (Mac app) or "0.1.0 · 796721b" (source). */
  current: string;
  /** What an update brings: a version and its release notes (Mac app), or the commits it adds (source). */
  latest: { label: string; notes?: string; url?: string; changes?: UpdateChange[]; total?: number } | null;
  /** Source: the update step in progress (scripts/updating-page.mjs names them). */
  step?: string | null;
  /** Mac app: how much of the download is done, 0 to 1. */
  progress?: number | null;
  /** The last time GitHub answered a check. */
  checkedAt: string | null;
  /** Why one click can't update this copy right now, in plain words, with what to do instead. */
  blocked?: string | null;
  /** The last check or download failed: why, in plain words. Checking again is always safe. */
  error?: string | null;
  /** The update that just ran (source: since the launcher started), so the app can say how it went once. */
  last?: { ok: boolean; at: string; to?: string; error?: string; rolledBack?: boolean; backedUp?: boolean } | null;
  /** Checks GitHub for a new version by itself (every 6 hours while Inroad runs). */
  autoCheck: boolean;
}

/** What the Mac app's shell exposes to the page (desktop/app/preload.cjs). Absent in a browser. */
export interface DesktopBridge {
  updates: {
    get(): Promise<UpdateStatus>;
    check(): Promise<UpdateStatus>;
    install(): Promise<{ ok: boolean; error?: string }>;
    setAutoCheck(on: boolean): Promise<UpdateStatus>;
    subscribe(cb: (s: UpdateStatus) => void): () => void;
  };
}
