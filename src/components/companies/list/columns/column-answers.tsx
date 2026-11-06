"use client";

import { Sparkles } from "lucide-react";
import { useRuns } from "@/components/providers/runs-provider";
import { Button } from "@/components/ui/button";
import { SectionLabel } from "@/components/ui/card";
import { cn } from "@/lib/client/cn";
import { cellState } from "@/lib/columns/values";
import { AnswerPopover, CellValue } from "./cell";
import { useColumns, useColumnsPolling } from "./use-columns";

/**
 * The company's research-column answers, in its sheet: every question asked of the table, this company's
 * answer with its source on hover, and Ask for the ones not asked yet. Renders nothing until a column exists.
 */
export function ColumnAnswers({ domain, name, className }: { domain: string; name?: string; className?: string }) {
  const { data } = useColumns();
  const { runs, start } = useRuns();
  const active = Object.values(runs).some((r) => r.workflow === "research_column" && (r.status === "running" || r.status === "queued"));
  useColumnsPolling(active);
  if (!data?.columns.length) return null;
  const company = name ?? domain;
  const ask = (columnId: string, force: boolean) => void start("research_column", { columnId, domains: [domain], force }, { notify: false });

  return (
    <section className={cn("mt-10", className)} aria-label="Research columns">
      <SectionLabel right={<span className="font-mono text-[12px] text-fg-3">from the Companies table</span>}>Research columns</SectionLabel>
      <ul className="divide-y divide-border rounded-lg bg-surface ring-1 ring-border">
        {data.columns.map((c) => {
          const cell = data.cells[c.id]?.[domain];
          const running = data.jobs.some((j) => j.columnId === c.id && j.active.includes(domain));
          const queued = !running && !cell && data.jobs.some((j) => j.columnId === c.id && j.domains.includes(domain));
          const state = cellState(cell);
          return (
            <li key={c.id} className="flex min-h-12 items-center gap-3 px-4 py-2.5">
              <p className="min-w-0 flex-1 text-[13px] leading-[18px] text-fg-2">{c.question}</p>
              <div className="flex max-w-[45%] shrink-0 items-center justify-end">
                {running || queued ? (
                  <span className="flex items-center gap-1.5 text-[12px] text-fg-3">
                    <span aria-hidden className={cn("size-1.5 rounded-full bg-accent", running && "animate-pulse")} />
                    {running ? "Researching" : "Waiting"}
                  </span>
                ) : state === "empty" ? (
                  <Button size="xs" variant="ghost" icon={<Sparkles className="size-3 text-accent-text" />} onClick={() => ask(c.id, false)}>
                    Ask
                  </Button>
                ) : (
                  <AnswerPopover column={c} cell={cell!} company={company} onAsk={(force) => ask(c.id, force)}>
                    <button className="flex h-7 min-w-0 max-w-full items-center gap-1.5 rounded-sm px-1.5 text-[13px] outline-none transition-colors hover:bg-bg-subtle focus-visible:ring-2 focus-visible:ring-[var(--ring)] data-[state=open]:bg-bg-subtle">
                      <CellValue cell={cell!} />
                    </button>
                  </AnswerPopover>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
