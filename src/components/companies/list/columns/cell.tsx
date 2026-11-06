"use client";

import * as RP from "@radix-ui/react-popover";
import { ExternalLink, RotateCw } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Favicon } from "@/components/ui/favicon";
import { cn } from "@/lib/client/cn";
import { age, hostOf, relativeTime } from "@/lib/client/format";
import type { CellSource, ColumnCell, ResearchColumn } from "@/lib/columns/types";
import { cellLabel, cellState, costLabel } from "@/lib/columns/values";

/** One research answer in the table: the value, its source, and a popover with the quotes behind it. */

export type CellRun = "running" | "queued" | null;

const KIND_LABEL: Record<CellSource["kind"], string> = {
  site: "Their site",
  job_board: "Their job board",
  dns: "Their DNS records",
  evidence: "On file",
  signal: "On file",
  page: "News",
  search: "Search result",
};

export function ResearchCell({
  column,
  cell,
  run,
  company,
  onAsk,
  className,
}: {
  column: ResearchColumn;
  cell: ColumnCell | undefined;
  run: CellRun;
  company: string;
  onAsk: (force: boolean) => void;
  className?: string;
}) {
  const state = cellState(cell);
  if (run && (state === "empty" || state === "failed" || run === "running")) {
    return (
      <span className={cn("relative z-[1] flex h-6 items-center gap-1.5", className)} aria-label={run === "running" ? `Researching ${company}` : `Waiting to research ${company}`}>
        {run === "running" ? (
          <>
            <span aria-hidden className="size-1.5 shrink-0 animate-pulse rounded-full bg-accent" />
            <span aria-hidden className="skeleton h-2 w-14 rounded-xs" />
          </>
        ) : (
          <span aria-hidden className="h-2 w-10 rounded-xs bg-fg/[0.06]" />
        )}
      </span>
    );
  }
  if (state === "empty") {
    return (
      <span className={cn("group/cell relative z-[1] flex h-6 items-center", className)}>
        <span className="font-mono text-[12px] text-fg-4 transition-opacity group-hover/cell:opacity-0 group-focus-within/cell:opacity-0">–</span>
        <button
          data-cell
          onClick={() => onAsk(false)}
          className="absolute inset-y-0 left-0 flex items-center rounded-xs px-1 text-[12px] font-medium text-accent-text opacity-0 transition-opacity focus-visible:opacity-100 group-hover/cell:opacity-100"
        >
          Ask
        </button>
      </span>
    );
  }
  return (
    <AnswerPopover column={column} cell={cell!} company={company} onAsk={onAsk}>
      <button
        data-cell
        className={cn(
          "relative z-[1] -mx-1 flex h-6 min-w-0 max-w-full items-center gap-1.5 rounded-xs px-1 text-left text-[12.5px] outline-none transition-colors hover:bg-bg-subtle focus-visible:ring-2 focus-visible:ring-[var(--ring)] data-[state=open]:bg-bg-subtle",
          className,
        )}
      >
        <CellValue cell={cell!} />
      </button>
    </AnswerPopover>
  );
}

/** The value as the table shows it: color carries confidence, a favicon carries the source. */
export function CellValue({ cell }: { cell: ColumnCell }) {
  const state = cellState(cell);
  const source = cell.sources[0];
  return (
    <>
      <span
        className={cn(
          "min-w-0 truncate",
          state === "failed" ? "text-warning" : state === "unknown" ? "text-fg-3" : cell.confidence === "low" ? "text-fg-2 underline decoration-dotted decoration-fg-4 underline-offset-[3px]" : cell.confidence === "medium" ? "text-fg-2" : "font-medium text-fg",
        )}
      >
        {cellLabel(cell)}
      </span>
      {source && state === "answered" && <Favicon domain={hostOf(source.url)} size={12} className="ring-0 opacity-80" />}
    </>
  );
}

/** Opens on hover (after a short pause) and on click; a click keeps it open until you leave. */
export function AnswerPopover({ column, cell, company, onAsk, children }: { column: ResearchColumn; cell: ColumnCell; company: string; onAsk: (force: boolean) => void; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const pinned = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const later = (fn: () => void, ms: number) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(fn, ms);
  };
  const enter = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    later(() => setOpen(true), 380);
  };
  const leave = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse" || pinned.current) return;
    later(() => setOpen(false), 160);
  };
  return (
    <RP.Root
      open={open}
      onOpenChange={(o) => {
        clearTimeout(timer.current);
        if (!o) pinned.current = false;
        setOpen(o);
      }}
    >
      <RP.Trigger
        asChild
        onPointerEnter={enter}
        onPointerLeave={leave}
        onClick={(e) => {
          e.preventDefault();
          clearTimeout(timer.current);
          pinned.current = !(open && pinned.current);
          setOpen(pinned.current || !open);
        }}
      >
        {children}
      </RP.Trigger>
      <RP.Portal>
        <RP.Content
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={12}
          onPointerEnter={() => clearTimeout(timer.current)}
          onPointerLeave={leave}
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="z-[75] w-[min(360px,calc(100vw-24px))] origin-[var(--radix-popover-content-transform-origin)] rounded-lg bg-surface-raised p-3.5 shadow-lg ring-1 ring-border outline-none data-[state=closed]:animate-[pop-out_100ms_var(--ease-out)] data-[state=open]:animate-[pop-in_160ms_var(--ease-out)]"
        >
          <AnswerDetail
            column={column}
            cell={cell}
            company={company}
            onAsk={(force) => {
              setOpen(false);
              onAsk(force);
            }}
          />
        </RP.Content>
      </RP.Portal>
    </RP.Root>
  );
}

