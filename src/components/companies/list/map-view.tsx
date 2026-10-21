"use client";

import { ArrowUpRight, CalendarHeart, Handshake, MapPin } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { LeadMap, type MapPin as Pin } from "@/components/map/lead-map";
import { PlacePicker } from "@/components/map/place-picker";
import { useLeadPoints, useMiles } from "@/components/map/use-lead-points";
import { Favicon } from "@/components/ui/favicon";
import { Segmented, Skeleton } from "@/components/ui/misc";
import { cn } from "@/lib/client/cn";
import { STAGE_LABELS } from "@/lib/domain/types";
import { metros, nearby, type LeadPoint } from "@/lib/geo/leads";
import { formatDistance, KM_PER_MI } from "@/lib/geo/places";
import { listItem, spring } from "@/lib/motion";

type Filter = "all" | "prospect" | "pipeline" | "customer";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "prospect", label: "Prospects" },
  { value: "pipeline", label: "Pipeline" },
  { value: "customer", label: "Customers" },
];

/**
 * Where the founder's leads are. The metros rank where a dinner would fill a room; a place search
 * answers "I'm in Chicago next week, who's there?". Pins open the company sheet.
 */
export function MapView({ onOpen, focusDomain }: { onOpen: (domain: string) => void; focusDomain?: string | null }) {
  const { points, pending, failed } = useLeadPoints();
  const miles = useMiles();
  const [filter, setFilter] = useState<Filter>("all");
  const [hovered, setHovered] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [placeFocus, setFocus] = useState<{ lat: number; lng: number; zoom?: number; key: string; label: string } | null>(null);
  // Arriving from a company sheet (?focus=domain): that company is selected and the map flies to it.
  const fromUrl = useMemo(() => (focusDomain && points ? points.find((p) => p.domain === focusDomain) : undefined), [focusDomain, points]);
  const selected = picked ?? fromUrl?.id ?? null;
  const setSelected = setPicked;
  const focus = useMemo(
    () => placeFocus ?? (fromUrl ? { lat: fromUrl.lat, lng: fromUrl.lng, zoom: 10, key: `domain:${fromUrl.domain}`, label: fromUrl.place } : null),
    [placeFocus, fromUrl],
  );

  const shown = useMemo(() => (points ?? []).filter((p) => filter === "all" || p.group === filter), [points, filter]);
  const byMetro = useMemo(() => metros(shown), [shown]);
  const near = useMemo(() => (focus ? nearby(shown, focus, 40 * KM_PER_MI).slice(0, 12) : []), [shown, focus]);
  const pins: Pin[] = useMemo(
    () =>
      shown.map((p) => ({
        id: p.id,
        lat: p.lat,
        lng: p.lng,
        group: p.group,
        tier: p.tier,
        warm: p.warm,
        title: p.name,
        sub: p.kind === "person" ? [p.title, p.company].filter(Boolean).join(" · ") : p.stage ? STAGE_LABELS[p.stage] : "Nobody named yet",
        meta: [p.place, p.byHq && p.kind === "person" ? "by HQ" : null].filter(Boolean).join(" · "),
      })),
    [shown],
  );
  const chosen = selected ? shown.find((p) => p.id === selected) : undefined;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented layoutId="map-filter" value={filter} onChange={setFilter} options={FILTERS.map((f) => ({ ...f, count: (points ?? []).filter((p) => f.value === "all" || p.group === f.value).length || undefined }))} />
          <PlacePicker
            placeholder="I'm in… a city or address"
            value={focus?.label}
            onPick={(p) => setFocus({ lat: p.lat, lng: p.lng, zoom: p.precision === "address" ? 12 : 9.5, key: `${p.lat},${p.lng}`, label: p.label })}
            className="min-w-[200px] flex-1"
          />
        </div>
        <LeadMap
          className="h-[clamp(420px,66vh,720px)]"
          pins={pins}
          fitKey={`${filter}:${points ? "ready" : "loading"}`}
          focus={focus}
          hoveredId={hovered}
          selectedId={selected}
          onHover={setHovered}
          onSelect={setSelected}
        />
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[11.5px] text-fg-3">
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="inline-block size-2.5 rounded-full bg-accent ring-2 ring-bg" /> Pipeline
          </span>
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="inline-block size-2.5 rounded-full bg-fg ring-2 ring-bg" /> Prospect
          </span>
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="inline-block size-2.5 rounded-full bg-success ring-2 ring-bg" /> Customer
          </span>
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="inline-block size-3 rounded-full ring-[1.5px] ring-accent/70" /> Warm
          </span>
          {pending > 0 && <span className="ml-auto">Placing {pending} more…</span>}
          {failed && <span className="ml-auto text-danger">Couldn&apos;t load the map&apos;s leads.</span>}
        </p>
      </div>

      <aside className="min-w-0 space-y-5">
        <AnimatePresence mode="wait" initial={false}>
          {chosen ? (
            <motion.div key={chosen.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0.1 } }} transition={spring.smooth}>
              <Selected p={chosen} onOpen={() => onOpen(chosen.domain)} onClose={() => setSelected(null)} />
            </motion.div>
          ) : null}
        </AnimatePresence>

        {focus && (
          <section>
            <p className="px-1 text-[11.5px] font-medium text-fg-3">
              Within {miles ? "40 mi" : `${Math.round(40 * KM_PER_MI)} km`} of {focus.label.split(",")[0]} <span className="font-mono tnum">{near.length}</span>
            </p>
            {near.length ? (
              <ul className="mt-1.5 space-y-0.5">
                {near.map((p, i) => (
                  <Row key={p.id} i={i} p={p} meta={formatDistance(p.km, miles)} active={hovered === p.id || selected === p.id} onHover={setHovered} onClick={() => setSelected(p.id)} />
                ))}
              </ul>
            ) : (
              <p className="mt-1.5 px-1 text-[12.5px] text-fg-3">Nobody there yet.</p>
            )}
          </section>
        )}

        <section>
          <p className="px-1 text-[11.5px] font-medium text-fg-3">Where your leads are</p>
          {!points ? (
            <div className="mt-2 space-y-1.5">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-11 w-full rounded-md" />
              ))}
            </div>
          ) : byMetro.length ? (
            <ul className="mt-1.5 space-y-0.5">
              {byMetro.slice(0, 8).map((m, i) => (
                <motion.li key={m.place} variants={listItem} initial="hidden" animate="show" custom={i} className="group rounded-md px-2 py-1.5 transition-colors hover:bg-bg-subtle">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setFocus({ lat: m.lat, lng: m.lng, zoom: 9.5, key: `metro:${m.place}`, label: m.place })}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    >
                      <MapPin className="size-3.5 shrink-0 text-fg-3" aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-fg">{m.place}</span>
                        <span className="block truncate text-[11.5px] text-fg-3">
                          {m.companies} compan{m.companies === 1 ? "y" : "ies"}
                          {m.aTier ? ` · ${m.aTier} A-tier` : ""}
                          {m.warm ? ` · ${m.warm} warm` : ""}
                        </span>
                      </span>
                    </button>
                    {m.companies >= 3 && (
                      <Link
                        href={`/events?new=1&city=${encodeURIComponent(m.place.split(",")[0])}`}
                        className="inline-flex shrink-0 items-center gap-1 rounded-sm px-1.5 py-1 text-[11.5px] font-medium text-fg-3 opacity-0 transition-opacity hover:text-fg focus-visible:opacity-100 group-hover:opacity-100"
                        title={`Plan a dinner in ${m.place}`}
                      >
                        <CalendarHeart className="size-3.5" aria-hidden /> Dinner
                      </Link>
                    )}
                  </div>
                </motion.li>
              ))}
            </ul>
          ) : (
            <p className="mt-1.5 px-1 text-[12.5px] leading-[18px] text-fg-3">No locations yet. Research a company or add people with a location, and they show up here.</p>
          )}
          {byMetro.length > 0 && byMetro[0].companies >= 3 && (
            <p className="mt-2 px-1 text-[12px] leading-[18px] text-fg-3">
              {byMetro[0].place.split(",")[0]} has the most companies you&apos;re working. A dinner there fills a room.
            </p>
          )}
        </section>
      </aside>
    </div>
  );
}

