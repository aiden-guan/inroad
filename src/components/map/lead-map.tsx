"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import type { GeoJSONSource, Map as MlMap, Popup, StyleSpecification } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import { useTheme } from "@/components/shell/sidebar";
import { cn } from "@/lib/client/cn";
import { circleRing } from "@/lib/geo/places";

/**
 * The lead map: OpenFreeMap vector tiles (free, no key; only map tiles are requested, never lead
 * data) recolored into the app's paper, ink and blue pencil. Pins cluster when zoomed out, spread
 * when zoomed in, and the event's radius ring eases to its new size. Reduced motion jumps instead.
 */

export interface MapPin {
  id: string;
  lat: number;
  lng: number;
  group: "pipeline" | "prospect" | "customer";
  tier: "A" | "B" | "C";
  warm: boolean;
  /** Hover card: "Dana Okafor" / "Head of Revenue · Northwind" / "3.2 mi" */
  title: string;
  sub?: string;
  meta?: string;
}

interface Props {
  pins: MapPin[];
  center?: { lat: number; lng: number; label?: string };
  radiusKm?: number;
  selectedId?: string | null;
  hoveredId?: string | null;
  onSelect?: (id: string) => void;
  onHover?: (id: string | null) => void;
  /** Bump to re-fit the view to all pins. */
  fitKey?: string | number;
  /** Fly here (Companies → a metro). */
  focus?: { lat: number; lng: number; zoom?: number; key: string } | null;
  className?: string;
}

const STYLE_URL = "https://tiles.openfreemap.org/styles/positron";

const PALETTE = {
  light: {
    land: "#f3f0e9",
    water: "#dbe2ea",
    park: "#e5e9dc",
    residential: "#efebe3",
    building: "#e6e1d7",
    roadMinor: "#ffffff",
    roadMajor: "#fdfcf9",
    casing: "#e0dacf",
    motorway: "#f6f1e6",
    motorwayCasing: "#d6cebf",
    rail: "#dcd5c9",
    boundary: "#c4bcae",
    label: "#7a756c",
    city: "#3a3732",
    halo: "#f3f0e9",
    ink: "#1a1917",
    accent: "#2d4fd6",
    success: "#1f7a4d",
    paper: "#faf9f6",
  },
  dark: {
    land: "#151412",
    water: "#0d1015",
    park: "#161914",
    residential: "#191816",
    building: "#1e1d1a",
    roadMinor: "#242320",
    roadMajor: "#2a2825",
    casing: "#1b1a18",
    motorway: "#33302b",
    motorwayCasing: "#1b1a18",
    rail: "#2a2825",
    boundary: "#3f3b35",
    label: "#8d887f",
    city: "#cfcac0",
    halo: "#151412",
    ink: "#efece6",
    accent: "#7c93ff",
    success: "#4cc38a",
    paper: "#121110",
  },
} as const;

type Palette = (typeof PALETTE)[keyof typeof PALETTE];

/** setPaintProperty with the property name as a plain string (style layer ids and props vary by style version). */
const paintOf = (map: MlMap) => map.setPaintProperty.bind(map) as (layer: string, prop: string, value: unknown) => void;

