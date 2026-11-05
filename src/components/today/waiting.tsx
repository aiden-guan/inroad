"use client";

import { Hourglass, Minus, Plus } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { toast } from "sonner";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Popover } from "@/components/ui/menu";
import { cn } from "@/lib/client/cn";
import { todayISO } from "@/lib/domain/ids";
import type { Workspace } from "@/lib/domain/types";
import { sentWhat, waitingOn, type Waiting } from "@/lib/moves/radar";
import { localDate, plural, shortDay } from "@/lib/moves/util";
import { remindLabel, shiftRemind } from "@/lib/replies/remind";

/**
 * "Waiting on 3 people": everyone whose latest note has a reminder (or a live sequence step) and hasn't answered.
 * Each row says what went and when it comes back, and the day moves or stops right there. Reminders are code
 * (src/lib/moves/radar.ts); nothing here sends.
 */
export function WaitingOn({ ws, now }: { ws: Workspace; now: number }) {
  const list = useMemo(() => waitingOn(ws, new Date(now)), [ws, now]);
  if (!list.length) return null;
  const due = list.filter((w) => w.due).length;
  return (
    <Popover
      align="end"
      className="w-[min(400px,calc(100vw-24px))] p-0"
      trigger={
        <button
          type="button"
          className="inline-flex h-7 items-center gap-1.5 rounded-sm px-2 text-[12.5px] text-fg-2 ring-1 ring-inset ring-border transition-colors hover:bg-bg-subtle hover:text-fg"
          aria-label={`Waiting on ${plural(list.length, "person", "people")}${due ? `, ${due} due` : ""}`}
        >
          <Hourglass aria-hidden className="size-3.5 text-fg-3" />
          Waiting on {plural(list.length, "person", "people")}
          {due > 0 && <span className="font-mono text-[11px] tnum text-fg-3">· {due} due</span>}
        </button>
      }
    >
      <div className="border-b border-border px-3.5 py-2.5">
        <p className="text-[13px] font-medium text-fg">Waiting on {plural(list.length, "person", "people")}</p>
        <p className="mt-0.5 text-[12px] leading-[17px] text-fg-3">If nothing comes back by the day, a follow-up with a written bump lands on Today. A reply, a meeting or a bounce ends the wait.</p>
      </div>
      <ul className="max-h-[min(60vh,420px)] divide-y divide-border overflow-y-auto overscroll-contain">
        {list.map((w) => (
          <WaitingRow key={w.personId} w={w} ws={ws} />
        ))}
      </ul>
    </Popover>
  );
}

function WaitingRow({ w, ws }: { w: Waiting; ws: Workspace }) {
  const { dispatch } = useWorkspace();
  const today = todayISO();
  const sentOn = localDate(w.touch.at);
  const on = w.remindOn;
  const set = (next: string | null) => void dispatch({ type: "activity.setRemind", id: w.touch.id, on: next });
  const stop = async () => {
    const prev = w.touch.remindOn;
    if (!(await dispatch({ type: "activity.setRemind", id: w.touch.id, on: null }))) return;
    toast(`Stopped waiting on ${w.name.split(" ")[0]}.`, { duration: 8_000, action: { label: "Undo", onClick: () => void dispatch({ type: "activity.setRemind", id: w.touch.id, on: prev === undefined ? w.remindOn : prev }) } });
  };
  const step = "inline-flex size-6 items-center justify-center rounded-xs text-fg-3 transition-colors hover:bg-bg-subtle hover:text-fg disabled:opacity-40";
  return (
    <li className="px-3.5 py-2.5">
      <div className="flex items-baseline gap-2">
        <Link href={`/companies?c=${encodeURIComponent(w.domain)}`} className="min-w-0 truncate text-[13px] font-medium text-fg hover:underline">
          {w.name} <span className="font-normal text-fg-3">· {w.company}</span>
        </Link>
        <span className={cn("ml-auto shrink-0 font-mono text-[11px] tnum", w.due ? "text-fg" : "text-fg-3")}>{w.due ? "due" : remindLabel(on, today)}</span>
      </div>
      <div className="mt-0.5 flex items-center gap-2 text-[12px] text-fg-3">
        <span className="min-w-0 truncate">
          {w.basis === "sequence" ? `Follow-up ${(w.nextStep ?? 2) - 1} of the sequence` : `${sentWhat(ws, w.touch).replace(/^./, (c) => c.toUpperCase())}`} · sent {shortDay(sentOn)}
          {w.heldUntil ? ` · held until ${shortDay(w.heldUntil)}` : ""}
        </span>
        <span className="ml-auto inline-flex shrink-0 items-center">
          <button type="button" className={step} aria-label={`Remind a day sooner about ${w.name}`} disabled={shiftRemind(on, -1, sentOn) === on} onClick={() => set(shiftRemind(on, -1, sentOn))}>
            <Minus className="size-3" />
          </button>
          <button type="button" className={step} aria-label={`Remind a day later about ${w.name}`} onClick={() => set(shiftRemind(on, 1, sentOn))}>
            <Plus className="size-3" />
          </button>
          <button type="button" onClick={() => void stop()} className="ml-1 rounded-xs px-1.5 py-0.5 text-[12px] text-fg-3 transition-colors hover:bg-bg-subtle hover:text-fg">
            Stop
          </button>
        </span>
      </div>
    </li>
  );
}
