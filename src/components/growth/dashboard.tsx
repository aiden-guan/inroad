"use client";

import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { rectSortingStrategy, SortableContext, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { Check, LayoutGrid, Plus, RefreshCw, RotateCcw, Search, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { useCallback, useRef, useState, type ReactNode } from "react";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/field";
import { cn } from "@/lib/client/cn";
import { defaultGrowthDashboard, growthCardOptions, moveGrowthCard, readGrowthDashboard, type GrowthCard, type GrowthDashboardLayout } from "@/lib/consumer/dashboard";
import { METRIC_PROVIDER_IDS } from "@/lib/metrics/types";
import { DashboardCard } from "./dashboard-card";
import { GrowthMetricCard } from "./metric-card";

export function GrowthDashboard({ now, logging, renderSection }: { now: number; logging: boolean; renderSection: (id: string) => ReactNode }) {
  const { ws, dispatch, refresh } = useWorkspace();
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<GrowthDashboardLayout | null>(null);
  const saves = useRef(Promise.resolve());
  const version = useRef(0);
  const save = useCallback((cards: GrowthCard[]) => {
    const next = { cards }; const ticket = ++version.current;
    setDraft(next);
    // Layout writes are ordered even when several checkboxes are changed before a response arrives.
    saves.current = saves.current.then(async () => {
      await dispatch({ type: "growth.dashboard", layout: next });
      if (ticket === version.current) setDraft(null);
    });
  }, [dispatch]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const savedLayout = draft ?? (ws ? readGrowthDashboard(ws) : { cards: [] });
  const layout = logging && !savedLayout.cards.some((c) => c.id === "weekly") ? { cards: [...savedLayout.cards, { id: "weekly", wide: true }] } : savedLayout;
  const options = ws ? growthCardOptions(ws) : [];
  if (!ws) return null;

  function move(id: string, direction: -1 | 1) {
    const index = layout.cards.findIndex((c) => c.id === id); const next = layout.cards[index + direction];
    if (next) save(moveGrowthCard(layout.cards, id, next.id));
  }
  function dropped({ active, over }: DragEndEvent) {
    if (over && active.id !== over.id) save(moveGrowthCard(layout.cards, String(active.id), String(over.id)));
  }
  async function sync() {
    setBusy(true); setError(null);
    const sources = METRIC_PROVIDER_IDS.filter((id) => ws!.integrations[id]?.enabled).map((id) => `/api/metrics/${id}/sync`);
    if (ws!.waitlist?.enabled) sources.push("/api/waitlist/sync");
    try {
      const failures = await Promise.all(sources.map(async (url) => {
        try { const response = await fetch(url, { method: "POST" }); const body = await response.json(); return response.ok ? null : body.error || "A source couldn't sync."; }
        catch { return "Couldn't reach a source. Check your connection."; }
      }));
      const messages = failures.filter(Boolean); if (messages.length) setError(messages.join(" "));
      await refresh();
    } finally { setBusy(false); }
  }

  const matching = options.filter((o) => `${o.title} ${o.description} ${o.group}`.toLowerCase().includes(search.toLowerCase()));
  const groups = [...new Set(matching.map((o) => o.group))];
  const connected = Boolean(ws.waitlist?.enabled || METRIC_PROVIDER_IDS.some((id) => ws.integrations[id]?.enabled));

  return <section id="business-metrics" aria-label="Growth dashboard" className="scroll-mt-24">
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
      <div className="flex items-center gap-2 text-[12px] text-fg-3"><LayoutGrid className="size-3.5" aria-hidden /><span>{editing ? "Drag a handle to rearrange. Changes save automatically." : "Your numbers, your view"}</span></div>
      <div className="flex flex-wrap items-center gap-1.5">
        {connected && <Button size="xs" variant="ghost" icon={<RefreshCw className="size-3.5" />} loading={busy} onClick={() => void sync()}>Sync all</Button>}
        <Button size="xs" variant="secondary" icon={<Plus className="size-3.5" />} onClick={() => { setSearch(""); setAdding(true); }}>Add cards</Button>
        <Button size="xs" disabled={editing && !!draft} variant={editing ? "primary" : "secondary"} icon={editing ? <Check className="size-3.5" /> : <SlidersHorizontal className="size-3.5" />} onClick={() => setEditing(!editing)}>{editing ? "Done editing" : "Edit dashboard"}</Button>
      </div>
    </div>
    {error && <p role="alert" className="mb-4 rounded-md bg-danger-subtle p-3 text-[13px] leading-5 text-danger">{error}</p>}
    {layout.cards.length === 0 ? <div className="rounded-xl border border-dashed border-border-strong px-6 py-14 text-center"><LayoutGrid className="mx-auto mb-4 size-6 text-fg-3" /><h2 className="font-serif text-[23px]">Make room for what matters.</h2><p className="mt-2 text-[13px] text-fg-3">Choose your waitlist, active users, revenue or weekly plan.</p><Button className="mt-5" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>Add your first card</Button></div> : <DndContext id="growth-dashboard-dnd" sensors={sensors} collisionDetection={closestCenter} onDragEnd={dropped} accessibility={{ screenReaderInstructions: { draggable: "Press Space to pick up a card. Use the arrow keys to move it, Space to drop, or Escape to cancel." } }}>
      <SortableContext items={layout.cards.map((c) => c.id)} strategy={rectSortingStrategy}>
        <div className="grid grid-cols-1 items-stretch gap-4 md:grid-cols-2 xl:grid-cols-3" data-testid="growth-grid">
          {layout.cards.map((card, index) => {
            const option = options.find((o) => o.id === card.id);
            const title = option?.title ?? "Saved metric";
            return <DashboardCard key={card.id} card={card} title={title} editing={editing} first={index === 0} last={index === layout.cards.length - 1} onMove={(direction) => move(card.id, direction)} onWidth={() => save(layout.cards.map((c) => c.id === card.id ? { ...c, wide: !c.wide } : c))} onRemove={() => save(layout.cards.filter((c) => c.id !== card.id))}>
              {card.id === "waitlist" || card.id.startsWith("metric:") ? <GrowthMetricCard id={card.id} title={title} period={card.id.startsWith("metric:") ? option?.description : undefined} now={now} /> : <div className="min-w-0 [&_section]:m-0 [&_table]:w-full [&_section]:scroll-mt-24">{renderSection(card.id)}</div>}
            </DashboardCard>;
          })}
        </div>
      </SortableContext>
    </DndContext>}
    <div className="mt-5 flex flex-wrap items-center justify-between gap-2 text-[11px] leading-5 text-fg-3"><span aria-live="polite">{draft ? "Saving layout…" : "Connected figures refresh every 15 minutes. Weekly numbers keep their own history."}</span><Link href="/integrations#business-metrics" className="font-medium text-fg-2 underline underline-offset-4">Manage sources ↗</Link></div>

    <Dialog open={adding} onOpenChange={setAdding} title="Make Growth yours" description="Choose the numbers and tools you want to see. Hiding a card keeps its data and connection." className="max-w-[600px]">
      <div className="p-5"><div className="relative"><Search className="pointer-events-none absolute left-3 top-3 size-3.5 text-fg-3" /><Input aria-label="Find a Growth card" placeholder="Find a card…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" /></div>
        <div className="mt-5 space-y-5">{groups.map((group) => <div key={group}><p className="mb-2 text-[11px] font-medium uppercase tracking-[0.08em] text-fg-3">{group}</p><div className="space-y-1">{matching.filter((o) => o.group === group).map((option) => {
          const selected = layout.cards.some((c) => c.id === option.id);
          return <label key={option.id} className={cn("flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-bg-subtle", selected && "bg-bg-subtle/60")}><input type="checkbox" className="size-4 shrink-0 accent-primary" checked={selected} onChange={(e) => save(e.target.checked ? [...layout.cards, { id: option.id, wide: option.wide }] : layout.cards.filter((c) => c.id !== option.id))} /><span className="min-w-0"><span className="block text-[13px] font-medium">{option.title}</span><span className="block text-[12px] leading-5 text-fg-3">{option.description}</span></span></label>;
        })}</div></div>)}{!matching.length && <p className="py-4 text-[13px] text-fg-3">No cards match. Try “users”, “waitlist” or “revenue”.</p>}</div>
        <p className="mt-5 text-[12px] leading-5 text-fg-3">More business metrics appear when you <Link href="/integrations#business-metrics" className="underline underline-offset-4">connect Stripe or Polar</Link>.</p>
        <div className="mt-6 flex items-center justify-between gap-3 border-t border-border pt-4"><Button size="xs" variant="ghost" icon={<RotateCcw className="size-3" />} onClick={() => save(defaultGrowthDashboard(ws).cards)}>Restore default layout</Button><Button size="sm" variant="primary" loading={!!draft} onClick={() => setAdding(false)}>Done</Button></div>
      </div>
    </Dialog>
  </section>;
}
