"use client";

import { Building2, MapPin, Search } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/client/cn";
import { placeLabel, searchPlaces } from "@/lib/geo/places";

export interface PickedPlace {
  label: string;
  lat: number;
  lng: number;
  precision: "city" | "address";
}

/**
 * A city or a venue. Known cities answer as you type (no network); after a short pause,
 * OpenStreetMap adds places and street addresses. Arrow keys and Enter work as in a menu.
 */
export function PlacePicker({ value, onPick, placeholder = "City or venue address", autoFocus, className }: { value?: string; onPick: (p: PickedPlace) => void; placeholder?: string; autoFocus?: boolean; className?: string }) {
  const id = useId();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [remote, setRemote] = useState<{ q: string; results: PickedPlace[] }>({ q: "", results: [] });
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  const local: PickedPlace[] = searchPlaces(q, 4).map((p) => ({ label: placeLabel(p), lat: p.lat, lng: p.lng, precision: "city" }));
  const fromServer = remote.q === q.trim() ? remote.results : [];
  const results = [...local, ...fromServer.filter((r) => !local.some((l) => Math.abs(l.lat - r.lat) < 0.02 && Math.abs(l.lng - r.lng) < 0.02))].slice(0, 7);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 3) return;
    const t = setTimeout(() => {
      fetch(`/api/geo/search?q=${encodeURIComponent(term)}`)
        .then((r) => (r.ok ? r.json() : { results: [] }))
        .then((body: { results: PickedPlace[] }) => setRemote({ q: term, results: body.results ?? [] }))
        .catch(() => setRemote({ q: term, results: [] }));
    }, 320);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const pick = (p: PickedPlace) => {
    onPick(p);
    setQ("");
    setOpen(false);
  };

  const searching = q.trim().length >= 3 && remote.q !== q.trim();
  return (
    <div ref={box} className={cn("relative", className)}>
      <div className="flex h-8 items-center gap-2 rounded-sm bg-surface px-2.5 ring-1 ring-border-strong/70 transition-shadow focus-within:ring-2 focus-within:ring-[var(--ring)]">
        <Search className="size-3.5 shrink-0 text-fg-3" aria-hidden />
        <input
          id={id}
          role="combobox"
          aria-expanded={open && results.length > 0}
          aria-controls={`${id}-list`}
          aria-label="Event location"
          autoFocus={autoFocus}
          autoComplete="off"
          value={q}
          placeholder={value ? `${value} · change` : placeholder}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(results.length - 1, a + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === "Enter" && results[active]) {
              e.preventDefault();
              pick(results[active]);
            } else if (e.key === "Escape") setOpen(false);
          }}
          className="h-full min-w-0 flex-1 bg-transparent text-[13px] text-fg outline-none placeholder:text-fg-3"
        />
        {searching && <span className="shimmer-text shrink-0 text-[11px]">Searching</span>}
      </div>
      {open && q.trim().length >= 2 && (results.length > 0 || !searching) && (
        <ul
          id={`${id}-list`}
          role="listbox"
          className="absolute left-0 right-0 top-[calc(100%+6px)] z-30 overflow-hidden rounded-lg bg-surface-raised p-1 shadow-lg ring-1 ring-border animate-[pop-in_140ms_var(--ease-out)]"
        >
          {results.map((r, i) => (
            <li key={`${r.label}-${r.lat}`} role="option" aria-selected={i === active}>
              <button
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(r)}
                className={cn("flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] text-fg", i === active && "bg-bg-subtle")}
              >
                {r.precision === "address" ? <Building2 className="size-3.5 shrink-0 text-fg-3" aria-hidden /> : <MapPin className="size-3.5 shrink-0 text-fg-3" aria-hidden />}
                <span className="min-w-0 flex-1 truncate">{r.label}</span>
                <span className="shrink-0 text-[11px] text-fg-4">{r.precision === "address" ? "Venue" : "City"}</span>
              </button>
            </li>
          ))}
          {!results.length && <li className="px-2 py-2 text-[12.5px] text-fg-3">No place by that name.</li>}
        </ul>
      )}
    </div>
  );
}
