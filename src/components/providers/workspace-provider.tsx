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
  refresh: () => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

async function fetchWorkspace(): Promise<Workspace> {
  const res = await fetch("/api/workspace", { cache: "no-store" });
  if (!res.ok) throw new Error(`Couldn't load your workspace (${res.status}).`);
  return res.json();
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [ws, setWs] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const confirmed = useRef<Workspace | null>(null);
  const pending = useRef(0);

  const refresh = useCallback(async () => {
    try {
      const next = await fetchWorkspace();
      confirmed.current = next;
      // Don't clobber optimistic state while writes are in flight.
      if (pending.current === 0) setWs(next);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load your workspace.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchWorkspace()
      .then((next) => {
        if (cancelled) return;
        confirmed.current = next;
        setWs(next);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Couldn't load your workspace."))
      .finally(() => !cancelled && setLoading(false));
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

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
