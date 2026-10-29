"use client";

import { ArrowDownRight, ArrowUpRight, CalendarClock, CircleDollarSign, Minus, Plus, Trophy, XCircle } from "lucide-react";
import Link from "next/link";
import { SectionLabel } from "@/components/ui/card";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/client/cn";
import { money, observedNote, shortDay, type Forecast, type ForecastChange, type RevenuePlan } from "@/lib/revenue/forecast";
import type { Observed } from "@/lib/revenue/stats";

function Rate({ o, unit, children }: { o: Observed; unit: string; children: React.ReactNode }) {
  return (
    <Tooltip content={observedNote(o, unit)}>
      <span
        tabIndex={0}
        className={cn(
          "cursor-help rounded-[2px] font-mono tnum outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
          o.source !== "observed" && "border-b border-dotted border-border-strong",
        )}
      >
        {children}
      </span>
    </Tooltip>
  );
}

function Step({ op, label, value, note, strong }: { op?: string; label: React.ReactNode; value: React.ReactNode; note?: React.ReactNode; strong?: boolean }) {
  return (
    <div className={cn("grid grid-cols-[20px_minmax(0,1fr)_auto] items-baseline gap-x-2 px-4 py-2.5 sm:px-5", strong && "bg-bg-subtle/60")}>
      <span aria-hidden className="font-mono text-[13px] text-fg-4">{op}</span>
      <span className={cn("text-[13.5px]", strong ? "font-medium text-fg" : "text-fg-2")}>
        {label}
        {note && <span className="block text-[12px] text-fg-3">{note}</span>}
      </span>
      <span className={cn("text-right font-mono text-[14px] tnum", strong ? "font-medium text-fg" : "text-fg-2")}>{value}</span>
    </div>
  );
}

/**
 * The plan behind the number, worked backward the way a Head of GTM does it on a Monday: what's left,
 * what open deals should bring in, and the deals, qualified opportunities and first meetings the rest
 * takes, by the date a new first meeting can still close inside the period. Dotted rates are starting
 * defaults until the workspace's own deals replace them.
 */
