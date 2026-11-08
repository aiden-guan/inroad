"use client";

import { Target } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { useClock } from "@/components/today/use-today";
import { Button } from "@/components/ui/button";
import { LoadingSignal } from "@/components/ui/loading";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/misc";
import { todayISO } from "@/lib/domain/ids";
import { baseline, computeForecast, computePlan, forecastChanges, money } from "@/lib/revenue/forecast";
import { DealCalls } from "./deal-calls";
import { ForecastHero } from "./forecast-hero";
import { Changes, PlanView } from "./plan-view";
import { TargetDialog } from "./target-dialog";
import { WeeklyUpdate } from "./weekly-update";
import { Working } from "./working";
import { BusinessMetrics } from "./business-metrics";

/**
 * Revenue: the number a Head of GTM is measured on, called the way a forecast meeting calls it.
 * Everything here is computed in code from the deals on file (zero tokens): the call, coverage, what
 * changed since last week, each deal's risks, the plan behind the gap and what's working. The only model
 * call is the weekly update, and only when asked.
 */
export function RevenuePage() {
  const { ws, error, refresh } = useWorkspace();
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

  if (!ws || !data) return error ? <div className="page-shell"><EmptyState title="Couldn't load revenue" body={error} action={<Button variant="primary" onClick={() => void refresh()}>Try again</Button>} /></div> : <LoadingSignal label="Calling the forecast" className="min-h-[60dvh]" />;
  const { f, plan, base, changes } = data;
  const target = ws.revenue?.target;

  return (
    <div className="page-shell">
      <PageHeader
        title="Revenue"
        eyebrow="Growth overview"
        description={
          target ? (
            <>
              A clear view of {target.label}, the deals behind your forecast, and where to focus next.
            </>
          ) : (
            "Your business metrics, the deals behind your forecast, and where to focus next."
          )
        }
        actions={
          <Button variant={target ? "secondary" : "primary"} icon={<Target className="size-4" />} onClick={() => setTargetOpen(true)}>
            {target ? `${target.label} · ${money(target.amountUsd)}` : "Set a revenue target"}
          </Button>
        }
      />

      <ForecastHero f={f} plan={plan} />
      <Changes changes={changes} since={base?.weekOf} />
      <div className="mt-8"><BusinessMetrics /></div>
      <DealCalls f={f} focus={params.get("d")} />
      <PlanView f={f} plan={plan} onSetTarget={() => setTargetOpen(true)} />
      <Working ws={ws} f={f} />
      <WeeklyUpdate ws={ws} today={today} />

      {targetOpen && <TargetDialog open={targetOpen} onOpenChange={setTargetOpen} today={today} stats={f.stats} />}
    </div>
  );
}
