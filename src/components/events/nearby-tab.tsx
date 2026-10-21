"use client";

import { Check, Compass, Handshake, Plus, UserSearch } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { LeadMap, type MapPin } from "@/components/map/lead-map";
import { PlacePicker, type PickedPlace } from "@/components/map/place-picker";
import { useLeadPoints, useMiles } from "@/components/map/use-lead-points";
import { credits, usePeopleData, type Preview } from "@/components/people/use-people-data";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Favicon } from "@/components/ui/favicon";
import { Num, Segmented, Skeleton } from "@/components/ui/misc";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/client/cn";
import { PEOPLE_DATA_PRICE } from "@/lib/connectors/catalog";
import { newId } from "@/lib/domain/ids";
import type { GtmEvent } from "@/lib/domain/types";
import { nearby, type LeadPoint, type Nearby } from "@/lib/geo/leads";
import { distanceKm, formatDistance, KM_PER_MI, placeLabel, resolvePlace } from "@/lib/geo/places";
import { spring } from "@/lib/motion";
import { guestFromPerson } from "./plan-math";
import { useGuestActions } from "./ui";

type Location = NonNullable<GtmEvent["location"]>;

const RADII_MI = [5, 10, 25, 50];
const RADII_KM = [10, 20, 40, 80];
const DEFAULT_KM = 25 * KM_PER_MI;

/** The event's place: what the founder set, else the venue or the plan's city from the built-in list. */
function derivedLocation(ev: GtmEvent): Location | null {
  if (ev.location) return ev.location;
  const p = resolvePlace(ev.venue?.address) ?? resolvePlace(ev.plan?.city) ?? resolvePlace(ev.request?.city);
  return p ? { label: placeLabel(p), lat: p.lat, lng: p.lng, radiusKm: DEFAULT_KM, precision: "city" } : null;
}

const GROUPS: { key: LeadPoint["group"]; label: string; hint: string }[] = [
  { key: "pipeline", label: "In your pipeline", hint: "A seat at dinner moves a deal faster than another call." },
  { key: "prospect", label: "Prospects", hint: "" },
  { key: "customer", label: "Customers", hint: "Your best co-hosts: buyers believe their peers." },
];

/**
 * "Who's near the room?" A map centered on the event with a radius ring, every lead inside it grouped
 * by where they are in the pipeline, and one click to put them on the guest list. With Firecrawl
 * connected, buyers nearby who aren't in Inroad yet are one free search away.
 */
