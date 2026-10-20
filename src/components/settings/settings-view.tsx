"use client";

import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Button } from "@/components/ui/button";
import { EmptyState, Skeleton } from "@/components/ui/misc";
import { cn } from "@/lib/client/cn";
import { todayISO } from "@/lib/domain/ids";
import { spring } from "@/lib/motion";
import { DataSection } from "./data";
import { GeneralSection } from "./general";
import { SendingSection } from "./sending";
import { UsageSection } from "./usage";
import { useSettingsStatus } from "./use-settings";
import { YouSection } from "./you";

const SECTIONS = [
  { id: "general", label: "General" },
  { id: "you", label: "You" },
  { id: "sending", label: "Sending" },
  { id: "usage", label: "Usage & budget" },
  { id: "data", label: "Data" },
] as const;
type SectionId = (typeof SECTIONS)[number]["id"];
const IDS = SECTIONS.map((s) => s.id);
const nowMs = () => Date.now();

function scrollToId(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  history.replaceState(history.state, "", `#${id}`);
}

/** The section crossing the top third of the viewport. */
function useScrollSpy(ready: boolean): SectionId | null {
  const [active, setActive] = useState<SectionId | null>(null);
  useEffect(() => {
    if (!ready) return;
    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.add(e.target.id);
          else visible.delete(e.target.id);
        }
        const current = IDS.filter((id) => visible.has(id)).at(-1);
        if (current) setActive(current);
      },
      { rootMargin: "-10% 0px -60% 0px" },
    );
    for (const id of IDS) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [ready]);
  return active;
}

/**
 * Settings: one calm document. Left subnav (General · You · Sending · Usage & budget · Data),
 * deep-linkable by hash (`/settings#usage`, `#sending`, `#domain`, `#suppression`, `#api-key`…).
 */
