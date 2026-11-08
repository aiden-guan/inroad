"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/client/cn";
import { ease, spring } from "@/lib/motion";

/**
 * The motion kit: small pieces with one shared vocabulary (8px of travel, a 2px blur, ~45ms between siblings,
 * ease-out to arrive, a small overshoot to land). The CSS-driven ones run on the compositor, so they stay
 * smooth while React is busy. Keyframes live in globals.css under "Motion kit"; reduced motion settles them.
 */

type FxVars = CSSProperties & Record<`--${string}`, string | number>;

/** Sibling index and start delay for the CSS-driven pieces (`fx-word`, `fx-rise`, `fx-digit`, …). */
export function fx(i: number, delayMs = 0, extra?: CSSProperties): FxVars {
  return { "--fx-i": i, "--fx-delay": `${delayMs}ms`, ...extra };
}

/* Which kind of input came last, shared by every component that asks. */
let lastInput: "keyboard" | "pointer" = "pointer";
const inputListeners = new Set<() => void>();
const markInput = (next: "keyboard" | "pointer") => () => {
  if (lastInput === next) return;
  lastInput = next;
  for (const listener of inputListeners) listener();
};
const onKeyInput = markInput("keyboard");
const onPointerInput = markInput("pointer");
function subscribeInput(listener: () => void) {
  if (!inputListeners.size) {
    window.addEventListener("keydown", onKeyInput, true);
    window.addEventListener("pointerdown", onPointerInput, true);
  }
  inputListeners.add(listener);
  return () => {
    inputListeners.delete(listener);
    if (inputListeners.size) return;
    window.removeEventListener("keydown", onKeyInput, true);
    window.removeEventListener("pointerdown", onPointerInput, true);
  };
}
/** True when the last input was a key: keyboard-driven changes snap instead of animating (they happen too often to wait on). */
export function useKeyboardDriven() {
  return useSyncExternalStore(subscribeInput, () => lastInput === "keyboard", () => false);
}

/**
 * True the first time `key` shows in this tab. Signature reveals play once a session, then the UI holds still.
 * It's marked seen from an effect, not during render: Next renders prefetched routes in hidden trees, where
 * render runs but effects wait until the tree is shown (and so do the CSS animations).
 */
export function useFirstSight(key: string) {
  const [first] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return !sessionStorage.getItem(`fx:${key}`);
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      sessionStorage.setItem(`fx:${key}`, "1");
    } catch {
      // private mode: the reveal may replay, which is harmless
    }
  }, [key]);
  return first;
}

/**
 * A line that arrives word by word, each word rising out of a blur. With `play` off it's plain text, so repeat
 * visits stay still. Give it a `key` when the text can change and the new text should arrive again.
 */
export function TextReveal({ text, play = true, delay = 0, step, className }: { text: string; play?: boolean; delay?: number; step?: number; className?: string }) {
  if (!play) return <span className={className}>{text}</span>;
  let n = 0;
  return (
    <span className={className} style={step ? ({ "--fx-step": `${step}ms` } as FxVars) : undefined}>
      {text.split(/(\s+)/).map((word, k) =>
        word.trim() ? (
          <span key={k} className="fx-word" style={fx(n++, delay)}>
            {word}
          </span>
        ) : (
          word
        ),
      )}
    </span>
  );
}

/**
 * A number that lands digit by digit: each glyph rises out of a blur with a small overshoot, 50ms apart.
 * Keyed by its text, so a new value lands again; `dir` -1 drops the digits in from above (the number fell).
 * Screen readers get the plain text once.
 */
export function DigitPop({ text, dir = 1, delay = 0, still, className }: { text: string; dir?: 1 | -1; delay?: number; still?: boolean; className?: string }) {
  if (still) return <span className={cn("whitespace-nowrap", className)}>{text}</span>;
  return (
    <span className={cn("inline-flex items-baseline whitespace-nowrap", className)}>
      <span className="sr-only">{text}</span>
      <span key={text} aria-hidden className="inline-flex items-baseline" style={{ "--fx-dir": dir } as FxVars}>
        {[...text].map((c, i) => (
          <span key={i} className="fx-digit" style={fx(i, delay)}>
            {c === " " ? " " : c}
          </span>
        ))}
      </span>
    </span>
  );
}

