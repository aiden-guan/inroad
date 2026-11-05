"use client";

import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/client/cn";

/** Small pieces Buyer voice's rows share: URL state without a navigation, row ids and keyboard movement. */

/** Search params without a navigation, so the open theme and the filter survive reloads and can be linked to. */
export function setParams(params: URLSearchParams | { toString(): string }, patch: Record<string, string | null>) {
  const next = new URLSearchParams(params.toString());
  for (const [k, v] of Object.entries(patch)) {
    if (v) next.set(k, v);
    else next.delete(k);
  }
  const q = next.toString();
  window.history.replaceState(window.history.state, "", `${window.location.pathname}${q ? `?${q}` : ""}${window.location.hash}`);
}

export const themeDomId = (key: string) => `theme-${key.replace(/[^a-z0-9]+/gi, "-")}`;

/** Bring a theme or alternative row into view and give it focus (headlines and links land here). */
export function focusRow(id: string) {
  requestAnimationFrame(() => {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ block: "center" });
    el.querySelector<HTMLElement>("button[aria-expanded]")?.focus({ preventScroll: true });
  });
}

/** J/K or the arrow keys move between rows; Enter opens one. */
export function RovingList({ children, className }: { children: ReactNode; className?: string }) {
  const onKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    const keys = ["j", "k", "ArrowDown", "ArrowUp"];
    if (!keys.includes(e.key) || e.metaKey || e.ctrlKey || e.altKey) return;
    const target = e.target as HTMLElement;
    if (!target.matches("button[data-row]")) return;
    const rows = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("button[data-row]")];
    const i = rows.indexOf(target as HTMLButtonElement);
    const next = rows[e.key === "j" || e.key === "ArrowDown" ? i + 1 : i - 1];
    if (!next) return;
    e.preventDefault();
    next.focus();
  };
  return (
    <ul className={cn("space-y-2", className)} onKeyDown={onKeyDown}>
      {children}
    </ul>
  );
}

/** A link that opened a theme or an alternative (`?theme=`, `?alt=`) brings that row into view once, after the section's own scroll. */
export function useArrival(key: string | null) {
  const arrival = useRef(key);
  useEffect(() => {
    const k = arrival.current;
    if (!k) return;
    const timer = setTimeout(() => focusRow(themeDomId(k)), 160);
    return () => clearTimeout(timer);
  }, []);
}
