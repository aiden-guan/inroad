"use client";

import { Target } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { useClock } from "@/components/today/use-today";
import { Button } from "@/components/ui/button";
import { LoadingSignal } from "@/components/ui/loading";
import { PageHeader } from "@/components/ui/page-header";
import { isConsumer } from "@/lib/consumer/market";
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

  if (!ws || !data) return <LoadingSignal label="Calling the forecast" className="min-h-[60dvh]" />;
  const { f, plan, base, changes } = data;
  const target = ws.revenue?.target;

  return (
    <div className="page-shell max-w-[1080px]">
      <PageHeader
        title="Revenue"
        eyebrow="The number"
        description={
          target ? (
            <>
              {target.label}: <span className="font-mono tnum text-fg">{money(target.amountUsd)}</span>. Commit <span className="font-mono tnum text-fg">{money(f.commit)}</span>, best case{" "}
              <span className="font-mono tnum text-fg">{money(f.bestCase)}</span>. The forecast is counted from your deals. Connected sources keep your business metrics up to date.
            </>
          ) : (
            "Your business metrics from connected sources, alongside the forecast called from your deals: commit, best case and pipeline, what's at risk and what it takes."
          )
        }
        actions={
          <Button variant={target ? "secondary" : "primary"} icon={<Target className="size-4" />} onClick={() => setTargetOpen(true)}>
            {target ? `${target.label} · ${money(target.amountUsd)}` : "Set a revenue target"}
          </Button>
        }
      />

      {isConsumer(ws) && (
        <p className="mt-6 rounded-md bg-bg-subtle px-3 py-2.5 text-[13px] leading-5 text-fg-2">
          Revenue calls a business&apos;s deals. You&apos;re set up as a consumer company, so your number lives on{" "}
          <Link href="/growth" className="text-fg underline underline-offset-2">
            Growth
          </Link>
          .
        </p>
      )}

      <BusinessMetrics />
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
