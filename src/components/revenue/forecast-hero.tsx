"use client";

import type { CSSProperties, ReactNode } from "react";
import { AiBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DigitPop, TextReveal, fx } from "@/components/ui/fx";
import { Num } from "@/components/ui/misc";
import { Orb } from "@/components/ui/orb";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/client/cn";
import { money, shortDay, type Forecast, type RevenuePlan } from "@/lib/revenue/forecast";
import { quarterOf } from "@/lib/revenue/stats";

const USD = { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 } as const;

/**
 * Blue pencil carries the forecast data. Each measure has one
 * swatch, and the bar and the figures under it use the same one. The measures are running totals, so each band
 * starts at zero: pipeline holds best case, best case holds commit, commit holds closed won.
 */
const SWATCH = {
  pipeline: "bg-accent/10 ring-1 ring-inset ring-accent/20",
  best: "bg-accent/30",
  commit: "bg-accent/65",
  won: "bg-accent",
} as const;

const TIP_TRIGGER = "cursor-help rounded-[2px] underline decoration-dotted decoration-fg-4 underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]";

/** A label pinned to a point on the bar, on whichever side of it has room. */
function Pin({ at, children, className, style }: { at: number; children: ReactNode; className?: string; style?: CSSProperties }) {
  const right = at > 0.6;
  return (
    <span
      className={cn("absolute top-0 whitespace-nowrap font-mono text-[11.5px] tnum", right ? "-translate-x-full pr-1.5 text-right" : "pl-1.5", className)}
      style={{ left: `${Math.min(100, Math.max(0, at * 100))}%`, ...style }}
    >
      {children}
    </span>
  );
}

/**
 * The bullet chart: the bands are pipeline, best case and commit (each a running total from zero), the solid bar
 * is closed won, the tall line is the target, the dashed notch is the call, and the hatching between the call and
 * the target is the gap. A sentence carries the same numbers for screen readers.
 */
function BulletChart({ f, play }: { f: Forecast; play: boolean }) {
  const scale = Math.max(f.target, f.pipeline, f.call, 1) * 1.06;
  const pos = (n: number) => Math.min(1, Math.max(0, n / scale));
  const pct = (n: number) => `${pos(n) * 100}%`;
  const gap = f.hasTarget ? f.target - f.call : 0;
  const bands = [
    { key: "pipeline", value: f.pipeline },
    { key: "best", value: f.bestCase },
    { key: "commit", value: f.commit },
  ] as const;
  const said = [
    `Closed won ${money(f.closedWon.usd)}`,
    `commit ${money(f.commit)}`,
    `best case ${money(f.bestCase)}`,
    `pipeline ${money(f.pipeline)}`,
  ].join(", ");
  const label = `${f.period.label}: ${said}. The call is ${money(f.call)}${f.hasTarget ? ` against a ${money(f.target)} target, ${gap > 0 ? `${money(gap)} short` : `${money(-gap)} over`}` : ""}.`;
  // Labels stay put once drawn; on the first look they arrive after the bar (the motion kit settles them for reduced motion).
  const late = (delay: number) => (play ? fx(0, delay) : undefined);

  return (
    <figure role="img" aria-label={label} className="mt-7">
      {/* Labels pin to their markers from sm up; on a phone they sit in one line under the bar, where they fit. */}
      <div aria-hidden className="relative hidden h-5 sm:block">
        {f.hasTarget && (
          <Pin at={pos(f.target)} className={cn("text-fg-2", play && "fx-rise")} style={late(1150)}>
            Target {money(f.target)}
          </Pin>
        )}
      </div>
      <div aria-hidden className="relative h-12 sm:mt-1">
        <div className="absolute inset-0 overflow-hidden rounded-md bg-bg-subtle ring-1 ring-inset ring-border">
          {bands.map((b, i) =>
            b.value > 0 ? (
              <div
                key={b.key}
                className={cn("absolute inset-y-0 left-0", SWATCH[b.key], play && "fx-wipe")}
                style={{ width: pct(b.value), ...(play ? fx(0, 150 + i * 170, { animationDuration: "820ms" }) : {}) }}
              />
            ) : null,
          )}
          {f.closedWon.usd > 0 && (
            <div className={cn("absolute left-0 top-1/2 h-[34%] -translate-y-1/2 rounded-r-[2px] bg-accent", play && "fx-wipe")} style={{ width: pct(f.closedWon.usd), ...(play ? fx(0, 700, { animationDuration: "700ms" }) : {}) }} />
          )}
          {gap > 0 && (
            <div
              className={cn("absolute inset-y-0 bg-[repeating-linear-gradient(135deg,transparent_0_5px,rgb(127_127_127/0.3)_5px_6px)]", play && "fx-rise")}
              style={{ left: pct(f.call), width: `calc(${pct(f.target)} - ${pct(f.call)})`, ...late(1250) }}
            />
          )}
        </div>
        <div className="absolute -bottom-1 -top-1" style={{ left: pct(f.call) }}>
          <div className={cn("h-full -translate-x-1/2 border-l-2 border-dashed border-fg", play && "fx-drop")} style={late(1050)} />
        </div>
        {f.hasTarget && (
          <div className="absolute -bottom-2 -top-2" style={{ left: pct(f.target) }}>
            <div className={cn("h-full w-[3px] -translate-x-1/2 rounded-full bg-fg shadow-[0_0_0_2px_var(--surface)]", play && "fx-drop")} style={late(1150)} />
          </div>
        )}
      </div>
      <div aria-hidden className="relative mt-2.5 hidden h-5 sm:block">
        <Pin at={pos(f.call)} className={cn("text-fg", play && "fx-rise")} style={late(1300)}>
          The call {money(f.call)}
          {gap > 0 && <span className="text-fg-3"> · {money(gap)} short</span>}
        </Pin>
      </div>
      <div aria-hidden className={cn("mt-2.5 flex flex-wrap justify-between gap-x-4 gap-y-1 font-mono text-[11.5px] tnum sm:hidden", play && "fx-rise")} style={late(1300)}>
        <span className="text-fg">
          The call {money(f.call)}
          {gap > 0 && <span className="text-fg-3"> · {money(gap)} short</span>}
        </span>
        {f.hasTarget && <span className="text-fg-2">Target {money(f.target)}</span>}
      </div>
    </figure>
  );
}

