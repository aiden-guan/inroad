"use client";

import { AnimatePresence, motion } from "motion/react";
import { Download, Plus, Sparkles, Star, StarOff, X } from "lucide-react";
import type { MouseEvent } from "react";
import { Button, IconButton } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Menu, MenuItem, MenuLabel, MenuSeparator } from "@/components/ui/menu";
import type { ResearchColumn } from "@/lib/columns/types";
import { shortQuestion } from "@/lib/columns/values";

/**
 * The floating bar for a multi-selection (bottom center): track or untrack, disqualify with a reason, ask a
 * research column of just these companies, export them as CSV. Esc clears; ⌘A selects every visible row.
 */
export function BulkBar({
  count,
  tracked,
  untracked,
  columns,
  missing,
  onTrack,
  onUntrack,
  onDismiss,
  onAsk,
  onNewColumn,
  onExport,
  onClear,
}: {
  count: number;
  /** Selected companies tracked now (Untrack applies to them). */
  tracked: number;
  /** Selected companies not tracked yet (Track applies to them). */
  untracked: number;
  columns: ResearchColumn[];
  /** Per column: how many selected companies have no answer yet. */
  missing: Record<string, number>;
  onTrack: () => void;
  onUntrack: () => void;
  onDismiss: (el: Element) => void;
  onAsk: (column: ResearchColumn, onlyMissing: boolean) => void;
  onNewColumn: (el: Element) => void;
  onExport: () => void;
  onClear: () => void;
}) {
  return (
    <AnimatePresence>
      {count > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0, transition: { duration: 0.18, ease: [0.23, 1, 0.32, 1] } }}
          exit={{ opacity: 0, y: 4, transition: { duration: 0.12 } }}
          className="pointer-events-none fixed inset-x-0 bottom-5 z-40 flex justify-center px-4"
        >
          <div role="toolbar" data-bulk-bar-anchor aria-label={`${count} selected`} className="pointer-events-auto flex max-w-full items-center gap-1 overflow-x-auto rounded-lg bg-surface-raised p-1.5 pl-3 shadow-lg ring-1 ring-border scrollbar-none">
            <span className="mr-1 shrink-0 font-mono text-[12px] tnum text-fg-2">{count} selected</span>
            {untracked > 0 && (
              <Button size="sm" variant="primary" icon={<Star className="size-3.5" />} onClick={onTrack}>
                Track<span className="hidden sm:inline"> {untracked}</span>
              </Button>
            )}
            {tracked > 0 && (
              <Button size="sm" variant="ghost" icon={<StarOff className="size-3.5" />} onClick={onUntrack}>
                Untrack<span className="hidden sm:inline"> {tracked}</span>
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={(e: MouseEvent<HTMLButtonElement>) => onDismiss(e.currentTarget)}>
              Disqualify…
            </Button>
            <Menu
              align="center"
              trigger={
                <Button size="sm" variant="ghost" icon={<Sparkles className="size-3.5 text-accent-text" />}>
                  Ask…
                </Button>
              }
            >
              {columns.length > 0 && <MenuLabel>Ask these {count === 1 ? "one" : count}</MenuLabel>}
              {columns.map((c) => {
                const m = missing[c.id] ?? 0;
                return (
                  <MenuItem key={c.id} icon={<Sparkles className="size-3.5" />} hint={m ? `${m} new` : "again"} onSelect={() => onAsk(c, m > 0)}>
                    <span className="block max-w-56 truncate">{shortQuestion(c.question, 44)}</span>
                  </MenuItem>
                );
              })}
              {columns.length > 0 && <MenuSeparator />}
              <MenuItem icon={<Plus className="size-3.5" />} onSelect={() => onNewColumn(document.querySelector("[data-bulk-bar-anchor]") ?? document.body)}>
                New question for these…
              </MenuItem>
            </Menu>
            <Button size="sm" variant="ghost" icon={<Download className="size-3.5" />} onClick={onExport}>
              <span className="hidden sm:inline">Export </span>CSV
            </Button>
            <span className="hidden items-center gap-1 px-1 text-[12px] text-fg-3 md:pointer-fine:flex">
              <Kbd>Esc</Kbd>
            </span>
            <IconButton label="Clear selection (Esc)" onClick={onClear}>
              <X className="size-3.5" />
            </IconButton>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
