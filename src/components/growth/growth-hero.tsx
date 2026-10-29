"use client";

import { useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { AiBadge } from "@/components/ui/badge";
import { TextReveal, fx, useFirstSight } from "@/components/ui/fx";
import { Num } from "@/components/ui/misc";
import { Orb } from "@/components/ui/orb";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/client/cn";
import { shortDate } from "@/lib/client/format";
import { STAGE_LABELS, type GoalPace, type GrowthRead } from "@/lib/consumer/growth";
import { daysBetween } from "@/lib/domain/ids";
import type { Goal } from "@/lib/domain/types";

/** A change a week, signed: "+12", "−3", "+0.5". */
export function perWeek(n: number): string {
  const v = Math.abs(n) >= 10 ? Math.round(Math.abs(n)) : Math.round(Math.abs(n) * 10) / 10;
  return `${n < 0 ? "−" : "+"}${v.toLocaleString("en-US")}`;
}

/**
 * The read, in one sentence, from code: where the goal stands and whether the recent pace gets there. It never guesses
 * a pace from one week, and it says what to log when the goal's number is missing.
 */
export function growthHeadline(goal: Pick<Goal, "target" | "targetLabel" | "byDate">, g: GrowthRead, pace: GoalPace | null): string {
  const { target, targetLabel: label, byDate } = goal;
  const by = shortDate(byDate);
  if (!g.latest) return `Log last week's numbers and I'll show whether ${target.toLocaleString("en-US")} ${label} by ${by} is on pace.`;
  const current = g.goal.current;
  if (current === null) return `Signups are in. Add ${label} to each week and I'll show the pace to ${target.toLocaleString("en-US")} by ${by}.`;
  if (current >= target) return `${current.toLocaleString("en-US")} ${label}: past the goal of ${target.toLocaleString("en-US")}. Set the next one in the plan.`;
  if (!pace) return `${current.toLocaleString("en-US")} ${label} last week. One more week of numbers and I'll show the pace to ${target.toLocaleString("en-US")} by ${by}.`;
  if (pace.onPace) return `On pace: ${current.toLocaleString("en-US")} ${label} now and ${perWeek(pace.perWeek)} a week reaches about ${pace.projected.toLocaleString("en-US")} by ${by}.`;
  return `${current.toLocaleString("en-US")} ${label} now. At ${perWeek(pace.perWeek)} a week that's about ${pace.projected.toLocaleString("en-US")} by ${by}, short of ${target.toLocaleString("en-US")}: it takes ${perWeek(pace.needPerWeek)} a week.`;
}

/**
 * The number, the way the Monday growth meeting reads it: where the goal is now, where the recent pace takes it by
 * the date, and the inputs under it (signups, retention against the bar, paying). Ink shades only; color is for risk.
 */
export function GrowthHero({ goal, g, pace, signupsPerWeek, today }: { goal: Goal; g: GrowthRead; pace: GoalPace | null; signupsPerWeek: number; today: string }) {
  const reduce = useReducedMotion();
  // The first look this session is choreographed, like Revenue's: the read, the bar, the target, the numbers.
  const play = useFirstSight("growth-hero") && !reduce;
  const [rolled, setRolled] = useState(!play);
  useEffect(() => {
    if (rolled) return;
    const t = setTimeout(() => setRolled(true), 420);
    return () => clearTimeout(t);
  }, [rolled]);

  const current = g.goal.current ?? 0;
  const projected = pace?.projected ?? null;
  const scale = Math.max(goal.target, projected ?? 0, current, 1) * 1.04;
  const pct = (n: number) => `${Math.max(0, (n / scale) * 100)}%`;
  const ahead = projected !== null && projected > current ? projected - current : 0;
  const weeksLeft = Math.max(0, Math.ceil(daysBetween(today, goal.byDate) / 7));
  const repeat = g.model.retention.metric === "m3_repeat";
  const prev = g.weeks.at(-2);
  const metric = goal.metric === "paying" ? "paying" : "active";
  const prevValue = prev?.[metric];
  const wow = prevValue && g.goal.current !== null ? (g.goal.current - prevValue) / prevValue : undefined;
  const behind = !!pace && !pace.onPace && current < goal.target;

  return (
    <section aria-label="The number" className="mt-8 overflow-hidden rounded-xl bg-surface shadow-sm ring-1 ring-inset ring-border">
      <div className="px-5 pb-6 pt-5 sm:px-7 sm:pt-6">
        <div className="mb-3 flex items-center gap-2 text-[12px] text-fg-3">
          <Orb size={14} state={behind || g.verdicts.some((v) => v.severity === "block") ? "needs" : "idle"} />
          <span className="font-medium text-fg-2">The read</span>
          <AiBadge />
        </div>
        <p className="max-w-[62ch] text-pretty font-serif text-[21px] leading-[30px] tracking-[-0.005em] text-fg sm:text-[24px] sm:leading-[33px]">
          <TextReveal text={growthHeadline(goal, g, pace)} play={play} step={22} delay={60} />
        </p>

        <div className="mt-7">
          <div className="relative h-11">
            <div className="absolute inset-0 overflow-hidden rounded-md bg-bg-subtle ring-1 ring-inset ring-border">
              <div className={cn("flex h-full", play && "fx-wipe")} style={play ? fx(0, 380, { animationDuration: "1100ms" }) : undefined}>
                {current > 0 && (
                  <Tooltip content={`Now: ${current.toLocaleString("en-US")} ${goal.targetLabel}`}>
                    <div tabIndex={-1} className="h-full border-r border-bg/70 bg-fg" style={{ width: pct(current) }} />
                  </Tooltip>
                )}
                {ahead > 0 && (
                  <Tooltip content={`At this pace by ${shortDate(goal.byDate)}: about ${projected!.toLocaleString("en-US")}`}>
                    <div tabIndex={-1} className="h-full bg-fg/12 bg-[repeating-linear-gradient(135deg,transparent_0_4px,rgb(127_127_127/0.12)_4px_5px)]" style={{ width: pct(ahead) }} />
                  </Tooltip>
                )}
              </div>
            </div>
            <div className="pointer-events-none absolute -bottom-1.5 -top-1.5" style={{ left: pct(goal.target) }}>
              <div className={cn("h-full w-0.5 -translate-x-1/2 rounded-full bg-fg", play && "fx-drop")} style={play ? fx(0, 1250) : undefined} />
            </div>
          </div>
          <div className="relative mt-2 h-4 text-[11.5px]">
            {/* The label sits on whichever side of the marker has room. */}
            <span
              className={cn("absolute whitespace-nowrap font-mono tnum text-fg-2", goal.target / scale > 0.3 ? "-translate-x-full pr-1.5" : "pl-1.5", play && "fx-rise")}
              style={{ left: pct(goal.target), ...(play ? fx(0, 1350) : {}) }}
            >
              Goal {goal.target.toLocaleString("en-US")}
            </span>
          </div>
        </div>

        <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-5">
          <Stat
            label="Now"
            swatch="bg-fg"
            value={rolled ? g.goal.current : 0}
            empty={g.goal.current === null}
            note={wow !== undefined ? `${wow >= 0 ? "+" : "−"}${Math.abs(Math.round(wow * 100))}% on the week` : goal.targetLabel}
          />
          <Stat
            label={`By ${shortDate(goal.byDate)}`}
            swatch="bg-fg/12"
            value={rolled ? projected : 0}
            empty={projected === null}
            note={pace ? `At ${perWeek(pace.perWeek)} a week` : "Two weeks of numbers to tell"}
            tip="The change a week across your last four weeks of change, carried in a straight line to the goal date. Early numbers swing too much for anything fancier."
          />
          <Stat label="Signups last week" value={rolled ? (g.latest?.signups ?? null) : 0} empty={!g.latest} note={`${signupsPerWeek.toLocaleString("en-US")} a week in the plan`} />
          <Stat
            label={repeat ? "Repeat in 90 days" : "Week-4 retention"}
            value={rolled ? (g.retention ?? null) : 0}
            suffix="%"
            empty={g.retention === undefined}
            warn={g.retentionStatus === "below"}
            note={`The bar is ${g.model.retention.target}%`}
          />
          <Stat
            label="Paying"
            value={rolled ? (g.latest?.paying ?? null) : 0}
            empty={g.latest?.paying === undefined}
            note={g.quickRatio !== undefined ? `Quick ratio ${g.quickRatio.toFixed(1)}` : "At week end"}
          />
        </dl>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border bg-bg-subtle/50 px-5 py-3 text-[12.5px] text-fg-3 sm:px-7">
        <span>
          Goal by <span className="font-mono tnum">{shortDate(goal.byDate)}</span> · <span className="font-mono tnum text-fg-2">{weeksLeft}</span> {weeksLeft === 1 ? "week" : "weeks"} left
        </span>
        <span>
          Focus <span className="font-medium text-fg-2">{STAGE_LABELS[g.focus].toLowerCase()}</span>
        </span>
        <Tooltip content={`Paid acquisition waits until ${repeat ? "repeat purchase" : "week-4 retention"} clears the ${g.model.retention.target}% bar and isn't falling: paid users into a leaky product are money you don't get back.`}>
          <span tabIndex={0} className="cursor-help rounded-[2px] outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]">
            Paid <span className={cn(g.paidAllowed ? "text-fg-2" : "font-medium text-warning")}>{g.paidAllowed ? "open" : "on hold"}</span>
          </span>
        </Tooltip>
        <span>
          <span className="font-mono tnum text-fg-2">{g.weeks.length}</span> {g.weeks.length === 1 ? "week" : "weeks"} logged
        </span>
      </div>
    </section>
  );
}

function Stat({ label, value, note, swatch, tip, suffix, empty, warn }: { label: string; value: number | null; note: string; swatch?: string; tip?: string; suffix?: string; empty?: boolean; warn?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1.5 text-[12px] text-fg-3">
        {swatch ? <span aria-hidden className={cn("size-2 rounded-[2px] ring-1 ring-inset ring-border", swatch)} /> : <span aria-hidden className="h-px w-2 bg-fg" />}
        {tip ? (
          <Tooltip content={tip}>
            <span tabIndex={0} className="cursor-help underline decoration-dotted underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]">
              {label}
            </span>
          </Tooltip>
        ) : (
          label
        )}
      </dt>
      <dd className={cn("mt-1 font-mono text-[22px] font-medium leading-7 tracking-[-0.01em]", warn ? "text-warning" : "text-fg")}>
        {empty ? <span className="text-fg-4">—</span> : <Num value={value ?? 0} format={suffix ? { maximumFractionDigits: 1 } : undefined} />}
        {!empty && suffix}
      </dd>
      <dd className="truncate text-[12px] text-fg-3">{note}</dd>
    </div>
  );
}
