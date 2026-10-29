"use client";

import { Target } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { useClock } from "@/components/today/use-today";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/misc";
import { todayISO } from "@/lib/domain/ids";
import { baseline, computeForecast, computePlan, forecastChanges, money } from "@/lib/revenue/forecast";
import { DealCalls } from "./deal-calls";
import { ForecastHero } from "./forecast-hero";
import { Changes, PlanView } from "./plan-view";
import { TargetDialog } from "./target-dialog";
import { WeeklyUpdate } from "./weekly-update";
import { Working } from "./working";

/**
 * Revenue: the number a Head of GTM is measured on, called the way a forecast meeting calls it.
 * Everything here is computed in code from the deals on file (zero tokens): the call, coverage, what
 * changed since last week, each deal's risks, the plan behind the gap and what's working. The only model
 * call is the weekly update, and only when asked.
 */
export function RevenuePage() {
  const { ws } = useWorkspace();
  const now = useClock(60_000);
  const params = useSearchParams();
  const [targetOpen, setTargetOpen] = useState(params.get("target") === "1");
  const today = todayISO(new Date(now));

  const data = useMemo(() => {
    if (!ws) return null;
    const f = computeForecast(ws, today);
    const plan = computePlan(ws, f, new Date(now));
    const base = baseline(ws, today);
    return { f, plan, base, changes: forecastChanges(ws, base, f) };
  }, [ws, today, now]);

  if (!ws || !data) return <RevenueSkeleton />;
  const { f, plan, base, changes } = data;
  const target = ws.revenue?.target;

  return (
    <div className="mx-auto w-full px-6 pb-28 pt-8 md:px-10 md:pt-12 max-w-[1080px]">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0 flex-1 basis-64">
          <h1 className="font-serif text-[32px] leading-[36px] tracking-[-0.02em]">Revenue</h1>
          <p className="mt-1.5 max-w-[60ch] text-[14px] leading-[21px] text-fg-2">
            {target ? (
              <>
                {target.label}: <span className="font-mono tnum text-fg">{money(target.amountUsd)}</span>. Commit <span className="font-mono tnum text-fg">{money(f.commit)}</span>, best case{" "}
                <span className="font-mono tnum text-fg">{money(f.bestCase)}</span>. Every number here is counted from your deals, not estimated by a model.
              </>
            ) : (
              "The forecast called from your deals: commit, best case and pipeline, what changed, what's at risk and what it takes. All computed from your deals."
            )}
          </p>
        </div>
        <Button variant={target ? "secondary" : "primary"} icon={<Target className="size-4" />} onClick={() => setTargetOpen(true)}>
          {target ? `${target.label} · ${money(target.amountUsd)}` : "Set a revenue target"}
        </Button>
      </header>

      <ForecastHero f={f} plan={plan} />
      <Changes changes={changes} since={base?.weekOf} />
      <DealCalls f={f} focus={params.get("d")} />
      <PlanView f={f} plan={plan} onSetTarget={() => setTargetOpen(true)} />
      <Working ws={ws} f={f} />
      <WeeklyUpdate ws={ws} today={today} />

      {targetOpen && <TargetDialog open={targetOpen} onOpenChange={setTargetOpen} today={today} stats={f.stats} />}
    </div>
  );
}

function RevenueSkeleton() {
  return (
    <div aria-busy className="mx-auto w-full px-6 pb-28 pt-8 md:px-10 md:pt-12 max-w-[1080px]">
      <Skeleton className="h-9 w-40" />
      <Skeleton className="mt-3 h-4 w-full max-w-md" />
      <Skeleton className="mt-8 h-72 w-full rounded-xl" />
    </div>
  );
}
