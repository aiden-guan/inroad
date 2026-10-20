"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { useWorkspace } from "@/components/providers/workspace-provider";
import type { HubStatus } from "@/lib/hub/types";

async function fetchStatus(): Promise<HubStatus> {
  const res = await fetch("/api/integrations/status", { cache: "no-store" });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? `Couldn't load integrations (${res.status}).`);
  return body as HubStatus;
}

/** Hub status that isn't in the workspace (inbound URL token, recent events, deliveries). */
export function useHubStatus() {
  const [status, setStatus] = useState<HubStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await fetchStatus());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load integrations.");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchStatus()
      .then((s) => !cancelled && setStatus(s))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Couldn't load integrations."));
    return () => {
      cancelled = true;
    };
  }, []);

  return { status, error, refresh, setStatus };
}

/** Calls `fn` every `ms` while `active`. Used only while a webhook card is open and waiting. */
export function usePolling(active: boolean, fn: () => void, ms = 4000) {
  useEffect(() => {
    if (!active) return;
    const t = setInterval(fn, ms);
    return () => clearInterval(t);
  }, [active, fn, ms]);
}

/**
 * POST/DELETE to a hub route. Shows the server's message on failure and refreshes the workspace
 * on success (routes that change it return it, but the provider only exposes refresh()).
 */
export function useHubApi() {
  const { refresh } = useWorkspace();
  return useCallback(
    async <T = Record<string, unknown>>(url: string, body?: unknown, opts: { method?: "POST" | "DELETE"; quiet?: boolean } = {}): Promise<(T & { ok?: boolean; message?: string }) | null> => {
      try {
        const res = await fetch(url, {
          method: opts.method ?? "POST",
          headers: body === undefined ? undefined : { "Content-Type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error ?? "That didn't work. Try again.");
        if (json && typeof json === "object" && "workspace" in json) void refresh();
        return json as T & { ok?: boolean; message?: string };
      } catch (e) {
        if (!opts.quiet) toast.error(e instanceof Error ? e.message : "That didn't work. Try again.");
        return null;
      }
    },
    [refresh],
  );
}

/* ───────────── A shared clock for "2m ago" labels, without calling Date.now() in render ───────────── */

let now = 0;
let timer: ReturnType<typeof setInterval> | undefined;
const subscribers = new Set<() => void>();

function subscribe(cb: () => void) {
  subscribers.add(cb);
  if (!timer) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      subscribers.forEach((f) => f());
    }, 30_000);
  }
  return () => {
    subscribers.delete(cb);
    if (!subscribers.size && timer) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

const snapshot = () => now;
const serverSnapshot = () => 0;

/** Current time, refreshed every 30s. 0 during server render (callers show nothing then). */
export function useNow(): number {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}

/* ───────────── URL hash (deep links like /integrations#instantly) ───────────── */

function subscribeHash(cb: () => void) {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
}

export function useHash(): string {
  return useSyncExternalStore(
    subscribeHash,
    () => window.location.hash.slice(1),
    () => "",
  );
}