export function PlanView({ f, plan, onSetTarget }: { f: Forecast; plan: RevenuePlan; onSetTarget: () => void }) {
  if (plan.verdict === "no_target") {
    return (
      <section className="mt-12" aria-labelledby="plan-label">
        <SectionLabel>
          <span id="plan-label">What it takes</span>
        </SectionLabel>
        <div className="rounded-xl bg-surface px-5 py-6 ring-1 ring-inset ring-border">
          <p className="font-serif text-[19px] leading-[28px] text-fg">Give me the number and I&apos;ll work backward to the meetings it takes.</p>
          <p className="mt-1.5 max-w-[60ch] text-[13.5px] leading-[21px] text-fg-2">
            A target turns this page into a plan: the gap after expected wins, the deals and first meetings that close it, and the last date new pipeline can still land this period.
          </p>
          <button type="button" onClick={onSetTarget} className="mt-4 inline-flex h-8 items-center rounded-md bg-primary px-3 text-[13px] font-medium text-primary-fg shadow-btn hover:bg-primary-hover active:scale-[0.97]">
            Set a revenue target
          </button>
        </div>
      </section>
    );
  }
  if (plan.verdict === "hit") return null;

  const perWeek = plan.meetingsPerWeekNeeded;
  const pace = plan.meetingsPerWeekRecent;
  return (
    <section className="mt-12" aria-labelledby="plan-label">
      <SectionLabel right={<span className="text-[12px] text-fg-3">Dotted rates are starting defaults</span>}>
        <span id="plan-label">What it takes</span>
      </SectionLabel>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,300px)]">
        <div className="overflow-hidden rounded-xl bg-surface shadow-sm ring-1 ring-inset ring-border">
          <div className="divide-y divide-border">
            <Step label="Left to close this period" value={money(plan.remaining)} note={`${money(f.target)} target − ${money(f.closedWon.usd)} won`} />
            <Step op="−" label="Expected from open deals at their usual odds" value={money(plan.expected)} />
            <Step op="=" label="To find in new pipeline" value={money(plan.gap)} strong />
            {plan.gap > 0 && (
              <>
                <Step
                  op="÷"
                  label={
                    <>
                      A typical deal of <Rate o={plan.avgDeal} unit="won deals">{money(plan.avgDeal.value)}</Rate>
                    </>
                  }
                  value={`${plan.dealsNeeded} ${plan.dealsNeeded === 1 ? "deal" : "deals"}`}
                />
                <Step
                  op="÷"
                  label={
                    <>
                      Win rate <Rate o={plan.winRate} unit="closed deals">{Math.round(plan.winRate.value * 100)}%</Rate>
                    </>
                  }
                  value={`${plan.qualifiedNeeded} qualified`}
                />
                <Step
                  op="÷"
                  label={
                    <>
                      First meetings that qualify <Rate o={plan.meetingToQualified} unit="decided first meetings">{Math.round(plan.meetingToQualified.value * 100)}%</Rate>
                    </>
                  }
                  value={`${plan.meetingsNeeded} first meetings`}
                  strong
                />
                <Step
                  op="→"
                  label={
                    <>
                      By {shortDay(plan.cutoff)}, so they close inside a <Rate o={plan.cycleDays} unit="won deals">{Math.round(plan.cycleDays.value)}-day</Rate> cycle
                    </>
                  }
                  value={perWeek === null ? "Too late" : `${perWeek} a week`}
                  note={perWeek === null ? "New first meetings from here close next period. This period lives in the deals already open." : `You've averaged ${pace} a week over the last four weeks.`}
                  strong
                />
              </>
            )}
          </div>
        </div>
        <div>
          <p className="mb-2 text-[12px] font-medium text-fg-2">Ways to close the gap</p>
          {plan.levers.length ? (
            <ul className="space-y-2.5">
              {plan.levers.map((l) => (
                <li key={l} className="flex gap-2.5 text-[13px] leading-5 text-fg-2">
                  <span aria-hidden className="mt-[7px] size-1 shrink-0 rounded-full bg-fg-3" />
                  {l}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-fg-3">Open deals cover it at their usual odds. Protect them: every deal below should have a dated, buyer-agreed next step.</p>
          )}
          {plan.byChannel.length > 0 && (
            <div className="mt-5">
              <p className="mb-2 text-[12px] font-medium text-fg-2">
                The same {plan.dealsNeeded} {plan.dealsNeeded === 1 ? "deal" : "deals"} from one channel alone
              </p>
              <table className="w-full text-left text-[12.5px]">
                <caption className="sr-only">Top of funnel each channel would need on its own, at starting conversion rates</caption>
                <tbody className="divide-y divide-border">
                  {plan.byChannel.map((r) => (
                    <tr key={r.key}>
                      <th scope="row" className="py-1.5 pr-3 font-normal text-fg-2">{r.label}</th>
                      <td className="py-1.5 text-right font-mono tnum text-fg">
                        {r.topOfFunnel.toLocaleString("en-US")}
                        <span className="block font-sans text-[11px] text-fg-3">
                          {r.unit}
                          {r.perWeek !== null ? `, ${r.perWeek.toLocaleString("en-US")}/wk` : ""}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-1.5 text-[11.5px] leading-4 text-fg-4">Starting conversion rates per channel; they become yours as deals close.</p>
            </div>
          )}
          {plan.gap > 0 && perWeek !== null && pace < perWeek && (
            <p className="mt-4 text-[12.5px] leading-5 text-fg-3">
              More cold email isn&apos;t the lever: the cap protects your domain. Warm paths, customer referrals and events convert several times better.{" "}
              <Link href="/plays" className="font-medium text-fg-2 underline-offset-2 hover:text-fg hover:underline">
                See your plays
              </Link>
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

const CHANGE_ICON: Record<ForecastChange["kind"], typeof Plus> = {
  won: Trophy,
  lost: XCircle,
  new: Plus,
  pushed: CalendarClock,
  pulled: CalendarClock,
  up: ArrowUpRight,
  down: ArrowDownRight,
  amount: CircleDollarSign,
  dropped: Minus,
};

/** What moved in the forecast since last week's snapshot. Computed, never remembered. */
export function Changes({ changes, since }: { changes: ForecastChange[]; since?: string }) {
  return (
    <section className="mt-12" aria-labelledby="changes-label">
      <SectionLabel right={since ? <span className="text-[12px] text-fg-3">Since {shortDay(since)}</span> : undefined}>
        <span id="changes-label">What changed</span>
      </SectionLabel>
      {!since ? (
        <p className="rounded-lg bg-surface px-5 py-4 text-[13.5px] leading-[21px] text-fg-2 ring-1 ring-inset ring-border">
          I photograph the forecast on the first open of each week. From next week, every deal that moved, slipped, grew or shrank shows here, with what it did to commit.
        </p>
      ) : !changes.length ? (
        <p className="rounded-lg bg-surface px-5 py-4 text-[13.5px] text-fg-2 ring-1 ring-inset ring-border">Nothing moved since {shortDay(since)}. A still forecast is usually a stalled one: check the next steps below.</p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl bg-surface shadow-sm ring-1 ring-inset ring-border">
          {changes.map((c, i) => {
            const Icon = CHANGE_ICON[c.kind];
            const bad = c.kind === "lost" || c.kind === "down" || c.kind === "dropped" || (c.kind === "pushed" && c.deltaUsd < 0) || (c.kind === "amount" && c.deltaUsd < 0);
            return (
              <li key={`${c.dealId}-${c.kind}-${i}`} className="flex items-start gap-3 px-4 py-2.5 sm:px-5">
                <Icon aria-hidden className={cn("mt-0.5 size-4 shrink-0", bad ? "text-warning" : "text-fg-3")} />
                <span className="min-w-0 flex-1 text-[13.5px] leading-5 text-fg">{c.text}</span>
                {c.deltaUsd !== 0 && (
                  <span className={cn("shrink-0 font-mono text-[12.5px] tnum", c.deltaUsd < 0 ? "text-warning" : "text-fg-2")}>
                    {c.deltaUsd > 0 ? "+" : ""}
                    {money(c.deltaUsd)}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
