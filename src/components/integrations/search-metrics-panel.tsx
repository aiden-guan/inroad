"use client";

import { RefreshCw } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { SEARCH_PROVIDERS } from "@/lib/metrics/search-catalog";
import { SEARCH_PROVIDER_IDS, type SearchProviderId } from "@/lib/metrics/search-types";
import { SearchMetricValues } from "./search-metric-values";
import { Ago, ConfirmButton, ExternalLink } from "./parts";
import { Group, IntegrationRow } from "./row";

export function SearchSources({ current, onToggle }: { current: string | null; onToggle: (id: string) => void }) {
  const { ws } = useWorkspace();
  if (!ws) return null;
  return <Group id="search-performance" question="How do search and AI answers find you?" note="Figures refresh every 15 minutes while Inroad is open. Read-only syncs use no AI tokens.">
    {SEARCH_PROVIDER_IDS.map((id) => {
      const meta = SEARCH_PROVIDERS[id], state = ws.integrations[id];
      return <IntegrationRow key={id} id={id} name={meta.name} blurb={meta.blurb} domain={meta.domain}
        status={!state?.enabled ? { tone: "off", label: "Not connected" } : state.lastError ? { tone: "error", label: "Needs attention" } : { tone: "on", label: <>Synced <Ago iso={state.lastSyncAt} /></> }}
        open={current === id} onToggle={() => onToggle(id)}><SearchPanel id={id} /></IntegrationRow>;
    })}
  </Group>;
}

