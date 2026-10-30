"use client";

import { RefreshCw } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { isConsumer } from "@/lib/consumer/market";
import { METRIC_PROVIDERS } from "@/lib/metrics/catalog";
import { METRIC_PROVIDER_IDS, type MetricProviderId } from "@/lib/metrics/types";
import { MetricValues } from "./metric-values";
import { Ago, ConfirmButton } from "./parts";
import { PostHogConnect } from "./posthog-connect";
import { ProviderKeyConnect } from "./provider-key-connect";
import { MetricPreferences } from "./metric-preferences";
import { Group, IntegrationRow } from "./row";

export function MetricSources({ current, onToggle }: { current: string | null; onToggle: (id: string) => void }) {
  const { ws } = useWorkspace();
  if (!ws) return null;
  return (
    <Group id="business-metrics" question="What tracks your business?" note="Connect once. Figures refresh every 15 minutes while Inroad is open. Read-only syncs use no AI tokens.">
      {METRIC_PROVIDER_IDS.map((id) => {
        const meta = METRIC_PROVIDERS[id];
        const state = ws.integrations[id];
        return (
          <IntegrationRow key={id} id={id} name={meta.name} blurb={meta.blurb} domain={meta.domain}
            status={!state?.enabled ? { tone: "off", label: "Not connected" } : state.lastError ? { tone: "error", label: "Needs attention" } : { tone: "on", label: <>Synced <Ago iso={state.lastSyncAt} /></> }}
            open={current === id} onToggle={() => onToggle(id)}>
            <MetricsPanel id={id} />
          </IntegrationRow>
        );
      })}
    </Group>
  );
}

function MetricsPanel({ id }: { id: MetricProviderId }) {
  const { ws, refresh } = useWorkspace();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const meta = METRIC_PROVIDERS[id];
  const state = ws?.integrations[id];
  const snapshot = ws?.businessMetrics?.[id];

  async function action(op: "sync" | "disconnect") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/metrics/${id}${op === "sync" ? "/sync" : ""}`, { method: op === "sync" ? "POST" : "DELETE" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Couldn't update this connection.");
      toast.success(op === "sync" ? `${meta.name} metrics updated.` : `${meta.name} disconnected.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't update this connection.");
    } finally {
      await refresh();
      setBusy(false);
    }
  }

  if (!state?.enabled || editing) return id === "posthog" ? <PostHogConnect onDone={() => setEditing(false)} onCancel={editing ? () => setEditing(false) : undefined} /> : <ProviderKeyConnect id={id} onDone={() => setEditing(false)} onCancel={editing ? () => setEditing(false) : undefined} />;
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 break-all text-[12px] text-fg-3">{snapshot?.accountLabel ?? String(state.config.accountLabel ?? meta.name)}</p>
        <div className="flex items-center gap-2">
          {snapshot?.environment === "test" && <Badge tone="warning">Test data</Badge>}
          <Button size="xs" loading={busy} icon={<RefreshCw className="size-3" />} onClick={() => void action("sync")}>Sync now</Button>
        </div>
      </div>
      {(error || state.lastError) && <p role="alert" className="mb-4 rounded-md bg-danger-subtle p-3 text-[13px] text-danger">{error ?? state.lastError?.message} {snapshot && "Showing the last successful sync."}</p>}
      {snapshot ? <MetricValues snapshot={snapshot} /> : <p className="text-[13px] text-fg-3">No figures yet. Sync now to import your metrics.</p>}
      <MetricPreferences id={id} state={state} />
      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-3 text-[12px] text-fg-3">
        <span>Last synced <Ago iso={state.lastSyncAt} /></span>
        <Link href={`${ws && isConsumer(ws) ? "/growth" : "/revenue"}#business-metrics`} className="py-1 font-medium text-fg-2 underline decoration-border-strong underline-offset-4">View in {ws && isConsumer(ws) ? "Growth" : "Revenue"}</Link>
        <button type="button" disabled={busy} onClick={() => setEditing(true)} className="rounded-sm py-1 font-medium text-fg-2 hover:underline disabled:opacity-50">Change connection</button>
        {!busy && <ConfirmButton confirmLabel={`Disconnect ${meta.name}?`} onConfirm={() => void action("disconnect")}>Disconnect</ConfirmButton>}
      </div>
    </div>
  );
}
