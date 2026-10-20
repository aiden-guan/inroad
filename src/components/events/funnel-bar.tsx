"use client";

import { cn } from "@/lib/client/cn";
import type { Funnel } from "./plan-math";

const STAGES: { key: keyof Omit<Funnel, "target">; label: string; shade: string }[] = [
  { key: "invited", label: "Invited", shade: "bg-fg-4/45" },
  { key: "accepted", label: "Accepted", shade: "bg-fg-4" },
  { key: "confirmed", label: "Confirmed", shade: "bg-fg-3" },
  { key: "attended", label: "Attended", shade: "bg-fg-2" },
  { key: "meetings", label: "Meetings", shade: "bg-fg" },
];

/**
 * Invited → accepted → confirmed → attended → meetings as nested bars on one track (ink shades,
 * never the agent's blue). The track is the invite target, so an empty room reads as "not started".
 */
export function FunnelBar({ funnel, className, size = "md" }: { funnel: Funnel; className?: string; size?: "sm" | "md" }) {
  const scale = Math.max(funnel.target, funnel.invited, 1);
  const rate = funnel.attended ? Math.round((funnel.meetings / funnel.attended) * 100) : null;
  return (
    <div className={cn("min-w-0", className)}>
      <div
        className={cn("relative overflow-hidden rounded-full bg-sunken ring-1 ring-inset ring-border/60", size === "sm" ? "h-1" : "h-1.5")}
        role="img"
        aria-label={STAGES.map((s) => `${funnel[s.key]} ${s.label.toLowerCase()}`).join(", ")}
      >
        {STAGES.map((s) => (
          <span
            key={s.key}
            className={cn("absolute inset-y-0 left-0 w-full origin-left rounded-full transition-transform duration-500 ease-out motion-reduce:transition-none", s.shade)}
            style={{ transform: `scaleX(${Math.min(1, funnel[s.key] / scale)})` }}
          />
        ))}
      </div>
      <dl className="mt-2 grid grid-cols-5 gap-1">
        {STAGES.map((s) => (
          <div key={s.key} className="min-w-0">
            <dt className="truncate text-[11px] text-fg-3">{s.label}</dt>
            <dd className="font-mono text-[13px] tnum text-fg">
              {funnel[s.key]}
              {s.key === "invited" && funnel.target > 0 && <span className="text-fg-3">/{funnel.target}</span>}
              {s.key === "meetings" && rate !== null && <span className="text-fg-3"> · {rate}%</span>}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
