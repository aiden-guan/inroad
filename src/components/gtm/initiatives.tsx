"use client";

import { Check, Clipboard, Plus } from "lucide-react";
import { useMemo, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { useClock } from "@/components/today/use-today";
import { Button } from "@/components/ui/button";
import { Card, SectionLabel } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label, Select, Textarea } from "@/components/ui/field";
import { shortDate } from "@/lib/client/format";
import { marketOf } from "@/lib/consumer/market";
import { addDays, todayISO } from "@/lib/domain/ids";
import { metricValue, weeklyPlan } from "@/lib/gtm/brief";
import { currentMetrics } from "@/lib/gtm/metrics";
import { initiativeProgress } from "@/lib/gtm/progress";
import type { GtmInitiative, MetricReading } from "@/lib/gtm/types";

async function writeInitiative(body: unknown, id?: string) {
  const response = await fetch(id ? `/api/gtm/initiatives/${encodeURIComponent(id)}` : "/api/gtm/initiatives", { method: id ? "PATCH" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Couldn't save this initiative.");
}

function InitiativeForm({ item, readings, today, onSaved }: { item?: GtmInitiative; readings: MetricReading[]; today: string; onSaved: () => Promise<void> }) {
  const primary = readings.find((r) => !r.problem && !r.test && (r.provider === "waitlist" || r.key === "qualified_30d" || r.key === "active_7d")) ?? readings.find((r) => !r.problem && !r.test);
  const [title, setTitle] = useState(item?.title ?? "");
  const [metricId, setMetricId] = useState(item ? item.measurement?.metric.id ?? "" : primary?.id ?? "");
  const [target, setTarget] = useState(item?.measurement?.target?.toString() ?? "");
  const [owner, setOwner] = useState(item?.owner ?? "Me");
  const [dueOn, setDueOn] = useState(item?.dueOn ?? addDays(today, 7));
  const [direction, setDirection] = useState<"increase" | "decrease">(item?.measurement?.direction ?? "increase");
  const [note, setNote] = useState(item?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const options = useRef<HTMLDetailsElement>(null);
  const [requestId] = useState(() => crypto.randomUUID());
  const selected = readings.find((r) => r.id === metricId);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(null);
    try {
      if (!owner.trim() || !dueOn) { if (options.current) options.current.open = true; throw new Error(!owner.trim() ? "Add an owner, or use Me." : "Choose a review date."); }
      const raw = target.trim().replace(/[$,%\s]/g, "");
      const nextTarget = raw ? Number(raw) : null;
      if (nextTarget !== null && (!Number.isFinite(nextTarget) || nextTarget < 0)) throw new Error("Use a nonnegative number for the target.");
      const body: Record<string, unknown> = { title, owner, dueOn, note };
      if (!item) body.requestId = requestId;
      if (!item || metricId !== (item.measurement?.metric.id ?? "")) body.metricId = metricId || null;
      if (metricId) { body.target = nextTarget; body.direction = direction; }
      await writeInitiative(body, item?.id);
      await onSaved(); toast.success(item ? "Initiative updated." : "Initiative added. Its baseline is saved.");
    } catch (e) { setError(e instanceof Error ? e.message : "Couldn't save this initiative."); }
    finally { pending.current = false; setBusy(false); }
  }
  return <form onSubmit={save} className="space-y-4 px-5 pb-5 pt-4">
    <div><Label htmlFor="initiative-title">What will you improve?</Label><Input id="initiative-title" autoFocus required maxLength={240} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Improve the signup welcome flow" /></div>
    <div><Label htmlFor="initiative-metric">Measure progress</Label><Select className="w-full" id="initiative-metric" value={metricId} onChange={(e) => { setMetricId(e.target.value); setTarget(""); }}><option value="">Unmeasured commitment</option>{item?.measurement && !readings.some((r) => r.id === item.measurement!.metric.id) && <option value={item.measurement.metric.id} disabled>{item.measurement.metric.label} · source unavailable</option>}{readings.map((r) => <option key={r.id} value={r.id} disabled={!!r.problem}>{r.label} · {r.period}{r.currency ? ` · ${r.currency}` : ""}{r.test ? " · TEST DATA" : ""}{r.problem ? " · sync needed" : ""}</option>)}</Select>
      {selected && <p className="mt-2 text-[12px] leading-5 text-fg-3">{metricValue(selected.value, selected)} · {selected.sourceLabel} · observed {shortDate(selected.at)}{selected.n !== undefined ? ` · n=${selected.n} decided exits` : ""}. {selected.problem ?? "The baseline is captured automatically when you save."}</p>}
      {item && metricId !== (item.measurement?.metric.id ?? "") && <p className="mt-2 text-[12px] leading-5 text-warning">Changing the metric starts a new baseline. The previous measurement and target are kept in history.</p>}
    </div>
    {metricId && <div><Label htmlFor="initiative-target">Target{selected?.unit === "percent" ? ", %" : selected?.currency ? `, ${selected.currency}` : ""} (optional)</Label><Input id="initiative-target" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="Choose your outcome" /></div>}
    <details ref={options} className="text-[12px] text-fg-3"><summary className="w-fit cursor-pointer py-1">Owner, review date and notes · {owner || "Me"} · {shortDate(dueOn)}</summary><div className="mt-3 space-y-3"><div className="grid grid-cols-2 gap-3"><div><Label htmlFor="initiative-owner">Owner</Label><Input id="initiative-owner" value={owner} maxLength={80} onChange={(e) => setOwner(e.target.value)} /></div><div><Label htmlFor="initiative-due">Review date</Label><Input id="initiative-due" type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} /></div></div>{metricId && <div><Label htmlFor="initiative-direction">Target direction</Label><Select className="w-full" id="initiative-direction" value={direction} onChange={(e) => setDirection(e.target.value as "increase" | "decrease")}><option value="increase">Increase toward the target</option><option value="decrease">Decrease toward the target</option></Select></div>}<div><Label htmlFor="initiative-note">Context or review notes</Label><Textarea id="initiative-note" rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} /></div></div></details>
    {error && <p role="alert" className="rounded-md bg-danger-subtle p-3 text-[13px] leading-5 text-danger">{error}</p>}
    <Button type="submit" variant="primary" loading={busy} disabled={!title.trim() || !!selected?.problem && metricId !== item?.measurement?.metric.id} className="w-full">{item ? "Save initiative" : "Add initiative"}</Button>
  </form>;
}

