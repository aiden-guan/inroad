"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRuns } from "@/components/providers/runs-provider";
import { useWorkspace } from "@/components/providers/workspace-provider";

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
