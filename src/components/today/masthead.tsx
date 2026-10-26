"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { RotateCw } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AiBadge } from "@/components/ui/badge";
import { Favicon } from "@/components/ui/favicon";
import { Num } from "@/components/ui/misc";
import { Orb } from "@/components/ui/orb";
import { MarginNote, SourceChip } from "@/components/ui/source";
import { cn } from "@/lib/client/cn";
import { age } from "@/lib/client/format";
import type { Brief, EntityRef, Scoreboard, Workspace } from "@/lib/domain/types";
import { ease } from "@/lib/motion";

/**
 * The masthead: the date in Newsreader, one greeting line, 0–3 cited lines worth knowing, and ONE
 * number strip. On the first open of the day it reveals in ≤600ms; afterwards it's instant.
 */
export function Masthead({
  ws,
  dateLabel,
  brief,
  greeting,
  scoreboard,
  reveal,
  working,
  preparing,
  error,
  onRefresh,
}: {
  ws: Workspace;
  dateLabel: string;
  brief: Brief | undefined;
  greeting: string;
  scoreboard: Scoreboard;
  reveal: boolean;
  working: boolean;
  preparing: boolean;
  error: string | null;
  onRefresh: () => void;
}) {
  const reduce = useReducedMotion();
  const [conversations, target] = scoreboard.conversations;
  const [wins, goal] = scoreboard.goalProgress;
  const consumer = ws.company?.market === "consumer";
  // Numbers roll from zero on the reveal only.
  const [rolled, setRolled] = useState(!reveal);
  useEffect(() => {
    if (rolled) return;
    const t = setTimeout(() => setRolled(true), 180);
    return () => clearTimeout(t);
  }, [rolled]);

  const matters = brief?.matters ?? [];

  return (
    <header className="relative">
      <div className="flex items-start gap-3">
        <motion.h1
          initial={reveal ? { opacity: 0, filter: "blur(4px)" } : false}
          animate={{ opacity: 1, filter: "blur(0px)" }}
          transition={{ duration: 0.3, ease: ease.out }}
          className="min-w-0 flex-1 text-balance font-serif text-[40px] leading-[44px] tracking-[-0.02em] text-fg [font-variation-settings:'opsz'_72] md:text-[48px] md:leading-[52px]"
        >
          {dateLabel}
        </motion.h1>
        <button
          onClick={onRefresh}
          aria-label="Refresh moves"
          title="Refresh moves"
          className="mt-3 inline-flex size-8 shrink-0 items-center justify-center rounded-sm text-fg-3 transition-[background-color,color,transform] duration-150 hover:bg-bg-subtle hover:text-fg active:scale-[0.94]"
        >
          <RotateCw className={cn("size-4", preparing && "animate-spin [animation-duration:900ms]")} />
        </button>
      </div>

      <div className="mt-3 flex items-start gap-2.5">
        <span className="mt-[7px] flex shrink-0 items-center" title="Your Head of GTM">
          <Orb state={working ? "working" : "idle"} size={14} />
        </span>
        <p className="min-w-0 font-serif text-[19px] leading-[28px] text-fg [font-variation-settings:'opsz'_24]" aria-live="polite">
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

      <AnimatePresence initial={false}>
        {matters.length > 0 && (
          <motion.ul
            key="matters"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="mt-4 space-y-2.5 pl-[24px]"
            aria-label="Worth knowing"
          >
            {matters.map((m) => (
              <li key={m.text} className="relative">
                <p className="max-w-[62ch] font-serif text-[16px] leading-[25px] text-fg-2">
                  {m.text}
                  {m.url ? (
                    <span className="xl:hidden">
                      {" "}
                      <SourceChip url={m.url} publishedAt={m.date} quote={m.quote} />
                    </span>
                  ) : (
                    m.ref && (
                      <span className="xl:hidden">
                        {" "}
                        <RefChip ws={ws} entity={m.ref} date={m.date} quote={m.quote} />
                      </span>
                    )
                  )}
                </p>
                {m.url ? (
                  <MarginNote url={m.url} publishedAt={m.date} quote={m.quote} className="absolute left-[calc(100%+40px)] top-1 hidden w-[200px] xl:block" />
                ) : (
                  m.ref && <RefChip ws={ws} entity={m.ref} date={m.date} quote={m.quote} margin className="absolute left-[calc(100%+40px)] top-1 hidden w-[200px] xl:block" />
                )}
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>

      <Link
        href="/playbook"
        className="group mt-6 inline-flex flex-wrap items-baseline gap-x-1.5 text-[13.5px] text-fg-2 transition-colors hover:text-fg"
        title="Your plan: conversations are the input that matters"
      >
        <Num value={rolled ? conversations : 0} className="font-medium text-fg" />
        <span>of</span>
        <Num value={target} className="font-medium text-fg" />
        <span>{consumer ? "user conversations this week" : "conversations this week"}</span>
        <span className="text-fg-3">·</span>
        <Num value={rolled ? wins : 0} className="font-medium text-fg" />
        <span>of</span>
        <Num value={goal} className="font-medium text-fg" />
        <span>{consumer ? ws.goal.targetLabel : "pilots"}</span>
      </Link>

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
