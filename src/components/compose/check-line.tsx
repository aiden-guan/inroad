"use client";

import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/client/cn";
import type { LintResult } from "@/lib/domain/types";
import type { Blocker } from "@/lib/quality/gates";
import { worstIssue } from "@/lib/quality/lint";

export interface Count {
  value: number;
  max: number;
  hard: number;
  unit: "words" | "characters";
}

/**
 * "Ready", or the single worst issue. Color changes only at thresholds (150ms, color only).
 * Blockers read in danger (you can't send), lint failures in warning (fix by editing).
 * The critic's verdict is never shown here.
 */
export function CheckLine({
  lint,
  blocker,
  count,
  open,
  onToggle,
  sent,
}: {
  lint: LintResult;
  blocker?: Blocker;
  count?: Count | null;
  open: boolean;
  onToggle: () => void;
  sent?: boolean;
}) {
  const worst = worstIssue(lint);
  const tone = sent ? "sent" : blocker ? "blocked" : worst ? "issue" : "ready";
  const text = tone === "sent" ? "Sent" : tone === "blocked" ? blocker!.text : tone === "issue" ? worst!.detail : "Ready";
  const extra = lint.violations.length + (blocker ? 1 : 0) - (tone === "issue" || tone === "blocked" ? 1 : 0);
  const countTone = !count ? "" : count.value > count.hard ? "text-danger" : count.value > count.max ? "text-warning" : "text-fg-3";
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="group flex min-h-7 w-full items-center gap-2 rounded-xs text-left text-[12.5px] leading-5 outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
    >
      <span
        aria-hidden
        className={cn(
          "size-1.5 shrink-0 rounded-full transition-colors duration-150",
          tone === "ready" ? "bg-success" : tone === "blocked" ? "bg-danger" : tone === "issue" ? "bg-warning" : "bg-fg-4",
        )}
      />
      <span
        className={cn(
          "min-w-0 flex-1 truncate transition-colors duration-150",
          tone === "ready" ? "text-fg-2" : tone === "blocked" ? "text-danger" : tone === "issue" ? "text-warning" : "text-fg-3",
        )}
      >
        {text}
        {extra > 0 && <span className="ml-1.5 text-fg-3">+{extra}</span>}
      </span>
      {count && (
        <span className={cn("shrink-0 font-mono text-[11.5px] tnum transition-colors duration-150", countTone)}>
          {count.value}
          {count.unit === "characters" ? `/${count.max}` : ""} {count.unit === "words" ? (count.value === 1 ? "word" : "words") : "chars"}
        </span>
      )}
      <ChevronDown className={cn("size-3.5 shrink-0 text-fg-4 transition-transform duration-200 group-hover:text-fg-3", open && "rotate-180")} />
    </button>
  );
}

export function CheckDetails({ lint, blockers, warnings }: { lint: LintResult; blockers: Blocker[]; warnings: string[] }) {
  const s = lint.stats;
  const rows: { tone: "danger" | "warning" | "muted"; text: string }[] = [
    ...blockers.map((b) => ({ tone: "danger" as const, text: b.text })),
    ...lint.violations.map((v) => ({ tone: v.severity === "error" ? ("warning" as const) : ("muted" as const), text: v.detail })),
    ...warnings.map((w) => ({ tone: "muted" as const, text: w })),
  ];
  return (
    <div className="mt-1.5 rounded-md bg-bg-subtle px-3 py-2.5 ring-1 ring-border animate-[fade-in_150ms_var(--ease-out)]">
      {rows.length ? (
        <ul className="space-y-1.5">
          {rows.map((r, i) => (
            <li key={i} className="flex gap-2 text-[12.5px] leading-[18px]">
              <span aria-hidden className={cn("mt-[6px] size-1.5 shrink-0 rounded-full", r.tone === "danger" ? "bg-danger" : r.tone === "warning" ? "bg-warning" : "bg-fg-4")} />
              <span className={r.tone === "muted" ? "text-fg-3" : "text-fg"}>{r.text}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[12.5px] text-fg-2">Passes every check: length, one question, sources for every specific, no template phrases.</p>
      )}
      <p className="mt-2 font-mono text-[11px] tnum text-fg-3">
        grade {Math.round(s.fkGrade)} · you {s.you} / I-we {s.iWe} · {s.questionMarks} {s.questionMarks === 1 ? "question" : "questions"} · {s.links}{" "}
        {s.links === 1 ? "link" : "links"}
      </p>
    </div>
  );
}