/** Recolors the base layers by id. Unknown layers keep the style's own colors. */
function themeBase(map: MlMap, c: Palette) {
  const set = (id: string, prop: string, value: unknown) => {
    try {
      paintOf(map)(id, prop, value);
    } catch {
      // the layer or property isn't in this style version
    }
  };
  for (const layer of map.getStyle().layers ?? []) {
    const id = layer.id;
    if ((layer as { source?: string }).source === "inroad") continue;
    if (layer.type === "background") set(id, "background-color", c.land);
    else if (id === "water") set(id, "fill-color", c.water);
    else if (id === "waterway") set(id, "line-color", c.water);
    else if (id === "park" || id.startsWith("landcover")) set(id, "fill-color", c.park);
    else if (id.startsWith("landuse")) set(id, "fill-color", c.residential);
    else if (id === "building") {
      set(id, "fill-color", c.building);
      set(id, "fill-outline-color", c.casing);
    } else if (layer.type === "line" && /motorway/.test(id)) set(id, "line-color", /casing/.test(id) ? c.motorwayCasing : c.motorway);
    else if (layer.type === "line" && /casing/.test(id)) set(id, "line-color", c.casing);
    else if (layer.type === "line" && /major/.test(id)) set(id, "line-color", c.roadMajor);
    else if (layer.type === "line" && /(highway|road|path|minor|pier)/.test(id)) set(id, "line-color", c.roadMinor);
    else if (layer.type === "line" && /rail/.test(id)) set(id, "line-color", c.rail);
    else if (layer.type === "line" && /boundary/.test(id)) set(id, "line-color", c.boundary);
    else if (layer.type === "line" && /aeroway/.test(id)) set(id, "line-color", c.casing);
    else if (layer.type === "fill" && /aeroway|road_area/.test(id)) set(id, "fill-color", c.residential);
    else if (layer.type === "symbol") {
      set(id, "text-color", /label_(city|country|state)/.test(id) ? c.city : c.label);
      set(id, "text-halo-color", c.halo);
      set(id, "text-halo-width", 1.4);
    }
  }
}

function pinColor(c: Palette): unknown {
  return ["match", ["get", "group"], "pipeline", c.accent, "customer", c.success, c.ink];
}

function addLeadLayers(map: MlMap, c: Palette) {
  map.addSource("inroad-radius", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  map.addLayer({ id: "inroad-radius-fill", type: "fill", source: "inroad-radius", paint: { "fill-color": c.accent, "fill-opacity": 0.06 } });
  map.addLayer({
    id: "inroad-radius-line",
    type: "line",
    source: "inroad-radius",
    paint: { "line-color": c.accent, "line-opacity": 0.55, "line-width": 1.5, "line-dasharray": [2, 2] },
  });

  // The event: drawn under the leads, so a cluster on the venue stays readable. The halo breathes (see the pulse effect).
  map.addSource("inroad-center", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  map.addLayer({ id: "inroad-center-halo", type: "circle", source: "inroad-center", paint: { "circle-color": c.accent, "circle-opacity": 0.25, "circle-radius": 10 } });
  map.addLayer({
    id: "inroad-center",
    type: "circle",
    source: "inroad-center",
    paint: { "circle-color": c.accent, "circle-radius": 7, "circle-stroke-width": 3, "circle-stroke-color": c.paper },
  });

  map.addSource("inroad", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
    cluster: true,
    clusterMaxZoom: 10,
    clusterRadius: 36,
    clusterProperties: { pipeline: ["+", ["case", ["==", ["get", "group"], "pipeline"], 1, 0]] },
    promoteId: "id",
  });
  map.addLayer({
    id: "inroad-cluster",
    type: "circle",
    source: "inroad",
    filter: ["has", "point_count"],
    paint: {
      "circle-color": ["case", [">", ["get", "pipeline"], 0], c.accent, c.ink],
      "circle-opacity": 0.92,
      "circle-radius": ["step", ["get", "point_count"], 14, 5, 17, 12, 21, 30, 26],
      "circle-stroke-width": 3,
      "circle-stroke-color": c.paper,
      "circle-stroke-opacity": 0.9,
      "circle-radius-transition": { duration: 300 },
    },
  });
  map.addLayer({
    id: "inroad-cluster-count",
    type: "symbol",
    source: "inroad",
    filter: ["has", "point_count"],
    layout: { "text-field": ["get", "point_count_abbreviated"], "text-font": ["Noto Sans Bold"], "text-size": 12, "text-allow-overlap": true },
    paint: { "text-color": c.paper },
  });
  // Warm leads (the founder knows them or has a path in) get a blue-pencil ring.
  map.addLayer({
    id: "inroad-warm",
    type: "circle",
    source: "inroad",
    filter: ["all", ["!", ["has", "point_count"]], ["==", ["get", "warm"], true]],
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 8, 12, 11],
      "circle-color": "rgba(0,0,0,0)",
      "circle-stroke-width": 1.5,
      "circle-stroke-color": c.accent,
      "circle-stroke-opacity": 0.7,
    },
  });
  map.addLayer({
    id: "inroad-pin",
    type: "circle",
    source: "inroad",
    filter: ["!", ["has", "point_count"]],
    paint: {
      "circle-color": pinColor(c) as never,
      // Zoom must be the outermost input; size by tier, plus a bump while hovered or selected.
      "circle-radius": [
        "interpolate",
        ["linear"],
        ["zoom"],
        3,
        ["+", ["match", ["get", "tier"], "A", 5, "B", 4, 3.5], ["case", ["boolean", ["feature-state", "active"], false], 3, 0]],
        12,
        ["+", ["match", ["get", "tier"], "A", 7.5, "B", 6.5, 5.5], ["case", ["boolean", ["feature-state", "active"], false], 3, 0]],
      ],
      "circle-stroke-width": ["case", ["boolean", ["feature-state", "active"], false], 3, 2],
      "circle-stroke-color": ["case", ["boolean", ["feature-state", "active"], false], c.accent, c.paper],
      "circle-radius-transition": { duration: 180 },
      "circle-stroke-width-transition": { duration: 180 },
    },
  });
}

