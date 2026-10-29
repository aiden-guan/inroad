"use client";

import { AnimatePresence, motion } from "motion/react";
import { ChevronRight } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/client/cn";
import { spring } from "@/lib/motion";

/** At most one new line per beat, so a burst of thinking still reads at a human pace. */
const BEAT_MS = 720;
const LINE_PX = 20;

/**
 * The reasoning stream: the agent's summarized thinking scrolling by in a window up to three lines tall.
 * Lines are released one per beat; the column glides up as each one lands (an interruptible transition, so a
 * burst retargets instead of queueing) and older lines dissolve under a mask at the top.
 */
export function ReasoningStream({ lines, max = 3, className }: { lines: string[]; max?: number; className?: string }) {
  const [shown, setShown] = useState(Math.min(lines.length, 1));
  const col = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    if (shown >= lines.length) return;
    const t = setTimeout(() => setShown((n) => Math.min(lines.length, n + 1)), shown === 0 ? 0 : BEAT_MS);
    return () => clearTimeout(t);
  }, [shown, lines.length]);

  useLayoutEffect(() => {
    const el = col.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const cap = max * LINE_PX;
  const box = Math.min(height, cap);
  const overflow = height > cap;
  const visible = lines.slice(0, shown);

  return (
    <div
      aria-live="off"
      className={cn("fx-reason transition-[height] duration-500 ease-[var(--ease-reason)]", className)}
      style={{ height: box, "--reason-fade": overflow ? "18px" : "0px", "--reason-lh": `${LINE_PX}px` } as React.CSSProperties}
    >
      <div ref={col} className="fx-reason-col absolute inset-x-0 top-0" style={{ transform: `translateY(${box - height}px)` }}>
        {visible.map((line, i) => (
          <p
            key={i}
            className={cn(
              "fx-reason-line font-serif text-[13.5px] italic leading-5 [font-variation-settings:'opsz'_14]",
              i === visible.length - 1 ? "text-fg-2" : "text-fg-3 opacity-70",
            )}
          >
            {line}
          </p>
        ))}
      </div>
    </div>
  );
}

/** A finished run's reasoning, folded: one quiet line that opens the whole trace. */
export function ReasoningTrace({ lines, className }: { lines: string[]; className?: string }) {
  const [open, setOpen] = useState(false);
  if (!lines.length) return null;
  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="group inline-flex h-6 items-center gap-1.5 rounded-xs pr-1.5 text-[12px] text-fg-3 transition-colors hover:text-fg-2"
      >
        <ChevronRight className={cn("size-3 transition-transform duration-200 ease-out", open && "rotate-90")} />
        <span className="font-medium">Reasoning</span>
        <span className="font-mono text-[11px] tnum text-fg-4 transition-colors group-hover:text-fg-3">
          {lines.length} {lines.length === 1 ? "thought" : "thoughts"}
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0, transition: { duration: 0.15 } }}
            transition={spring.smooth}
            className="overflow-hidden"
          >
            <ol className="ml-[5px] mt-1 space-y-1 border-l border-border py-1 pl-3.5">
              {lines.map((line, i) => (
                <li key={i} className="fx-rise font-serif text-[13.5px] italic leading-5 text-fg-3" style={{ "--fx-i": Math.min(i, 10) } as React.CSSProperties}>
                  {line}
                </li>
              ))}
            </ol>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
