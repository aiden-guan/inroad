"use client";
import { useCallback, useEffect, useState } from "react";
import type { AutomationData } from "@/lib/automation/types";
import type { researchMetrics } from "@/lib/search/research";

export interface AutomationStatus extends Omit<AutomationData, "version"> {
  metrics: ReturnType<typeof researchMetrics>;
}
export async function localPost<T>(url: string, input: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input), signal });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "The request didn't finish. Try again.");
  return body as T;
}
export function useAutomation() {
  const [data, setData] = useState<AutomationStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      const response = await fetch("/api/automation", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Couldn't load research tools.");
      setData(body);
      setError(null);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Couldn't load research tools.");
    }
  }, []);
  useEffect(() => {
    const abort = new AbortController();
    fetch("/api/automation", { cache: "no-store", signal: abort.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Couldn't load research tools.");
        if (!abort.signal.aborted) setData(body);
      })
      .catch((error) => {
        if (!abort.signal.aborted) setError(error instanceof Error ? error.message : "Couldn't load research tools.");
      });
    return () => abort.abort();
  }, []);
  const run = useCallback(
    async <T>(body: unknown): Promise<T> => {
      const result = await localPost<{ result: T }>("/api/automation", body);
      await reload();
      return result.result;
    },
    [reload],
  );
  return { data, error, reload, run };
}
export type AutomationController = ReturnType<typeof useAutomation>;
export const controlClass =
  "w-full rounded-md border border-border bg-surface px-3 py-2 text-[13px] text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]";
