"use client";

import { cn } from "@/lib/client/cn";
import { useModKeys } from "@/lib/client/platform";

/** A key, labeled for this computer: "⌘K" reads "Ctrl K" off a Mac. */
export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  const keys = useModKeys();
  return (
    <kbd
      className={cn(
        "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-xs bg-bg-subtle px-1 font-mono text-[11px] leading-none text-fg-3 ring-1 ring-border",
        className,
      )}
    >
      {typeof children === "string" ? keys(children) : children}
    </kbd>
  );
}
