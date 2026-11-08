"use client";

import * as RD from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/client/cn";
import { IconButton } from "./button";
import { InkPattern } from "./ink-pattern";

/**
 * Right-side sheet for detail views (company, deal, event). Fast, origin-aware drawer motion.
 * Width grows instead of stacking: never open a modal on top of a sheet. With a `seed` (a company's
 * domain), the header carries that company's generative ink mark, inking in as the sheet lands.
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  children,
  width = 640,
  header,
  seed,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  width?: number;
  header?: ReactNode;
  seed?: string;
}) {
  return (
    <RD.Root open={open} onOpenChange={onOpenChange}>
      <RD.Portal>
        <RD.Overlay className="fixed inset-0 z-[50] bg-overlay/60 backdrop-blur-[2px] data-[state=open]:animate-[fade-in_250ms_var(--ease-out)] data-[state=closed]:animate-[fade-out_150ms_var(--ease-out)]" />
        <RD.Content
          style={{ maxWidth: width }}
          className={cn(
            "fixed inset-y-2 right-2 z-[51] flex w-[calc(100vw-16px)] flex-col overflow-hidden rounded-2xl bg-surface-raised shadow-xl ring-1 ring-inset ring-border outline-none",
            "data-[state=open]:animate-[sheet-in_280ms_var(--ease-drawer)] data-[state=closed]:animate-[sheet-out_180ms_var(--ease-out)]",
          )}
        >
          <RD.Title className="sr-only">{title}</RD.Title>
          <RD.Description className="sr-only">{title} details</RD.Description>
          <div className="relative isolate flex shrink-0 items-center justify-between gap-3 overflow-hidden border-b border-border px-5 py-3">
            {seed && (
              <div aria-hidden className="absolute inset-0 -z-10 text-fg opacity-[0.15] [mask-image:linear-gradient(to_left,#000_8%,transparent_62%)]">
                <InkPattern key={seed} seed={seed} reveal delay={160} scale={1.25} />
              </div>
            )}
            <div className="min-w-0 flex-1">{header ?? <span className="text-[14px] font-semibold">{title}</span>}</div>
            <RD.Close asChild>
              <IconButton label="Close (Esc)">
                <X className="size-4" />
              </IconButton>
            </RD.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}
