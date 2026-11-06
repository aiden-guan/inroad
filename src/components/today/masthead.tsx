"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowUpRight, CornerDownLeft, RotateCw } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AiBadge } from "@/components/ui/badge";
import { Favicon } from "@/components/ui/favicon";
import { Orb } from "@/components/ui/orb";
import { SourceChip } from "@/components/ui/source";
import { cn } from "@/lib/client/cn";
import { age } from "@/lib/client/format";
import type { Brief, EntityRef, Workspace } from "@/lib/domain/types";
import type { NorthStar } from "@/lib/moves/north-star";
import type { Since, SinceFact } from "@/lib/moves/since";
import { ease } from "@/lib/motion";

/** Where a line or a fact goes when clicked: a card on the desk (opened in place), else a page. */
export interface Target {
  moveId?: string;
  replyIds?: string[];
  href?: string;
}

/**
 * The masthead, kept short so the desk starts above the fold: the date as an eyebrow, the greeting, the one number
 * (the same north star the sidebar shows), what changed since the last visit (code, each fact a link), then the
 * brief's lines, each one opening the card that acts on it.
 */
export function Masthead({
  ws,
  dateLabel,
  brief,
  greeting,
  star,
  since,
  reveal,
  working,
  preparing,
  error,
  onRefresh,
  targetOf,
  onOpen,
  onSeen,
  tools,
}: {
  ws: Workspace;
  dateLabel: string;
  brief: Brief | undefined;
  greeting: string;
  star: NorthStar;
  since: Since | null;
  reveal: boolean;
  working: boolean;
  preparing: boolean;
  error: string | null;
  onRefresh: () => void;
  /** The card or page a brief line or a since-fact points to. */
  targetOf: (x: { ref?: EntityRef; domain?: string; replyIds?: string[]; loose?: boolean }) => Target;
  onOpen: (t: Target) => void;
  /** "Since …" seen: start counting from now. */
  onSeen: () => void;
  /** Waiting on, What I've learned. */
  tools?: ReactNode;
}) {
  const reduce = useReducedMotion();
  const [showAllMatters, setShowAllMatters] = useState(false);
  // The bar fills from empty on the morning reveal only.
  const [rolled, setRolled] = useState(!reveal);
  useEffect(() => {
    if (rolled) return;
    const t = setTimeout(() => setRolled(true), 180);
    return () => clearTimeout(t);
  }, [rolled]);
  const matters = brief?.matters ?? [];
  const ratio = star.max > 0 ? Math.min(1, star.value / star.max) : 0;

  return (
    <header className="relative">
      <p className="page-eyebrow mb-3">Your daily brief</p>
      <div className="flex items-center justify-between gap-3">
        <h1 className="page-heading min-w-0">
          <span className="truncate">{dateLabel}</span>
        </h1>
        <button
          onClick={onRefresh}
          aria-label="Refresh moves"
          title="Refresh moves"
          disabled={preparing}
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-fg-3 ring-1 ring-inset ring-border transition-[background-color,color,transform] duration-150 hover:bg-surface hover:text-fg active:scale-[0.94] disabled:opacity-60"
        >
          <RotateCw className={cn("size-3.5", preparing && "animate-spin [animation-duration:900ms]")} />
        </button>
      </div>

      <div className="mt-2.5 flex items-start gap-2.5">
        <span className="mt-[7px] flex shrink-0 items-center" title="Your Head of GTM">
          <Orb state={working ? "working" : "idle"} size={14} />
        </span>
        <p className="min-w-0 font-serif text-[20px] leading-[28px] text-fg [font-variation-settings:'opsz'_24]" aria-live="polite">
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={greeting}
              initial={reveal ? false : { opacity: 0, filter: "blur(2px)" }}
              animate={{ opacity: 1, filter: "blur(0px)" }}
              exit={{ opacity: 0, transition: { duration: 0.1 } }}
              transition={{ duration: 0.18, ease: ease.out }}
              className="inline"
            >
              {reveal && !reduce ? <Streamed text={greeting} /> : greeting}
            </motion.span>
          </AnimatePresence>
          <AiBadge className="ml-2 align-[3px]" />
        </p>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl bg-bg/65 px-4 py-4 ring-1 ring-inset ring-border">
        <Link href={star.href} title={`${star.label}. Open ${star.href === "/revenue" ? "the forecast" : star.href === "/growth" ? "Growth" : "your plan"}`} className="group inline-flex min-w-0 items-center gap-2.5 text-[13px] leading-5 text-fg-2">
          <span
            role="progressbar"
            aria-label={star.label}
            aria-valuenow={Math.round(ratio * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuetext={star.headline}
            className="progress-track w-14 shrink-0"
          >
            <span className="progress-fill block !bg-accent" style={{ transform: `scaleX(${rolled ? ratio : 0})` }} />
          </span>
          <span className="min-w-0 truncate">
            <span className="font-medium text-fg tnum group-hover:underline group-hover:underline-offset-4">{star.headline}</span>
            {star.details.map((d) => (
              <span key={d} className="tnum text-fg-3">
                {" "}
                · {d}
              </span>
            ))}
          </span>
        </Link>
        {tools && <div className="ml-auto flex shrink-0 flex-wrap items-center gap-1.5">{tools}</div>}
      </div>

      {since && since.facts.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5 sm:pl-[24px]" aria-label={`${since.label}: what changed`} role="group">
          <span className="mr-0.5 text-[12px] text-fg-3">{since.label}</span>
          {since.facts.map((f) => (
            <FactChip key={f.key} ws={ws} fact={f} target={targetOf({ ref: f.ref, domain: f.domain, replyIds: f.replyIds })} onOpen={onOpen} />
          ))}
          <button type="button" onClick={onSeen} className="ml-0.5 h-6 rounded-xs px-1 text-[12px] text-fg-3 transition-colors hover:text-fg" title="Count from now">
            Clear
          </button>
        </div>
      )}

      {matters.length > 0 && (
        <ul id="daily-updates" className="mt-4 grid gap-x-8 gap-y-3 sm:pl-[24px] lg:grid-cols-2" aria-label="Worth knowing">
          {matters.map((m, i) => {
            const t = targetOf({ ref: m.ref, loose: true });
            return (
              <li key={m.text} className={cn("relative", i > 0 && !showAllMatters && "hidden sm:block")}>
                <div className="flex items-start gap-2">
                  <MatterLine text={m.text} target={t} onOpen={onOpen} />
                  {(m.url || m.ref) && (
                    <span className="mt-[3px] shrink-0">{m.url ? <SourceChip url={m.url} publishedAt={m.date} quote={m.quote} /> : m.ref && <RefChip ws={ws} entity={m.ref} date={m.date} quote={m.quote} />}</span>
                  )}
                </div>

              </li>
            );
          })}
        </ul>
      )}

      {matters.length > 1 && <button onClick={() => setShowAllMatters((show) => !show)} aria-controls="daily-updates" aria-expanded={showAllMatters} className="mt-2 min-h-9 rounded-sm text-[12px] font-medium text-fg-2 underline decoration-border-strong underline-offset-4 sm:hidden">{showAllMatters ? "Show fewer updates" : `${matters.length - 1} more updates`}</button>}

      {error && (
        <p className="mt-3 text-[12.5px] text-danger">
          {error} Showing your last saved moves.{" "}
          <button onClick={onRefresh} className="underline underline-offset-4">
            Try again
          </button>
        </p>
      )}
    </header>
  );
}

/** A brief line: it opens the card that acts on it, or the record it's about. */
function MatterLine({ text, target, onOpen }: { text: string; target: Target; onOpen: (t: Target) => void }) {
  const body = (
    <>
      <span className="line-clamp-2 font-serif text-[15px] leading-[22px] text-fg-2 transition-colors group-hover:text-fg">{text}</span>
      {(target.moveId || target.replyIds) && (
        <span className="ml-auto mt-0.5 hidden shrink-0 items-center gap-1 text-[11.5px] text-fg-3 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 md:inline-flex">
          Open <CornerDownLeft aria-hidden className="size-3" />
        </span>
      )}
    </>
  );
  const cls = "group flex min-w-0 flex-1 items-start gap-3 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]";
  if (target.moveId || target.replyIds) {
    return (
      <button type="button" onClick={() => onOpen(target)} className={cls} title="Open the card that acts on this">
        {body}
      </button>
    );
  }
  if (target.href) {
    return (
      <Link href={target.href} className={cls}>
        {body}
      </Link>
    );
  }
  return <span className="min-w-0 flex-1 font-serif text-[15px] leading-[22px] text-fg-2">{text}</span>;
}

const DOT: Record<SinceFact["kind"], string> = {
  replies: "bg-accent",
  booked: "bg-success",
  moved: "bg-warning",
  canceled: "bg-danger",
  stage: "bg-fg-2",
  signals: "bg-info",
};

/** One thing that changed since the last visit, linking to its card or its record. */
function FactChip({ ws, fact, target, onOpen }: { ws: Workspace; fact: SinceFact; target: Target; onOpen: (t: Target) => void }) {
  const cls = "inline-flex h-6 max-w-full items-center gap-1.5 rounded-xs bg-surface px-1.5 text-[12px] text-fg-2 ring-1 ring-inset ring-border transition-[background-color,color] duration-150 hover:bg-bg-subtle hover:text-fg";
  const inner = (
    <>
      <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", DOT[fact.kind])} />
      {fact.domain && fact.kind !== "replies" && <Favicon domain={fact.domain} name={ws.accounts[fact.domain]?.name} size={12} className="ring-0" />}
      <span className="truncate">{fact.text}</span>
    </>
  );
  if (target.moveId || target.replyIds) {
    return (
      <button type="button" className={cls} title={fact.detail} onClick={() => onOpen(target)}>
        {inner}
      </button>
    );
  }
  if (target.href) {
    return (
      <Link href={target.href} className={cls} title={fact.detail}>
        {inner}
        <ArrowUpRight aria-hidden className="size-3 shrink-0 opacity-60" />
      </Link>
    );
  }
  return (
    <span className={cls} title={fact.detail}>
      {inner}
    </span>
  );
}

/** Where a line built from your own data (a reply, a deal, a meeting) comes from: the record, not a web page. */
function refSource(ws: Workspace, ref: EntityRef): { label: string; domain?: string; href?: string } | null {
  const sheet = (domain: string) => `/companies?c=${encodeURIComponent(domain)}`;
  switch (ref.kind) {
    case "account":
      return { label: ws.accounts[ref.id]?.name ?? ref.id, domain: ref.id, href: sheet(ref.id) };
    case "person": {
      const p = ws.people[ref.id];
      return p ? { label: p.name, domain: p.accountDomain, href: sheet(p.accountDomain) } : null;
    }
    case "deal": {
      const d = ws.deals[ref.id];
      return d ? { label: ws.accounts[d.accountDomain]?.name ?? d.name, domain: d.accountDomain, href: sheet(d.accountDomain) } : null;
    }
    case "meeting": {
      const m = ws.meetings[ref.id];
      const domain = m ? ws.deals[m.dealId]?.accountDomain : undefined;
      return m ? { label: m.title, domain, href: domain ? sheet(domain) : undefined } : null;
    }
    default:
      return null;
  }
}

function RefChip({ ws, entity, date, quote, margin, className }: { ws: Workspace; entity: EntityRef; date?: string; quote?: string; margin?: boolean; className?: string }) {
  const src = refSource(ws, entity);
  if (!src) return null;
  const when = age(date);
  const body = margin ? (
    <>
      <span className="font-mono text-fg-2">
        {src.label}
        {when && <span className="text-fg-3"> · {when}</span>}
      </span>
      {quote && <span className="mt-0.5 line-clamp-2 block font-serif text-[12.5px] italic">“{quote}”</span>}
    </>
  ) : (
    <>
      {src.domain && <Favicon domain={src.domain} size={12} className="ring-0" />}
      <span className="truncate">{src.label}</span>
      {when && <span className="text-fg-3">· {when}</span>}
    </>
  );
  const cls = margin
    ? cn("group block border-l border-accent/40 pl-2.5 text-[11.5px] leading-[16px] text-fg-3 transition-colors hover:border-accent hover:text-fg-2", className)
    : cn(
        "inline-flex h-5 max-w-56 items-center gap-1 rounded-xs bg-surface px-1 align-[1px] font-mono text-[11px] text-fg-2 ring-1 ring-border",
        src.href && "transition-[background-color,box-shadow] duration-150 ease-out-quad hover:bg-accent-subtle hover:ring-accent/30",
        className,
      );
  return src.href ? (
    <Link href={src.href} title={quote} className={cls}>
      {body}
    </Link>
  ) : (
    <span title={quote} className={cls}>
      {body}
    </span>
  );
}

/** Word-by-word stream for the greeting on the morning reveal: 15ms per word, 180ms fade + unblur, caret while streaming. */
function Streamed({ text }: { text: string }) {
  const parts = useMemo(() => {
    let n = 0;
    return text.split(/(\s+)/).map((w) => ({ w, index: w.trim() ? n++ : -1 }));
  }, [text]);
  const total = parts.filter((p) => p.index >= 0).length;
  const [done, setDone] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setDone(true), 120 + total * 15 + 180);
    return () => clearTimeout(t);
  }, [total]);
  return (
    <>
      {parts.map((p, key) =>
        p.index >= 0 ? (
          <motion.span
            key={key}
            initial={{ opacity: 0, filter: "blur(2px)" }}
            animate={{ opacity: 1, filter: "blur(0px)" }}
            transition={{ duration: 0.18, ease: ease.out, delay: 0.12 + p.index * 0.015 }}
          >
            {p.w}
          </motion.span>
        ) : (
          p.w
        ),
      )}
      {!done && <span aria-hidden className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[3px] animate-caret bg-accent" />}
    </>
  );
}
