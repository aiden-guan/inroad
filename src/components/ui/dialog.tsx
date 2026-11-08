"use client";

import * as RD from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/client/cn";
import { IconButton } from "./button";

/** Centered modal. Enters in 200ms from scale .98; exits faster. */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
  hideClose,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
  hideClose?: boolean;
}) {
  return (
    <RD.Root open={open} onOpenChange={onOpenChange}>
      <RD.Portal>
        <RD.Overlay className="fixed inset-0 z-[60] bg-overlay backdrop-blur-[3px] data-[state=open]:animate-[fade-in_200ms_var(--ease-out)] data-[state=closed]:animate-[fade-out_150ms_var(--ease-out)]" />
        <RD.Content
          className={cn(
            "fixed left-1/2 top-[8dvh] z-[61] max-h-[84dvh] w-[calc(100vw-32px)] max-w-[520px] -translate-x-1/2 overflow-y-auto overscroll-contain rounded-2xl bg-surface-raised shadow-xl ring-1 ring-inset ring-border outline-none sm:top-[12dvh] sm:max-h-[76dvh]",
            "data-[state=open]:animate-[dialog-in_200ms_var(--ease-out)] data-[state=closed]:animate-[dialog-out_150ms_var(--ease-out)]",
            className,
          )}
          aria-describedby={description ? undefined : undefined}
        >
          {(title || !hideClose) && (
            <div className="flex items-start justify-between gap-4 px-5 pb-1 pt-5">
              <div>
                {title && <RD.Title className="text-[17px] font-medium leading-6 tracking-[-0.02em] text-fg">{title}</RD.Title>}
                {description && <RD.Description className="mt-1.5 text-pretty text-[13px] leading-5 text-fg-2">{description}</RD.Description>}
              </div>
              {!hideClose && (
                <RD.Close asChild>
                  <IconButton label="Close" className="-mr-1.5 -mt-0.5">
                    <X className="size-4" />
                  </IconButton>
                </RD.Close>
              )}
            </div>
          )}
          {!title && <RD.Title className="sr-only">Dialog</RD.Title>}
          {children}
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}
