"use client";

import { ArrowUpRight, Plug, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { SearchMetricValues } from "@/components/integrations/search-metric-values";
import { Ago, ToolMark } from "@/components/integrations/parts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionLabel } from "@/components/ui/card";
import { SEARCH_PROVIDERS } from "@/lib/metrics/search-catalog";
import { SEARCH_PROVIDER_IDS } from "@/lib/metrics/search-types";

export function SearchPerformance() {
  const { ws, refresh } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!ws) return null;
  const providers = SEARCH_PROVIDER_IDS;
  const section = "search-performance";
  const connected = providers.filter((id) => ws.integrations[id]?.enabled);

  async function sync() {
    setBusy(true);
    setError(null);
    const failures: string[] = [];
    await Promise.all(connected.map(async (id) => {
      try {
        const res = await fetch(`/api/search-metrics/${id}/sync`, { method: "POST" });
        const body = await res.json();
        if (!res.ok) failures.push(body.error ?? `${SEARCH_PROVIDERS[id].name} couldn't sync.`);
      } catch { failures.push(`${SEARCH_PROVIDERS[id].name} couldn't sync. Check your connection.`); }
    }));
    if (failures.length) setError(failures.join(" "));
    await refresh();
    setBusy(false);
  }

  return (
    <section id={section} aria-labelledby={`${section}-title`} className="mb-9 scroll-mt-24">
      <SectionLabel right={<div className="flex items-center gap-2">{connected.length > 0 && <Button size="xs" variant="ghost" icon={<RefreshCw className="size-3" />} loading={busy} onClick={() => void sync()}>Sync now</Button>}<Link href={`/integrations#${section}`} className="flex items-center gap-1 py-1 text-[12px] text-fg-2 hover:underline">Manage sources <ArrowUpRight className="size-3" /></Link></div>}>
        <span id={`${section}-title`}>SEO & AEO performance <span className="ml-2 font-normal text-fg-3">{connected.length} {connected.length === 1 ? "source" : "sources"} connected</span></span>
      </SectionLabel>
      {error && <p role="alert" className="mb-3 text-[13px] text-danger">{error}</p>}
      {connected.length === 0 ? (
        <Card className="p-5">
          <div className="flex items-start gap-3"><Plug className="mt-0.5 size-4 shrink-0 text-fg-3" /><div><p className="text-[14px] font-medium text-fg">See whether discovery turns into visits and customers.</p><p className="mt-1 max-w-[64ch] text-[13px] leading-5 text-fg-3">Connect Google and Bing for search visibility, then PostHog for organic and AI referral sessions and conversions. Each source compares the latest 28 days with the previous 28.</p></div></div>
          <div className="mt-5 grid gap-2 sm:grid-cols-3">
            {providers.map((id) => <Link key={id} href={`/integrations#${id}`} className="flex items-center gap-2.5 rounded-md px-3 py-3 ring-1 ring-border transition-colors hover:bg-bg-subtle"><ToolMark name={SEARCH_PROVIDERS[id].name} domain={SEARCH_PROVIDERS[id].domain} /><span className="flex-1 text-[13px] font-medium">Connect {SEARCH_PROVIDERS[id].name}</span><ArrowUpRight className="size-3.5 text-fg-3" /></Link>)}
          </div>
        </Card>
      ) : (
        <div className="space-y-3">
          {connected.map((id) => {
            const meta = SEARCH_PROVIDERS[id];
            const state = ws.integrations[id]!;
            const snapshot = ws.searchMetrics?.[id];
            return <Card key={id} className="p-5">
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><div className="flex min-w-0 items-center gap-2.5"><ToolMark name={meta.name} domain={meta.domain} /><Link href={`/integrations#${id}`} className="text-[13px] font-medium hover:underline">{meta.name}</Link>{snapshot?.environment === "test" && <Badge tone="warning">Test data</Badge>}</div><span className="text-[12px] text-fg-3">{state.lastError ? "Last successful sync " : "Synced "}<Ago iso={state.lastSyncAt} /></span></div>
              {state.lastError && <p className="mb-4 rounded-md bg-danger-subtle p-3 text-[12px] leading-5 text-danger">{state.lastError.message} {snapshot && "These are your last successful figures."}</p>}
              {snapshot ? <SearchMetricValues snapshot={snapshot} /> : <p className="text-[13px] text-fg-3">No figures yet. Sync now to import them.</p>}
            </Card>;
          })}
          <p className="px-1 text-[12px] leading-5 text-fg-3">Refreshes every 15 minutes while Inroad is open. Each source keeps its own definitions; sources are never added together. Search platforms and PostHog use different reporting windows and attribution rules. Open each card’s definitions before comparing them.</p>
        </div>
      )}
    </section>
  );
}
