"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import type { IntegrationState } from "@/lib/domain/types";
import type { MetricProviderId } from "@/lib/metrics/types";

export function MetricPreferences({ id, state }: { id: MetricProviderId; state: IntegrationState }) {
  const { refresh } = useWorkspace();
  const [event, setEvent] = useState(String(state.config.activityEvent ?? ""));
  const [identified, setIdentified] = useState(state.config.identifiedOnly !== false);
  const [currency, setCurrency] = useState(String(state.config.currency ?? "").toUpperCase());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (id === "polar") return null;
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/metrics/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(id === "posthog" ? { activityEvent: event, identifiedOnly: identified } : { currency: currency.trim() || null }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Couldn't save preferences.");
      await refresh(); toast.success("Metrics updated.");
    } catch (e) { setError(e instanceof Error ? e.message : "Couldn't save preferences."); }
    finally { setBusy(false); }
  }
  return <details className="mt-3 text-[12px] text-fg-3"><summary className="w-fit cursor-pointer rounded-sm py-1">Customize metrics (optional)</summary>
    <form onSubmit={save} className="mt-3 max-w-lg space-y-3">
      {id === "posthog" ? <>
        <div><Label htmlFor="posthog-activity">Count a specific activity</Label><Input id="posthog-activity" value={event} onChange={(e) => setEvent(e.target.value)} placeholder="All app activity (recommended)" maxLength={200} /><p className="mt-1">Leave empty to count any activity your app records.</p></div>
        <label className="flex items-center gap-2"><input type="checkbox" checked={identified} onChange={(e) => setIdentified(e.target.checked)} />Only count signed-in users</label>
      </> : <div><Label htmlFor="stripe-report-currency">Limit to one currency</Label><Input id="stripe-report-currency" value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} placeholder="All currencies (recommended)" maxLength={3} pattern="[A-Za-z]{3}" /><p className="mt-1">Leave empty to show each currency separately.</p></div>}
      <Button type="submit" size="sm" loading={busy}>Save preferences</Button>
      {error && <p role="alert" className="text-danger">{error}</p>}
    </form>
  </details>;
}
