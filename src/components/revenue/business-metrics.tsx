"use client";

import { ArrowUpRight, Plug, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { MetricValues } from "@/components/integrations/metric-values";
import { Ago, ToolMark } from "@/components/integrations/parts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionLabel } from "@/components/ui/card";
import { METRIC_PROVIDERS } from "@/lib/metrics/catalog";
import { METRIC_PROVIDER_IDS } from "@/lib/metrics/types";

export function BusinessMetrics({ mode = "revenue" }: { mode?: "revenue" | "growth" }) {
  const { ws, refresh } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!ws) return null;
  const connected = METRIC_PROVIDER_IDS.filter((id) => ws.integrations[id]?.enabled);

  async function sync() {
    setBusy(true);
    setError(null);
    const failures: string[] = [];
    await Promise.all(connected.map(async (id) => {
      try {
        const res = await fetch(`/api/metrics/${id}/sync`, { method: "POST" });
        const body = await res.json();
        if (!res.ok) failures.push(body.error ?? `${METRIC_PROVIDERS[id].name} couldn't sync.`);
      } catch { failures.push(`${METRIC_PROVIDERS[id].name} couldn't sync. Check your connection.`); }
    }));
    if (failures.length) setError(failures.join(" "));
    await refresh();
    setBusy(false);
  }

  return (
    <section id="business-metrics" aria-labelledby="business-metrics-title" className="mb-9 scroll-mt-24">
      <SectionLabel right={<div className="flex items-center gap-2">{connected.length > 0 && <Button size="xs" variant="ghost" icon={<RefreshCw className="size-3" />} loading={busy} onClick={() => void sync()}>Sync now</Button>}<Link href="/integrations#business-metrics" className="flex items-center gap-1 py-1 text-[12px] text-fg-2 hover:underline">Manage sources <ArrowUpRight className="size-3" /></Link></div>}>
        <span id="business-metrics-title">Your business, kept in sync</span>
      </SectionLabel>
      {error && <p role="alert" className="mb-3 text-[13px] text-danger">{error}</p>}
      {connected.length === 0 ? (
        <Card className="p-5">
          <div className="flex items-start gap-3"><Plug className="mt-0.5 size-4 shrink-0 text-fg-3" /><div><p className="text-[14px] font-medium text-fg">The numbers you already track, without the upkeep.</p><p className="mt-1 max-w-[64ch] text-[13px] leading-5 text-fg-3">Connect product analytics or billing to bring active users, revenue and customer counts into Inroad automatically.</p></div></div>
          <div className="mt-5 grid gap-2 sm:grid-cols-3">
            {METRIC_PROVIDER_IDS.map((id) => <Link key={id} href={`/integrations#${id}`} className="flex items-center gap-2.5 rounded-md px-3 py-3 ring-1 ring-border transition-colors hover:bg-bg-subtle"><ToolMark name={METRIC_PROVIDERS[id].name} domain={METRIC_PROVIDERS[id].domain} /><span className="flex-1 text-[13px] font-medium">Connect {METRIC_PROVIDERS[id].name}</span><ArrowUpRight className="size-3.5 text-fg-3" /></Link>)}
          </div>
        </Card>
      ) : (
        <div className="space-y-3">
          {connected.map((id) => {
            const meta = METRIC_PROVIDERS[id];
            const state = ws.integrations[id]!;
            const snapshot = ws.businessMetrics?.[id];
            return <Card key={id} className="p-5">
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><div className="flex min-w-0 items-center gap-2.5"><ToolMark name={meta.name} domain={meta.domain} /><Link href={`/integrations#${id}`} className="text-[13px] font-medium hover:underline">{meta.name}</Link>{snapshot?.environment === "test" && <Badge tone="warning">Test data</Badge>}</div><span className="text-[12px] text-fg-3">{state.lastError ? "Last successful sync " : "Synced "}<Ago iso={state.lastSyncAt} /></span></div>
              {state.lastError && <p className="mb-4 rounded-md bg-danger-subtle p-3 text-[12px] leading-5 text-danger">{state.lastError.message} {snapshot && "These are your last successful figures."}</p>}
              {snapshot ? <MetricValues snapshot={snapshot} /> : <p className="text-[13px] text-fg-3">No figures yet. Sync now to import them.</p>}
            </Card>;
          })}
          <p className="px-1 text-[12px] leading-5 text-fg-3">Refreshes every 15 minutes while Inroad is open. Each source keeps its own definitions; sources are never added together. {mode === "growth" ? "The growth history below uses your logged weeks; rolling provider windows do not overwrite them." : "The deal forecast below uses your tracked deals."}</p>
        </div>
      )}
    </section>
  );
}
