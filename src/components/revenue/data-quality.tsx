"use client";

import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { SectionLabel } from "@/components/ui/card";
import { Favicon } from "@/components/ui/favicon";
import { cn } from "@/lib/client/cn";
import type { Workspace } from "@/lib/domain/types";
import { localDate } from "@/lib/moves/util";
import { dealGaps, GAP_LABELS, money, shortDay, type Forecast } from "@/lib/revenue/forecast";

const SHOWN = 8;

const UNKNOWN_LABELS: Record<string, string> = {
  created: "created dates",
  stage_date: "dates for entering the current stage",
  activity: "last-activity dates",
  contacts: "contacts",
  source: "where each deal came from",
};

/**
 * Data quality: how many open deals carry what the forecast needs, which ones don't and what each is missing, and
 * what a file import couldn't say. Counted in code from the deals on file.
 */
export function DataQuality({ ws, f }: { ws: Workspace; f: Forecast }) {
  const [all, setAll] = useState(false);
  const rows = f.calls
    .map((c) => ({ c, gaps: dealGaps(c, f.today) }))
    .filter((r) => r.gaps.length)
    .sort((a, b) => b.c.amount.usd - a.c.amount.usd || a.c.deal.name.localeCompare(b.c.deal.name));
  const shown = all ? rows : rows.slice(0, SHOWN);

  // Each file import, once: when, how many deals, and what the file had no column for.
  const files = new Map<string, { from: string; at: string; deals: number; unknown: Set<string> }>();
  for (const d of Object.values(ws.deals)) {
    if (!d.imported) continue;
    const key = `${d.imported.from}|${d.imported.at.slice(0, 10)}`;
    const hit = files.get(key) ?? { from: d.imported.from, at: d.imported.at, deals: 0, unknown: new Set<string>() };
    hit.deals++;
    for (const u of d.imported.unknown ?? []) if (u !== "stage_date" || d.imported.stage !== "talking") hit.unknown.add(u);
    files.set(key, hit);
  }

  return (
    <section aria-labelledby="data-quality-title">
      <SectionLabel right={<span className="text-[12px] text-fg-3">A deal needs a current close date, an amount, a dated next step and two contacts</span>}>
        <span id="data-quality-title">Data quality</span>
      </SectionLabel>
      <div className="overflow-hidden rounded-xl bg-surface shadow-sm ring-1 ring-inset ring-border">
        <p className="border-b border-border px-5 py-4 text-[13.5px] leading-[21px] text-fg-2">
          <span className="font-mono text-[20px] tnum text-fg">{f.dataTrust.complete}</span> of <span className="font-mono tnum text-fg">{f.dataTrust.open}</span> open deals are fully filled in.{" "}
          {rows.length ? "The forecast is only as good as the rest; these are the gaps, largest deals first." : f.dataTrust.open ? "Nothing missing." : "No open deals yet."}
        </p>
        {rows.length > 0 && (
          <ul className="divide-y divide-border">
            {shown.map(({ c, gaps }) => (
              <li key={c.deal.id} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:gap-4">
                <div className="flex min-w-0 flex-1 items-center gap-2.5">
                  <Favicon domain={c.deal.accountDomain} name={c.deal.name} size={16} />
                  <span className="min-w-0 truncate text-[13.5px] font-medium text-fg">{c.deal.name}</span>
                  <span className="shrink-0 font-mono text-[12px] tnum text-fg-3">
                    {money(c.amount.usd)}
                    {c.amount.source === "average" && " est."}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 pl-[26px] sm:pl-0">
                  {gaps.map((g) => (
                    <span key={g} className={cn("rounded-xs px-1.5 py-0.5 text-[12px] ring-1 ring-inset", g === "close_passed" || g === "next_step_overdue" ? "bg-warning-subtle text-warning ring-transparent" : "bg-bg-subtle text-fg-2 ring-border")}>
                      {GAP_LABELS[g]}
                    </span>
                  ))}
                  <Link href={`/companies?c=${encodeURIComponent(c.deal.accountDomain)}`} className="inline-flex min-h-7 items-center gap-1 rounded-sm px-1.5 text-[12.5px] font-medium text-fg-2 hover:text-fg">
                    Fill in <ArrowUpRight className="size-3 opacity-60" aria-hidden />
                    <span className="sr-only">{c.deal.name}</span>
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
        {rows.length > SHOWN && (
          <button type="button" onClick={() => setAll((v) => !v)} className="w-full border-t border-border px-5 py-2.5 text-left text-[12.5px] font-medium text-fg-2 hover:bg-bg-subtle/50 hover:text-fg">
            {all ? "Show fewer" : `Show all ${rows.length}`}
          </button>
        )}
      </div>
      {files.size > 0 && (
        <ul className="mt-3 space-y-1.5 px-1 text-[12px] leading-[18px] text-fg-3">
          {[...files.values()].map((file) => (
            <li key={`${file.from}${file.at}`}>
              {file.deals} {file.deals === 1 ? "deal" : "deals"} came from {file.from} on {shortDay(localDate(file.at))}.
              {file.unknown.size > 0 && ` The file had no ${[...file.unknown].map((u) => UNKNOWN_LABELS[u] ?? u).join(", ")}, so checks that need them count from the import or say they can't tell.`}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