function SearchPanel({ id }: { id: SearchProviderId }) {
  const { ws, refresh } = useWorkspace();
  const [editing, setEditing] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const meta = SEARCH_PROVIDERS[id], state = ws?.integrations[id], snapshot = ws?.searchMetrics?.[id];
  async function action(op: "sync" | "disconnect") {
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/search-metrics/${id}${op === "sync" ? "/sync" : ""}`, { method: op === "sync" ? "POST" : "DELETE" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Couldn't update this connection.");
      toast.success(op === "sync" ? `${meta.name} metrics updated.` : `${meta.name} disconnected.`);
    } catch (e) { setError(e instanceof Error ? e.message : "Couldn't update this connection."); }
    finally { await refresh(); setBusy(false); }
  }
  if (!state?.enabled || editing) return <SearchConnect id={id} onDone={() => setEditing(false)} onCancel={editing ? () => setEditing(false) : undefined} />;
  return <div>
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><p className="min-w-0 break-all text-[12px] text-fg-3">{snapshot?.accountLabel ?? String(state.config.accountLabel ?? meta.name)}</p><div className="flex items-center gap-2">{snapshot?.environment === "test" && <Badge tone="warning">Test data</Badge>}<Button size="xs" loading={busy} icon={<RefreshCw className="size-3" />} onClick={() => void action("sync")}>Sync now</Button></div></div>
    {(error || state.lastError) && <p role="alert" className="mb-4 rounded-md bg-danger-subtle p-3 text-[13px] text-danger">{error ?? state.lastError?.message} {snapshot && "Showing the last successful sync."}</p>}
    {snapshot ? <SearchMetricValues snapshot={snapshot} /> : <p className="text-[13px] text-fg-3">No figures yet. Sync now to import your metrics.</p>}
    <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-3 text-[12px] text-fg-3"><span>Last synced <Ago iso={state.lastSyncAt} /></span><Link href="/visibility" className="py-1 font-medium text-fg-2 underline underline-offset-4">View dashboard</Link><button type="button" disabled={busy} onClick={() => setEditing(true)} className="rounded-sm py-1 font-medium text-fg-2 hover:underline disabled:opacity-50">Edit connection</button>{!busy && <ConfirmButton confirmLabel={`Disconnect ${meta.name}?`} onConfirm={() => void action("disconnect")}>Disconnect</ConfirmButton>}</div>
  </div>;
}

function SearchConnect({ id, onDone, onCancel }: { id: SearchProviderId; onDone: () => void; onCancel?: () => void }) {
  const { ws, refresh } = useWorkspace();
  const meta = SEARCH_PROVIDERS[id], config = ws?.integrations[id]?.config;
  const [key, setKey] = useState("");
  const [region, setRegion] = useState(String(config?.region ?? "us"));
  const [projectId, setProjectId] = useState(String(config?.projectId ?? ""));
  const [siteUrl, setSiteUrl] = useState(String(config?.siteUrl ?? ""));
  const [siteHost, setSiteHost] = useState(String(config?.siteHost ?? ""));
  const [conversionEvent, setConversionEvent] = useState(String(config?.conversionEvent ?? ""));
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const fieldId = (field: string) => `search-${id}-${field}`;
  async function connect(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      const config = id === "posthog-search" ? { region, projectId, siteHost, conversionEvent } : { siteUrl };
      const response = await fetch(`/api/search-metrics/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: key.trim(), config }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? `${meta.name} didn't accept that connection.`);
      setKey(""); await refresh(); toast.success(`${meta.name} connected. Your first metrics are ready.`); onDone();
    } catch (e) { setError(e instanceof Error ? e.message : `Couldn't connect to ${meta.name}. Try again.`); }
    finally { setBusy(false); }
  }
  return <div className="space-y-4">
    <p className="max-w-[64ch] text-[13px] leading-5 text-fg-2">{meta.setup}</p><ExternalLink href={meta.href}>View {meta.name} setup</ExternalLink><p className="text-[12px] leading-5 text-fg-3">Permissions: {meta.scopes}</p>
    <form onSubmit={connect}><fieldset disabled={busy || Boolean(ws?.sample)} className="space-y-4 disabled:opacity-60">
      {id === "posthog-search" ? <>
        <div className="grid gap-3 sm:grid-cols-2"><div><Label htmlFor={fieldId("region")}>PostHog region</Label><Select id={fieldId("region")} value={region} onChange={(e) => setRegion(e.target.value)} className="w-full"><option value="us">US Cloud</option><option value="eu">EU Cloud</option></Select></div><div><Label htmlFor={fieldId("project")}>Project ID</Label><Input id={fieldId("project")} value={projectId} onChange={(e) => setProjectId(e.target.value)} inputMode="numeric" required pattern="[0-9]+" placeholder="12345" /></div></div>
        <div><Label htmlFor={fieldId("host")}>Website hostname</Label><Input id={fieldId("host")} value={siteHost} onChange={(e) => setSiteHost(e.target.value)} placeholder="www.example.com" required /><p className="mt-1.5 text-[12px] text-fg-3">Only sessions entering this exact hostname are counted, including anonymous visitors.</p></div>
        <div><Label htmlFor={fieldId("conversion")}>Conversion event (optional)</Label><Input id={fieldId("conversion")} value={conversionEvent} onChange={(e) => setConversionEvent(e.target.value)} placeholder="signup_completed" maxLength={200} /><p className="mt-1.5 text-[12px] text-fg-3">Use an existing event. Server events must include the website session’s $session_id.</p></div>
      </> : <div><Label htmlFor={fieldId("site")}>Verified property</Label><Input id={fieldId("site")} value={siteUrl} onChange={(e) => setSiteUrl(e.target.value)} placeholder={id === "google-search-console" ? "sc-domain:example.com" : "https://www.example.com/"} required /></div>}
      <div><Label htmlFor={fieldId("key")}>{meta.keyLabel}</Label>{id === "google-search-console" ? <Textarea id={fieldId("key")} value={key} onChange={(e) => setKey(e.target.value)} placeholder={meta.placeholder} required maxLength={20000} autoComplete="off" spellCheck={false} data-1p-ignore className="font-mono text-[12px]" aria-describedby={fieldId("key-help")} /> : <Input id={fieldId("key")} type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={meta.placeholder} required minLength={8} maxLength={4000} autoComplete="off" spellCheck={false} data-1p-ignore className="font-mono" aria-describedby={fieldId("key-help")} />}</div>
      <div className="flex flex-wrap gap-2"><Button type="submit" variant="primary" loading={busy}>Connect and import metrics</Button>{onCancel && <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>}</div>
    </fieldset>{ws?.sample && <p className="mt-3 text-[12px] text-fg-3">Leave the sample workspace before connecting your real accounts.</p>}<div aria-live="polite">{busy && <p className="mt-3 text-[12px] text-fg-3">Checking access and importing your first metrics…</p>}</div>{error && <p role="alert" className="mt-3 text-[13px] text-danger">{error}</p>}<p id={fieldId("key-help")} className="mt-3 text-[12px] leading-5 text-fg-3">Your key stays on this computer. Inroad reads aggregate metrics without changing anything in {meta.name}.</p></form>
  </div>;
}
