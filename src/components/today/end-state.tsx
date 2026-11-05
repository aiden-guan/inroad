"use client";

import { useReducedMotion } from "motion/react";
import Link from "next/link";
import { CheckStamp, TextReveal } from "@/components/ui/fx";
import { cn } from "@/lib/client/cn";
import type { NextItem, Progress } from "@/lib/moves/desk";
import { plural } from "@/lib/moves/util";
import { RunInline } from "./parts";

/**
 * The end of the desk. Cleared this session, it lands once (the stamp, the line, the bar settling full); on a later
 * visit it's still. Either way it says what's next, from code (tomorrow's first card, the next meeting, the next
 * reminder), and offers one useful optional job, so Today never dead-ends.
 */
export function DeskEnd({
  progress,
  next,
  justCleared,
  consumer,
  worth,
}: {
  progress: Progress;
  next: NextItem[];
  /** The founder cleared the last card in this session: the moment plays. */
  justCleared: boolean;
  consumer: boolean;
  /** Companies with a fresh signal this fortnight (business). */
  worth: number;
}) {
  const reduce = useReducedMotion();
  const play = justCleared && !reduce;
  const cleared = progress.done > 0;
  const moves = progress.done - progress.replies.done;
  const did = [moves > 0 ? plural(moves, "move") : "", progress.replies.done > 0 ? plural(progress.replies.done, "reply", "replies") : ""].filter(Boolean).join(" and ");
  return (
    <section aria-label="Desk clear" className="mt-8 rounded-xl bg-surface px-5 py-6 shadow-xs ring-1 ring-inset ring-border md:px-7 md:py-7" aria-live="polite">
      <div className="flex items-start gap-3.5">
        <span className={cn("mt-1 flex size-8 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset", cleared ? "bg-success-subtle ring-success/20" : "bg-bg-subtle ring-border/60")}>
          {cleared ? <CheckStamp size={20} still={!play} /> : <span aria-hidden className="size-2 rounded-full bg-border-strong" />}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-serif text-[26px] leading-[32px] tracking-[-0.02em] text-fg [font-variation-settings:'opsz'_36]">
            <TextReveal key={String(cleared)} text={cleared ? "Desk clear." : "Nothing needs you right now."} play={play} step={60} delay={120} />
          </h2>
          <p className={cn("mt-1.5 max-w-[56ch] text-[14px] leading-[22px] text-fg-2", play && "fx-rise [--fx-delay:360ms]")}>
            {cleared
              ? `You cleared ${did} today. Replies that come in, reminders that come due and new signals will land here.`
              : consumer
                ? "Your growth actions are up to date."
                : worth
                  ? `${plural(worth, "company", "companies")} had a fresh signal this fortnight. Worth a look when you have time.`
                  : "No replies, meetings or follow-ups are waiting."}
          </p>
          {cleared && (
            <span aria-hidden className={cn("progress-track mt-4 block max-w-[280px]", play && "fx-rise [--fx-delay:300ms]")}>
              <span className="progress-fill block bg-success" style={{ transform: "scaleX(1)" }} />
            </span>
          )}
        </div>
      </div>

      {next.length > 0 && (
        <div className={cn("mt-6 border-t border-border pt-4", play && "fx-rise [--fx-delay:520ms]")}>
          <p className="text-[12px] font-medium text-fg-3">Next</p>
          <ul className="mt-1.5 space-y-1.5">
            {next.map((n) => (
              <li key={n.key} className="flex items-baseline gap-3 text-[13.5px] leading-5">
                <span className="w-[112px] shrink-0 font-mono text-[11.5px] tnum text-fg-3">{n.when}</span>
                {n.href ? (
                  <Link href={n.href} className="min-w-0 truncate text-fg underline-offset-4 hover:underline">
                    {n.text}
                  </Link>
                ) : (
                  <span className="min-w-0 truncate text-fg">{n.text}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className={cn("mt-5", play && "fx-rise [--fx-delay:640ms]")}>
        {consumer ? (
          <RunInline workflow="partners" args={{ mode: "find", count: 8, source: "founder" }} runRef={{ kind: "playbook", id: "partners" }} label="Find creators and communities" variant="secondary" />
        ) : (
          <RunInline workflow="discovery" args={{ source: "manual" }} label="Find more companies" variant="secondary" hint="Optional · a few minutes in the background" />
        )}
      </div>
    </section>
  );
}
