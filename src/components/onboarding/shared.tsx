"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Orb } from "@/components/ui/orb";
import { BRAND } from "@/lib/brand";
import type { Account, RunSummary, Workspace } from "@/lib/domain/types";

/** A ticking clock for elapsed timers. Only runs while `active`; `from` is the value before the first tick. */
export function useNow(active: boolean, from: number): number {
  const [now, setNow] = useState(from);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

/**
 * Keeps the workspace fresh while the first run writes to it: refreshes whenever the live runs report a new step
 * (throttled), with a slow poll as a safety net.
 */
export function useLiveRefresh(active: boolean, pulse: string) {
  const { refresh } = useWorkspace();
  const last = useRef(0);
  useEffect(() => {
    if (!active) return;
    const wait = Math.max(0, 500 - (Date.now() - last.current));
    const t = setTimeout(() => {
      last.current = Date.now();
      void refresh();
    }, wait);
    return () => clearTimeout(t);
  }, [active, pulse, refresh]);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => void refresh(), 3000);
    return () => clearInterval(t);
  }, [active, refresh]);
}

/** "1:07" — the elapsed clock in the reading header. */
export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
}

/** Keys pressed inside a popover, menu or dialog belong to it (Esc closes the overlay, not the run). */
export function inOverlay(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return !!el?.closest?.('[role="dialog"],[role="menu"],[role="listbox"],[data-radix-popper-content-wrapper]');
}


/** Accepts "acme.com", "https://www.acme.com/about" → "acme.com". Null when it isn't a plausible site. */
export function domainOf(input: string): string | null {
  const raw = input.trim();
  if (!raw || /\s/.test(raw)) return null;
  try {
    const host = new URL(raw.includes("://") ? raw : `https://${raw}`).hostname.toLowerCase().replace(/^www\./, "");
    return /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(host) ? host : null;
  } catch {
    return null;
  }
}

export function runSummary(ws: Workspace, id: string | undefined): RunSummary | undefined {
  return id ? ws.runs.find((r) => r.id === id) : undefined;
}

/** The order discovery ranks in: fit × (1 + whyNow / 2), tier first. Customers (the users the founder named) are never prospects. */
export function rankAccounts(accounts: Account[]): Account[] {
  const tier = { A: 0, B: 1, C: 2 } as const;
  return accounts.filter((a) => a.status !== "customer").sort(
    (a, b) => tier[a.tier] - tier[b.tier] || b.fitScore * (1 + b.whyNowScore / 2) - a.fitScore * (1 + a.whyNowScore / 2) || a.addedAt.localeCompare(b.addedAt),
  );
}

export function Wordmark() {
  return (
    <div className="flex items-center gap-2">
      <Orb size={14} />
      <span className="font-serif text-[18px] font-medium tracking-[-0.02em] text-fg">{BRAND.product}</span>
    </div>
  );
}

/** Paper canvas with the wordmark; every first-run step sits inside it. */
export function Canvas({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-bg">
      <header className="flex h-14 items-center px-4 sm:px-6 md:px-10">
        <Wordmark />
      </header>
      {children}
    </div>
  );
}