function recolorLeadLayers(map: MlMap, c: Palette) {
  const set = (id: string, prop: string, v: unknown) => map.getLayer(id) && paintOf(map)(id, prop, v);
  set("inroad-radius-fill", "fill-color", c.accent);
  set("inroad-center-halo", "circle-color", c.accent);
  set("inroad-center", "circle-color", c.accent);
  set("inroad-center", "circle-stroke-color", c.paper);
  set("inroad-radius-line", "line-color", c.accent);
  set("inroad-cluster", "circle-color", ["case", [">", ["get", "pipeline"], 0], c.accent, c.ink]);
  set("inroad-cluster", "circle-stroke-color", c.paper);
  set("inroad-cluster-count", "text-color", c.paper);
  set("inroad-warm", "circle-stroke-color", c.accent);
  set("inroad-pin", "circle-color", pinColor(c));
  set("inroad-pin", "circle-stroke-color", ["case", ["boolean", ["feature-state", "active"], false], c.accent, c.paper]);
}

const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** The box around a radius ring, so the camera frames the whole ring at any map size. */
function ringBounds(center: { lat: number; lng: number }, radiusKm: number): [[number, number], [number, number]] {
  let w = 180,
    s = 90,
    e = -180,
    n = -90;
  for (const [lng, lat] of circleRing(center, radiusKm, 32)) {
    w = Math.min(w, lng);
    e = Math.max(e, lng);
    s = Math.min(s, lat);
    n = Math.max(n, lat);
  }
  return [
    [w, s],
    [e, n],
  ];
}

