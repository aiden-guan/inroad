"use client";

import { AnimatePresence, motion } from "motion/react";
import type { Ref } from "react";
import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SourceChip } from "@/components/ui/source";
import { cn } from "@/lib/client/cn";
import type { Move, SkipReason, Workspace } from "@/lib/domain/types";
import { ruleLabel } from "@/lib/moves/rules";
import { spring } from "@/lib/motion";
import type { CheckRepliesHandle } from "./check-replies";
import { MoveBody, cardDraft, endsInBody } from "./move-body";
import { KindIcon, SkipReasons } from "./parts";

export interface MoveCardProps {
  move: Move;
  ws: Workspace;
  now: number;
  today: string;
  weekStart: string;
  focused: boolean;
  expanded: boolean;
  skipOpen: boolean;
  bindHeader: (el: HTMLButtonElement | null) => void;
  repliesHandle?: Ref<CheckRepliesHandle>;
  onFocus: () => void;
  onToggle: () => void;
  /** The card's own work finished it (a form saved, a draft approved): no toast. */
  onDone: () => void;
  /** The founder pressed Done: toast with Undo. */
  onMarkDone: () => void;
  /** The card's own work put it off until a date: no toast (the card says what happened). */
  onSnoozeUntil: (until: string) => void;
  onSkipOpen: () => void;
  onSkip: (reason: SkipReason) => void;
  onSkipCancel: () => void;
  onSnooze: () => void;
  onChanged: () => void;
}

/**
 * One move: kind icon, a templated title, the why line with its source, minutes. Enter expands it
 * in place into whatever finishes it (a draft, a form, a run). The focused card wears the blue-pencil wash.
 */
export function MoveCard({ bindHeader, repliesHandle, ...p }: MoveCardProps) {
  const { move } = p;
  const overdue = move.overdueDays ?? 0;
  // Matches the page's A key: with a draft showing, A belongs to the composer's own button.
  const hasDraft = !!cardDraft(p.ws, move);
  const ownEnd = endsInBody(move);
  return (
    <div className={cn("group/move relative rounded-xl bg-surface shadow-xs ring-1 ring-inset transition-[box-shadow,background-color] duration-200 hover:shadow-sm", p.focused ? "ring-accent/40" : "ring-border")}>
      <div className={cn("relative flex items-start gap-3.5 px-4 py-4 transition-colors duration-150 md:px-5", p.focused && "draft-wash", p.expanded || p.skipOpen ? "rounded-t-xl" : "rounded-xl")}>
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-bg-subtle ring-1 ring-inset ring-border/60" title={ruleLabel(move.rule)}>
          <KindIcon kind={move.kind} className={cn(p.focused && "text-accent-text")} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="pt-0.5 text-[14px] font-medium leading-5 text-fg">
            <button
              ref={bindHeader}
              onFocus={p.onFocus}
              onClick={p.onToggle}
              aria-expanded={p.expanded}
              className="text-left outline-none after:absolute after:inset-0 after:rounded-[inherit] after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-[var(--ring)]"
            >
              {move.title}
            </button>
          </h3>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px] leading-5 text-fg-2">
            {overdue > 0 && <span className="font-medium text-danger">Overdue {overdue}d ·</span>}
            <span className="min-w-0 break-words">{move.why}</span>
            {move.source && <SourceChip url={move.source.url} publishedAt={move.source.date} quote={move.source.quote} className="relative z-10" />}
          </p>
        </div>
        <span className="mt-1 flex shrink-0 items-center gap-2 text-fg-3">
          <span className="font-mono text-[10.5px] tnum">{move.minutes} min</span>
          <ChevronRight aria-hidden className={cn("hidden size-3.5 transition-transform duration-200 sm:block", p.expanded && "rotate-90")} />
        </span>
      </div>

      {p.skipOpen && <SkipReasons onPick={p.onSkip} onCancel={p.onSkipCancel} />}

      <AnimatePresence initial={false}>
        {p.expanded && (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0, transition: { duration: 0.15 } }}
            transition={spring.smooth}
            className="overflow-hidden"
          >
            <div className="border-t border-border px-4 pb-4 pt-5 md:px-5">
              <MoveBody
                move={move}
                ws={p.ws}
                now={p.now}
                today={p.today}
                weekStart={p.weekStart}
                focused={p.focused}
                onComplete={p.onDone}
                onSnooze={p.onSnoozeUntil}
                onChanged={p.onChanged}
                repliesHandle={repliesHandle}
              />
              <div className="mt-4 flex flex-wrap items-center gap-1 border-t border-border pt-2.5">
                {!ownEnd && (
                  <Button size="sm" variant="ghost" kbd={p.focused && !hasDraft ? "A" : undefined} onClick={p.onMarkDone}>
                    Done
                  </Button>
                )}
                <Button size="sm" variant="ghost" kbd={p.focused ? "X" : undefined} onClick={p.onSkipOpen}>
                  Skip
                </Button>
                <Button size="sm" variant="ghost" kbd={p.focused ? "S" : undefined} onClick={p.onSnooze}>
                  Tomorrow
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
