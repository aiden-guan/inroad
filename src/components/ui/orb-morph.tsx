"use client";

import { ViewTransition, useSyncExternalStore, type ReactNode } from "react";

const WIDE = "(min-width: 768px)";

function subscribeWide(cb: () => void) {
  const mq = window.matchMedia(WIDE);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

/** True at the md breakpoint and up, where the sidebar (not the phone header) carries the agent. */
export function useWide(): boolean {
  return useSyncExternalStore(
    subscribeWide,
    () => window.matchMedia(WIDE).matches,
    () => false,
  );
}

/**
 * The orb's one cross-route moment: when onboarding ends, the big orb on /welcome flies into the
 * sidebar (or the phone header) and lands with a small pop (globals.css, `.morph`). Each page shows two
 * orbs for two layouts, but a shared name may be mounted only once, so only the one this layout shows
 * carries it. Each layout has its own name because media-query subscribers can render independently
 * during hydration or resizing. `default="none"` keeps every other navigation still; reduced motion skips the flight.
 */
export function OrbMorph({ on, layout, children }: { on: boolean; layout: "desktop" | "phone"; children: ReactNode }) {
  if (!on) return children;
  return (
    <ViewTransition name={`ember-orb-${layout}`} share="morph" default="none">
      {children}
    </ViewTransition>
  );
}
