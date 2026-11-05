"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { applyColumnsOps } from "@/lib/columns/ops";
import type { ColumnsData, ColumnsOp, ColumnsResponse } from "@/lib/columns/types";

/**
 * One store for research columns in this tab, shared by the table, its composer and the company sheet:
 * fetched once, changed optimistically (the same reducer the server runs), and polled while a run is filling
 * cells so answers appear as each company finishes.
 */

interface State {
  data: ColumnsResponse | null;
  error: string | null;
}

let state: State = { data: null, error: null };
let confirmed: ColumnsResponse | null = null;
let pending = 0;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function set(next: Partial<State>) {
  state = { ...state, ...next };
  for (const l of listeners) l();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

async function load(): Promise<void> {
  if (loading) return loading;
  loading = (async () => {
    try {
      const res = await fetch("/api/columns", { cache: "no-store" });
      const body = (await res.json()) as ColumnsResponse & { error?: string };
      if (!res.ok) throw new Error(body.error ?? `Couldn't load research columns (${res.status}).`);
      confirmed = body;
      // Don't clobber optimistic changes while they're being saved.
      if (pending === 0) set({ data: body, error: null });
    } catch (e) {
      if (!state.data) set({ error: e instanceof Error ? e.message : "Couldn't load research columns." });
    } finally {
      loading = null;
    }
  })();
  return loading;
}

/** Applies ops at once, then saves them. Resolves false (and puts things back) if the save fails. */
async function apply(ops: ColumnsOp[]): Promise<boolean> {
  const base = state.data ?? confirmed;
  if (base) {
    try {
      const draft = structuredClone(base) as ColumnsResponse;
      applyColumnsOps(draft as ColumnsData, ops);
      set({ data: draft });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That didn't save.");
      return false;
    }
  }
  pending++;
  try {
    const res = await fetch("/api/columns", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ops }) });
    const body = (await res.json()) as ColumnsResponse & { error?: string };
    if (!res.ok) throw new Error(body.error ?? "That didn't save.");
    confirmed = body;
    pending--;
    if (pending === 0) set({ data: body, error: null });
    return true;
  } catch (e) {
    pending--;
    toast.error(e instanceof Error ? e.message : "That didn't save.");
    if (pending === 0 && confirmed) set({ data: confirmed });
    return false;
  }
}

export function useColumns() {
  const snap = useSyncExternalStore(subscribe, () => state, () => state);
  // Fresh on every mount and when the window comes back: a sample, reset or restore replaces columns.json.
  useEffect(() => {
    void load();
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);
  const refresh = useCallback(() => load(), []);
  return { data: snap.data, error: snap.error, apply, refresh };
}

/**
 * Polls while `active` (a column run is going), then once more after it ends, so the last answers and the
 * final costs land. Every hook instance shares the one store, so two pollers just share requests.
 */
export function useColumnsPolling(active: boolean, everyMs = 1200) {
  useEffect(() => {
    if (!active) return;
    void load();
    const t = setInterval(() => void load(), everyMs);
    return () => {
      clearInterval(t);
      void load();
    };
  }, [active, everyMs]);
}
