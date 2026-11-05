"use client";
import { BellRing, Radar } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { useRuns } from "@/components/providers/runs-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import { Segmented } from "@/components/ui/misc";
import { WorkLog } from "@/components/ui/work-log";
import { relativeTime } from "@/lib/client/format";
import type { Workspace } from "@/lib/domain/types";
import { feedSummary, withinWindow } from "@/lib/intent/feed";
import { DeveloperRadar } from "./developer-radar";
import { IntentFeed } from "./intent-feed";
import { IntentHow, money, scanRequests } from "./intent-how";
import type { AutomationController } from "./use-automation";
import { isActive, useIntentRun, useIntentStatus, useUrlParams } from "./use-intent";

/**
 * Research → Intent. "Asking for it": people who said in public that they have the problem the company solves,
 * asked for a tool, or compared its competitors, each with the post's own words. "Developers": who is forking,
 * filing and discussing the repositories in its space (businesses only).
 */
export function IntentPanel({ ws, consumer, automation }: { ws: Workspace; consumer: boolean; automation: AutomationController }) {
  const params = useSearchParams();
  const setParams = useUrlParams();
  const { start } = useRuns();
  const { status, error } = useIntentStatus(ws.rev);
  const run = useIntentRun("asks");
  const scanning = isActive(run);
  const [now] = useState(() => Date.now());
  const view = !consumer && params.get("intent") === "developers" ? "developers" : "asks";
  const radarView = params.get("radar") === "people" ? "people" : "companies";
  const items = ws.intent?.items ?? [];
  const week = items.filter((i) => withinWindow(i, "7d", now)).length;
  const monitor = automation.data?.monitors.find((m) => m.kind === "intent");
  const canScan = status?.canScan.ok ?? false;

  async function scan() {
    if (!canScan) return;
    setParams({ intent: null });
    // A toast only when the founder has moved on to another page; here the feed itself shows the result.
    await start("intent", { mode: "asks" }, { notify: () => !window.location.pathname.startsWith("/research") });
  }

  async function watch() {
    try {
      await automation.run({
        action: "save_monitor",
        input: { name: "People asking for it", kind: "intent", query: "Research → Intent queries from your playbook", intervalMinutes: 1440, keywords: [], enabled: true, recipe: "custom" },
      });
      toast("I'll check the free sources every day and list new posts under Monitors. Nothing goes to the AI until you scan.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save the monitor.");
    }
  }

  return (
    <div className="space-y-5">
      <section className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 max-w-[62ch] flex-1 basis-72">
          <h2 className="text-[18px] font-medium leading-[26px] text-fg">{consumer ? "People asking for what you make" : "People asking for what you sell"}</h2>
          <p className="mt-1 text-[14px] leading-[22px] text-fg-2">{feedSummary(items, now, consumer)}</p>
          {ws.intent?.scans[0] && (
            <p className="mt-1 text-[12px] text-fg-3">
              Last scan {relativeTime(ws.intent.scans[0].at, now)} · {scanRequests(ws.intent.scans[0])} requests · {money(ws.intent.scans[0].costUsd)} of AI
              {ws.sample ? " · example posts from the sample" : ""}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {monitor ? (
            <Badge tone={monitor.enabled ? "success" : "neutral"} className="h-8 px-2.5 text-[12px]">
              <BellRing aria-hidden className="size-3.5" /> {monitor.enabled ? "Checked daily" : "Daily check paused"}
            </Badge>
          ) : (
            <Button size="sm" variant="secondary" icon={<BellRing className="size-3.5" />} disabled={!status?.canScan.ok || !!ws.sample} onClick={() => void watch()}>
              Check daily
            </Button>
          )}
          <Button size="sm" variant="agent" icon={<Radar className="size-3.5" />} loading={scanning} disabled={!canScan || scanning} onClick={() => void scan()}>
            {scanning ? "Scanning" : "Scan now"}
          </Button>
        </div>
        {status && !status.canScan.ok && status.canScan.reason && <p className="w-full text-[12px] text-fg-3">{status.canScan.reason}</p>}
        {error && (
          <div className="w-full">
            <FieldError>{error}</FieldError>
          </div>
        )}
      </section>

      {!consumer && (
        <Segmented
          layoutId="intent-view"
          value={view}
          onChange={(v) => setParams({ intent: v === "asks" ? null : v })}
          options={[
            { value: "asks", label: "Asking for it", count: week || undefined },
            { value: "developers", label: "Developers", count: ws.intent?.radar?.companies.length || undefined },
          ]}
        />
      )}

      {view === "asks" && run && (scanning || run.error) && <WorkLog run={run} />}

      {view === "asks" ? (
        <IntentFeed ws={ws} consumer={consumer} onScan={() => void scan()} canScan={canScan && !scanning} />
      ) : (
        <DeveloperRadar
          ws={ws}
          view={radarView}
          githubToken={!!status?.githubToken}
          canScan={!ws.sample || !!status?.mock}
          reason={ws.sample && !status?.mock ? "The sample shows example activity. Reading repositories starts once you set up your own company." : undefined}
        />
      )}

      <IntentHow status={status} state={ws.intent} consumer={consumer} />
    </div>
  );
}
