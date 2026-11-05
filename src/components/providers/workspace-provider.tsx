"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { applyAction, type Action } from "@/lib/domain/actions";
import type { Workspace } from "@/lib/domain/types";

interface WorkspaceContextValue {
  ws: Workspace | null;
  loading: boolean;
  error: string | null;
  /** Applies actions instantly in the browser, then confirms with the server (rolls back on failure). */
  dispatch: (actions: Action | Action[]) => Promise<boolean>;
  /** Reads the workspace again, now: for after something changed on the server. */
  refresh: () => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

async function fetchWorkspace(): Promise<Workspace> {
  const res = await fetch("/api/workspace", { cache: "no-store" });
  if (!res.ok) throw new Error(`Couldn't load your workspace (${res.status}).`);
  return res.json();
}

/** A focus within this long after a load doesn't read the workspace again: nothing could have changed unseen. */
const FOCUS_FRESH_MS = 3000;

/**
 * The workspace for the whole app, read once on load (~200KB), again when the window regains focus, and whenever a
 * caller says something changed (`refresh`). Loads used to run twice on every hard load: React's development
 * Strict Mode runs the mount effect twice, and a window focus right after load started a second read. Now a load
 * that's already on its way is shared, a focus just after a load is skipped, and an older response never
 * overwrites a newer one. An explicit `refresh` always reads anew (the server changed after the read in flight began).
 */
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [ws, setWs] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const confirmed = useRef<Workspace | null>(null);
  const pending = useRef(0);
  const inflight = useRef<Promise<void> | null>(null);
  const issued = useRef(0);
  const applied = useRef(0);
  const loadedAt = useRef(0);

  const load = useCallback((reuse: boolean): Promise<void> => {
    if (reuse && inflight.current) return inflight.current;
    const id = ++issued.current;
    const run: Promise<void> = fetchWorkspace()
      .then((next) => {
        if (id < applied.current) return;
        applied.current = id;
        loadedAt.current = Date.now();
        confirmed.current = next;
        // Don't clobber optimistic state while writes are in flight.
        if (pending.current === 0) setWs(next);
        setError(null);
      })
      .catch((e: unknown) => {
        if (id >= applied.current) setError(e instanceof Error ? e.message : "Couldn't load your workspace.");
      })
      .finally(() => {
        if (inflight.current === run) inflight.current = null;
        setLoading(false);
      });
    inflight.current = run;
    return run;
  }, []);

  const refresh = useCallback(() => load(false), [load]);

  useEffect(() => {
    void load(true);
    const onFocus = () => {
      if (Date.now() - loadedAt.current < FOCUS_FRESH_MS) return;
      void load(true);
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  const dispatch = useCallback(async (input: Action | Action[]) => {
    const actions = Array.isArray(input) ? input : [input];
    const base = confirmed.current;
    if (base) {
      setWs((current) => {
        const draft = structuredClone(current ?? base);
        try {
          for (const a of actions) applyAction(draft, a);
          return draft;
        } catch {
          return current;
        }
      });
    }
    pending.current += 1;
    try {
      const res = await fetch("/api/workspace/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actions }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "That didn't save.");
      confirmed.current = body as Workspace;
      // A write's answer is the newest state: a read that started before it mustn't land on top of it.
      applied.current = ++issued.current;
      loadedAt.current = Date.now();
      pending.current -= 1;
      if (pending.current === 0) setWs(body as Workspace);
      return true;
    } catch (e) {
      pending.current -= 1;
      toast.error(e instanceof Error ? e.message : "That didn't save.");
      if (pending.current === 0 && confirmed.current) setWs(confirmed.current);
      return false;
    }
  }, []);

  const value = useMemo(() => ({ ws, loading, error, dispatch, refresh }), [ws, loading, error, dispatch, refresh]);
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return ctx;
}
