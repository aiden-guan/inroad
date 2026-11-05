"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRuns } from "@/components/providers/runs-provider";
import { useWorkspace } from "@/components/providers/workspace-provider";
import type { Workspace } from "@/lib/domain/types";
import { deskSnapshot, type DeskSnapshot } from "@/lib/moves/since";

/** A coarse clock for ages and time-of-day rules. Never read Date.now() during render. */
export function useClock(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

interface PrepareState {
  preparing: boolean;
  error: string | null;
  briefRunId: string | null;
}

/**
 * Recomputes moves on the server (all code) on open, after the founder acts (debounced), and every
 * five minutes while the tab is visible, so timed cards (debriefs, close-out) appear on their own.
 */
export function usePrepare() {
  const { refresh } = useWorkspace();
  const { attach } = useRuns();
  const [state, setState] = useState<PrepareState>({ preparing: false, error: null, briefRunId: null });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);
  const again = useRef(false);
  const prepareRef = useRef<((reason: "open" | "action" | "timer" | "refresh") => Promise<void>) | null>(null);

  const prepare = useCallback(
    async (reason: "open" | "action" | "timer" | "refresh" = "refresh") => {
      if (inFlight.current) {
        again.current = true;
        return;
      }
      inFlight.current = true;
      setState((s) => ({ ...s, preparing: true }));
      try {
        const res = await fetch("/api/today/prepare", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason }),
        });
        const body = (await res.json()) as { error?: string; briefRunId?: string | null; sweepRunId?: string | null; aheadRunIds?: string[]; changed?: boolean };
        if (!res.ok) throw new Error(body.error ?? "Couldn't refresh your moves.");
        // Attach without a title: the brief is background work and shouldn't toast when it lands.
        if (body.briefRunId) attach(body.briefRunId);
        // The day's free signal check runs in the background too; the timer re-prepare turns what it finds into moves.
        if (body.sweepRunId) attach(body.sweepRunId);
        // Briefs and drafts started ahead: their cards show the live log in place, and land without a toast.
        for (const id of body.aheadRunIds ?? []) attach(id);
        if (body.changed || body.briefRunId) await refresh();
        setState((s) => ({ preparing: false, error: null, briefRunId: body.briefRunId ?? s.briefRunId }));
      } catch (e) {
        setState((s) => ({ ...s, preparing: false, error: e instanceof Error ? e.message : "Couldn't refresh your moves." }));
      } finally {
        inFlight.current = false;
        if (again.current) {
          again.current = false;
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => void prepareRef.current?.("action"), 300);
        }
      }
    },
    [attach, refresh],
  );

  useEffect(() => {
    prepareRef.current = prepare;
  }, [prepare]);

  /** After an action: wait for the burst to settle, then re-rank. */
  const schedule = useCallback(
    (delay = 900) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void prepare("action"), delay);
    },
    [prepare],
  );

  useEffect(() => {
    const first = setTimeout(() => void prepare("open"), 0);
    const every = setInterval(() => {
      if (document.visibilityState === "visible") void prepare("timer");
    }, 5 * 60_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void prepare("timer");
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(first);
      clearInterval(every);
      document.removeEventListener("visibilitychange", onVisible);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [prepare]);

  return { ...state, prepare, schedule };
}

const REVEAL_KEY = "inroad:today-revealed";

function readRevealed(): string | null {
  try {
    return localStorage.getItem(REVEAL_KEY);
  } catch {
    return null;
  }
}

/**
 * The morning reveal plays on the first open of the day only (≤600ms) and any key or click skips it.
 * Phase "skipped" remounts the content at its final state; "done" just stops new staggers.
 */
export function useReveal(today: string) {
  const [phase, setPhase] = useState<"reveal" | "skipped" | "done">(() => (readRevealed() === today ? "done" : "reveal"));

  useEffect(() => {
    if (phase !== "reveal") return;
    try {
      localStorage.setItem(REVEAL_KEY, today);
    } catch {
      // private mode: the reveal may replay, which is harmless
    }
    const end = setTimeout(() => setPhase("done"), 700);
    const skip = () => setPhase("skipped");
    window.addEventListener("keydown", skip, { once: true });
    window.addEventListener("pointerdown", skip, { once: true });
    return () => {
      clearTimeout(end);
      window.removeEventListener("keydown", skip);
      window.removeEventListener("pointerdown", skip);
    };
  }, [phase, today]);

  return phase;
}

/* ───────────── Since your last visit ───────────── */

/** A tab away from Today this long starts a new visit. */
const NEW_VISIT_AFTER_MS = 30 * 60_000;
const visitKey = (id: string) => `inroad:visit:${id}`;
const baseKey = (id: string) => `inroad:visit-base:${id}`;

interface StoredVisit {
  snapshot: DeskSnapshot;
  leftAt: string;
}

function readJSON<T>(storage: () => Storage, key: string): T | null {
  try {
    const raw = storage().getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJSON(storage: () => Storage, key: string, value: unknown) {
  try {
    storage().setItem(key, JSON.stringify(value));
  } catch {
    // private mode or a full disk: "since your last visit" falls back to the last 24 hours
  }
}

/**
 * The snapshot Today compares against for "since your last visit": the state when the founder last left Today, kept
 * per workspace. A reload, or a trip to another page and back within 30 minutes, is the same visit. Everything here
 * reads and writes from effects, never during render: Next renders prefetched routes in hidden trees, where render
 * runs but effects wait until the page is shown. `undefined` until read; `null` when there's no earlier visit.
 */
/** The base this tab counts from: kept for its session (reloads, other pages), else the end of the last visit. Read only. */
function visitBase(id: string): DeskSnapshot | null {
  const stored = readJSON<StoredVisit>(() => localStorage, visitKey(id));
  const kept = readJSON<{ base: DeskSnapshot | null }>(() => sessionStorage, baseKey(id));
  const away = stored ? Date.now() - Date.parse(stored.leftAt) : Infinity;
  if (kept && away < NEW_VISIT_AFTER_MS) return kept.base;
  return stored?.snapshot ?? null;
}

export function useSinceLastVisit(ws: Workspace): { base: DeskSnapshot | null | undefined; markSeen: () => void } {
  const id = ws.createdAt;
  // Reading storage is fine during render; every write below happens in an effect or a handler.
  const [base, setBase] = useState<DeskSnapshot | null | undefined>(() => (typeof window === "undefined" ? undefined : visitBase(id)));
  const wsRef = useRef(ws);
  useEffect(() => {
    wsRef.current = ws;
  });

  useEffect(() => {
    const local = () => localStorage;
    const session = () => sessionStorage;
    // This tab keeps counting from the same base through reloads and trips to other pages.
    writeJSON(session, baseKey(id), { base: visitBase(id) });
    const save = () => writeJSON(local, visitKey(id), { snapshot: deskSnapshot(wsRef.current, new Date()), leftAt: new Date().toISOString() } satisfies StoredVisit);
    const onVisibility = () => {
      if (document.visibilityState === "hidden") return save();
      // Back after a long time away: a new visit, measured from when they left.
      const last = readJSON<StoredVisit>(local, visitKey(id));
      if (last && Date.now() - Date.parse(last.leftAt) >= NEW_VISIT_AFTER_MS) {
        writeJSON(session, baseKey(id), { base: last.snapshot });
        setBase(last.snapshot);
      }
    };
    const every = setInterval(() => document.visibilityState === "visible" && save(), 60_000);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", save);
    return () => {
      clearInterval(every);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", save);
      save();
    };
  }, [id]);

  const markSeen = useCallback(() => {
    const now = deskSnapshot(wsRef.current, new Date());
    writeJSON(() => sessionStorage, baseKey(id), { base: now });
    setBase(now);
  }, [id]);

  return { base, markSeen };
}
