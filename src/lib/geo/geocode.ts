import "server-only";
import path from "node:path";
import { readDataFile, writeDataFile } from "@/lib/store/data-file";
import { DATA_DIR, readSettings } from "@/lib/store/settings";
import { placeLabel, resolvePlace, searchPlaces, type ResolvedPlace } from "./places";

/**
 * Places the built-in list doesn't know, from OpenStreetMap's Nominatim. Only the place text leaves
 * this machine. Its usage policy asks for at most one request a second, an identifying user agent
 * and caching, so every answer (including "not found") is kept on disk and requests queue politely.
 */

const CACHE_FILE = path.join(DATA_DIR, "geo-cache.json");
const ENDPOINT = "https://nominatim.openstreetmap.org/search";
const UA = "Inroad/1.0 (local-first GTM app; geocoding city and venue names)";

type Cached = { at: string; place: ResolvedPlace | null; places?: ResolvedPlace[] };
type Cache = Record<string, Cached>;

const key = (q: string) => q.trim().toLowerCase().replace(/\s+/g, " ");

function readCache(): Cache {
  try {
    return readDataFile<Cache>(CACHE_FILE, () => ({}));
  } catch {
    return {};
  }
}

function remember(q: string, place: ResolvedPlace | null, places?: ResolvedPlace[]) {
  const cache = readCache();
  cache[key(q)] = { at: new Date().toISOString(), place, ...(places ? { places } : {}) };
  writeDataFile(CACHE_FILE, cache);
}

const g = globalThis as unknown as { __inroadGeo?: { next: number; pending: Set<string> } };
const state = (g.__inroadGeo ??= { next: 0, pending: new Set() });

async function gate() {
  const now = Date.now();
  const wait = Math.max(0, state.next - now);
  state.next = Math.max(now, state.next) + 1100;
  if (wait) await new Promise((r) => setTimeout(r, wait));
}

interface NominatimHit {
  lat: string;
  lon: string;
  name?: string;
  display_name: string;
  addresstype?: string;
  address?: { city?: string; town?: string; village?: string; state?: string; country_code?: string; road?: string; house_number?: string };
}

function toPlace(h: NominatimHit, precision: ResolvedPlace["precision"]): ResolvedPlace {
  const a = h.address ?? {};
  const city = a.city ?? a.town ?? a.village;
  const country = (a.country_code ?? "").toUpperCase() || "XX";
  return {
    name: precision === "address" ? h.name || h.display_name.split(",")[0] : city || h.name || h.display_name.split(",")[0],
    country,
    region: country === "US" || country === "CA" ? undefined : a.state,
    lat: Number(h.lat),
    lng: Number(h.lon),
    precision,
  };
}

async function nominatim(q: string, limit: number): Promise<NominatimHit[] | null> {
  await gate();
  const url = `${ENDPOINT}?${new URLSearchParams({ q, format: "jsonv2", limit: String(limit), addressdetails: "1", "accept-language": "en" })}`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const body = (await res.json()) as unknown;
    return Array.isArray(body) ? (body as NominatimHit[]).filter((h) => Number.isFinite(Number(h.lat)) && Number.isFinite(Number(h.lon))) : null;
  } catch {
    return null;
  }
}

const osmOn = () => readSettings().geocoder !== "off";

/** Built-in list first, then the cache. Never waits on the network. */
export function placeNow(text: string | null | undefined): ResolvedPlace | null | undefined {
  if (!text?.trim()) return null;
  const known = resolvePlace(text);
  if (known) return known;
  const hit = readCache()[key(text)];
  return hit ? hit.place : undefined; // undefined: not looked up yet
}

/** Looks up places in the background, one a second. Callers re-ask later; `pending` says how many are queued. */
export function geocodeLater(texts: string[]): number {
  if (!osmOn()) return 0;
  const cache = readCache();
  const fresh = [...new Set(texts.map((t) => t.trim()).filter(Boolean))].filter((t) => !resolvePlace(t) && !cache[key(t)] && !state.pending.has(key(t)));
  for (const t of fresh.slice(0, 40)) {
    state.pending.add(key(t));
    void (async () => {
      const hits = await nominatim(t, 1);
      // A network failure isn't "not found": leave it uncached so a later visit tries again.
      if (hits) remember(t, hits[0] ? toPlace(hits[0], "city") : null);
      state.pending.delete(key(t));
    })();
  }
  return state.pending.size;
}

export function pendingGeocodes(): number {
  return state.pending.size;
}

/** The location picker: instant matches from the built-in list, then OpenStreetMap places and venues. */
export async function searchLocation(q: string): Promise<{ label: string; lat: number; lng: number; precision: ResolvedPlace["precision"]; country: string }[]> {
  const local = searchPlaces(q, 4).map((p) => ({ label: placeLabel(p), lat: p.lat, lng: p.lng, precision: "city" as ResolvedPlace["precision"], country: p.country }));
  if (q.trim().length < 3 || !osmOn()) return local;
  const cached = readCache()[key(`search:${q}`)];
  let remote: ResolvedPlace[] = cached?.places ?? [];
  if (!cached) {
    const hits = await nominatim(q, 5);
    remote = (hits ?? []).map((h) => toPlace(h, h.addresstype && /^(city|town|village|municipality|state|county|country|suburb|neighbourhood)$/.test(h.addresstype) ? "city" : "address"));
    if (hits) remember(`search:${q}`, remote[0] ?? null, remote);
  }
  const out = [...local];
  for (const r of remote) {
    if (out.some((o) => Math.abs(o.lat - r.lat) < 0.02 && Math.abs(o.lng - r.lng) < 0.02)) continue;
    out.push({ label: r.precision === "address" ? r.name : placeLabel(r), lat: r.lat, lng: r.lng, precision: r.precision, country: r.country });
  }
  return out.slice(0, 7);
}
