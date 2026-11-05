"use client";

import { Minus, Plus } from "lucide-react";
import { useState } from "react";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { cn } from "@/lib/client/cn";
import { addBusinessDays, todayISO } from "@/lib/domain/ids";
import { sequenceNext } from "@/lib/moves/radar";
import { localDate } from "@/lib/moves/util";
import { REMIND_BUSINESS_DAYS, remindLabel, shiftRemind } from "@/lib/replies/remind";

/**
 * "Remind me Monday if no reply", pre-checked, in the toast that confirms a send. Uncheck it to stop chasing the
 * thread; − and + move the day by one working day. Reads the send from the workspace, so it stays true after
 * the round trip. Renders nothing for sends that never get a reminder (an intro ask, a sequencer's step).
 */
export function RemindControl({ activityId, className }: { activityId: string; className?: string }) {
  const { ws, dispatch } = useWorkspace();
  const [lastOn, setLastOn] = useState<string | null>(null);
  const a = ws?.activities.find((x) => x.id === activityId);
  if (!a || a.remindOn === undefined) return null;
  const today = todayISO();
  const sentOn = localDate(a.at);
  const on = a.remindOn;
  // In a sequence the reminder is the next step coming due: say so, so turning it off is a clear choice.
  const pkg = a.draftRef ? ws?.outreach[a.draftRef.packageId] : undefined;
  const seq = pkg ? sequenceNext(pkg) : null;
  const set = (next: string | null) => void dispatch({ type: "activity.setRemind", id: activityId, on: next });
  const toggle = () => {
    if (on) {
      setLastOn(on);
      set(null);
    } else set(lastOn ?? addBusinessDays(sentOn, REMIND_BUSINESS_DAYS));
  };
  const step = "inline-flex size-6 items-center justify-center rounded-xs text-fg-3 transition-colors hover:bg-bg-subtle hover:text-fg disabled:opacity-40";
  return (
    <span className={cn("mt-1 flex items-center gap-1.5 text-[12.5px] text-fg-2", className)}>
      <label className="inline-flex cursor-pointer items-center gap-2">
        <input type="checkbox" checked={!!on} onChange={toggle} className="size-3.5 accent-[var(--primary)]" />
        {on ? (
          <span>
            Remind me {remindLabel(on, today)} if no reply{seq ? <span className="text-fg-3"> · follow-up {seq.step - 1}</span> : null}
          </span>
        ) : (
          <span className="text-fg-3">{seq ? "No reminder: the sequence waits" : "No reminder"}</span>
        )}
      </label>
      {on && (
        <span className="ml-auto inline-flex items-center">
          <button type="button" className={step} aria-label="A day sooner" disabled={shiftRemind(on, -1, sentOn) === on} onClick={() => set(shiftRemind(on, -1, sentOn))}>
            <Minus className="size-3" />
          </button>
          <button type="button" className={step} aria-label="A day later" onClick={() => set(shiftRemind(on, 1, sentOn))}>
            <Plus className="size-3" />
          </button>
        </span>
      )}
    </span>
  );
}
