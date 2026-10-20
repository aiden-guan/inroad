"use client";

import { Check } from "lucide-react";
import Link from "next/link";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Badge } from "@/components/ui/badge";
import { SectionLabel } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/misc";
import { cn } from "@/lib/client/cn";
import { shortDate } from "@/lib/client/format";
import { addDays, todayISO } from "@/lib/domain/ids";
import type { GtmEvent } from "@/lib/domain/types";
import type { TimelineTask } from "./plan-math";

const OWNER: Record<TimelineTask["owner"], string> = { founder: "You", ember: "Inroad", cohost: "Co-host" };

function TaskRow({ ev, task, index }: { ev: GtmEvent; task: TimelineTask; index: number }) {
  const { dispatch } = useWorkspace();
  const today = todayISO();
  const overdue = !task.done && task.due < today;
  return (
    <li className="flex min-h-11 items-start gap-3 rounded-md px-2 py-2 transition-colors hover:bg-surface/70">
      <button
        role="checkbox"
        aria-checked={Boolean(task.done)}
        aria-label={task.task}
        onClick={() => void dispatch({ type: "event.toggleTask", id: ev.id, index })}
        className={cn(
          "mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-[5px] ring-1 transition-[background-color,box-shadow,transform] duration-150 active:scale-[0.9]",
          task.done ? "bg-primary text-primary-fg ring-primary" : "bg-surface ring-border-strong hover:ring-fg-3",
        )}
      >
        <Check className={cn("size-3 transition-[opacity,transform] duration-150", task.done ? "scale-100 opacity-100" : "scale-75 opacity-0")} strokeWidth={3} />
      </button>
      <div className="min-w-0 flex-1">
        <p className={cn("text-[13.5px] leading-5", task.done ? "text-fg-3 line-through decoration-fg-4" : "text-fg")}>{task.task}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11.5px] text-fg-3">
          <span className="font-mono">{task.offset}</span>
          {task.owner !== "founder" && <Badge tone={task.owner === "ember" ? "agent" : "outline"}>{OWNER[task.owner]}</Badge>}
        </p>
      </div>
      <span className={cn("shrink-0 pt-0.5 font-mono text-[12px] tnum", overdue ? "text-danger" : task.due === today && !task.done ? "text-fg" : "text-fg-3")}>
        {overdue ? `${shortDate(task.due)} · late` : task.due === today ? "Today" : shortDate(task.due)}
      </span>
    </li>
  );
}

export function TimelineTab({ ev }: { ev: GtmEvent }) {
  const timeline = ev.plan?.timeline ?? [];
  if (!timeline.length) return <EmptyState title="No tasks yet" body="Set a date on the Plan tab and every task gets one." />;

  const today = todayISO();
  const weekEnd = addDays(today, 7);
  const indexed = timeline.map((task, index) => ({ task, index }));
  const groups = [
    { key: "late", label: "Overdue", items: indexed.filter(({ task }) => !task.done && task.due < today) },
    { key: "week", label: "This week", items: indexed.filter(({ task }) => !task.done && task.due >= today && task.due <= weekEnd) },
    { key: "later", label: "Later", items: indexed.filter(({ task }) => !task.done && task.due > weekEnd) },
    { key: "done", label: "Done", items: indexed.filter(({ task }) => task.done) },
  ].filter((g) => g.items.length);
  const left = timeline.filter((t) => !t.done).length;

  return (
    <div className="max-w-[720px]">
      <p className="text-[13px] text-fg-2">
        {left ? `${left} of ${timeline.length} tasks left.` : "Every task is done."} Tasks due show up on{" "}
        <Link href="/today" className="text-fg-2 underline-offset-4 hover:text-fg hover:underline">
          Today
        </Link>
        . Moving the date on the Plan tab moves them all.
      </p>
      <div className="mt-6 space-y-6">
        {groups.map((g) => (
          <section key={g.key}>
            <SectionLabel>
              <span className={cn(g.key === "late" && "text-danger")}>
                {g.label} · {g.items.length}
              </span>
            </SectionLabel>
            <ul className="space-y-0.5">
              {g.items.map(({ task, index }) => (
                <TaskRow key={`${index}-${task.task}`} ev={ev} task={task} index={index} />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
