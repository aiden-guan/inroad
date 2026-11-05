"use client";

import { Cpu } from "lucide-react";
import { useEffect, useState } from "react";
import type { ModelTarget, RoutingStatus } from "@/lib/ai/routing-types";
import { cn } from "@/lib/client/cn";

/**
 * A model for one message, as a compact control beside Send: it reads "Default model" until the founder picks one,
 * and saved task choices stay in Settings. Hidden when there's nothing to choose between.
 */
export function RunModelPicker({ value, onChange, disabled, className }: { value?: ModelTarget; onChange: (value?: ModelTarget) => void; disabled?: boolean; className?: string }) {
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
  const ready = status.connections.filter((c) => status.ready[c.id]);
  const picked = value ? ready.find((c) => c.id === value.connectionId) : undefined;
  const shown = picked ? (value?.model ? value.model : `${picked.name}'s usual models`) : "Default model";
  return (
    <span className={cn("relative inline-flex min-w-0 items-center", className)}>
      <Cpu aria-hidden className="pointer-events-none absolute left-2 size-3.5 text-fg-3" />
      <select
        aria-label="Model for this message"
        title={`Model for this message: ${shown}`}
        disabled={disabled}
        value={value ? `${value.connectionId}|${value.model ?? ""}` : ""}
        className={cn(
          "field-select h-7 min-w-0 max-w-[9.5rem] rounded-md bg-transparent pl-7 text-[12px] font-medium transition-colors duration-150 hover:bg-bg-subtle hover:text-fg-2 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)] disabled:opacity-50 sm:max-w-[14rem]",
          picked ? "text-fg-2" : "text-fg-3",
        )}
        onChange={(e) => {
          const [connectionId, model] = e.target.value.split("|");
          onChange(connectionId ? { connectionId, ...(model ? { model } : {}) } : undefined);
        }}
      >
        <option value="">Default model</option>
        {ready.map((c) => <optgroup key={c.id} label={c.name}>
          <option value={`${c.id}|`}>{c.name}&apos;s usual models</option>
          {[...new Set([c.model, ...Object.values(c.models), ...c.available])].map((model) => <option key={model} value={`${c.id}|${model}`}>{model}</option>)}
        </optgroup>)}
      </select>
    </span>
  );
}
