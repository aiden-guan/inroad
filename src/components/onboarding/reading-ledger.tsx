"use client";

import { Briefcase, Building2, ChevronDown, FileText, Mail, MessageSquare, Newspaper, Search } from "lucide-react";
import { motion } from "motion/react";
import type { ReactNode } from "react";
import { Favicon } from "@/components/ui/favicon";
import { cn } from "@/lib/client/cn";
import type { OnboardingLedgerRow } from "@/lib/domain/types";
import { ease } from "@/lib/motion";

const CHECK_ICON: Record<string, ReactNode> = {
  DNS: <Mail className="size-3.5" />,
  "Job board": <Briefcase className="size-3.5" />,
  News: <Newspaper className="size-3.5" />,
  "Hacker News": <MessageSquare className="size-3.5" />,
  "YC directory": <Building2 className="size-3.5" />,
  "Your description": <FileText className="size-3.5" />,
};

/** Rows that land together (one refresh) cascade 40ms apart, capped at 8; rows that trickle in just appear. */
function delays(rows: { at: string }[]): number[] {
  let burst = 0;
  return rows.map((r, i) => {
    if (i > 0 && Date.parse(r.at) - Date.parse(rows[i - 1].at) > 400) burst = i;
    return Math.min(i - burst, 8) * 0.04;
  });
}

function Drawn() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5 text-fg-3" aria-hidden>
      <motion.path
        d="M3.5 8.5l3 3 6-7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.25, ease: ease.out }}
      />
    </svg>
  );
}

export interface ExtraRow {
  id: string;
  verb: string;
  detail: string;
  active?: boolean;
}

function Row({ verb, label, detail, mono, icon, ms, delay, title }: { verb: string; label?: string; detail: string; mono?: boolean; icon: ReactNode; ms?: number; delay: number; title?: string }) {
  return (
    <motion.li
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: ease.out, delay }}
      className="flex h-7 min-w-0 items-center gap-2 text-[13px]"
    >
      <span className="flex size-4 shrink-0 items-center justify-center">
        <Drawn />
      </span>
      <span className="flex size-4 shrink-0 items-center justify-center text-fg-3">{icon}</span>
      <span className="shrink-0 text-fg">{verb}</span>
      {label && (
        <>
          <span className="shrink-0 text-fg-4">·</span>
          <span className="shrink-0 text-fg-2">{label}</span>
        </>
      )}
      <span className="shrink-0 text-fg-4">·</span>
      <span title={title ?? detail} className={cn("min-w-0 flex-1 truncate text-fg-3", mono && "font-mono text-[12px]")}>
        {detail}
      </span>
      {ms !== undefined && <span className="shrink-0 pl-2 font-mono text-[11px] tnum text-fg-3">{(ms / 1000).toFixed(1)}s</span>}
    </motion.li>
  );
}

/** The live verb: a spinner ring and a shimmer that stops the moment the step lands. */
export function PendingRow({ verb, detail }: { verb: string; detail?: string }) {
  return (
    <li className="flex h-7 min-w-0 items-center gap-2 text-[13px]" aria-live="polite">
      <span className="flex size-4 shrink-0 items-center justify-center">
        <span className="size-3 animate-spin rounded-full border-[1.5px] border-accent/25 border-t-accent" />
      </span>
      <span className="shimmer-text min-w-0 truncate">
        {verb}
        {detail && <span className="ml-1.5 font-mono text-[12px]">{detail}</span>}
      </span>
    </li>
  );
}

/**
 * The reading ledger: every page actually crawled (favicon, title, mono path, real duration) and every free
 * lookup. Collapses to a one-line summary once drafting starts.
 */
export function ReadingLedger({
  rows,
  pending,
  extra = [],
  collapsed,
  onToggle,
}: {
  rows: OnboardingLedgerRow[];
  pending?: { verb: string; detail?: string } | null;
  extra?: ExtraRow[];
  collapsed?: boolean;
  onToggle?: () => void;
}) {
  const pages = rows.filter((r) => r.kind === "page").length;
  const checks = rows.filter((r) => r.kind === "check").length;
  const searches = extra.length;
  const wait = delays(rows);

  if (collapsed) {
    const parts = [
      pages ? `Read ${pages} page${pages === 1 ? "" : "s"}` : null,
      checks ? `${checks} free lookup${checks === 1 ? "" : "s"}` : null,
      searches ? `${searches} search${searches === 1 ? "" : "es"}` : null,
    ].filter(Boolean);
    const active = extra.filter((x) => x.active);
    return (
      <div>
        <button
          onClick={onToggle}
          aria-expanded={false}
          className="-ml-1 inline-flex h-7 items-center gap-2 rounded-sm px-1 text-[13px] text-fg-2 transition-colors duration-150 hover:bg-bg-subtle hover:text-fg"
        >
          <span className="flex size-4 items-center justify-center">
            <Drawn />
          </span>
          {parts.join(" · ") || "Reading"}
          <ChevronDown className="size-3.5 text-fg-3" aria-hidden />
        </button>
        {(active.length > 0 || pending) && (
          <ul>
            {active.map((x) => (
              <PendingRow key={x.id} verb={x.verb} detail={x.detail} />
            ))}
            {pending && <PendingRow verb={pending.verb} detail={pending.detail} />}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div>
      <ul aria-label="What I read">
        {rows.map((r, i) =>
          r.kind === "page" ? (
            <Row key={r.id} verb="Read" label={r.label} detail={r.detail} mono icon={r.host ? <Favicon domain={r.host} size={14} /> : null} ms={r.ms} delay={wait[i]} title={r.url} />
          ) : (
            <Row key={r.id} verb="Checked" label={r.label} detail={r.detail} icon={CHECK_ICON[r.label] ?? null} delay={wait[i]} />
          ),
        )}
        {extra.map((x) =>
          x.active ? (
            <PendingRow key={x.id} verb={x.verb} detail={x.detail} />
          ) : (
            <Row key={x.id} verb={x.verb} detail={x.detail} icon={<Search className="size-3.5" />} delay={0} />
          ),
        )}
        {pending && <PendingRow verb={pending.verb} detail={pending.detail} />}
      </ul>
      {onToggle && rows.length > 0 && (
        <button onClick={onToggle} aria-expanded className="mt-1 rounded-xs text-[12px] text-fg-3 transition-colors hover:text-fg-2">
          Hide
        </button>
      )}
    </div>
  );
}
