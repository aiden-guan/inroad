"use client";

import { X } from "lucide-react";
import { useState } from "react";
import { GrowthLogForm, PmfSurveyForm, VerdictList } from "@/components/consumer/growth-ui";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Button, IconButton } from "@/components/ui/button";
import { SectionLabel } from "@/components/ui/card";
import { cn } from "@/lib/client/cn";
import { shortDate } from "@/lib/client/format";
import { PMF_SURVEY } from "@/lib/consumer/benchmarks";
import { STAGE_LABELS, hasLoggedLastWeek, type FunnelStage, type GrowthRead } from "@/lib/consumer/growth";
import type { Workspace } from "@/lib/domain/types";

const STAGE_ORDER: FunnelStage[] = ["acquisition", "activation", "retention", "referral", "revenue"];

/**
 * Last week's numbers and what they say: logged every Monday, read in code. Rates hide below 20 signups, and paid
 * spend waits until retention clears the bar. `logging` opens the form (the header button and `?log=1` both do).
 */
export function Numbers({ ws, today, g, logging, onLogging }: { ws: Workspace; today: string; g: GrowthRead; logging: boolean; onLogging: (open: boolean) => void }) {
  const { dispatch } = useWorkspace();
  const [surveying, setSurveying] = useState(false);
  const recent = g.weeks.slice(-6).reverse();
  const repeat = g.model.retention.metric === "m3_repeat";
  const logged = hasLoggedLastWeek(ws, today);
  const stats: { label: string; value: string }[] = [];
  if (g.activationRate !== undefined) stats.push({ label: "Reach the first win", value: `${g.activationRate.toFixed(0)}%` });
  if (g.referredShare !== undefined) stats.push({ label: "From a friend", value: `${g.referredShare.toFixed(0)}%` });
  if (g.cac !== undefined) stats.push({ label: g.cacBasis === "paying" ? "Paid cost per customer" : "Paid cost per signup", value: `$${g.cac.toFixed(2)}` });
  if (g.paybackMonths !== undefined) stats.push({ label: "Payback", value: `${g.paybackMonths.toFixed(1)} mo` });
  if (g.pmf) stats.push({ label: `Very disappointed (${g.pmf.answers})`, value: `${g.pmf.score.toFixed(0)}%` });

  return (
    <section id="numbers" className="mt-12 scroll-mt-6" aria-labelledby="numbers-label">
      <SectionLabel
        right={
          !logging && (
            <Button size="sm" variant={logged ? "ghost" : "primary"} onClick={() => onLogging(true)}>
              {logged ? "Edit last week" : "Log last week"}
            </Button>
          )
        }
      >
        <span id="numbers-label">This week&apos;s read</span>
      </SectionLabel>

      <div className="overflow-hidden rounded-xl bg-surface shadow-sm ring-1 ring-inset ring-border">
        {logging && (
          <div className="relative border-b border-border bg-bg-subtle/40 px-5 py-5 sm:px-7">
            {g.latest && (
              <IconButton label="Close" onClick={() => onLogging(false)} className="absolute right-3 top-3">
                <X className="size-4" />
              </IconButton>
            )}
            <GrowthLogForm ws={ws} today={today} onSaved={() => onLogging(false)} />
          </div>
        )}

        <div className="px-5 py-5 sm:px-7">
          <div className="mb-5 flex flex-wrap items-center gap-1.5" aria-label="Funnel stages">
            {STAGE_ORDER.map((s) => (
              <span key={s} className={cn("rounded-full px-2.5 py-0.5 text-[12px] ring-1", s === g.focus ? "bg-bg-subtle font-medium text-fg ring-border-strong" : "text-fg-3 ring-border")}>
                {STAGE_LABELS[s]}
                {s === g.focus && <span className="ml-1 font-mono text-[10.5px] text-fg-3">focus</span>}
              </span>
            ))}
          </div>

          {stats.length > 0 && (
            <dl className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {stats.map((s) => (
                <div key={s.label} className="rounded-md bg-bg-subtle/60 px-3 py-2.5 ring-1 ring-inset ring-border">
                  <dt className="text-[11.5px] text-fg-3">{s.label}</dt>
                  <dd className="mt-0.5 font-mono text-[15px] font-medium tnum text-fg">{s.value}</dd>
                </div>
              ))}
            </dl>
          )}

          <VerdictList verdicts={g.verdicts} />

          {recent.length > 0 && (
            <div className="mt-5 overflow-x-auto rounded-lg ring-1 ring-inset ring-border">
              <table className="w-full min-w-[560px] text-left text-[12.5px]">
                <thead className="bg-bg-subtle text-fg-3">
                  <tr>
                    {["Week of", "Signups", "First win", "Active", repeat ? "Repeat %" : "Wk-4 %", "Paying", "Spend", "Top channel", ""].map((h) => (
                      <th key={h} scope="col" className="whitespace-nowrap px-3 py-2 font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border font-mono tnum">
                  {recent.map((w) => (
                    <tr key={w.weekOf}>
                      <td className="px-3 py-2">{shortDate(w.weekOf)}</td>
                      <td className="px-3 py-2">{w.signups}</td>
                      <td className="px-3 py-2">{w.activated ?? "—"}</td>
                      <td className="px-3 py-2">{w.active ?? "—"}</td>
                      <td className="px-3 py-2">{w.retainedPct ?? "—"}</td>
                      <td className="px-3 py-2">{w.paying ?? "—"}</td>
                      <td className="px-3 py-2">{w.spendUsd ? `$${w.spendUsd}` : "—"}</td>
                      <td className="max-w-[140px] truncate px-3 py-2 font-sans">{w.topChannel ?? "—"}</td>
                      <td className="px-2 py-1 text-right">
                        <IconButton label={`Remove the week of ${w.weekOf}`} onClick={() => void dispatch({ type: "growth.remove", weekOf: w.weekOf })} className="size-7">
                          <X className="size-3.5" />
                        </IconButton>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="border-t border-border bg-bg-subtle/50 px-5 py-3 sm:px-7">
          {surveying ? (
            <PmfSurveyForm onSaved={() => setSurveying(false)} />
          ) : (
            <button type="button" onClick={() => setSurveying(true)} className="text-[12.5px] text-fg-2 underline-offset-4 hover:text-fg hover:underline">
              Log a product-market fit survey ({PMF_SURVEY.threshold.value}% &ldquo;very disappointed&rdquo; is the line)
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
