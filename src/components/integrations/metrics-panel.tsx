"use client";

import { RefreshCw } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/field";
import { isConsumer } from "@/lib/consumer/market";
import { METRIC_PROVIDERS } from "@/lib/metrics/catalog";
import { METRIC_PROVIDER_IDS, type MetricProviderId } from "@/lib/metrics/types";
import { MetricValues } from "./metric-values";
import { Ago, ConfirmButton, ExternalLink } from "./parts";
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

  if (!state?.enabled || editing) return <MetricConnect id={id} onDone={() => setEditing(false)} onCancel={editing ? () => setEditing(false) : undefined} />;
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
      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-3 text-[12px] text-fg-3">
        <span>Last synced <Ago iso={state.lastSyncAt} /></span>
        <Link href={`${ws && isConsumer(ws) ? "/growth" : "/revenue"}#business-metrics`} className="py-1 font-medium text-fg-2 underline decoration-border-strong underline-offset-4">View in {ws && isConsumer(ws) ? "Growth" : "Revenue"}</Link>
        <button type="button" disabled={busy} onClick={() => setEditing(true)} className="rounded-sm py-1 font-medium text-fg-2 hover:underline disabled:opacity-50">Edit connection</button>
        {!busy && <ConfirmButton confirmLabel={`Disconnect ${meta.name}?`} onConfirm={() => void action("disconnect")}>Disconnect</ConfirmButton>}
      </div>
    </div>
  );
}

function MetricConnect({ id, onDone, onCancel }: { id: MetricProviderId; onDone: () => void; onCancel?: () => void }) {
  const { ws, refresh } = useWorkspace();
  const meta = METRIC_PROVIDERS[id];
  const config = ws?.integrations[id]?.config;
  const [key, setKey] = useState("");
  const [region, setRegion] = useState(String(config?.region ?? "us"));
  const [projectId, setProjectId] = useState(String(config?.projectId ?? ""));
  const [activityEvent, setActivityEvent] = useState(String(config?.activityEvent ?? "$pageview"));
  const [identifiedOnly, setIdentifiedOnly] = useState(config?.identifiedOnly !== false);
  const [currency, setCurrency] = useState(String(config?.currency ?? "USD").toUpperCase());
  const [organizationId, setOrganizationId] = useState(String(config?.organizationId ?? ""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fieldId = (field: string) => `metrics-${id}-${field}`;

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const config = id === "posthog" ? { region, projectId, activityEvent, identifiedOnly } : id === "stripe" ? { currency } : { organizationId };
      const res = await fetch(`/api/metrics/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: key.trim(), config }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `${meta.name} didn't accept that connection.`);
      setKey("");
      await refresh();
      toast.success(`${meta.name} connected. Your first metrics are ready.`);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : `Couldn't connect to ${meta.name}. Try again.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="max-w-[64ch] text-[13px] leading-5 text-fg-2">{meta.setup}</p>
      <ExternalLink href={meta.href}>{id === "stripe" ? "Open Stripe API keys" : `View ${meta.name} setup`}</ExternalLink>
      <p className="text-[12px] leading-5 text-fg-3">Permissions: {meta.scopes}</p>
      <form onSubmit={connect}>
        <fieldset disabled={busy || Boolean(ws?.sample)} className="space-y-4 disabled:opacity-60">
          {id === "posthog" && <>
            <div className="grid gap-3 sm:grid-cols-2">
              <div><Label htmlFor={fieldId("region")}>PostHog region</Label><Select id={fieldId("region")} value={region} onChange={(e) => setRegion(e.target.value)} className="w-full"><option value="us">US Cloud</option><option value="eu">EU Cloud</option></Select></div>
              <div><Label htmlFor={fieldId("project")}>Project ID</Label><Input id={fieldId("project")} value={projectId} onChange={(e) => setProjectId(e.target.value)} placeholder="12345" inputMode="numeric" required pattern="[0-9]+" /></div>
            </div>
            <div><Label htmlFor={fieldId("event")}>What activity makes someone active?</Label><Input id={fieldId("event")} value={activityEvent} onChange={(e) => setActivityEvent(e.target.value)} placeholder="$pageview" maxLength={200} aria-describedby={fieldId("event-help")} /><p id={fieldId("event-help")} className="mt-1.5 text-[12px] text-fg-3">Use an event your app already tracks, such as $pageview or app_opened. Leave blank to count any event.</p></div>
            <label className="flex items-start gap-2 text-[13px] text-fg-2"><input type="checkbox" checked={identifiedOnly} onChange={(e) => setIdentifiedOnly(e.target.checked)} className="mt-1 accent-primary" /><span>Only count identified users<span className="mt-0.5 block text-[12px] leading-5 text-fg-3">Recommended for product usage. Requires your app to identify signed-in users in PostHog. Turn off to include anonymous visitors.</span></span></label>
          </>}
          {id === "stripe" && <div className="max-w-xs"><Label htmlFor={fieldId("currency")}>Reporting currency</Label><Input id={fieldId("currency")} value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} maxLength={3} minLength={3} pattern="[A-Za-z]{3}" required placeholder="USD" aria-describedby={fieldId("currency-help")} /><p id={fieldId("currency-help")} className="mt-1.5 text-[12px] leading-5 text-fg-3">Three-letter code. Payments in other currencies are reported as excluded, never combined.</p></div>}
          {id === "polar" && <div><Label htmlFor={fieldId("organization")}>Organization ID</Label><Input id={fieldId("organization")} value={organizationId} onChange={(e) => setOrganizationId(e.target.value)} required placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" /></div>}
          <div><Label htmlFor={fieldId("key")}>{meta.keyLabel}</Label><Input id={fieldId("key")} type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={meta.placeholder} required minLength={8} maxLength={4000} autoComplete="off" spellCheck={false} data-1p-ignore className="font-mono" aria-describedby={fieldId("key-help")} /></div>
          <div className="flex flex-wrap gap-2"><Button type="submit" variant="primary" loading={busy}>Connect and import metrics</Button>{onCancel && <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>}</div>
        </fieldset>
        {ws?.sample && <p className="mt-3 text-[12px] text-fg-3">Leave the sample workspace before connecting your real accounts.</p>}
        <div aria-live="polite">{busy && <p className="mt-3 text-[12px] text-fg-3">Checking access and importing your first metrics…</p>}</div>
        {error && <p role="alert" className="mt-3 text-[13px] text-danger">{error}</p>}
        <p id={fieldId("key-help")} className="mt-3 text-[12px] leading-5 text-fg-3">Your key stays on this computer. Inroad reads aggregate metrics without changing anything in {meta.name}.</p>
      </form>
    </div>
  );
}
