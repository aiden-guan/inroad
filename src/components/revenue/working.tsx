"use client";

import { Badge } from "@/components/ui/badge";
import { SectionLabel } from "@/components/ui/card";
import { Tooltip } from "@/components/ui/tooltip";
import { ROLE_LABELS, SIGNAL_LABELS } from "@/components/playbook/model";
import { cn } from "@/lib/client/cn";
import type { Workspace } from "@/lib/domain/types";
import { byPersona, bySignal, bySource, lossReasons, type TouchRow } from "@/lib/revenue/attribution";
import { money, type Forecast } from "@/lib/revenue/forecast";

const SAMPLE_NOTE = {
  anecdote: "Under 20: an anecdote, not a rate.",
  directional: "20–99: directional.",
  reliable: "100+: reliable.",
} as const;

function Frac({ n, of, sample }: { n: number; of: number; sample?: TouchRow["sample"] }) {
  const text = (
    <span className="font-mono tnum">
      {n}
      <span className="text-fg-4">/{of}</span>
    </span>
  );
  if (!sample) return text;
  return (
    <Tooltip content={`${of ? Math.round((n / of) * 100) : 0}% · ${SAMPLE_NOTE[sample]}`}>
      <span tabIndex={0} className="cursor-help rounded-[2px] outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]">
        {text}
      </span>
    </Tooltip>
  );
}

/**
 * What's working, counted in code: where deals come from and how they convert, which why-now signals and
 * personas answer, and what the losses say to change. Small numbers are shown as counts, not rates.
 */
export function Working({ ws, f }: { ws: Workspace; f: Forecast }) {
  const sources = bySource(ws, f.stats);
  const signals = bySignal(ws, SIGNAL_LABELS).filter((r) => r.touched > 0);
  const personas = byPersona(ws, ROLE_LABELS).filter((r) => r.touched > 0 && r.key !== "none");
  const losses = lossReasons(ws, f.stats);
  // One reason behind 30% or more of at least five losses is a pattern, not bad luck (docs/research/12 §F4).
  const lossTotal = losses.reduce((n, l) => n + l.count, 0);
  if (!sources.length && !signals.length) return null;

  return (
    <section className="mt-12" aria-labelledby="working-label">
      <SectionLabel right={<span className="text-[12px] text-fg-3">Counts until there&apos;s enough to call a rate</span>}>
        <span id="working-label">What&apos;s working</span>
      </SectionLabel>

      {sources.length > 0 && (
        <div className="overflow-x-auto rounded-xl bg-surface shadow-sm ring-1 ring-inset ring-border">
          <table className="w-full min-w-[620px] text-left text-[13px]">
            <caption className="sr-only">Deals by where they came from</caption>
            <thead>
              <tr className="border-b border-border text-[11.5px] text-fg-3">
                <th scope="col" className="px-4 py-2 font-medium">Where deals come from</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Deals</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Qualified</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Won of closed</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Won</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Open</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">Cycle</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sources.map((r) => (
                <tr key={r.key}>
                  <th scope="row" className="px-4 py-2.5 font-medium text-fg">{r.label}</th>
                  <td className="px-3 py-2.5 text-right font-mono tnum text-fg-2">{r.deals}</td>
                  <td className="px-3 py-2.5 text-right text-fg-2">
                    <Frac n={r.qualified} of={r.deals} />
                  </td>
                  <td className="px-3 py-2.5 text-right text-fg-2">{r.winRate ? <Frac n={r.won} of={r.winRate.n} sample={r.winRate.n >= 100 ? "reliable" : r.winRate.n >= 20 ? "directional" : "anecdote"} /> : <span className="text-fg-4">—</span>}</td>
                  <td className="px-3 py-2.5 text-right font-mono tnum text-fg">{r.wonUsd ? money(r.wonUsd) : <span className="text-fg-4">—</span>}</td>
                  <td className="px-3 py-2.5 text-right font-mono tnum text-fg-2">{r.openUsd ? money(r.openUsd) : <span className="text-fg-4">—</span>}</td>
                  <td className="px-4 py-2.5 text-right font-mono tnum text-fg-3">{r.cycleDays !== null ? `${Math.round(r.cycleDays)}d` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        {signals.length > 0 && <TouchTable title="Which why-now signals get answers" rows={signals} />}
        {personas.length > 0 && <TouchTable title="Which personas answer" rows={personas} />}
      </div>

      {losses.length > 0 && (
        <div className="mt-5 rounded-xl bg-surface px-4 py-3 shadow-sm ring-1 ring-inset ring-border sm:px-5">
          <p className="mb-1 text-[12px] font-medium text-fg-2">Why deals are lost</p>
          <ul className="divide-y divide-border">
            {losses.map((l) => (
              <li key={l.reason} className="flex flex-col gap-0.5 py-2 sm:flex-row sm:items-baseline sm:gap-4">
                <span className="flex w-52 shrink-0 items-center gap-1.5 text-[13px] font-medium text-fg">
                  {l.label} <span className="font-mono text-[12px] tnum text-fg-3">×{l.count}</span>
                  {lossTotal >= 5 && l.count / lossTotal >= 0.3 && <Badge tone="warning">Pattern</Badge>}
                </span>
                <span className="flex-1 text-[12.5px] leading-5 text-fg-3">{l.count >= 2 ? l.lesson : `One loss. ${l.lesson}`}</span>
                {l.usd > 0 && <span className="font-mono text-[12px] tnum text-fg-3">{money(l.usd)}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function TouchTable({ title, rows }: { title: string; rows: TouchRow[] }) {
  return (
    <div className="overflow-x-auto rounded-xl bg-surface shadow-sm ring-1 ring-inset ring-border">
      <table className="w-full min-w-[360px] text-left text-[13px]">
        <caption className="sr-only">{title}</caption>
        <thead>
          <tr className="border-b border-border text-[11.5px] text-fg-3">
            <th scope="col" className="px-4 py-2 font-medium">{title}</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Replied</th>
            <th scope="col" className="px-4 py-2 text-right font-medium">Became deals</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.slice(0, 6).map((r) => (
            <tr key={r.key}>
              <th scope="row" className={cn("px-4 py-2.5 font-medium", r.key === "none" ? "text-fg-3" : "text-fg")}>{r.label}</th>
              <td className="px-3 py-2.5 text-right text-fg-2">
                <Frac n={r.replied} of={r.touched} sample={r.sample} />
              </td>
              <td className="px-4 py-2.5 text-right text-fg-2">
                <Frac n={r.meetings} of={r.touched} sample={r.sample} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
