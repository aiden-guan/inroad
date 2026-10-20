"use client";

import { TriangleAlert } from "lucide-react";
import { useState, useSyncExternalStore, type ReactNode } from "react";
import { CopyButton } from "@/components/ui/misc";
import { cn } from "@/lib/client/cn";
import { relativeTime } from "@/lib/client/format";

/* Small pieces shared by the agents card and the import flow. */

/** One copyable machine value. Secrets can be shown masked via `display`. */
export function CopyField({ value, display, label = "Copy", className }: { value: string; display?: string; label?: string; className?: string }) {
  return (
    <div className={cn("flex min-w-0 items-center gap-2 rounded-md bg-sunken py-1 pl-2.5 pr-1 ring-1 ring-border", className)}>
      <code className="min-w-0 flex-1 truncate font-mono text-[12px] leading-6 text-fg" title={display ? undefined : value}>
        {display ?? value}
      </code>
      <CopyButton text={value} label={label} className="h-6 shrink-0 bg-surface" />
    </div>
  );
}

/** Multi-line code. Scrolls inside itself so the page never scrolls sideways at 375px. */
export function CodeBlock({ code, label = "Copy", wrap, className }: { code: string; label?: string; wrap?: boolean; className?: string }) {
  return (
    <div className={cn("relative min-w-0", className)}>
      <pre
        className={cn(
          "max-h-64 overflow-auto rounded-md bg-sunken p-3 font-mono text-[12px] leading-[18px] text-fg-2 ring-1 ring-border",
          // Prose (a prompt) wraps and leaves room for the button above it; commands keep their lines.
          wrap ? "whitespace-pre-wrap break-words pt-10" : "pr-[76px]",
        )}
      >
        {code}
      </pre>
      <CopyButton text={code} label={label} className="absolute right-1.5 top-1.5 h-6 bg-surface" />
    </div>
  );
}

export function Callout({ children, tone = "neutral", className }: { children: ReactNode; tone?: "warning" | "neutral"; className?: string }) {
  return (
    <div className={cn("flex gap-2.5 rounded-md px-3 py-2.5 text-[13px] leading-[19px]", tone === "warning" ? "bg-warning-subtle text-fg" : "bg-bg-subtle text-fg-2", className)}>
      {tone === "warning" && <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** Two clicks for mild, reversible-by-recreating actions (revoke a key). The second click within 3s confirms. */
export function ConfirmButton({ children, confirmLabel, onConfirm, className }: { children: ReactNode; confirmLabel: string; onConfirm: () => void; className?: string }) {
  const [armed, setArmed] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else {
          setArmed(true);
          setTimeout(() => setArmed(false), 3000);
        }
      }}
      onBlur={() => setArmed(false)}
      className={cn(
        "inline-flex h-7 items-center rounded-sm px-2 text-[12px] font-medium transition-[background-color,color,transform] duration-150 active:scale-[0.97]",
        armed ? "bg-danger-subtle text-danger" : "text-fg-3 hover:bg-bg-subtle hover:text-fg-2",
        className,
      )}
    >
      {armed ? confirmLabel : children}
    </button>
  );
}

export function SubLabel({ children, right, className }: { children: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <div className={cn("mb-2 flex items-center justify-between gap-3", className)}>
      <p className="text-[12px] font-medium text-fg-3">{children}</p>
      {right}
    </div>
  );
}

/* ───────────── A shared clock for "2m ago", without Date.now() in render ───────────── */

let now = 0;
let timer: ReturnType<typeof setInterval> | undefined;
const subscribers = new Set<() => void>();

function subscribe(cb: () => void) {
  subscribers.add(cb);
  if (!timer) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      subscribers.forEach((f) => f());
    }, 15_000);
  }
  return () => {
    subscribers.delete(cb);
    if (!subscribers.size && timer) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

/** Current time, refreshed every 15s. 0 during server render (callers show nothing then). */
export function useNow(): number {
  return useSyncExternalStore(
    subscribe,
    () => now,
    () => 0,
  );
}

/** Forces the shared clock forward (after an action that just happened). */
export function tickNow() {
  now = Date.now();
  subscribers.forEach((f) => f());
}

export function Ago({ iso, className }: { iso?: string; className?: string }) {
  const t = useNow();
  if (!iso || !t) return null;
  return <span className={cn("tnum", className)}>{relativeTime(iso, t)}</span>;
}

/* ───────────── Where this app is reachable ───────────── */

const noop = () => () => {};

/** `window.location.origin` without reading window during render on the server. */
export function useOrigin(): string {
  return useSyncExternalStore(
    noop,
    () => window.location.origin,
    () => "",
  );
}

export const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:\d+)?$/i;
