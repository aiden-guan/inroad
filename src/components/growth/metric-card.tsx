"use client";

import { ArrowUpRight, Database, Settings2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Ago } from "@/components/integrations/parts";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { shortDate } from "@/lib/client/format";
import { currentMetrics, historyFor, observedChange } from "@/lib/gtm/metrics";
import type { MetricPoint } from "@/lib/gtm/types";
import { formatMetric } from "@/lib/metrics/catalog";
import { WaitlistCard } from "./waitlist";

function Sparkline({ points, label }: { points: MetricPoint[]; label: string }) {
  const recent = points.slice(-30);
  if (recent.length < 2) return <div className="mt-5 flex h-16 items-center border-y border-dashed border-border text-[12px] leading-5 text-fg-3">Your trend builds with each sync.</div>;
  const low = Math.min(...recent.map((p) => p.value));
  const span = Math.max(1, Math.max(...recent.map((p) => p.value)) - low);
  const start = Date.parse(recent[0].at); const duration = Math.max(1, Date.parse(recent.at(-1)!.at) - start);
  const path = recent.map((p, i) => `${i ? "L" : "M"}${4 + (Date.parse(p.at) - start) / duration * 392},${60 - (p.value - low) / span * 48}`).join(" ");
  return <div className="mt-5"><svg viewBox="0 0 400 68" preserveAspectRatio="none" className="h-16 w-full text-fg-2" role="img" aria-label={`${label}: ${recent[0].value} on ${shortDate(recent[0].at)} to ${recent.at(-1)!.value} on ${shortDate(recent.at(-1)!.at)}`}><path d={path} fill="none" stroke="currentColor" strokeWidth="1.7" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" /></svg><div className="mt-1 flex justify-between font-mono text-[10px] text-fg-3"><span>{shortDate(recent[0].at)}</span><span>{shortDate(recent.at(-1)!.at)}</span></div></div>;
}

export function GrowthMetricCard({ id, title, period, now }: { id: string; title: string; period?: string; now: number }) {
  const { ws } = useWorkspace();
  const [managing, setManaging] = useState(false);
  if (!ws) return null;
  const waitlist = id === "waitlist";
  const [, provider, key] = id.split(":");
  const reading = currentMetrics(ws, new Date(now), { pipeline: false }).find((r) => waitlist ? r.provider === "waitlist" : r.provider === provider && r.key === key) ?? (waitlist && ws.waitlist ? {
    id: JSON.stringify(["waitlist", ws.waitlist.source.id, "total"]), provider: "waitlist" as const, key: "total", label: "Waitlist", sourceLabel: ws.waitlist.source.label, period: "Last saved total", definition: "Rows in the connected signup table. Net change includes additions and removals.", href: "/growth#waitlist", value: ws.waitlist.current.total, at: ws.waitlist.current.at, problem: "Waitlist is disconnected.", currency: undefined, test: false,
  } : undefined);
  const series = reading ? historyFor(ws, reading) : null;
  const change = reading && series ? observedChange(series, reading) : null;
  const target = waitlist ? ws.waitlist?.goal : undefined;
  const href = waitlist ? "#waitlist" : `/integrations#${provider}`;
  return <>
    <Card role="region" className="flex h-full min-h-[290px] flex-col p-5" aria-label={`${title}${period ? ` · ${period}` : ""}`}>
      <div className="flex min-w-0 items-start justify-between gap-3"><div><h2 className="text-[13px] font-medium text-fg">{title}</h2><p className="mt-1 text-[11px] text-fg-3">{period || reading?.period || "Current total"}{!period && reading?.currency && ` · ${reading.currency}`}</p></div>{waitlist ? <button type="button" aria-label="Manage waitlist" onClick={() => setManaging(true)} className="rounded-md p-1 text-fg-3 hover:bg-bg-subtle focus-visible:outline-2 focus-visible:outline-[var(--ring)]"><Settings2 className="size-3.5" /></button> : <Link href={href} aria-label={`Manage ${title} source`} className="rounded-md p-1 text-fg-3 hover:bg-bg-subtle"><ArrowUpRight className="size-3.5" /></Link>}</div>
      {reading ? <>
        <p aria-label={waitlist ? `${reading.value.toLocaleString("en-US")} waitlist signups` : undefined} className="mt-5 break-words font-mono text-[38px] leading-none tracking-[-0.055em] text-fg tnum">{formatMetric(reading.value, reading.currency)}</p>
        <p className="mt-2 min-h-4 text-[11px] text-fg-3">{change ? <><span className="font-mono text-fg-2">{change.delta > 0 ? "+" : ""}{formatMetric(change.delta, reading.currency)}{change.percent !== null && ` (${change.percent > 0 ? "+" : ""}${change.percent.toFixed(1)}%)`}</span> since {shortDate(change.since)}</> : "First observation saved"}</p>
        {target && <div className="mt-4"><div className="mb-1.5 flex justify-between text-[11px] text-fg-3"><span>Goal {target.toLocaleString("en-US")}</span><span>{Math.min(100, Math.floor(reading.value / target * 100))}%</span></div><div role="progressbar" aria-label="Waitlist goal progress" aria-valuemin={0} aria-valuemax={target} aria-valuenow={Math.min(target, reading.value)} className="h-1 overflow-hidden rounded-full bg-bg-subtle"><div className="h-full bg-fg" style={{ width: `${Math.min(100, reading.value / target * 100)}%` }} /></div></div>}
        <Sparkline points={series?.points ?? []} label={title} />
        {reading.problem && <p role="status" className="mt-3 text-[12px] leading-5 text-warning">{reading.problem} Showing the last successful count.</p>}
        <div className="mt-auto pt-4"><div className="flex flex-wrap items-center gap-2 text-[11px] leading-4 text-fg-3"><span className="min-w-0 break-words">{reading.sourceLabel}</span>{reading.test && <Badge tone="warning">Test data</Badge>}<span>· <Ago iso={reading.at} /></span></div>
          <details className="mt-2 text-[11px] leading-5 text-fg-3"><summary className="w-fit cursor-pointer rounded-sm focus-visible:outline-2 focus-visible:outline-[var(--ring)]">How it&apos;s counted</summary><p className="mt-1.5">{reading.definition}</p>{provider === "posthog" && reading.value === 0 && <p className="mt-2">Check the project and activity filter in <Link className="underline" href={href}>PostHog settings</Link>.</p>}</details>
        </div>
      </> : <div className="flex flex-1 flex-col items-start justify-center py-6"><Database className="mb-3 size-5 text-fg-3" /><p className="text-[13px] font-medium">{waitlist ? "Connect your signup database" : "Connect a source for this number"}</p><p className="mt-1 text-[12px] leading-5 text-fg-3">{waitlist ? "Bring in your waitlist total and its history." : "Your connection may need a sync or this metric may no longer be available."}</p>{waitlist ? <button className="mt-4 text-[12px] font-medium underline underline-offset-4" onClick={() => setManaging(true)}>Set up waitlist</button> : <Link href={href} className="mt-4 text-[12px] font-medium underline underline-offset-4">Manage source ↗</Link>}</div>}
    </Card>
    {waitlist && <Dialog open={managing} onOpenChange={setManaging} title="Your waitlist" description="Manage the source, target and sync for your waitlist." className="max-w-[640px]"><div className="p-5 [&>section]:mb-0"><WaitlistCard /></div></Dialog>}
  </>;
}
