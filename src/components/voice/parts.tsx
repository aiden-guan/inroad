"use client";

import Link from "next/link";
import { cn } from "@/lib/client/cn";
import { shortDate } from "@/lib/client/format";
import { STAGE_LABELS } from "@/lib/domain/types";
import type { ThemeKind, VoiceSnippet, VoiceTrend } from "@/lib/voice/types";

/** Shared pieces of Buyer voice: a quote with its receipt, the source label and the six-month bars. */

export const KIND_LABELS: Record<ThemeKind, string> = { objection: "Objection", pain: "Pain", outcome: "Wanted outcome", process: "Buying process" };
export const KIND_PLURAL: Record<ThemeKind, string> = { objection: "Objections", pain: "Pains", outcome: "Outcomes", process: "Buying process" };

/** Where a quote's conversation lives: the call opened on its company sheet, or the company for a reply. */
export function snippetHref(s: VoiceSnippet): string | undefined {
  if (!s.domain) return undefined;
  const sheet = `/companies?c=${encodeURIComponent(s.domain)}`;
  return s.meetingId ? `${sheet}&intent=prep&ref=${encodeURIComponent(s.meetingId)}` : sheet;
}

const SOURCE: Record<VoiceSnippet["source"], { label: string; hint: string }> = {
  transcript: { label: "Transcript", hint: "Their words, checked against the call transcript." },
  email: { label: "Email", hint: "Their words, from the reply they sent." },
  notes: { label: "Your notes", hint: "Paraphrase from your call notes, not their exact words." },
  summary: { label: "Debrief summary", hint: "The debrief's one-line read of an objection, not their words." },
  talk: { label: "Your notes", hint: "Paraphrase from your notes on the conversation, not their exact words." },
};

export function SourceTag({ s, className }: { s: Pick<VoiceSnippet, "source" | "verbatim">; className?: string }) {
  const src = SOURCE[s.source];
  return (
    <span
      title={src.hint}
      className={cn(
        "inline-flex h-[18px] shrink-0 items-center rounded-[3px] px-1 font-mono text-[12px] font-medium tracking-wide ring-1 ring-inset",
        s.verbatim ? "text-fg-2 ring-border-strong/70" : "bg-bg-subtle text-fg-3 ring-border",
        className,
      )}
    >
      {src.label}
      {!s.verbatim && <span className="sr-only"> (paraphrase)</span>}
    </span>
  );
}

/** One thing a buyer said, with who, where, when and at what stage. Paraphrase never wears quote marks. */
export function QuoteRow({ s, compact, highlight }: { s: VoiceSnippet; compact?: boolean; highlight?: boolean }) {
  const href = snippetHref(s);
  const who = [s.speaker, s.title].filter(Boolean).join(", ");
  return (
    <li className={cn("min-w-0", compact ? "py-2" : "py-2.5")}>
      {s.verbatim ? (
        <blockquote className={cn("font-serif leading-[23px] text-fg [overflow-wrap:anywhere]", compact ? "text-[14.5px] leading-[22px]" : "text-[15.5px]", highlight && "text-fg")}>
          “{s.text}”
        </blockquote>
      ) : (
        <p className={cn("leading-[21px] text-fg-2 [overflow-wrap:anywhere]", compact ? "text-[13px]" : "text-[13.5px]")}>
          <span className="mr-1.5 text-[12px] font-medium uppercase tracking-[0.06em] text-fg-3">Paraphrase</span>
          {s.text}
        </p>
      )}
      <p className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-[12px] leading-4 text-fg-3">
        <SourceTag s={s} />
        {who && <span className="min-w-0 truncate text-fg-2">{who}</span>}
        {s.company &&
          (href ? (
            <Link href={href} className="min-w-0 truncate rounded-xs underline-offset-2 hover:text-fg hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]">
              {s.company}
            </Link>
          ) : (
            <span className="truncate">{s.company}</span>
          ))}
        <span className="font-mono tnum">{shortDate(s.date)}</span>
        {s.stage && <span>· at {STAGE_LABELS[s.stage]}</span>}
      </p>
    </li>
  );
}

/** Conversations that raised it in each 30-day window, oldest first; the last bar is the last 30 days. */
export function TrendBars({ trend, className }: { trend: Pick<VoiceTrend, "buckets">; className?: string }) {
  const max = Math.max(1, ...trend.buckets);
  const n = trend.buckets.length;
  return (
    <span
      role="img"
      aria-label={`Conversations that raised it by month, oldest first: ${trend.buckets.join(", ")}`}
      className={cn("inline-flex h-4 items-end gap-[2px]", className)}
    >
      {trend.buckets.map((v, i) => (
        <span
          key={i}
          className={cn("w-[5px] rounded-[1px]", i === n - 1 ? "bg-fg-2" : "bg-fg-4/70", v === 0 && "bg-border")}
          style={{ height: `${v === 0 ? 2 : Math.max(4, Math.round((v / max) * 16))}px` }}
        />
      ))}
    </span>
  );
}

export function TrendLabel({ trend }: { trend: VoiceTrend }) {
  if (!trend.label) return null;
  const text = trend.label === "new" ? "New this month" : trend.label === "rising" ? "Rising" : "Quieter lately";
  return (
    <span className={cn("inline-flex h-5 items-center rounded-xs px-1.5 text-[12px] font-medium ring-1 ring-inset", trend.label === "fading" ? "text-fg-3 ring-border" : "bg-accent-subtle text-accent-text ring-transparent")}>
      {text}
    </span>
  );
}
