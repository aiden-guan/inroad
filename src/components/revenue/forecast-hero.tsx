"use client";

import { useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { AiBadge } from "@/components/ui/badge";
import { DigitPop, TextReveal, fx, useFirstSight } from "@/components/ui/fx";
import { Num } from "@/components/ui/misc";
import { Orb } from "@/components/ui/orb";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/client/cn";
import { money, shortDay, type Forecast, type RevenuePlan } from "@/lib/revenue/forecast";

const USD = { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 } as const;

/** Ink shades only: the accent belongs to the agent, and color in charts is reserved for risk. */
const SEGMENTS = [
  { key: "won", label: "Closed won", className: "bg-fg" },
  { key: "commit", label: "Commit", className: "bg-fg/65" },
  { key: "best", label: "Best case", className: "bg-fg/35" },
  { key: "pipeline", label: "Pipeline", className: "bg-fg/12 bg-[repeating-linear-gradient(135deg,transparent_0_4px,rgb(127_127_127/0.12)_4px_5px)]" },
] as const;

/**
 * The number, the way it's called in a forecast meeting: what's closed, what's committed, what's
 * possible, against the target. The sentence above the bar is the plan's headline: what it takes.
 */
export function ForecastHero({ f, plan }: { f: Forecast; plan: RevenuePlan }) {
  const reduce = useReducedMotion();
  // The first look this session is choreographed: the call is read out, the bar draws, the target drops in,
  // the numbers roll up from zero. After that the page just shows the number.
  const play = useFirstSight("revenue-hero") && !reduce;
  const [rolled, setRolled] = useState(!play);
  useEffect(() => {
    if (rolled) return;
    const t = setTimeout(() => setRolled(true), 420);
    return () => clearTimeout(t);
  }, [rolled]);
  const commitOpen = f.commit - f.closedWon.usd;
  const bestOpen = f.bestCase - f.commit;
  const pipeOpen = f.pipeline - f.bestCase;
  const scale = Math.max(f.target, f.pipeline, 1) * 1.04;
  const pct = (n: number) => `${Math.max(0, (n / scale) * 100)}%`;
  const parts = [
    { ...SEGMENTS[0], value: f.closedWon.usd },
    { ...SEGMENTS[1], value: commitOpen },
    { ...SEGMENTS[2], value: bestOpen },
    { ...SEGMENTS[3], value: pipeOpen },
  ];
  const short = f.hasTarget && f.coverage !== null && f.coverage < f.coverageNeeded;

  return (
    <section aria-label="Forecast" className="mt-8 overflow-hidden rounded-xl bg-surface shadow-sm ring-1 ring-inset ring-border">
      <div className="px-5 pb-6 pt-5 sm:px-7 sm:pt-6">
        <div className="mb-3 flex items-center gap-2 text-[12px] text-fg-3">
          <Orb size={14} state={plan.verdict === "behind" || plan.verdict === "too_late" ? "needs" : "idle"} />
          <span className="font-medium text-fg-2">The call</span>
          <AiBadge />
        </div>
        <p className="max-w-[62ch] text-pretty font-serif text-[21px] leading-[30px] tracking-[-0.005em] text-fg sm:text-[24px] sm:leading-[33px]">
          <TextReveal text={plan.headline} play={play} step={22} delay={60} />
        </p>

        <div className="mt-7">
          <div className="relative h-11">
            <div className="absolute inset-0 overflow-hidden rounded-md bg-bg-subtle ring-1 ring-inset ring-border">
              <div className={cn("flex h-full", play && "fx-wipe")} style={play ? fx(0, 380, { animationDuration: "1100ms" }) : undefined}>
                {parts.map((p) =>
                  p.value > 0 ? (
                    <Tooltip key={p.key} content={`${p.label}: ${money(p.value)}`}>
                      <div tabIndex={-1} className={cn("h-full border-r border-bg/70 last:border-r-0", p.className)} style={{ width: pct(p.value) }} />
                    </Tooltip>
                  ) : null,
                )}
              </div>
            </div>
            {f.hasTarget && (
              <div className="pointer-events-none absolute -bottom-1.5 -top-1.5" style={{ left: pct(f.target) }}>
                <div className={cn("h-full w-0.5 -translate-x-1/2 rounded-full bg-fg", play && "fx-drop")} style={play ? fx(0, 1250) : undefined} />
              </div>
            )}
          </div>
          {f.hasTarget && (
            <div className="relative mt-2 h-4 text-[11.5px]">
              {/* The label sits on whichever side of the marker has room. */}
              <span
                className={cn("absolute whitespace-nowrap font-mono tnum text-fg-2", f.target / scale > 0.3 ? "-translate-x-full pr-1.5" : "pl-1.5", play && "fx-rise")}
                style={{ left: pct(f.target), ...(play ? fx(0, 1350) : {}) }}
              >
                Target {money(f.target)}
              </span>
            </div>
          )}
        </div>

        <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-5">
          <Stat label="Closed won" swatch="bg-fg" value={rolled ? f.closedWon.usd : 0} note={`${f.closedWon.deals.length} ${f.closedWon.deals.length === 1 ? "deal" : "deals"}`} />
          <Stat label="Commit · floor" swatch="bg-fg/65" value={rolled ? f.commit : 0} note={f.hasTarget ? `${Math.round((f.commit / f.target) * 100)}% of target` : "Won + commit"} />
          <Stat
            label="The call"
            value={rolled ? f.call : 0}
            note={f.hasTarget ? `${Math.round((f.call / f.target) * 100)}% of target` : "Category-weighted"}
            tip="Closed won, plus each deal at its category's odds: commit 90%, best case 50%, pipeline 15%. The odds calibrate once two quarters of snapshots exist."
          />
          <Stat label="Best case · ceiling" swatch="bg-fg/35" value={rolled ? f.bestCase : 0} note={f.hasTarget ? `${Math.round((f.bestCase / f.target) * 100)}% of target` : "Commit + best case"} />
          <Stat label="Pipeline" swatch="bg-fg/12" value={rolled ? f.pipeline : 0} note={`Stage-weighted ${money(f.weighted)}`} />
        </dl>
        {f.hitChance !== null && f.remaining > 0 && (
          <p className="mt-5 flex flex-wrap items-baseline gap-x-2 border-t border-border pt-4 text-[13px] text-fg-2">
            <DigitPop text={`${Math.round(f.hitChance * 100)}%`} delay={1500} still={!play} className={cn("font-mono text-[18px] font-medium tnum", f.hitChance < 0.3 ? "text-warning" : "text-fg")} />
            <span>chance of reaching {money(f.target)} with the deals open today, at their category odds.</span>
            <Tooltip content="Exact, over every combination of these deals closing or not. It treats deals as independent, which flatters a bad quarter: one budget freeze can hit several at once.">
              <span tabIndex={0} className="cursor-help text-[12px] text-fg-3 underline decoration-dotted underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]">
                How this is computed
              </span>
            </Tooltip>
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border bg-bg-subtle/50 px-5 py-3 text-[12.5px] text-fg-3 sm:px-7">
        <span>
          {f.period.label} · <span className="font-mono tnum">{shortDay(f.period.start)}–{shortDay(f.period.end)}</span> ·{" "}
          <span className="font-mono tnum text-fg-2">{f.period.weeksLeft}</span> {f.period.weeksLeft === 1 ? "week" : "weeks"} left
        </span>
        {f.coverage !== null && (
          <Tooltip content={`Open pipeline closing this period ÷ the ${money(f.remaining)} still to close. Start a period at ${f.coverageNeeded}× until your own snapshots can measure what you need.`}>
            <span tabIndex={0} className="cursor-help rounded-[2px] outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]">
              Coverage <span className={cn("font-mono tnum", short ? "font-medium text-warning" : "text-fg-2")}>{f.coverage.toFixed(1)}×</span>
              <span className="text-fg-4"> / {f.coverageNeeded}× healthy</span>
            </span>
          </Tooltip>
        )}
        {f.next.coverage !== null && (
          <Tooltip content={`Pipeline already dated for ${shortDay(f.next.start)}–${shortDay(f.next.end)}, against a target the same size as this one.`}>
            <span tabIndex={0} className="cursor-help rounded-[2px] outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]">
              Next period <span className={cn("font-mono tnum", f.next.coverage < 1 ? "text-warning" : "text-fg-2")}>{f.next.coverage.toFixed(1)}×</span>
            </span>
          </Tooltip>
        )}
        {plan.verdict !== "no_target" && plan.verdict !== "hit" && (
          <span>
            New pipeline closes in time until <span className="font-mono tnum text-fg-2">{shortDay(plan.cutoff)}</span>
          </span>
        )}
        {f.creation.needPerWeek !== null && (
          <Tooltip content={`New deals started in the last four weeks (${f.creation.deals}), at their amounts or the typical deal, against what a same-size target next period needs each week at your win rate.`}>
            <span tabIndex={0} className="cursor-help rounded-[2px] outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]">
              Pipeline created{" "}
              <span className={cn("font-mono tnum", f.creation.perWeek < f.creation.needPerWeek * 0.8 ? "text-warning" : "text-fg-2")}>{money(f.creation.perWeek)}/wk</span>
              <span className="text-fg-4"> / {money(f.creation.needPerWeek)} needed</span>
            </span>
          </Tooltip>
        )}
        {f.dataTrust.open > 0 && (
          <Tooltip content={`${f.dataTrust.complete} of ${f.dataTrust.open} open deals have a current close date, an amount, a dated next step and two contacts. The forecast is only as good as these.`}>
            <span tabIndex={0} className="cursor-help rounded-[2px] outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]">
              Data trust <span className={cn("font-mono tnum", f.dataTrust.score < 50 ? "text-warning" : "text-fg-2")}>{f.dataTrust.score}%</span>
            </span>
          </Tooltip>
        )}
      </div>
    </section>
  );
}

function Stat({ label, value, note, swatch, tip }: { label: string; value: number; note: string; swatch?: string; tip?: string }) {
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
      <dd className="mt-1 font-mono text-[22px] font-medium leading-7 tracking-[-0.01em] text-fg">
        <Num value={value} format={USD} />
      </dd>
      <dd className="text-[12px] text-fg-3">{note}</dd>
    </div>
  );
}
