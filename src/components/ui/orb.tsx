"use client";

import { motion, useAnimationControls, useReducedMotion } from "motion/react";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/client/cn";

export type OrbState = "idle" | "working" | "needs" | "error";

/**
 * The agent's mark. Every motion maps to a real state — no idle "breathing":
 *  working → a ring sweeps once per 1.2s; each completed step (`tick`) pulses the core once
 *  needs   → a still ring, one ping when the state begins
 *  error   → the core goes gray; the reason is always written in text nearby
 */
export function Orb({ state = "idle", size = 20, tick = 0, className }: { state?: OrbState; size?: number; tick?: number; className?: string }) {
  const reduce = useReducedMotion();
  const core = useAnimationControls();
  const lastTick = useRef(tick);

  useEffect(() => {
    if (tick === lastTick.current) return;
    lastTick.current = tick;
    if (reduce) return;
    void core.start({ scale: [1, 1.12, 1], transition: { duration: 0.32, ease: [0.23, 1, 0.32, 1] } });
  }, [tick, core, reduce]);

  const ring = Math.max(1.5, size / 14);
  return (
    <span className={cn("relative inline-flex shrink-0 items-center justify-center", className)} style={{ width: size, height: size }} aria-hidden>
      {state === "working" && (
        <span
          className={cn("absolute inset-0 rounded-full", !reduce && "animate-orb-spin")}
          style={{
            background: "conic-gradient(from 0deg, var(--accent), transparent 70%)",
            WebkitMask: `radial-gradient(farthest-side, transparent calc(100% - ${ring}px), #000 calc(100% - ${ring}px))`,
            mask: `radial-gradient(farthest-side, transparent calc(100% - ${ring}px), #000 calc(100% - ${ring}px))`,
          }}
        />
      )}
      {state === "needs" && (
        <>
          <span className="absolute inset-0 rounded-full" style={{ boxShadow: `inset 0 0 0 ${ring}px var(--accent)` }} />
          {!reduce && <span key="ping" className="absolute inset-0 rounded-full bg-accent/40 [animation:orb-ping_1s_var(--ease-out)_1_forwards]" />}
        </>
      )}
      <motion.span
        animate={core}
        className="absolute rounded-full"
        style={{
          inset: state === "idle" || state === "error" ? 0 : ring + Math.max(1, size / 16),
          background:
            state === "error"
              ? "radial-gradient(circle at 35% 30%, var(--fg-4), var(--fg-3) 70%)"
              : "radial-gradient(circle at 34% 28%, color-mix(in oklab, var(--accent) 35%, white) 0%, var(--accent) 52%, color-mix(in oklab, var(--accent) 70%, black) 100%)",
          boxShadow: "inset 0 1px 0 rgb(255 255 255 / 0.35), 0 1px 2px rgb(0 0 0 / 0.12)",
          transition: "inset 200ms var(--ease-out)",
        }}
      />
    </span>
  );
}
