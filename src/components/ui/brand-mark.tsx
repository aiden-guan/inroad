import type { CSSProperties } from "react";
import { cn } from "@/lib/client/cn";

/**
 * Two paths becoming one: the small, reusable Inroad signature.
 * `draw="once"` draws it in (the outer arch, then the inner one, then the bearings), for a page's first paint;
 * `draw="loop"` keeps drawing and releasing it, for an indeterminate wait.
 */
export function BrandMark({ className, draw }: { className?: string; draw?: "once" | "loop" }) {
  const stroke = (delay: number) =>
    draw ? { pathLength: 1, className: draw === "loop" ? "fx-draw-loop" : "fx-draw", style: { "--fx-delay": `${delay}ms` } as CSSProperties } : {};
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden className={cn("size-7 shrink-0", className)}>
      <path d="M7 25V16a9 9 0 0 1 18 0v9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" {...stroke(0)} />
      <path d="M13 25v-9a3 3 0 0 1 6 0v9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" {...stroke(draw === "loop" ? 160 : 220)} />
      <path
        d="M16 4v3M4 16h3M25 16h3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity=".4"
        className={draw === "once" ? "fx-rise" : undefined}
        style={draw === "once" ? ({ "--fx-delay": "760ms", "--fx-travel": "2px" } as CSSProperties) : undefined}
      />
    </svg>
  );
}