export function SettingsView() {
  const { ws, loading, error, dispatch, refresh } = useWorkspace();
  const settings = useSettingsStatus();
  const [now] = useState(nowMs);
  const [today] = useState(todayISO);
  const ready = !!ws;
  const active = useScrollSpy(ready);

  // Arriving from a link (/settings#usage): bring the target into view once the document exists.
  const arrived = useRef(false);
  useEffect(() => {
    if (!ready || arrived.current) return;
    arrived.current = true;
    const target = window.location.hash.slice(1);
    if (!target) return;
    const frame = requestAnimationFrame(() => document.getElementById(target)?.scrollIntoView({ block: "start" }));
    return () => cancelAnimationFrame(frame);
  }, [ready]);

  // Keep the active chip visible in the phone-width section strip.
  useEffect(() => {
    if (!active) return;
    // Scroll only the strip; scrollIntoView could interrupt the page's own smooth scroll.
    const chip = document.getElementById(`settings-chip-${active}`);
    const strip = chip?.closest("ol");
    if (!chip || !strip || !strip.clientWidth) return;
    const c = chip.getBoundingClientRect();
    const box = strip.getBoundingClientRect();
    if (c.left < box.left || c.right > box.right) strip.scrollBy({ left: c.left - box.left - 8, behavior: "smooth" });
  }, [active]);

  if (!ws) {
    if (loading) return <SettingsSkeleton />;
    return (
      <EmptyState
        title="Couldn't open settings"
        body={error ?? "Something went wrong loading your workspace."}
        action={
          <Button variant="primary" onClick={() => void refresh()}>
            Try again
          </Button>
        }
      />
    );
  }

  const current: SectionId = active ?? "general";

  return (
    <div className="@container/page">
      <div
        className={cn(
          "mx-auto w-full max-w-[1000px] px-6 pb-32 pt-8 md:px-10 md:pt-12",
          "@min-[960px]/page:grid @min-[960px]/page:grid-cols-[156px_minmax(0,720px)] @min-[960px]/page:justify-center @min-[960px]/page:gap-x-12",
        )}
      >
        <aside className="hidden @min-[960px]/page:block">
          <nav aria-label="Settings sections" className="sticky top-8 pt-1">
            <ol className="space-y-0.5">
              {SECTIONS.map((s) => {
                const on = s.id === current;
                return (
                  <li key={s.id}>
                    <a
                      href={`#${s.id}`}
                      onClick={(e) => {
                        e.preventDefault();
                        scrollToId(s.id);
                      }}
                      aria-current={on ? "location" : undefined}
                      className={cn("relative flex h-8 items-center rounded-sm px-2.5 text-[13.5px] transition-colors duration-150", on ? "font-medium text-fg" : "text-fg-2 hover:text-fg")}
                    >
                      {on && <motion.span layoutId="settings-nav" transition={spring.snappy} className="absolute inset-0 rounded-sm bg-surface shadow-xs ring-1 ring-border" />}
                      <span className="relative flex-1">{s.label}</span>
                    </a>
                  </li>
                );
              })}
            </ol>
          </nav>
        </aside>

        <div className="mx-auto w-full min-w-0 max-w-[720px] @min-[960px]/page:mx-0">
          <header className="mb-8">
            <h1 className="font-serif text-[32px] leading-[36px] tracking-[-0.02em] text-fg [font-variation-settings:'opsz'_72]">Settings</h1>
            <p className="mt-2 max-w-[58ch] text-[14px] leading-[21px] text-fg-2">Everything here saves as you go and stays on this computer.</p>
          </header>

          <nav
            aria-label="Settings sections"
            className="sticky top-12 z-30 -mx-6 mb-8 border-b border-border bg-bg/90 px-6 backdrop-blur md:top-0 md:-mx-10 md:px-10 @min-[960px]/page:hidden"
          >
            <ol className="scrollbar-none -mx-1 flex gap-1 overflow-x-auto px-1 py-2">
              {SECTIONS.map((s) => {
                const on = s.id === current;
                return (
                  <li key={s.id} className="shrink-0">
                    <a
                      id={`settings-chip-${s.id}`}
                      href={`#${s.id}`}
                      onClick={(e) => {
                        e.preventDefault();
                        scrollToId(s.id);
                      }}
                      aria-current={on ? "location" : undefined}
                      className={cn(
                        "inline-flex h-8 items-center rounded-sm px-3 text-[13px] transition-colors duration-150",
                        on ? "bg-surface font-medium text-fg shadow-xs ring-1 ring-border" : "text-fg-2 hover:text-fg",
                      )}
                    >
                      {s.label}
                    </a>
                  </li>
                );
              })}
            </ol>
          </nav>

          <div>
            <GeneralSection settings={settings} />
            <YouSection ws={ws} dispatch={dispatch} />
            <SendingSection ws={ws} dispatch={dispatch} refresh={refresh} now={now} today={today} />
            <UsageSection ws={ws} dispatch={dispatch} now={now} />
            <DataSection ws={ws} refresh={refresh} dataDir={settings.status?.dataDir ?? null} today={today} />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Matches the document's layout; fades in after 150ms so fast loads never flash it. */
export function SettingsSkeleton() {
  return (
    <div className="@container/page">
      <div
        className="mx-auto w-full max-w-[1000px] px-6 pt-8 [animation:fade-in_200ms_var(--ease-out)_150ms_both] md:px-10 md:pt-12 @min-[960px]/page:grid @min-[960px]/page:grid-cols-[156px_minmax(0,720px)] @min-[960px]/page:justify-center @min-[960px]/page:gap-x-12"
        aria-busy="true"
        aria-label="Loading settings"
      >
        <div className="hidden space-y-2 @min-[960px]/page:block">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-6 w-28" />
          ))}
        </div>
        <div className="w-full max-w-[720px]">
          <Skeleton className="h-9 w-36" />
          <Skeleton className="mt-3 h-4 w-[60%]" />
          <Skeleton className="mt-12 h-8 w-28" />
          <Skeleton className="mt-6 h-24 w-full rounded-lg" />
          <Skeleton className="mt-8 h-14 w-full rounded-lg" />
          <Skeleton className="mt-8 h-32 w-full rounded-lg" />
        </div>
      </div>
    </div>
  );
}