function fallbackStyle(c: Palette): StyleSpecification {
  return { version: 8, glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf", sources: {}, layers: [{ id: "background", type: "background", paint: { "background-color": c.land } }] };
}

export function LeadMap({ pins, center, radiusKm, selectedId, hoveredId, onSelect, onHover, fitKey, focus, className }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const [ready, setReady] = useState(false);
  const [offline, setOffline] = useState(false);
  const { theme } = useTheme();
  const palette = PALETTE[theme === "dark" ? "dark" : "light"];
  const paletteRef = useRef(palette);
  const handlers = useRef({ onSelect, onHover });
  const ringRadius = useRef<number | undefined>(undefined);
  const popup = useRef<Popup | null>(null);
  const active = useRef<string | null>(null);

  useEffect(() => {
    handlers.current = { onSelect, onHover };
  }, [onSelect, onHover]);

  // Create the map once.
  useEffect(() => {
    let cancelled = false;
    let ro: ResizeObserver | null = null;
    void (async () => {
      const ml = await import("maplibre-gl");
      if (cancelled || !box.current) return;
      // The bundled module can't find its sibling worker file; serve it same-origin instead.
      ml.setWorkerUrl(`${window.location.origin}/api/vendor/maplibre-worker`);
      const c = paletteRef.current;
      let style: StyleSpecification | string = STYLE_URL;
      try {
        const res = await fetch(STYLE_URL, { cache: "force-cache" });
        style = res.ok ? ((await res.json()) as StyleSpecification) : fallbackStyle(c);
        if (!res.ok) setOffline(true);
      } catch {
        style = fallbackStyle(c);
        setOffline(true);
      }
      if (cancelled || !box.current) return;
      const map = new ml.Map({
        container: box.current,
        style,
        ...(center ? { bounds: ringBounds(center, radiusKm ?? 40), fitBoundsOptions: { padding: 28 } } : { center: [-40, 35] as [number, number], zoom: 1.6 }),
        attributionControl: { compact: true },
        cooperativeGestures: false,
        dragRotate: false,
        pitchWithRotate: false,
        fadeDuration: 180,
      });
      map.touchZoomRotate.disableRotation();
      map.addControl(new ml.NavigationControl({ showCompass: false }), "top-right");
      mapRef.current = map;
      popup.current = new ml.Popup({ closeButton: false, closeOnClick: false, offset: 12, className: "inroad-popup", maxWidth: "260px" });

      map.on("load", () => {
        if (cancelled) return;
        themeBase(map, paletteRef.current);
        addLeadLayers(map, paletteRef.current);
        setReady(true);
      });

      const pinAt = (e: { features?: { properties: Record<string, unknown> }[] }) => e.features?.[0]?.properties;
      map.on("mousemove", "inroad-pin", (e) => {
        const p = pinAt(e as never);
        if (!p) return;
        map.getCanvas().style.cursor = "pointer";
        handlers.current.onHover?.(String(p.id));
      });
      map.on("mouseleave", "inroad-pin", () => {
        map.getCanvas().style.cursor = "";
        handlers.current.onHover?.(null);
      });
      map.on("click", "inroad-pin", (e) => {
        const p = pinAt(e as never);
        if (p) handlers.current.onSelect?.(String(p.id));
      });
      map.on("mouseenter", "inroad-cluster", () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", "inroad-cluster", () => (map.getCanvas().style.cursor = ""));
      map.on("click", "inroad-cluster", async (e) => {
        const f = map.queryRenderedFeatures(e.point, { layers: ["inroad-cluster"] })[0];
        if (!f) return;
        const zoom = await (map.getSource("inroad") as GeoJSONSource).getClusterExpansionZoom(Number(f.properties.cluster_id));
        const [lng, lat] = (f.geometry as unknown as { coordinates: [number, number] }).coordinates;
        map.easeTo({ center: [lng, lat], zoom: zoom + 0.3, duration: reduced() ? 0 : 520 });
      });

      ro = new ResizeObserver(() => map.resize());
      ro.observe(box.current);
    })();
    return () => {
      cancelled = true;
      ro?.disconnect();
      popup.current?.remove();
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // The map is created once; later prop changes are applied by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Theme changes recolor in place (no style reload, so the view and pins stay put).
  useEffect(() => {
    paletteRef.current = palette;
    const map = mapRef.current;
    if (!map || !ready) return;
    themeBase(map, palette);
    recolorLeadLayers(map, palette);
  }, [palette, ready]);

  // Pins.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    (map.getSource("inroad") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: pins.map((p) => ({
        type: "Feature",
        id: p.id,
        geometry: { type: "Point", coordinates: [p.lng, p.lat] },
        properties: { id: p.id, group: p.group, tier: p.tier, warm: p.warm, title: p.title, sub: p.sub ?? "", meta: p.meta ?? "" },
      })),
    });
  }, [pins, ready]);

  // Fit to all pins when asked (first load, a filter change) and nothing else is framing the view.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || center || !pins.length) return;
    let w = 180,
      s = 90,
      e = -180,
      n = -90;
    for (const p of pins) {
      w = Math.min(w, p.lng);
      e = Math.max(e, p.lng);
      s = Math.min(s, p.lat);
      n = Math.max(n, p.lat);
    }
    map.fitBounds(
      [
        [w, s],
        [e, n],
      ],
      { padding: 64, maxZoom: 10.5, duration: reduced() ? 0 : 900 },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, ready]);

  // Fly to a requested spot.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !focus) return;
    const opts = { center: [focus.lng, focus.lat] as [number, number], zoom: focus.zoom ?? 10 };
    if (reduced()) map.jumpTo(opts);
    else map.flyTo({ ...opts, speed: 1.3, curve: 1.45, essential: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.key, ready]);

  // The event: a pulsing pin and a radius ring that eases between sizes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const src = map.getSource("inroad-radius") as GeoJSONSource;
    const dot = map.getSource("inroad-center") as GeoJSONSource;
    if (!center || !radiusKm) {
      src.setData({ type: "FeatureCollection", features: [] });
      dot.setData({ type: "FeatureCollection", features: [] });
      return;
    }
    let raf = 0;
    dot.setData({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [center.lng, center.lat] } });
    const from = ringRadius.current ?? radiusKm;
    const start = performance.now();
    const duration = reduced() || from === radiusKm ? 0 : 320;
    const draw = (r: number) => src.setData({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [circleRing(center, r)] } });
    const tick = (t: number) => {
      const k = duration ? Math.min(1, (t - start) / duration) : 1;
      const eased = 1 - Math.pow(1 - k, 3);
      draw(from + (radiusKm - from) * eased);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    ringRadius.current = radiusKm;
    const camera = map.cameraForBounds(ringBounds(center, radiusKm), { padding: 28 });
    if (camera) {
      if (reduced()) map.jumpTo(camera);
      else map.flyTo({ ...camera, speed: 1.2, curve: 1.42, essential: true });
    }
    return () => cancelAnimationFrame(raf);
  }, [center?.lat, center?.lng, center?.label, radiusKm, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  // The event's halo breathes: radius out, opacity down, every 2.4s. Static under reduced motion.
  const hasCenter = !!center;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !hasCenter || reduced()) return;
    let raf = 0;
    let last = 0;
    const loop = (t: number) => {
      // ~30fps is plenty for a slow pulse and halves the work.
      if (t - last > 33) {
        last = t;
        const k = (t % 2400) / 2400;
        const eased = 1 - Math.pow(1 - k, 3);
        if (map.getLayer("inroad-center-halo")) {
          paintOf(map)("inroad-center-halo", "circle-radius", 9 + eased * 26);
          paintOf(map)("inroad-center-halo", "circle-opacity", 0.32 * (1 - k));
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [ready, hasCenter]);

  // Highlight the hovered or selected pin, with a hover card.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const id = hoveredId ?? selectedId ?? null;
    if (active.current && active.current !== id) map.setFeatureState({ source: "inroad", id: active.current }, { active: false });
    active.current = id;
    if (!id) {
      popup.current?.remove();
      return;
    }
    map.setFeatureState({ source: "inroad", id }, { active: true });
    const pin = pins.find((p) => p.id === id);
    if (!pin || !popup.current) return;
    const el = document.createElement("div");
    const t = document.createElement("p");
    t.className = "inroad-popup-title";
    t.textContent = pin.title;
    el.append(t);
    if (pin.sub) {
      const s = document.createElement("p");
      s.className = "inroad-popup-sub";
      s.textContent = pin.sub;
      el.append(s);
    }
    if (pin.meta) {
      const m = document.createElement("p");
      m.className = "inroad-popup-meta";
      m.textContent = pin.meta;
      el.append(m);
    }
    popup.current.setLngLat([pin.lng, pin.lat]).setDOMContent(el).addTo(map);
  }, [hoveredId, selectedId, pins, ready]);

  return (
    <div className={cn("inroad-map relative overflow-hidden rounded-xl bg-bg-subtle ring-1 ring-border", className)}>
      <div ref={box} className="h-full w-full" />
      {!ready && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="shimmer-text text-[12.5px]">Drawing the map…</span>
        </div>
      )}
      {offline && ready && <p className="absolute left-3 top-3 rounded-sm bg-surface/90 px-2 py-1 text-[11.5px] text-fg-3 ring-1 ring-border">Map tiles are unavailable offline. Pins still show.</p>}
    </div>
  );
}