export function NearbyTab({ ev }: { ev: GtmEvent }) {
  const { ws, dispatch } = useWorkspace();
  const actions = useGuestActions(ev);
  const miles = useMiles();
  const { points, pending, failed } = useLeadPoints();
  const loc = useMemo(() => derivedLocation(ev), [ev]);
  const [hovered, setHovered] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const rows = useRef<Map<string, HTMLLIElement>>(new Map());

  const guestsByPerson = useMemo(() => new Map(Object.values(ev.guests).filter((g) => g.personId).map((g) => [g.personId!, g])), [ev.guests]);
  const inRange = useMemo(() => (points && loc ? nearby(points, loc, loc.radiusKm) : []), [points, loc]);

  const pins: MapPin[] = useMemo(
    () =>
      (points ?? []).map((p) => {
        const km = loc ? distanceKm(loc, p) : undefined;
        return {
          id: p.id,
          lat: p.lat,
          lng: p.lng,
          group: p.group,
          tier: p.tier,
          warm: p.warm,
          title: p.name,
          sub: p.kind === "person" ? [p.title, p.company].filter(Boolean).join(" · ") : "Nobody named yet",
          meta: [km !== undefined ? formatDistance(km, miles) : null, p.byHq ? "by HQ" : p.place].filter(Boolean).join(" · "),
        };
      }),
    [points, loc, miles],
  );

  if (!ws || !actions) return null;

  const setLocation = (next: Partial<Location>) => {
    const base = loc ?? { label: "", lat: 0, lng: 0, radiusKm: DEFAULT_KM, precision: "city" as const };
    void dispatch({ type: "event.update", id: ev.id, patch: { location: { ...base, ...next } } });
  };
  const pick = (p: PickedPlace) => setLocation({ label: p.label, lat: p.lat, lng: p.lng, precision: p.precision });

  const radii = miles ? RADII_MI : RADII_KM;
  const toKm = (v: number) => (miles ? v * KM_PER_MI : v);
  const radiusValue = loc ? String(radii.reduce((best, r) => (Math.abs(toKm(r) - loc.radiusKm) < Math.abs(toKm(best) - loc.radiusKm) ? r : best), radii[0])) : String(radii[2]);

  const add = async (p: Nearby) => {
    const person = p.personId ? ws.people[p.personId] : undefined;
    if (!person) return;
    const ok = await actions.save(guestFromPerson(ws, ev, person, newId("gst"), p.group === "customer" ? "customer_host" : "prospect"));
    if (ok) toast(`${person.name.split(" ")[0]} is on the list. Write their personal line before you invite them.`);
  };

  const focusRow = (id: string) => {
    setSelected(id);
    rows.current.get(id)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };

  const warm = inRange.filter((p) => p.warm).length;
  const listed = inRange.filter((p) => p.personId && guestsByPerson.has(p.personId)).length;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <PlacePicker value={loc?.label} onPick={pick} className="min-w-[220px] flex-1" />
          <Segmented
            layoutId={`radius-${ev.id}`}
            value={radiusValue}
            onChange={(v) => setLocation({ radiusKm: toKm(Number(v)) })}
            options={radii.map((r) => ({ value: String(r), label: `${r} ${miles ? "mi" : "km"}` }))}
          />
        </div>
        <LeadMap
          className="h-[clamp(340px,58vh,600px)]"
          pins={pins}
          center={loc ? { lat: loc.lat, lng: loc.lng, label: loc.label } : undefined}
          radiusKm={loc?.radiusKm}
          hoveredId={hovered}
          selectedId={selected}
          onHover={setHovered}
          onSelect={focusRow}
        />
        <Legend />
      </div>

      <aside className="min-w-0">
        {!loc ? (
          <div className="rounded-lg bg-surface px-4 py-6 text-center ring-1 ring-border">
            <Compass className="mx-auto size-5 text-fg-4" aria-hidden />
            <p className="mt-2 text-[14px] font-medium text-fg">Where&apos;s the room?</p>
            <p className="mt-1 text-[13px] leading-[19px] text-fg-3">Pick a city or paste the venue&apos;s address. I&apos;ll show every lead close enough to come.</p>
          </div>
        ) : !points ? (
          <div className="space-y-2">
            <Skeleton className="h-5 w-48" />
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 w-full rounded-md" />
            ))}
          </div>
        ) : (
          <>
            <p className="text-[13px] leading-[20px] text-fg-2">
              <span className="font-mono tnum text-fg">
                <Num value={inRange.length} />
              </span>{" "}
              lead{inRange.length === 1 ? "" : "s"} within {formatDistance(loc.radiusKm, miles).replace("<", "")} of <span className="text-fg">{loc.label}</span>
              {warm > 0 && (
                <>
                  {" · "}
                  <span className="font-mono tnum text-fg">{warm}</span> warm
                </>
              )}
              {listed > 0 && (
                <>
                  {" · "}
                  <span className="font-mono tnum text-fg">{listed}</span> on your list
                </>
              )}
            </p>
            {pending > 0 && <p className="mt-1 text-[12px] text-fg-3">Placing {pending} more on the map…</p>}
            {failed && <p className="mt-1 text-[12px] text-danger">Couldn&apos;t load your leads. Reload to try again.</p>}

            {inRange.length === 0 ? (
              <p className="mt-4 rounded-lg bg-surface px-4 py-5 text-[13px] leading-[19px] text-fg-3 ring-1 ring-border">
                Nobody within range yet. Widen the radius, or find buyers nearby below.
              </p>
            ) : (
              <div className="mt-3 max-h-[min(62vh,620px)] space-y-4 overflow-y-auto pr-1">
                {GROUPS.map((g) => {
                  const list = inRange.filter((p) => p.group === g.key);
                  if (!list.length) return null;
                  return (
                    <section key={g.key}>
                      <p className="flex items-baseline gap-1.5 px-1 text-[11.5px] font-medium text-fg-3">
                        {g.label} <span className="font-mono tnum">{list.length}</span>
                      </p>
                      {g.hint && <p className="px-1 text-[11.5px] text-fg-4">{g.hint}</p>}
                      <ul className="mt-1.5 space-y-1">
                        <AnimatePresence initial={false}>
                          {list.map((p) => (
                            <motion.li
                              key={p.id}
                              layout="position"
                              initial={{ opacity: 0, y: 4 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, transition: { duration: 0.12 } }}
                              transition={spring.smooth}
                              ref={(el) => {
                                if (el) rows.current.set(p.id, el);
                                else rows.current.delete(p.id);
                              }}
                              onMouseEnter={() => setHovered(p.id)}
                              onMouseLeave={() => setHovered(null)}
                              className={cn(
                                "flex items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors duration-150",
                                hovered === p.id || selected === p.id ? "bg-bg-subtle" : "hover:bg-bg-subtle/60",
                                selected === p.id && "ring-1 ring-accent/40",
                              )}
                            >
                              <Favicon domain={p.domain} name={p.company} size={18} />
                              <div className="min-w-0 flex-1">
                                <p className="flex items-center gap-1.5 truncate text-[13px]">
                                  <span className="truncate font-medium text-fg">{p.name}</span>
                                  {p.warm && (
                                    <Tooltip content="You know them, or have a warm path in">
                                      <Handshake className="size-3 shrink-0 text-accent" aria-label="Warm" />
                                    </Tooltip>
                                  )}
                                  {p.tier === "A" && <span className="shrink-0 font-mono text-[10.5px] text-fg-3">A</span>}
                                </p>
                                <p className="truncate text-[11.5px] text-fg-3">
                                  {p.kind === "person" ? [p.title, p.company].filter(Boolean).join(" · ") : "Nobody named yet"}
                                  {p.byHq && p.kind === "person" && (
                                    <Tooltip content="Placed by their company's HQ; they may work elsewhere.">
                                      <span className="ml-1 text-fg-4">· by HQ</span>
                                    </Tooltip>
                                  )}
                                </p>
                              </div>
                              <span className="shrink-0 font-mono text-[11px] tnum text-fg-3">{formatDistance(p.km, miles)}</span>
                              {p.personId ? (
                                guestsByPerson.has(p.personId) ? (
                                  <Badge tone="outline">
                                    <Check className="size-3" aria-hidden /> Listed
                                  </Badge>
                                ) : (
                                  <Button size="xs" variant="secondary" icon={<Plus className="size-3" />} onClick={() => void add(p)} aria-label={`Add ${p.name} to the guest list`}>
                                    Add
                                  </Button>
                                )
                              ) : (
                                <Link href={`/companies?c=${encodeURIComponent(p.domain)}`} className="shrink-0 text-[12px] font-medium text-fg-2 hover:text-fg">
                                  Find people
                                </Link>
                              )}
                            </motion.li>
                          ))}
                        </AnimatePresence>
                      </ul>
                    </section>
                  );
                })}
              </div>
            )}
            <NearApollo ev={ev} near={loc.label} />
          </>
        )}
      </aside>
    </div>
  );
}