/**
 * The number, the way it's called in a forecast meeting: what's closed, what's committed, what's possible, against
 * the target. The sentence above the bar is the plan's headline: what it takes.
 */
export function ForecastHero({ f, plan, onSetTarget, onDataQuality }: { f: Forecast; plan: RevenuePlan; onSetTarget: () => void; onDataQuality: () => void }) {
  // Financial values appear immediately; the chart retains its true initial geometry.
  const play = false;
  const rolled = true;
  const short = f.hasTarget && f.coverage !== null && f.coverage < f.coverageNeeded;
  const of = (n: number) => `${Math.round((n / f.target) * 100)}% of target`;
  const q = quarterOf(f.period.start);
  const quarterly = q.start === f.period.start && q.end === f.period.end;

  return (
    <section id="forecast" aria-label="Forecast" className="forecast-progress mt-8 scroll-mt-6 overflow-hidden rounded-xl ring-1 ring-inset ring-border">
      <div className="px-5 pb-6 pt-5 sm:px-7 sm:pt-6">
        <div className="mb-5 flex items-center justify-between gap-3 text-[12px] text-fg-3"><span className="font-medium text-fg-2">Revenue outlook</span><span>{f.period.label}</span></div>
        <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-5">
          <div>
            <p className="text-[12px] text-fg-3">Expected revenue <Tooltip content="Closed won, plus open deals at their forecast category odds. Estimates, rather than guaranteed revenue."><span tabIndex={0} className={cn(TIP_TRIGGER, "ml-1")}>The call</span></Tooltip></p>
            <p className="mt-1 text-[40px] font-medium leading-[48px] tracking-[-0.045em] tnum"><Num value={f.call} format={USD} /></p>
            <p className="mt-1 text-[12px] text-fg-3">{f.hasTarget ? `${Math.round((f.call / f.target) * 100)}% of ${money(f.target)} target` : "Weighted from the deals on file"}</p>
          </div>
          <div className="max-w-[48ch] border-l-2 border-accent/30 pl-4">
            <div className="mb-2 flex items-center gap-2 text-[12px] text-fg-3"><Orb size={14} state={plan.verdict === "behind" || plan.verdict === "too_late" ? "needs" : "idle"} /><span className="font-medium text-fg-2">Where to focus</span><AiBadge /></div>
            <p className="text-pretty font-serif text-[19px] leading-[27px] text-fg"><TextReveal text={plan.headline} play={false} /></p>
            {f.hasTarget && plan.gap > 0 && <p className="mt-2 text-[11.5px] leading-4 text-fg-3">Plan based on {money(f.weighted)} in stage-weighted revenue.</p>}
          </div>
        </div>
        {!f.hasTarget && (
          <Button size="sm" variant="primary" className="mt-4" onClick={onSetTarget}>
            {f.ended ? `Set the ${f.period.label} target` : "Set a revenue target"}
          </Button>
        )}

        <BulletChart f={f} play={play} />

        <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-5 border-t border-border pt-5 sm:grid-cols-4">
          <Stat label="Closed won" swatch={SWATCH.won} value={rolled ? f.closedWon.usd : 0} note={`${f.closedWon.deals.length} ${f.closedWon.deals.length === 1 ? "deal" : "deals"}`} tip="Deals won inside the period." />
          <Stat
            label="Commit"
            swatch={SWATCH.commit}
            value={rolled ? f.commit : 0}
            note={f.hasTarget ? of(f.commit) : "Won plus commit deals"}
            tip="The floor: closed won plus deals that pass every commit test (economic buyer engaged, paper process known, a buyer-agreed step within two weeks, a firm close date)."
          />
          <Stat label="Best case" swatch={SWATCH.best} value={rolled ? f.bestCase : 0} note={f.hasTarget ? of(f.bestCase) : "Commit plus best-case deals"} tip="The ceiling: commit plus the deals that could still close this period." />
          <Stat label="Pipeline" swatch={SWATCH.pipeline} value={rolled ? f.pipeline : 0} note={`Worth ${money(f.weighted)} at stage odds`} tip="Closed won plus every open deal dated to close this period." />
        </dl>
        {f.hitChance !== null && f.remaining > 0 && (
          <p className="mt-5 flex flex-wrap items-baseline gap-x-2 border-t border-border pt-4 text-[13px] text-fg-2">
            <DigitPop text={`${Math.round(f.hitChance * 100)}%`} delay={1500} still={!play} className={cn("font-mono text-[18px] font-medium tnum", f.hitChance < 0.3 ? "text-warning" : "text-fg")} />
            <span>chance of reaching {money(f.target)} with the deals open today, at their category odds.</span>
            <Tooltip content="Exact, over every combination of these deals closing or not. It treats deals as independent, which flatters a bad quarter: one budget freeze can hit several at once.">
              <span tabIndex={0} className={cn(TIP_TRIGGER, "text-[12px] text-fg-3")}>
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
          <Tooltip content={`Open pipeline closing this period, divided by the ${money(f.remaining)} still to close. Start a period near ${f.coverageNeeded}× until your own history shows what you need.`}>
            <span tabIndex={0} className={TIP_TRIGGER}>
              Pipeline covers <span className={cn("font-mono tnum", short ? "font-medium text-warning" : "text-fg-2")}>{f.coverage.toFixed(1)}×</span> what&apos;s left
              <span className="text-fg-4"> · aim for {f.coverageNeeded}×</span>
            </span>
          </Tooltip>
        )}
        {(f.hasTarget || f.next.pipeline > 0) && (
          <Tooltip content={`Open deals dated ${shortDay(f.next.start)}–${shortDay(f.next.end)}.${f.next.coverage !== null ? ` Against a target the same size as this one, that's ${f.next.coverage.toFixed(1)}×.` : ""}`}>
            <span tabIndex={0} className={TIP_TRIGGER}>
              Lined up for next {quarterly ? "quarter" : "period"} <span className={cn("font-mono tnum", (f.next.coverage ?? 1) < 1 ? "text-warning" : "text-fg-2")}>{money(f.next.pipeline)}</span>
            </span>
          </Tooltip>
        )}
        {plan.verdict !== "no_target" && plan.verdict !== "hit" && plan.cutoff >= f.today && (
          <span>
            New deals can still close this period if they start by <span className="font-mono tnum text-fg-2">{shortDay(plan.cutoff)}</span>
          </span>
        )}
        {f.creation.needPerWeek !== null && (
          <Tooltip content={`Deals started in the last four weeks (${f.creation.deals}), at their amounts or the typical deal, against what a same-size target next period needs each week at your win rate.`}>
            <span tabIndex={0} className={TIP_TRIGGER}>
              New pipeline <span className={cn("font-mono tnum", f.creation.perWeek < f.creation.needPerWeek * 0.8 ? "text-warning" : "text-fg-2")}>{money(f.creation.perWeek)}</span> a week
              <span className="text-fg-4"> · {money(f.creation.needPerWeek)} needed</span>
            </span>
          </Tooltip>
        )}
        {f.dataTrust.open > 0 && (
          <Tooltip content="A deal is fully filled in with a current close date, an amount, a dated next step and two contacts. The forecast is only as good as these.">
            <button type="button" onClick={onDataQuality} className={cn(TIP_TRIGGER, "cursor-pointer text-left hover:text-fg-2")}>
              Fully filled in <span className={cn("font-mono tnum", f.dataTrust.score < 50 ? "text-warning" : "text-fg-2")}>{f.dataTrust.complete} of {f.dataTrust.open}</span> deals
            </button>
          </Tooltip>
        )}
      </div>
    </section>
  );
}

function Stat({ label, value, note, swatch, marker, tip }: { label: string; value: number; note: string; swatch?: string; marker?: boolean; tip: string }) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1.5 text-[12px] text-fg-3">
        {marker ? <span aria-hidden className="h-3 w-0 border-l-2 border-dashed border-fg" /> : <span aria-hidden className={cn("size-2.5 shrink-0 rounded-[2px]", swatch)} />}
        <Tooltip content={tip}>
          <span tabIndex={0} className={TIP_TRIGGER}>
            {label}
          </span>
        </Tooltip>
      </dt>
      <dd className="mt-1 font-mono text-[22px] font-medium leading-7 tracking-[-0.01em] text-fg">
        <Num value={value} format={USD} />
      </dd>
      <dd className="text-[12px] text-fg-3">{note}</dd>
    </div>
  );
}
