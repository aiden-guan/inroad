"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRuns, type RunState } from "@/components/providers/runs-provider";
import type { SourceStatus } from "@/lib/intent/sources";
import type { IntentQuery } from "@/lib/intent/types";
import { localPost } from "./use-automation";

/** What GET /api/intent says before anything runs: sources and limits, the query plan, whether a scan can start. */
export interface IntentStatus {
  sources: SourceStatus[];
  queries: IntentQuery[];
  retired: IntentQuery[];
  canScan: { ok: boolean; reason?: string };
  mock: boolean;
  githubToken: boolean;
  search: string | null;
}

/** Reloads whenever the workspace changes (`rev`), so a retired query or a new playbook shows at once. Zero tokens. */
export function useIntentStatus(rev: number | undefined) {
  const [status, setStatus] = useState<IntentStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    fetch("/api/intent", { cache: "no-store", signal: abort.signal })
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Couldn't read the intent settings.");
        if (!abort.signal.aborted) {
          setStatus(body);
          setError(null);
        }
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e instanceof Error ? e.message : "Couldn't read the intent settings.");
      });
    return () => abort.abort();
  }, [rev]);
  return { status, error };
}

export const intentAction = <T>(body: Record<string, unknown>) => localPost<T>("/api/intent", body);

/** The newest run of one Intent mode this tab knows about (live, or finished in this session). */
export function useIntentRun(mode: "asks" | "radar"): RunState | undefined {
  const { runs } = useRuns();
  return useMemo(
    () =>
      Object.values(runs)
        .filter((r) => r.workflow === "intent" && r.ref?.id === `intent:${mode}`)
        .sort((a, b) => b.startedAt - a.startedAt)[0],
    [runs, mode],
  );
}

export const isActive = (run: RunState | undefined) => !!run && (run.status === "running" || run.status === "queued");

/** URL-addressable view state without a server round trip (the history API updates useSearchParams). */
export function useUrlParams() {
  return useCallback((patch: Record<string, string | null>) => {
    const next = new URLSearchParams(window.location.search);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    const qs = next.toString();
    window.history.replaceState(null, "", qs ? `${window.location.pathname}?${qs}` : window.location.pathname);
  }, []);
}

export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
}

export function inOverlay(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el?.closest?.('[role="dialog"],[role="menu"],[role="listbox"],[data-radix-popper-content-wrapper]');
}
