import { OPEN_STAGES, type Account, type PersonaRole, type Stage, type Workspace } from "@/lib/domain/types";
import { knowsDirectly } from "@/lib/moves/util";
import { distanceKm, placeLabel, spread, type ResolvedPlace } from "./places";

/**
 * Where the founder's leads are. People are placed by their own location, else by their company's
 * HQ (flagged, since remote is common); companies with nobody named yet appear on their own. Pure:
 * the caller supplies how text becomes a place (built-in list, cache), so nothing here waits on a network.
 */

export interface LeadPoint {
  /** "per:<id>" or "acc:<domain>" */
  id: string;
  kind: "person" | "account";
  domain: string;
  company: string;
  /** The person's name, or the company's when nobody is named. */
  name: string;
  title?: string;
  personId?: string;
  role?: PersonaRole;
  tier: Account["tier"];
  fit: number;
  group: "customer" | "pipeline" | "prospect";
  stage?: Stage;
  /** The founder knows them or has a warm path in. */
  warm: boolean;
  /** "New York, NY" */
  place: string;
  lat: number;
  lng: number;
  /** False when placed at a city center (spread a little so pins don't stack). */
  exact: boolean;
  /** Placed by the company's HQ, not the person's own location. */
  byHq: boolean;
}

type Resolve = (text: string) => ResolvedPlace | null | undefined;

export function leadPoints(ws: Workspace, resolve: Resolve): { points: LeadPoint[]; unresolved: string[] } {
  const points: LeadPoint[] = [];
  const unresolved = new Set<string>();
  const at = (text: string | undefined): ResolvedPlace | null => {
    if (!text?.trim()) return null;
    const p = resolve(text);
    if (p === undefined) unresolved.add(text.trim());
    return p ?? null;
  };

  for (const acc of Object.values(ws.accounts)) {
    if (acc.status === "disqualified") continue;
    const deal = acc.dealId ? ws.deals[acc.dealId] : undefined;
    const group: LeadPoint["group"] = acc.status === "customer" || deal?.stage === "won" ? "customer" : deal && OPEN_STAGES.includes(deal.stage) ? "pipeline" : "prospect";
    const hq = at(acc.hqCity);
    const base = { domain: acc.domain, company: acc.name, tier: acc.tier, fit: acc.fitScore, group, ...(deal ? { stage: deal.stage } : {}) };
    let placedPeople = 0;
    for (const id of acc.peopleIds) {
      const p = ws.people[id];
      if (!p || p.doNotContact || p.mayHaveLeft) continue;
      const own = at(p.location);
      const where = own ?? hq;
      if (!where) continue;
      const pos = where.precision === "address" ? where : spread(`per:${p.id}`, where);
      points.push({
        ...base,
        id: `per:${p.id}`,
        kind: "person",
        name: p.name,
        title: p.title,
        personId: p.id,
        role: p.role,
        warm: knowsDirectly(p) || p.contactPaths.some((c) => c.kind === "warm_intro"),
        place: placeLabel(where),
        lat: pos.lat,
        lng: pos.lng,
        exact: where.precision === "address",
        byHq: !own,
      });
      placedPeople++;
    }
    if (!placedPeople && hq) {
      const pos = hq.precision === "address" ? hq : spread(`acc:${acc.domain}`, hq);
      points.push({ ...base, id: `acc:${acc.domain}`, kind: "account", name: acc.name, warm: acc.warmPathCount > 0, place: placeLabel(hq), lat: pos.lat, lng: pos.lng, exact: hq.precision === "address", byHq: true });
    }
  }
  return { points, unresolved: [...unresolved] };
}

export interface Nearby extends LeadPoint {
  km: number;
}

/** Leads within `radiusKm` of a center, nearest and best first. */
export function nearby(points: LeadPoint[], center: { lat: number; lng: number }, radiusKm: number): Nearby[] {
  return points
    .map((p) => ({ ...p, km: distanceKm(center, p) }))
    .filter((p) => p.km <= radiusKm)
    .sort((a, b) => GROUP_RANK[a.group] - GROUP_RANK[b.group] || Number(b.warm) - Number(a.warm) || b.fit - a.fit || a.km - b.km);
}

const GROUP_RANK: Record<LeadPoint["group"], number> = { pipeline: 0, prospect: 1, customer: 2 };

/**
 * Metros by lead count, for "where should the next dinner be?". Places within a dinner's drive of a
 * bigger one fold into it (Jersey City into New York, Oakland into San Francisco).
 */
export function metros(points: LeadPoint[], mergeKm = 40): { place: string; lat: number; lng: number; leads: number; companies: number; aTier: number; warm: number }[] {
  const byPlace = new Map<string, LeadPoint[]>();
  for (const p of points) byPlace.set(p.place, [...(byPlace.get(p.place) ?? []), p]);
  const places = [...byPlace.entries()]
    .map(([place, list]) => ({ place, list, lat: list.reduce((n, p) => n + p.lat, 0) / list.length, lng: list.reduce((n, p) => n + p.lng, 0) / list.length }))
    .sort((a, b) => b.list.length - a.list.length);
  const groups: { place: string; lat: number; lng: number; list: LeadPoint[] }[] = [];
  for (const pl of places) {
    const home = groups.find((g) => distanceKm(g, pl) <= mergeKm);
    if (home) home.list.push(...pl.list);
    else groups.push({ place: pl.place, lat: pl.lat, lng: pl.lng, list: [...pl.list] });
  }
  return groups
    .map((g) => ({
      place: g.place,
      lat: g.lat,
      lng: g.lng,
      leads: g.list.length,
      companies: new Set(g.list.map((p) => p.domain)).size,
      aTier: new Set(g.list.filter((p) => p.tier === "A").map((p) => p.domain)).size,
      warm: g.list.filter((p) => p.warm).length,
    }))
    .sort((a, b) => b.companies - a.companies || b.aTier - a.aTier || b.leads - a.leads);
}
