"use client";

import * as RT from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";
import { cn } from "@/lib/client/cn";

export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <RT.Provider delayDuration={600} skipDelayDuration={300}>
      {children}
    </RT.Provider>
  );
}

export function Tooltip({
  content,
  children,
  side = "top",
  className,
}: {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  className?: string;
}) {
  if (!content) return <>{children}</>;
  return (
    <RT.Root>
      <RT.Trigger asChild>{children}</RT.Trigger>
      <RT.Portal>
        <RT.Content
          side={side}
          sideOffset={6}
          className={cn(
            "z-[80] max-w-72 origin-[var(--radix-tooltip-content-transform-origin)] rounded-sm bg-primary px-2 py-1 text-[12px] leading-4 text-primary-fg shadow-md",
            "data-[state=delayed-open]:animate-[tooltip-in_120ms_var(--ease-out)] data-[state=instant-open]:animate-none",
            className,
          )}
        >
          {content}
        </RT.Content>
      </RT.Portal>
    </RT.Root>
  );
}
