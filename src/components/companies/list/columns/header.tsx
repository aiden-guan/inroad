"use client";

import * as DM from "@radix-ui/react-dropdown-menu";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, EyeOff, Pencil, RotateCw, Sparkles, Square, Trash2 } from "lucide-react";
import { Spinner } from "@/components/ui/button";
import { cn } from "@/lib/client/cn";
import type { ColumnJob, ResearchColumn, ViewSort } from "@/lib/columns/types";
import { COLUMN_TYPE_LABEL } from "@/lib/columns/types";
import { costLabel, shortQuestion, sortChoices, type AnswerOption } from "@/lib/columns/values";

/**
 * A research column's header: the question (full text in the menu), live progress while a run fills it, and
 * one menu for everything you can do to the column: sort, filter by answer, fill or ask again, edit, move, hide, delete.
 */

const item =
  "flex min-h-8 cursor-default select-none items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] text-fg outline-none transition-colors duration-100 data-[highlighted]:bg-bg-subtle data-[disabled]:opacity-45";

export function ColumnHeader({
  column,
  sort,
  onSort,
  options,
  filter,
  onFilter,
  jobs,
  onStop,
  empty,
  visible,
  fillUsd,
  againUsd,
  onFill,
  onAskAll,
  onEdit,
  onMove,
  canMove,
  onHide,
  onDelete,
}: {
  column: ResearchColumn;
  sort: ViewSort;
  onSort: (dir: "asc" | "desc") => void;
  options: AnswerOption[];
  filter: string[];
  onFilter: (keys: string[]) => void;
  jobs: ColumnJob[];
  onStop: () => void;
  /** Visible companies with no answer yet. */
  empty: number;
  visible: number;
  /** What filling the empty ones would cost at this column's measured average, or null when unknown. */
  fillUsd: number | null;
  againUsd: number | null;
  onFill: () => void;
  onAskAll: () => void;
  onEdit: () => void;
  onMove: (by: -1 | 1) => void;
  canMove: { left: boolean; right: boolean };
  onHide: () => void;
  onDelete: () => void;
}) {
  const sorted = sort.key === `col:${column.id}`;
  const running = jobs.length > 0;
  const total = jobs.reduce((n, j) => n + j.domains.length, 0);
  const done = jobs.reduce((n, j) => n + j.done, 0);
  const filtered = filter.length > 0;
  const toggle = (key: string, on: boolean) => onFilter(on ? [...new Set([...filter, key])] : filter.filter((k) => k !== key));

  return (
    <DM.Root>
      <DM.Trigger asChild>
        <button
          title={column.question}
          className={cn(
            "group/h -mx-1 flex h-7 min-w-0 items-center gap-1 rounded-sm px-1 text-left text-[11px] font-medium outline-none transition-colors hover:bg-bg hover:text-fg-2 focus-visible:ring-2 focus-visible:ring-[var(--ring)] data-[state=open]:bg-bg data-[state=open]:text-fg-2",
            filtered || sorted ? "text-fg-2" : "text-fg-3",
          )}
        >
          <Sparkles className="size-3 shrink-0 text-accent-text/80" aria-hidden />
          <span className="min-w-0 flex-1 truncate">{shortQuestion(column.question, 40)}</span>
          {running ? (
            <span className="flex shrink-0 items-center gap-1 font-mono text-[10.5px] tnum text-fg-3">
              <Spinner className="size-2.5" />
              {done}/{total}
            </span>
          ) : sorted ? (
            sort.dir === "asc" ? <ArrowUp className="size-3 shrink-0" aria-label="Sorted ascending" /> : <ArrowDown className="size-3 shrink-0" aria-label="Sorted descending" />
          ) : null}
          {filtered && <span aria-label="Filtered" className="size-1.5 shrink-0 rounded-full bg-accent" />}
        </button>
      </DM.Trigger>
      <DM.Portal>
        <DM.Content
          align="start"
          sideOffset={6}
          collisionPadding={12}
          className="z-[70] max-h-[var(--radix-dropdown-menu-content-available-height)] w-72 origin-[var(--radix-dropdown-menu-content-transform-origin)] overflow-y-auto overscroll-contain rounded-xl bg-surface-raised p-1.5 shadow-lg ring-1 ring-inset ring-border data-[state=closed]:animate-[pop-out_100ms_var(--ease-out)] data-[state=open]:animate-[pop-in_160ms_var(--ease-out)]"
        >
          <div className="px-2.5 pb-2 pt-1.5">
            <p className="text-pretty text-[13px] font-medium leading-[18px] text-fg">{column.question}</p>
            <p className="mt-0.5 font-mono text-[11px] text-fg-3">
              {COLUMN_TYPE_LABEL[column.type]}
              {column.options?.length ? ` · ${column.options.join(", ")}` : ""}
            </p>
            {column.instructions && <p className="mt-1 line-clamp-3 text-[12px] leading-[17px] text-fg-2">{column.instructions}</p>}
          </div>

          {running && (
            <>
              <DM.Item onSelect={onStop} className={item}>
                <Square className="size-3.5 text-fg-3" />
                <span className="flex-1">Stop</span>
                <span className="font-mono text-[11.5px] tnum text-fg-3">
                  {done} of {total}
                </span>
              </DM.Item>
              <DM.Separator className="my-1 h-px bg-border" />
            </>
          )}

          <DM.Label className="px-2.5 pb-1 pt-1.5 text-[11px] font-medium text-fg-3">Sort</DM.Label>
          {sortChoices(column.type).map((c) => (
            <DM.Item key={c.dir} onSelect={() => onSort(c.dir)} className={item}>
              <span className="flex size-4 items-center justify-center text-fg-3">{sorted && sort.dir === c.dir ? <Check className="size-3.5" /> : null}</span>
              <span className="flex-1">{c.label}</span>
            </DM.Item>
          ))}

          <DM.Separator className="my-1 h-px bg-border" />
          <DM.Label className="flex items-center justify-between px-2.5 pb-1 pt-1.5 text-[11px] font-medium text-fg-3">
            <span>Show</span>
            {filtered && (
              <button onClick={() => onFilter([])} className="font-normal text-fg-3 hover:text-fg">
                Clear
              </button>
            )}
          </DM.Label>
          {options.map((o) => (
            <DM.CheckboxItem key={o.value} checked={filter.includes(o.value)} onSelect={(e) => e.preventDefault()} onCheckedChange={(on) => toggle(o.value, on === true)} className={item}>
              <span className={cn("flex size-4 items-center justify-center rounded-[4px] ring-1 ring-border-strong", filter.includes(o.value) && "bg-primary ring-primary")}>
                <DM.ItemIndicator>
                  <Check className="size-3 text-primary-fg" strokeWidth={3} />
                </DM.ItemIndicator>
              </span>
              <span className="min-w-0 flex-1 truncate">{o.label}</span>
              <span className="font-mono text-[11px] tnum text-fg-3">{o.count}</span>
            </DM.CheckboxItem>
          ))}

          <DM.Separator className="my-1 h-px bg-border" />
          <DM.Item onSelect={onFill} disabled={running || empty === 0} className={item}>
            <Sparkles className="size-3.5 text-fg-3" />
            <span className="flex-1">{empty ? `Ask ${empty} without an answer` : "Every visible company has an answer"}</span>
            {empty > 0 && fillUsd !== null && <span className="font-mono text-[11.5px] tnum text-fg-3">≈{costLabel(fillUsd)}</span>}
          </DM.Item>
          <DM.Item onSelect={onAskAll} disabled={running || visible === 0} className={item}>
            <RotateCw className="size-3.5 text-fg-3" />
            <span className="flex-1">Ask all {visible} again</span>
            {againUsd !== null && <span className="font-mono text-[11.5px] tnum text-fg-3">≈{costLabel(againUsd)}</span>}
          </DM.Item>
          <DM.Item onSelect={onEdit} className={item}>
            <Pencil className="size-3.5 text-fg-3" />
            <span className="flex-1">Edit question…</span>
          </DM.Item>

          <DM.Separator className="my-1 h-px bg-border" />
          <DM.Item onSelect={() => onMove(-1)} disabled={!canMove.left} className={item}>
            <ArrowLeft className="size-3.5 text-fg-3" />
            <span className="flex-1">Move left</span>
          </DM.Item>
          <DM.Item onSelect={() => onMove(1)} disabled={!canMove.right} className={item}>
            <ArrowRight className="size-3.5 text-fg-3" />
            <span className="flex-1">Move right</span>
          </DM.Item>
          <DM.Item onSelect={onHide} className={item}>
            <EyeOff className="size-3.5 text-fg-3" />
            <span className="flex-1">Hide in this view</span>
          </DM.Item>
          <DM.Item onSelect={onDelete} className={cn(item, "text-danger")}>
            <Trash2 className="size-3.5" />
            <span className="flex-1">Delete column</span>
          </DM.Item>
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}