function InitiativeCard({ item, readings, today, onEdit, onChange }: { item: GtmInitiative; readings: MetricReading[]; today: string; onEdit: () => void; onChange: () => Promise<void> }) {
  const result = initiativeProgress(item, readings, today);
  const m = item.status === "done" ? item.outcomes.at(-1)?.measurement ?? item.measurement : item.measurement;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function status(status: GtmInitiative["status"]) {
    setBusy(true); setError(null);
    try { await writeInitiative({ status }, item.id); await onChange(); }
    catch (e) { setError(e instanceof Error ? e.message : "Couldn't update the initiative."); }
    finally { setBusy(false); }
  }
  return <Card className="break-words p-4 sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 flex-1"><p className="text-[11px] leading-5 text-fg-3">{item.owner} · Review {shortDate(item.dueOn)}{result.overdue ? " · overdue" : ""}{item.status !== "active" ? ` · ${item.status === "done" ? "Reviewed" : "Parked"}` : ""}</p><h4 className="mt-0.5 break-words text-[15px] font-medium leading-6 text-fg">{item.title}</h4></div>{result.targetMet && <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-fg"><Check className="size-3.5" />At target</span>}</div>
    {m ? <div className="mt-3 text-[13px] leading-5 text-fg-2"><p>{m.metric.label} · {m.metric.period}{m.metric.test ? " · TEST DATA" : ""}</p><p className="mt-1 font-mono tnum">{metricValue(m.baseline.value, m.metric)} → {result.current ? metricValue(result.current.value, m.metric) : "—"}{m.target !== undefined ? ` · target ${metricValue(m.target, m.metric)}` : ""}</p>{result.percent !== undefined && <div role="progressbar" aria-label={`Progress for ${item.title}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(result.percent)} className="mt-3 h-1.5 overflow-hidden rounded-full bg-bg-subtle"><div className="h-full bg-fg" style={{ width: `${result.percent}%` }} /></div>}<p className="mt-2 text-[11px] text-fg-3">Baseline {shortDate(m.baseline.at)}{m.baseline.n !== undefined ? ` (n=${m.baseline.n})` : ""}{result.current ? ` · last observation ${shortDate(result.current.at)}${result.current.n !== undefined ? ` (n=${result.current.n})` : ""}` : ""} · <Link className="underline underline-offset-2" href={m.metric.href}>{m.metric.sourceLabel}</Link></p></div> : <p className="mt-3 text-[12px] text-fg-3">Unmeasured commitment. Review the outcome when it is due.</p>}
    {result.problem && <p role="status" className="mt-3 text-[12px] leading-5 text-warning">{result.problem}</p>}
    {item.note && <p className="mt-3 whitespace-pre-wrap break-words text-[12px] leading-5 text-fg-3">{item.note}</p>}
    <div className="mt-4 flex flex-wrap gap-2">{item.status === "active" ? <><Button size="xs" loading={busy} onClick={() => void status("done")}>Mark reviewed</Button><Button size="xs" variant="ghost" onClick={onEdit}>Edit plan or metric</Button><Button size="xs" variant="ghost" disabled={busy} onClick={() => void status("parked")}>Park</Button></> : <Button size="xs" loading={busy} onClick={() => void status("active")}>Reopen</Button>}</div>
    {(item.revisions.length > 0 || item.outcomes.length > 0) && <details className="mt-3 text-[11px] leading-5 text-fg-3"><summary className="w-fit cursor-pointer">Measurement history</summary><ul className="mt-2 space-y-1">{item.revisions.map((r, i) => <li key={`r${i}`}>Changed {shortDate(r.at)}: {r.measurement.metric.label}, baseline {metricValue(r.measurement.baseline.value, r.measurement.metric)}{r.measurement.target !== undefined ? `, target ${metricValue(r.measurement.target, r.measurement.metric)}` : ""}.</li>)}{item.outcomes.map((o, i) => <li key={`o${i}`}>Reviewed {shortDate(o.at)}{o.current && o.measurement ? `: ${metricValue(o.measurement.baseline.value, o.measurement.metric)} → ${metricValue(o.current.value, o.measurement.metric)}` : ""}{o.problem ? ` · ${o.problem}` : ""}. {o.note}</li>)}</ul></details>}
    {error && <p role="alert" className="mt-3 text-[12px] text-danger">{error}</p>}
  </Card>;
}

export function GtmInitiatives() {
  const { ws, refresh } = useWorkspace();
  const now = useClock(60_000);
  const readings = useMemo(() => ws ? currentMetrics(ws, new Date(now)) : [], [ws, now]);
  const [form, setForm] = useState<true | GtmInitiative | null>(null);
  if (!ws) return null;
  const today = todayISO(new Date(now));
  const items = Object.values(ws.gtmInitiatives ?? {}).filter((i) => i.market === marketOf(ws)).sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.createdAt.localeCompare(b.createdAt));
  const active = items.filter((i) => i.status === "active");
  const others = items.filter((i) => i.status !== "active").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  async function copy() {
    try { await navigator.clipboard.writeText(weeklyPlan(ws!, readings, new Date(now))); toast.success("Weekly execution plan copied."); }
    catch { toast.error("Couldn't copy the plan. Try again."); }
  }
  return <section id="gtm-initiatives" aria-labelledby="gtm-initiatives-title" className="mb-9 scroll-mt-24">
    <SectionLabel right={<div className="flex flex-wrap justify-end gap-1">{items.length > 0 && <Button size="xs" variant="ghost" icon={<Clipboard className="size-3" />} onClick={() => void copy()}>Copy weekly plan</Button>}<Button size="xs" icon={<Plus className="size-3" />} onClick={() => setForm(true)}>Add initiative</Button></div>}><span id="gtm-initiatives-title">This week&apos;s GTM priorities</span></SectionLabel>
    {active.length ? <div className="grid gap-3 lg:grid-cols-2">{active.map((item) => <InitiativeCard key={item.id} item={item} readings={readings} today={today} onEdit={() => setForm(item)} onChange={refresh} />)}</div> : <Card className="px-5 py-4 text-[13px] leading-5 text-fg-3">Give a priority an owner and a review date. Inroad captures the metric baseline and tracks progress from your connected sources or deals.</Card>}
    {others.length > 0 && <details className="mt-4 text-[12px] text-fg-3"><summary className="w-fit cursor-pointer py-1">Reviewed and parked · {others.length}</summary><div className="mt-3 grid gap-3 lg:grid-cols-2">{others.map((item) => <InitiativeCard key={item.id} item={item} readings={readings} today={today} onEdit={() => setForm(item)} onChange={refresh} />)}</div></details>}
    <p className="mt-3 px-1 text-[11px] leading-4 text-fg-3">Targets are measured automatically; you decide when to mark a priority reviewed. Observed changes do not establish cause. Saved readouts stay fixed.</p>
    <Dialog open={form !== null} onOpenChange={(open) => { if (!open) setForm(null); }} title={form === true ? "Add a GTM initiative" : "Edit GTM initiative"} description="One priority, a measurable outcome and a date to review it.">{form && <InitiativeForm key={form === true ? "new" : form.id} item={form === true ? undefined : form} readings={readings} today={today} onSaved={async () => { await refresh(); setForm(null); }} />}</Dialog>
  </section>;
}
