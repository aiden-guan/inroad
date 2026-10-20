"use client";

import type { HubStatus } from "@/lib/hub/types";
import { Ago, StatusDot, SubLabel } from "./parts";

/** The last few syncs and pushes for one connector. Hidden until there is one. */
export function SyncLog({ id, status, max = 4 }: { id: string; status: HubStatus | null; max?: number }) {
  const entries = (status?.sync ?? []).filter((e) => e.integrationId === id).slice(0, max);
  if (!entries.length) return null;
  return (
    <div>
      <SubLabel>Recent activity</SubLabel>
      <ul className="space-y-1.5">
        {entries.map((e) => (
          <li key={e.id} className="flex items-baseline gap-2.5 text-[13px] leading-[19px]">
            <StatusDot tone={e.ok ? "on" : "error"} className="relative -top-px" />
            <span className={e.ok ? "min-w-0 flex-1 text-fg-2" : "min-w-0 flex-1 text-danger"}>{e.message}</span>
            <span className="shrink-0 font-mono text-[11px] text-fg-3">
              <Ago iso={e.at} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
