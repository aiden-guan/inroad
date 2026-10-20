"use client";

import { useEffect } from "react";
import { useWorkspace } from "@/components/providers/workspace-provider";

const POLLED = ["instantly", "smartlead", "hubspot", "attio"] as const;
// The server keeps each connector's own cadence (2–5 min); this only says the app is open.
const TICK_MS = 60_000;

/**
 * While the app is open in a visible tab, asks the server to read replies and CRM changes from
 * connected tools that no webhook can reach. Renders nothing; refreshes the workspace when
 * something new arrived.
 */
export function ConnectorPoller() {
  const { ws, refresh } = useWorkspace();
  const active = Boolean(ws && !ws.sample && POLLED.some((id) => ws.integrations[id]?.enabled));

  useEffect(() => {
    if (!active) return;
    let stopped = false;
    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch("/api/integrations/poll", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
        const body = (await res.json().catch(() => null)) as { changed?: boolean } | null;
        if (!stopped && body?.changed) await refresh();
      } catch {
        // Offline or the app restarting: the next tick tries again.
      }
    };
    const first = setTimeout(() => void tick(), 5_000);
    const timer = setInterval(() => void tick(), TICK_MS);
    return () => {
      stopped = true;
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [active, refresh]);

  return null;
}
