"use client";

import { useEffect, useState } from "react";
import type { ModelTarget, RoutingStatus } from "@/lib/ai/routing-types";

/** A choice for one run; saved task policies remain in Settings. */
export function RunModelPicker({ value, onChange, disabled }: { value?: ModelTarget; onChange: (value?: ModelTarget) => void; disabled?: boolean }) {
  const [status, setStatus] = useState<RoutingStatus>();
  useEffect(() => {
    let cancelled = false;
    fetch("/api/ai/connections", { cache: "no-store" }).then(async (r) => {
      if (!r.ok) return;
      const data = await r.json(); if (!cancelled) setStatus(data);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);
  if (!status || !status.connections.length) return null;
  return <label className="flex items-center gap-2 border-t border-border px-3 py-2 text-[12px] text-fg-3">
    <span>Model</span>
    <select aria-label="Model for this message" disabled={disabled} value={value ? `${value.connectionId}|${value.model ?? ""}` : ""}
      className="min-w-0 flex-1 rounded border border-border bg-surface px-2 py-1 text-fg-2"
      onChange={(e) => {
        const [connectionId, model] = e.target.value.split("|");
        onChange(connectionId ? { connectionId, ...(model ? { model } : {}) } : undefined);
      }}>
      <option value="">Follow task routing</option>
      {status.connections.filter((c) => status.ready[c.id]).map((c) => <optgroup key={c.id} label={c.name}>
        <option value={`${c.id}|`}>Use {c.name} tier models</option>
        {[...new Set([c.model, ...Object.values(c.models), ...c.available])].map((model) => <option key={model} value={`${c.id}|${model}`}>{model}</option>)}
      </optgroup>)}
    </select>
  </label>;
}
