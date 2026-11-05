"use client";

import { ChevronRight, Sparkle } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Popover } from "@/components/ui/menu";
import { cn } from "@/lib/client/cn";
import type { Action } from "@/lib/domain/actions";
import type { Move, Workspace } from "@/lib/domain/types";
import { LEARN_WINDOW_DAYS, learnedAdjustments, matches, skipTarget, type Adjustment } from "@/lib/learning/targeting";
import { localDate, plural, shortDay } from "@/lib/moves/util";

/**
 * "What I've learned": each adjustment skips made, the skips behind it, when it lapses, and Undo. Today's targeting
 * reads the same list (src/lib/learning/targeting.ts), so what this says is what the ranking does. Shown from Today
 * and in the Friday learning review.
 */

const WHY: Record<Adjustment["kind"], (a: Adjustment) => string> = {
  persona: (a) => `${plural(a.skips.length, "skip")} as the wrong person since ${shortDay(a.since)}`,
  signal: (a) => `${plural(a.skips.length, "skip")} for a weak angle since ${shortDay(a.since)}`,
  tone: (a) => `${plural(a.skips.length, "draft")} you marked tone off, kept as what not to write`,
};

function headline(a: Adjustment): string {
  if (a.kind === "tone") return "Tone: drafts stay away from these";
  return `${a.label}: ${a.kind === "persona" ? "new outreach" : "cards built on it"} ranked ${Math.round((1 - (a.weight ?? 1)) * 100)}% lower`;
}

/** The actions that take an adjustment back, and the ones that put it back. */
function undoActions(a: Adjustment): { undo: Action[]; redo: Action[] } {
  if (a.kind === "tone") {
    // The examples go; the skipped cards stay skipped. Redo can't restore deleted text, so it isn't offered.
    return { undo: [{ type: "voice.forgetToneOff", ats: a.skips.map((s) => s.at) }], redo: [] };
  }
  const ids = a.skips.map((s) => s.moveId);
  return { undo: [{ type: "move.learn", ids, ignore: true }], redo: [{ type: "move.learn", ids, ignore: false }] };
}

export function LearnedList({ ws, today, visible, className }: { ws: Workspace; today: string; visible?: Move[]; className?: string }) {
  const { dispatch } = useWorkspace();
  const list = useMemo(() => learnedAdjustments(ws, today), [ws, today]);
  const [open, setOpen] = useState<string | null>(null);
  if (!list.length) {
    return (
      <p className={cn("text-[12.5px] leading-[19px] text-fg-3", className)}>
        Nothing yet. Three skips with the same reason inside {LEARN_WINDOW_DAYS} days change who I suggest: wrong person on one persona, or a weak angle on one kind of signal.
      </p>
    );
  }
  return (
    <ul className={cn("space-y-2", className)}>
      {list.map((a) => {
        const affected = visible?.filter((m) => a.kind !== "tone" && matches(a, skipTarget(ws, m)) && /ranked lower/.test(m.why)).length ?? 0;
        const { undo, redo } = undoActions(a);
        const expanded = open === a.key;
        return (
          <li key={a.key} className="rounded-md bg-surface px-3 py-2.5 ring-1 ring-inset ring-border">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium leading-5 text-fg">{headline(a)}</p>
                <p className="mt-0.5 text-[12px] leading-[17px] text-fg-3">
                  {WHY[a.kind](a)}
                  {a.expiresOn && ` · until ${shortDay(a.expiresOn)} unless you skip more`}
                  {affected > 0 && ` · ${plural(affected, "card")} on today's desk`}
                </p>
              </div>
              <button
                type="button"
                onClick={async () => {
                  if (!(await dispatch(undo))) return;
                  toast(a.kind === "tone" ? "Removed those examples. Drafts no longer avoid them." : `Stopped. ${a.label} cards rank as before.`, redo.length ? { duration: 8_000, action: { label: "Undo", onClick: () => void dispatch(redo) } } : undefined);
                }}
                className="shrink-0 rounded-sm px-2 py-1 text-[12px] font-medium text-fg-2 ring-1 ring-inset ring-border transition-colors hover:bg-bg-subtle hover:text-fg"
              >
                Undo
              </button>
            </div>
            <button type="button" onClick={() => setOpen(expanded ? null : a.key)} aria-expanded={expanded} className="mt-1.5 inline-flex items-center gap-1 text-[12px] text-fg-3 hover:text-fg-2">
              <ChevronRight aria-hidden className={cn("size-3 transition-transform duration-150", expanded && "rotate-90")} />
              {a.kind === "tone" ? "The drafts" : "The skips"}
            </button>
            {expanded && (
              <ul className="mt-1 space-y-0.5 border-l border-border pl-3 animate-[fade-in_150ms_var(--ease-out)]">
                {a.skips.map((s) => (
                  <li key={`${s.moveId}:${s.at}`} className="flex gap-2 text-[12px] leading-[18px] text-fg-2">
                    <span className="min-w-0 flex-1 truncate">{s.title}</span>
                    <span className="shrink-0 font-mono text-[11px] tnum text-fg-3">{shortDay(localDate(s.at))}</span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** The quiet button on Today that opens the list. */
export function LearnedButton({ ws, today, visible }: { ws: Workspace; today: string; visible: Move[] }) {
  const n = useMemo(() => learnedAdjustments(ws, today).length, [ws, today]);
  if (!n) return null;
  return (
    <Popover
      align="end"
      className="w-[min(420px,calc(100vw-24px))]"
      trigger={
        <button
          type="button"
          className="inline-flex h-7 items-center gap-1.5 rounded-sm px-2 text-[12.5px] text-fg-2 ring-1 ring-inset ring-border transition-colors hover:bg-bg-subtle hover:text-fg"
          aria-label={`What I've learned from your skips: ${plural(n, "change")}`}
        >
          <Sparkle aria-hidden className="size-3.5 text-accent-text" />
          Learned <span className="font-mono text-[11px] tnum text-fg-3">{n}</span>
        </button>
      }
    >
      <p className="mb-1 text-[13px] font-medium text-fg">What I&apos;ve learned</p>
      <p className="mb-2.5 text-[12px] leading-[17px] text-fg-3">From your skips, in code. Each one lapses on its own; Undo takes it back now.</p>
      <LearnedList ws={ws} today={today} visible={visible} />
    </Popover>
  );
}