function Row({ i, p, meta, active, onHover, onClick }: { i: number; p: LeadPoint; meta: string; active: boolean; onHover: (id: string | null) => void; onClick: () => void }) {
  return (
    <motion.li variants={listItem} initial="hidden" animate="show" custom={i}>
      <button
        type="button"
        onMouseEnter={() => onHover(p.id)}
        onMouseLeave={() => onHover(null)}
        onClick={onClick}
        className={cn("flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors", active ? "bg-bg-subtle" : "hover:bg-bg-subtle/60")}
      >
        <Favicon domain={p.domain} name={p.company} size={18} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 truncate text-[13px] text-fg">
            <span className="truncate">{p.name}</span>
            {p.warm && <Handshake className="size-3 shrink-0 text-accent" aria-label="Warm" />}
          </span>
          <span className="block truncate text-[11.5px] text-fg-3">{p.kind === "person" ? [p.title, p.company].filter(Boolean).join(" · ") : "Nobody named yet"}</span>
        </span>
        <span className="shrink-0 font-mono text-[11px] tnum text-fg-3">{meta}</span>
      </button>
    </motion.li>
  );
}

function Selected({ p, onOpen, onClose }: { p: LeadPoint; onOpen: () => void; onClose: () => void }) {
  return (
    <div className="rounded-lg bg-surface p-3.5 shadow-sm ring-1 ring-border">
      <div className="flex items-start gap-2.5">
        <Favicon domain={p.domain} name={p.company} size={22} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-medium text-fg">{p.name}</p>
          <p className="truncate text-[12.5px] text-fg-2">{p.kind === "person" ? [p.title, p.company].filter(Boolean).join(" · ") : `${p.company} · nobody named yet`}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[11.5px] text-fg-3">
            <span>{p.place}</span>
            {p.byHq && p.kind === "person" && <span>· placed by HQ</span>}
            {p.stage && <span>· {STAGE_LABELS[p.stage]}</span>}
            <span>· Tier {p.tier}</span>
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label="Clear selection" className="rounded-xs px-1 text-[16px] leading-none text-fg-3 hover:text-fg">
          ×
        </button>
      </div>
      <button
        type="button"
        onClick={onOpen}
        className="mt-3 inline-flex h-7 items-center gap-1.5 rounded-sm bg-primary px-2.5 text-[12.5px] font-medium text-primary-fg shadow-btn transition-[background-color,transform] duration-150 hover:bg-primary-hover active:scale-[0.97]"
      >
        Open {p.company} <ArrowUpRight className="size-3.5 opacity-70" />
      </button>
    </div>
  );
}