function Legend() {
  const dot = (cls: string) => <span aria-hidden className={cn("inline-block size-2.5 rounded-full ring-2 ring-bg", cls)} />;
  return (
    <p className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[11.5px] text-fg-3">
      <span className="flex items-center gap-1.5">{dot("bg-accent")} Pipeline</span>
      <span className="flex items-center gap-1.5">{dot("bg-fg")} Prospect</span>
      <span className="flex items-center gap-1.5">{dot("bg-success")} Customer</span>
      <span className="flex items-center gap-1.5">
        <span aria-hidden className="inline-block size-3 rounded-full ring-[1.5px] ring-accent/70" /> Warm
      </span>
      <span className="ml-auto text-fg-4">Bigger dots are A-tier</span>
    </p>
  );
}

/** Buyers near the venue who aren't in Inroad yet: a free Apollo search, then a paid add per person. */
function NearApollo({ ev, near }: { ev: GtmEvent; near: string }) {
  const pd = usePeopleData();
  const { ws } = useWorkspace();
  const actions = useGuestActions(ev);
  const [found, setFound] = useState<{ people: Preview[]; total?: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);

  if (!pd.connected) {
    return (
      <p className="mt-5 border-t border-border pt-3 text-[12px] leading-[18px] text-fg-3">
        Want buyers near the room who aren&apos;t in Inroad yet?{" "}
        <Link href="/integrations#firecrawl" className="font-medium text-fg-2 hover:text-fg">
          Connect Firecrawl
        </Link>{" "}
        for a free search by your buyer titles.
      </p>
    );
  }

  const search = async () => {
    setBusy(true);
    const r = await pd.findNear(near);
    setBusy(false);
    if (r) setFound(r);
  };

  const add = async (p: Preview) => {
    setAdding(p.id);
    const r = await pd.add(undefined, p.id);
    setAdding(null);
    if (!r || !ws || !actions) return;
    setFound((f) => f && { ...f, people: f.people.map((x) => (x.id === p.id ? { ...x, personId: r.personId } : x)) });
    toast(`Added ${p.firstName} and ${p.companyName ?? "their company"}${r.credits ? ` · ${credits(r.credits)}` : ""}. They'll appear on the map in a moment.`);
  };

  return (
    <div className="mt-5 border-t border-border pt-3">
      {!found ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <Button size="sm" variant="secondary" icon={<UserSearch className="size-3.5" />} loading={busy} onClick={() => void search()}>
            Find buyers nearby
          </Button>
          <span className="text-[12px] text-fg-3">Free · Apollo, by your buyer titles</span>
        </div>
      ) : (
        <>
          <p className="px-1 text-[11.5px] font-medium text-fg-3">
            On Apollo near {near.split(",")[0]} <span className="font-mono tnum">{found.total && found.total > found.people.length ? `${found.people.length} of ${found.total}` : found.people.length}</span>
          </p>
          <ul className="mt-1.5 space-y-1">
            {found.people.map((p) => (
              <li key={p.id} className="flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-bg-subtle/60">
                {p.companyDomain ? <Favicon domain={p.companyDomain} name={p.companyName} size={18} /> : <span className="size-[18px] rounded-sm bg-bg-subtle" />}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px]">
                    <span className="font-medium text-fg">
                      {p.firstName} {p.lastName}
                    </span>
                  </p>
                  <p className="truncate text-[11.5px] text-fg-3">{[p.title, p.companyName].filter(Boolean).join(" · ")}</p>
                </div>
                {p.personId ? (
                  <Badge tone="outline">
                    <Check className="size-3" aria-hidden /> Added
                  </Badge>
                ) : (
                  <Tooltip content={`Full name, LinkedIn and work email, filed under their company. Up to ${credits(PEOPLE_DATA_PRICE.add)}.`}>
                    <Button size="xs" variant="secondary" loading={adding === p.id} disabled={adding !== null && adding !== p.id} onClick={() => void add(p)}>
                      Add
                    </Button>
                  </Tooltip>
                )}
              </li>
            ))}
            {!found.people.length && <li className="px-2 py-2 text-[12.5px] text-fg-3">Nobody with your buyer titles there on Apollo.</li>}
          </ul>
        </>
      )}
    </div>
  );
}
