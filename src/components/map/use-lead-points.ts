"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useWorkspace } from "@/components/providers/workspace-provider";
import type { LeadPoint } from "@/lib/geo/leads";
import { usesMiles } from "@/lib/geo/places";

/**
 * Lead points from the server (which places them, asking OpenStreetMap for unknown places in the
 * background). Re-reads when the workspace changes, and a few times while places are still pending.
 */
export function useLeadPoints(): { points: LeadPoint[] | null; pending: number; failed: boolean } {
  const { ws } = useWorkspace();
  const [state, setState] = useState<{ points: LeadPoint[] | null; pending: number; failed: boolean }>({ points: null, pending: 0, failed: false });
  const rev = ws?.rev ?? 0;

  useEffect(() => {
    let cancelled = false;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () =>
      fetch("/api/geo/leads", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((body: { points: LeadPoint[]; pending: number }) => {
          if (cancelled) return;
          setState({ points: body.points, pending: body.pending, failed: false });
          // Places resolve one a second; look again while some are still on their way.
          if (body.pending > 0 && tries++ < 6) timer = setTimeout(load, 2500);
        })
        .catch(() => !cancelled && setState((s) => ({ ...s, failed: true })));
    // Debounced: a burst of writes (adding guests) reads once.
    timer = setTimeout(load, rev ? 250 : 0);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [rev]);

  return state;
}

const noop = () => () => {};

/** Miles for US readers, kilometres elsewhere. Stable across server and client renders. */
export function useMiles(): boolean {
  return useSyncExternalStore(noop, () => usesMiles(), () => true);
}
