"use client";

import {
  CalendarClock,
  CalendarHeart,
  CalendarX,
  ClipboardList,
  FileUp,
  Forward,
  Handshake,
  Inbox,
  ListChecks,
  MessageCircleQuestion,
  NotebookPen,
  PenLine,
  Radio,
  Reply,
  Search,
  Settings2,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { useActiveRuns, useRunFor, useRuns } from "@/components/providers/runs-provider";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { WorkLog } from "@/components/ui/work-log";
import { cn } from "@/lib/client/cn";
import type { EntityRef, MoveKind, SkipReason, WorkflowId } from "@/lib/domain/types";

const ICONS: Record<MoveKind, LucideIcon> = {
  reply: Reply,
  check_replies: Inbox,
  meeting_prep: CalendarClock,
  debrief: NotebookPen,
  follow_up: Forward,
  first_touch: PenLine,
  linkedin: UserPlus,
  intro_ask: Handshake,
  next_step_missing: CalendarX,
  close_out: ListChecks,
  signal: Radio,
  event_task: CalendarHeart,
  question: MessageCircleQuestion,
  review: ClipboardList,
  post: PenLine,
  setup: Settings2,
  import: FileUp,
  research: Search,
};

export const KIND_LABELS: Record<MoveKind, string> = {
  reply: "Replies",
  check_replies: "Check replies",
  meeting_prep: "Meetings",
  debrief: "Debriefs",
  follow_up: "Follow-ups",
  first_touch: "First touches",
  linkedin: "LinkedIn",
  intro_ask: "Intros",
  next_step_missing: "Deals",
  close_out: "Close-out",
  signal: "Signals",
  event_task: "Events",
  question: "Questions",
  review: "Reviews",
  post: "Posts",
  setup: "Setup",
  import: "Imports",
  research: "Research",
};

export function KindIcon({ kind, className }: { kind: MoveKind; className?: string }) {
  const Icon = ICONS[kind] ?? PenLine;
  return <Icon aria-hidden className={cn("size-4 shrink-0 text-fg-3", className)} strokeWidth={1.75} />;
}

export const SKIP_REASONS: { id: SkipReason; label: string; noted: string }[] = [
  { id: "not_relevant_now", label: "Not relevant now", noted: "not relevant now" },
  { id: "wrong_person", label: "Wrong person", noted: "wrong person" },
  { id: "weak_angle", label: "Weak angle", noted: "weak angle" },
  { id: "already_handled", label: "Already handled", noted: "already handled" },
  { id: "tone_off", label: "Tone off", noted: "tone off" },
  { id: "other", label: "Other", noted: "skipped" },
];

/** The reason picker appears instantly (no animation): it's keyboard-driven and used often. */
export function SkipReasons({ onPick, onCancel }: { onPick: (reason: SkipReason) => void; onCancel: () => void }) {
  return (
    <div role="group" aria-label="Why skip this?" className="flex flex-wrap items-center gap-1.5 border-t border-border px-4 py-3">
      <span className="mr-1 text-[12px] text-fg-3">Why skip?</span>
      {SKIP_REASONS.map((r, i) => (
        <button
          key={r.id}
          onClick={() => onPick(r.id)}
          className="inline-flex h-7 items-center gap-1.5 rounded-sm bg-surface px-2 text-[12.5px] text-fg ring-1 ring-border transition-[background-color,transform] duration-150 hover:bg-bg-subtle active:scale-[0.97]"
        >
          <Kbd className="h-4 min-w-4 text-[10px]">{i + 1}</Kbd>
          {r.label}
        </button>
      ))}
      <button onClick={onCancel} className="ml-auto h-7 rounded-sm px-2 text-[12.5px] text-fg-3 hover:text-fg">
        Cancel
      </button>
    </div>
  );
}

/**
 * Starts a workflow from inside a card and shows its live work log in place, then the receipt.
 * Errors stay inline (no toast): the founder is looking right at this card.
 */
export function RunInline({
  workflow,
  args,
  label,
  runRef,
  variant = "agent",
  icon,
  onResult,
  hint,
}: {
  workflow: WorkflowId;
  args: unknown;
  label: string;
  runRef?: EntityRef;
  variant?: "agent" | "primary" | "secondary";
  icon?: ReactNode;
  onResult?: (result: unknown) => void;
  hint?: ReactNode;
}) {
  const { start, runs } = useRuns();
  const [runId, setRunId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const byRef = useRunFor(runRef, workflow);
  const activeRuns = useActiveRuns();
  const mine = runId ? runs[runId] : undefined;
  // After a remount (card collapsed, page left) pick the live run back up, so the button can't start a duplicate.
  const live = runRef ? (byRef && (byRef.status === "running" || byRef.status === "queued") ? byRef : undefined) : activeRuns.find((r) => r.workflow === workflow);
  const run = mine ?? live;
  const active = run && (run.status === "running" || run.status === "queued");

  if (run && active) return <WorkLog run={run} />;
  return (
    <div className="flex flex-col items-start gap-2">
      {run?.status === "error" && <p className="text-[12.5px] text-danger">{run.error?.message ?? "That didn't work."} Try again, or check Settings if it keeps failing.</p>}
      {run?.status === "done" && <WorkLog run={run} />}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant={variant}
          icon={icon}
          loading={starting}
          onClick={async () => {
            setStarting(true);
            const r = await start(workflow, args, { notify: false, onResult });
            setStarting(false);
            if (r) setRunId(r.id);
          }}
        >
          {run?.status === "error" ? "Try again" : label}
        </Button>
        {hint && <span className="text-[12px] text-fg-3">{hint}</span>}
      </div>
    </div>
  );
}

/** Hold-to-confirm, reserved for destructive actions (close lost). Linear fill shows time passing. */
export function HoldButton({ onConfirm, children, ms = 900 }: { onConfirm: () => void; children: ReactNode; ms?: number }) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const begin = () => {
    if (timer.current) return;
    setHolding(true);
    timer.current = setTimeout(() => {
      timer.current = null;
      setHolding(false);
      onConfirm();
    }, ms);
  };
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setHolding(false);
  };
  return (
    <button
      onPointerDown={begin}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && !e.repeat) {
          e.preventDefault();
          begin();
        }
      }}
      onKeyUp={(e) => {
        if (e.key === "Enter" || e.key === " ") cancel();
      }}
      className="relative inline-flex h-8 select-none items-center overflow-hidden rounded-sm px-3 text-[13px] font-medium text-danger ring-1 ring-danger/30 transition-transform duration-100 active:scale-[0.97]"
    >
      <span
        aria-hidden
        className="absolute inset-0 origin-left bg-danger-subtle"
        style={{ transform: `scaleX(${holding ? 1 : 0})`, transition: holding ? `transform ${ms}ms linear` : "transform 200ms var(--ease-out)" }}
      />
      <span className="relative">{children}</span>
    </button>
  );
}

/** Quiet key legend for a card or a list. */
export function Keys({ items, className }: { items: [string, string][]; className?: string }) {
  return (
    <div className={cn("hidden flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-fg-3 md:flex", className)}>
      {items.map(([k, label]) => (
        <span key={k + label} className="inline-flex items-center gap-1.5">
          <Kbd>{k}</Kbd>
          {label}
        </span>
      ))}
    </div>
  );
}