/** The answer, how sure, what it rests on, every source with its quote and date, and what it cost. */
export function AnswerDetail({ column, cell, company, onAsk }: { column: ResearchColumn; cell: ColumnCell; company: string; onAsk?: (force: boolean) => void }) {
  const state = cellState(cell);
  const codeRead = (s: CellSource) => cell.method === "workspace" || s.kind === "job_board" || s.kind === "dns";
  const how =
    cell.method === "workspace"
      ? "Read in code, no AI"
      : cell.method === "reused"
        ? "Reused from the same question"
        : [cell.pagesRead ? `${cell.pagesRead} ${cell.pagesRead === 1 ? "page" : "pages"}` : null, cell.searches ? `${cell.searches} ${cell.searches === 1 ? "search" : "searches"}` : null]
            .filter(Boolean)
            .join(" · ") || "From what was on file";
  const cost = cell.unpriced ? "cost unknown" : costLabel(cell.costUsd ?? 0);
  return (
    <div className="text-left">
      <p className="line-clamp-2 text-[12px] leading-[16px] text-fg-3">
        {company} · {column.question}
      </p>
      <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className={cn("font-serif text-[22px] leading-[28px] tracking-[-0.01em]", state === "answered" ? "text-fg" : state === "failed" ? "text-warning" : "text-fg-2")}>
          {state === "failed" ? "Didn't finish" : cellLabel(cell)}
        </span>
        {state === "answered" && cell.confidence && (
          <Badge tone={cell.confidence === "high" ? "success" : cell.confidence === "medium" ? "neutral" : "warning"}>{cell.confidence} confidence</Badge>
        )}
      </div>
      {(cell.error || cell.note) && <p className="mt-1.5 text-[12.5px] leading-[18px] text-fg-2">{cell.error ?? cell.note}</p>}
      {state === "unknown" && (
        <p className="mt-1 text-[12px] leading-[17px] text-fg-3">
          I don&rsquo;t guess. {cell.pagesRead ? `Checked ${cell.pagesRead} ${cell.pagesRead === 1 ? "page" : "pages"}` : "Checked what was on file"}
          {cell.searches ? ` and ${cell.searches === 1 ? "one search" : `${cell.searches} searches`}` : ""}.
        </p>
      )}

      {cell.sources.length > 0 && (
        <ul className="mt-3 space-y-3 border-t border-border pt-3">
          {cell.sources.map((s, i) => {
            const host = hostOf(s.url);
            return (
              <li key={`${s.url}-${i}`} className="min-w-0">
                <a href={s.url} target="_blank" rel="noreferrer" className="group flex min-w-0 items-center gap-1.5 text-[12px] text-fg-3 hover:text-fg-2">
                  <Favicon domain={host} size={13} className="ring-0" />
                  <span className="min-w-0 truncate font-mono text-fg-2 group-hover:underline">{host}</span>
                  <span className="shrink-0">· {KIND_LABEL[s.kind]}</span>
                  {s.date && <span className="shrink-0 font-mono">· {age(s.date)}</span>}
                  <ExternalLink className="size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
                </a>
                {codeRead(s) ? (
                  <p className="mt-1 break-words rounded-xs bg-bg-subtle px-2 py-1 font-mono text-[12px] leading-[16px] text-fg-2">{s.quote}</p>
                ) : (
                  <blockquote className="mt-1 break-words border-l-2 border-accent/50 pl-2.5 font-serif text-[13.5px] leading-[20px] text-fg-2">“{s.quote}”</blockquote>
                )}
                {!s.checked && <p className="mt-1 text-[12px] text-fg-3">From a search result. I couldn&rsquo;t check the quote against the page, so this counts as low confidence.</p>}
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-2.5">
        <span className="min-w-0 truncate font-mono text-[12px] text-fg-3" title={new Date(cell.at).toLocaleString()}>
          {how} · {cost} · {relativeTime(cell.at)}
        </span>
        {onAsk && (
          <Button size="xs" variant="ghost" icon={<RotateCw className="size-3" />} onClick={() => onAsk(true)}>
            Ask again
          </Button>
        )}
      </div>
    </div>
  );
}
