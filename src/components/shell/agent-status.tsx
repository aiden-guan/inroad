"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useActiveRuns, useRuns, type RunState } from "@/components/providers/runs-provider";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Orb, type OrbState } from "@/components/ui/orb";
import { Receipt } from "@/components/ui/work-log";
import { todayISO } from "@/lib/domain/ids";
import { yourMoves } from "@/lib/intros/rules";
import { todayCounts } from "@/lib/moves/nav-counts";

export interface AgentStatus {
  state: OrbState;
  /** Completed steps across live runs: each one ticks the orb once. */
  ticks: number;
  /** One line: the live run's title, else what's waiting on Today. */
  line: string;
  active: RunState[];
  ready: number;
  later: number;
}

/** What the agent is doing right now, for the sidebar block and the phone header alike. */
export function useAgentStatus(): AgentStatus {
  const { ws } = useWorkspace();
  const active = useActiveRuns();
  // Read the clock only once the workspace is here: never while prerendering the shell.
  const { ready, later } = useMemo(() => (ws ? todayCounts(ws.moves, todayISO()) : { ready: 0, later: 0 }), [ws]);
  const ticks = active.reduce((n, r) => n + r.steps.length, 0);
  // Until the workspace loads there's nothing true to say yet (a blank line keeps the height).
  const line = active.length ? active[0].title : !ws ? " " : ready ? `${ready} move${ready === 1 ? "" : "s"} ready for you` : "All caught up";
  return { state: active.length ? "working" : ready ? "needs" : "idle", ticks, line, active, ready, later };
}

/** Badge counts for the nav: the same numbers Today and Intros show. */
export function useNavCounts(): Record<string, number | undefined> {
  const { ws } = useWorkspace();
  return useMemo(() => {
    if (!ws) return {};
    const today = todayISO();
    return { "/today": todayCounts(ws.moves, today).ready || undefined, "/intros": yourMoves(ws, today).length || undefined };
  }, [ws]);
}

/** The agent popover: runs in progress, what's waiting on Today, and the last few receipts. */
export function AgentPanel({ status, onNavigate }: { status: AgentStatus; onNavigate?: () => void }) {
  const { runs } = useRuns();
  const recent = useMemo(
    () =>
      Object.values(runs)
        .filter((r) => r.status !== "running" && r.status !== "queued")
        .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
        .slice(0, 5),
    [runs],
  );
  const { active, ready, later } = status;
  return (
    <div className="space-y-2">
      {active.length > 0 && (
        <div>
          <p className="px-1.5 pb-1 text-[11px] font-medium text-fg-3">In progress · {active.length}</p>
          {active.map((r) => (
            <div key={r.id} className="flex items-center gap-2 rounded-sm px-1.5 py-1.5 text-[13px]">
              <Orb state="working" size={14} />
              <span className="min-w-0 flex-1 truncate">{r.title}</span>
              <span className="truncate font-mono text-[11px] text-fg-3">{r.steps.at(-1)?.text.slice(0, 18)}</span>
            </div>
          ))}
        </div>
      )}
      {ready > 0 && (
        <Link href="/today" onClick={onNavigate} className="block rounded-sm px-1.5 py-1.5 text-[13px] text-fg transition-colors hover:bg-bg-subtle">
          {ready} move{ready === 1 ? "" : "s"} ready on Today
          {later > 0 && <span className="block text-[12px] text-fg-3">{later} more under Later</span>}
        </Link>
      )}
      <div>
        <p className="px-1.5 pb-1 text-[11px] font-medium text-fg-3">Recent</p>
        {recent.length === 0 && <p className="px-1.5 py-1 text-[12px] text-fg-3">Nothing yet this session.</p>}
        {recent.map((r) => (
          <div key={r.id} className="rounded-sm px-1.5 py-1">
            <p className="truncate text-[13px] text-fg">{r.title}</p>
            <Receipt run={r} />
          </div>
        ))}
      </div>
    </div>
  );
}