/**
 * `DigitPop` for a changing value: the first landing waits `delay` (or doesn't play, with `still`); every
 * later change lands at once, from the side the value moved.
 */
export function PopNumber({ value, format, delay = 0, still, className }: { value: number; format: (n: number) => string; delay?: number; still?: boolean; className?: string }) {
  const [seen, setSeen] = useState<{ value: number; dir: 1 | -1; changed: boolean }>({ value, dir: 1, changed: false });
  if (seen.value !== value) setSeen({ value, dir: value < seen.value ? -1 : 1, changed: true });
  return <DigitPop text={format(value)} dir={seen.dir} delay={seen.changed ? 0 : delay} still={still && !seen.changed} className={className} />;
}

/**
 * A status that swaps in place: the old line lifts away into a blur as the new one rises from below. While
 * `active` the glyphs carry the shimmer. Both copies share one grid cell, so the swap never shifts layout.
 */
export function StatusLine({ text, active, className }: { text: string; active?: boolean; className?: string }) {
  return (
    <span className={cn("relative inline-grid min-w-0 align-bottom [&>*]:[grid-area:1/1]", className)}>
      <AnimatePresence initial={false}>
        <motion.span
          key={text}
          initial={{ opacity: 0, y: 8, filter: "blur(2px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          exit={{ opacity: 0, y: -8, filter: "blur(2px)", transition: { duration: 0.14, ease: ease.out } }}
          transition={{ duration: 0.2, ease: ease.out, delay: 0.04 }}
          className={cn("block min-w-0 truncate", active && "shimmer-text")}
        >
          {text}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/** The success stamp: a disc lands with a small overshoot, the check draws itself, one ring goes out. `still` just shows it. */
export function CheckStamp({ size = 20, still, className }: { size?: number; still?: boolean; className?: string }) {
  return (
    <span className={cn("relative inline-flex shrink-0 items-center justify-center", className)} style={{ width: size, height: size }} aria-hidden>
      {!still && <span className="absolute inset-0 rounded-full bg-success/30 [animation:fx-ring_720ms_var(--ease-out)_140ms_both]" />}
      <span className={cn("absolute inset-0 rounded-full bg-success", !still && "[animation:fx-pop_440ms_var(--ease-overshoot)_both]")} />
      <svg viewBox="0 0 20 20" fill="none" className="relative size-[62%] text-bg">
        <path
          d="M5 10.5l3.2 3.2L15 7"
          pathLength={1}
          stroke="currentColor"
          strokeWidth={2.4}
          strokeLinecap="round"
          strokeLinejoin="round"
          className={still ? undefined : "fx-draw"}
          style={still ? undefined : ({ "--fx-delay": "150ms", animationDuration: "380ms" } as FxVars)}
        />
      </svg>
    </span>
  );
}

/**
 * An on/off switch with a physical thumb: it stretches toward the far side while pressed and springs across
 * on release. Ink, never the agent's blue.
 */
export function Switch({ on, onChange, label, children, className }: { on: boolean; onChange: (on: boolean) => void; label: string; children?: ReactNode; className?: string }) {
  const [pressed, setPressed] = useState(false);
  const thumb = pressed ? 17 : 14;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      onPointerCancel={() => setPressed(false)}
      className={cn(
        "inline-flex h-7 select-none items-center gap-2 rounded-full pl-1.5 pr-2.5 text-[12px] font-medium ring-1 ring-inset ring-border transition-[background-color,transform] duration-150 hover:bg-bg-subtle active:scale-[0.97]",
        className,
      )}
    >
      <span aria-hidden className={cn("relative flex h-[18px] w-[30px] shrink-0 items-center rounded-full p-[2px] transition-colors duration-200 ease-out", on ? "bg-fg" : "bg-border-strong")}>
        <motion.span
          initial={false}
          animate={{ x: on ? 26 - thumb : 0, width: thumb }}
          transition={spring.snappy}
          className="h-[14px] rounded-full bg-bg shadow-[0_1px_2px_rgb(0_0_0/0.2)]"
        />
      </span>
      {children}
    </button>
  );
}
