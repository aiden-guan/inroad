"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { METRIC_PROVIDERS } from "@/lib/metrics/catalog";
import { ExternalLink } from "./parts";

export function ProviderKeyConnect({ id, onDone, onCancel }: { id: "stripe" | "polar"; onDone: () => void; onCancel?: () => void }) {
  const { ws, refresh } = useWorkspace();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const meta = METRIC_PROVIDERS[id];
  async function connect(value: string) {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/metrics/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: value.trim(), config: {} }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? `Couldn't connect ${meta.name}.`);
      setKey(""); await refresh(); toast.success(`${meta.name} connected. Your metrics are ready.`); onDone();
    } catch (e) { setError(e instanceof Error ? e.message : "Couldn't connect. Try again."); }
    finally { setBusy(false); }
  }
  return <div className="space-y-3 py-1">
    <p className="max-w-[56ch] text-[13px] leading-5 text-fg-2">{id === "stripe" ? "One read-only key. Inroad detects your currencies and imports your revenue and customers." : "One organization token. Inroad finds your organization and imports your metrics."}</p>
    <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); void connect(key); }}>
      <Label htmlFor={`metrics-${id}-key`}>{meta.keyLabel}</Label>
      <Input id={`metrics-${id}-key`} type="password" value={key} onChange={(e) => setKey(e.target.value)} onPaste={(e) => { const value = e.clipboardData.getData("text").trim(); if ((id === "stripe" ? /^(rk|sk)_(live|test)_/.test(value) : value.startsWith("polar_oat_")) && value.length >= 8 && !ws?.sample) { e.preventDefault(); setKey(value); void connect(value); } }} placeholder="Paste your key to connect automatically" required minLength={8} maxLength={4000} disabled={busy || Boolean(ws?.sample)} autoComplete="off" spellCheck={false} data-1p-ignore />
      <div className="flex flex-wrap items-center gap-3"><Button type="submit" variant="primary" loading={busy} disabled={Boolean(ws?.sample)}>Connect {meta.name}</Button><ExternalLink href={meta.href}>Get a key</ExternalLink>{onCancel && <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>}</div>
    </form>
    <p className="text-[12px] text-fg-3">Paste once. Everything else is detected. Your key stays on this computer.</p>
    <details className="text-[12px] leading-5 text-fg-3"><summary className="w-fit cursor-pointer rounded-sm py-1">Help getting a key</summary><p className="mt-2">{meta.setup}</p><p className="mt-1">{meta.scopes}</p></details>
    {busy && <p role="status" className="text-[12px] text-fg-3">Connecting and bringing in your metrics…</p>}
    {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
    {ws?.sample && <p className="text-[12px] text-fg-3">Leave the sample workspace to connect your account.</p>}
  </div>;
}
