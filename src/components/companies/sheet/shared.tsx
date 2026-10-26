"use client";

import { AlertTriangle, Info } from "lucide-react";
import { useCallback, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { SectionLabel } from "@/components/ui/card";
import { MarginNote, SourceChip } from "@/components/ui/source";
import { cn } from "@/lib/client/cn";
import { nowISO, todayISO } from "@/lib/domain/ids";
import type { Evidence, PersonaRole } from "@/lib/domain/types";

/* ─────────────────────────────── Time (render-safe) ─────────────────────────────── */

function subscribeMinute(cb: () => void) {
  const t = setInterval(cb, 30_000);
  return () => clearInterval(t);
}
const minuteNow = () => Math.floor(Date.now() / 60_000) * 60_000;

/** Wall-clock time, quantized to the minute so renders stay pure and stable. */
export function useNow(): number {
  return useSyncExternalStore(subscribeMinute, minuteNow, minuteNow);
}

/** Today's local date (`YYYY-MM-DD`), updating across midnight. */
export function useToday(): string {
  return useSyncExternalStore(subscribeMinute, todayISO, todayISO);
}

/* ─────────────────────────────── Evidence ─────────────────────────────── */

/** Resolves evidence ids to the records still trusted (flagged-wrong evidence disappears everywhere). */
export function useEvidence() {
  const { ws } = useWorkspace();
  return useCallback(
    (ids: (string | undefined)[] | undefined): Evidence[] => {
      if (!ws || !ids) return [];
      const seen = new Set<string>();
      const out: Evidence[] = [];
      for (const id of ids) {
        const e = id ? ws.evidence[id] : undefined;
        if (e && !e.flaggedWrong && !seen.has(e.id)) {
          seen.add(e.id);
          out.push(e);
        }
      }
      return out;
    },
    [ws],
  );
}

export function useFlagWrong() {
  const { dispatch } = useWorkspace();
  return useCallback(
    (id: string) => {
      void dispatch({ type: "evidence.flagWrong", id, at: nowISO() }).then((ok) => ok && toast("Marked wrong. I won't use that source again."));
    },
    [dispatch],
  );
}

/** True when any of these ids was flagged wrong (dependent text needs a rewrite). */
export function useHasFlagged() {
  const { ws } = useWorkspace();
  return useCallback((ids: string[] | undefined) => !!ws && !!ids?.some((id) => ws.evidence[id]?.flaggedWrong), [ws]);
}

/**
 * A sentence with its receipts. At ≥1280px the sources sit in a right margin beside the
 * sentence; below that they follow it as chips.
 */
export function Cited({ evidence, children, className, chips = "inline" }: { evidence: Evidence[]; children: ReactNode; className?: string; chips?: "inline" | "below" }) {
  const flag = useFlagWrong();
  return (
    <div className={cn("xl:grid xl:grid-cols-[minmax(0,1fr)_196px] xl:gap-x-6", className)}>
      <div className="min-w-0">
        {children}
        {evidence.length > 0 && (
          <span className={cn("xl:hidden", chips === "below" ? "mt-1.5 flex flex-wrap gap-1" : "ml-1 inline-flex flex-wrap gap-1 align-middle")}>
            {evidence.slice(0, 3).map((e) => (
              <SourceChip key={e.id} url={e.url} publishedAt={e.publishedAt} quote={e.quote} claim={e.claim} confidence={e.confidence} onFlagWrong={() => flag(e.id)} />
            ))}
          </span>
        )}
      </div>
      {evidence.length > 0 && (
        <div className="hidden space-y-2 pt-1 xl:block">
          {evidence.slice(0, 2).map((e) => (
            <div key={e.id} className="group relative animate-[fade-in_150ms_var(--ease-out)]">
              <MarginNote url={e.url} publishedAt={e.publishedAt} quote={e.quote} />
              <button
                onClick={() => flag(e.id)}
                className="mt-0.5 pl-2.5 text-[11px] text-fg-3 opacity-0 transition-opacity duration-150 hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
              >
                Wrong?
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────── Layout bits ─────────────────────────────── */

export function Section({ label, right, children, className, id }: { label: ReactNode; right?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={cn("scroll-mt-14", className)}>
      <SectionLabel right={right}>{label}</SectionLabel>
      {children}
    </section>
  );
}

export function Callout({ tone = "neutral", children, className, action }: { tone?: "neutral" | "warning" | "danger"; children: ReactNode; className?: string; action?: ReactNode }) {
  const Icon = tone === "neutral" ? Info : AlertTriangle;
  return (
    <div
      role={tone === "danger" ? "alert" : undefined}
      className={cn(
        "flex items-start gap-2.5 rounded-md px-3 py-2.5 text-[13px] leading-5",
        className,
        tone === "danger" && "bg-danger-subtle text-danger",
        tone === "warning" && "bg-warning-subtle text-warning",
        tone === "neutral" && "bg-bg-subtle text-fg-2",
      )}
    >
      <Icon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">{children}</div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/** Filled dots for signal (0–3) and angle (1–5) strength. Ink, never the agent's blue. */
export function StrengthDots({ value, max, label }: { value: number; max: number; label: string }) {
  return (
    <span className="inline-flex items-center gap-[3px]" role="img" aria-label={`${label}: ${value} of ${max}`} title={`${label} ${value}/${max}`}>
      {Array.from({ length: max }, (_, i) => (
        <span key={i} className={cn("size-[5px] rounded-full", i < value ? "bg-fg-2" : "bg-border-strong")} />
      ))}
    </span>
  );
}

export const ROLE_LABEL: Record<PersonaRole, string> = {
  economic_buyer: "Economic buyer",
  champion: "Champion",
  technical_approver: "Technical approver",
  user: "User",
  blocker: "Blocker",
  early_adopter: "Early adopter",
  payer: "Payer",
  influencer: "Influencer",
};

/** Text that will go out under the founder's name: Inter, a 1px blue-pencil rule, labeled Draft. */
export function DraftBlock({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("draft-rule rounded-r-md bg-surface py-2.5 pl-3.5 pr-3", className)}>
      <span className="mb-1 block font-mono text-[10.5px] uppercase tracking-wide text-fg-3">Draft</span>
      {children}
    </div>
  );
}

/* ─────────────────────────────── Inputs ─────────────────────────────── */

/**
 * An input that commits on blur or Enter (one write per edit, not per keystroke). Remounts when
 * the stored value changes elsewhere, so it never shows stale text.
 */
export function CommitInput({
  value,
  onCommit,
  className,
  placeholder,
  type = "text",
  ariaLabel,
  multiline,
}: {
  value: string;
  onCommit: (next: string) => void;
  className?: string;
  placeholder?: string;
  type?: "text" | "date" | "number" | "datetime-local";
  ariaLabel: string;
  multiline?: boolean;
}) {
  const commit = (next: string) => {
    if (next !== value) onCommit(next);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (!multiline || e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      (e.currentTarget as HTMLElement).blur();
    }
    if (e.key === "Escape") {
      e.stopPropagation();
      e.currentTarget.value = value;
      (e.currentTarget as HTMLElement).blur();
    }
  };
  const base =
    "w-full rounded-sm bg-transparent px-1.5 text-[13px] text-fg ring-1 ring-transparent placeholder:text-fg-3 transition-[box-shadow,background-color] duration-150 hover:ring-border focus-visible:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]";
  return multiline ? (
    <textarea key={value} defaultValue={value} aria-label={ariaLabel} placeholder={placeholder} onBlur={(e) => commit(e.target.value)} onKeyDown={onKey} className={cn(base, "min-h-16 resize-none py-1.5 leading-5", className)} />
  ) : (
    <input key={value} type={type} defaultValue={value} aria-label={ariaLabel} placeholder={placeholder} onBlur={(e) => commit(e.target.value)} onKeyDown={onKey} className={cn(base, "h-7", className)} />
  );
}

/**
 * Hold-to-confirm for destructive actions (900ms). Pointer or keyboard (hold Enter/Space).
 * The fill is a transform, so it stays on the compositor.
 */
export function HoldButton({ onConfirm, children, className, disabled }: { onConfirm: () => void; children: ReactNode; className?: string; disabled?: boolean }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [holding, setHolding] = useState(false);
  const start = () => {
    if (disabled || timer.current) return;
    setHolding(true);
    timer.current = setTimeout(() => {
      timer.current = null;
      setHolding(false);
      onConfirm();
    }, 900);
  };
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setHolding(false);
  };
  return (
    <button
      type="button"
      disabled={disabled}
      onPointerDown={start}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && !e.repeat) {
          e.preventDefault();
          start();
        }
      }}
      onKeyUp={(e) => (e.key === "Enter" || e.key === " ") && cancel()}
      onBlur={cancel}
      className={cn(
        "relative inline-flex h-7 select-none items-center justify-center overflow-hidden rounded-sm px-2.5 text-[13px] font-medium text-danger ring-1 ring-danger/30 transition-[background-color,transform] duration-150 hover:bg-danger-subtle active:scale-[0.97] disabled:opacity-50",
        className,
      )}
    >
      <span
        aria-hidden
        className="absolute inset-0 origin-left bg-danger/15"
        style={{ transform: `scaleX(${holding ? 1 : 0})`, transition: holding ? "transform 900ms linear" : "transform 150ms var(--ease-out)" }}
      />
      <span className="relative">{holding ? "Keep holding…" : children}</span>
    </button>
  );
}

/* ─────────────────────────────── Handoff ─────────────────────────────── */

/** Gmail compose deeplink, or null when the URL would be too long (then offer Copy). */
export function gmailHref({ to, subject, body, authUser }: { to?: string; subject: string; body: string; authUser?: string }): string | null {
  const url = `https://mail.google.com/mail/u/${encodeURIComponent(authUser || "0")}/?tf=cm&to=${encodeURIComponent(to ?? "")}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  return url.length <= 2000 ? url : null;
}

export function useStableRef<T extends { kind: string; id: string }>(kind: T["kind"], id: string) {
  return useMemo(() => ({ kind, id }) as T, [kind, id]);
}
