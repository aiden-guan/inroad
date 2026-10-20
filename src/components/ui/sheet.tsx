"use client";

import * as RD from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/client/cn";
import { IconButton } from "./button";

/**
 * Right-side sheet for detail views (company, deal, event). 500ms iOS drawer curve on enter.
 * Width grows instead of stacking: never open a modal on top of a sheet.
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  children,
  width = 640,
  header,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  width?: number;
  header?: ReactNode;
}) {
  return (
    <RD.Root open={open} onOpenChange={onOpenChange}>
      <RD.Portal>
        <RD.Overlay className="fixed inset-0 z-[50] bg-overlay/60 data-[state=open]:animate-[fade-in_300ms_var(--ease-out)] data-[state=closed]:animate-[fade-out_200ms_var(--ease-out)]" />
        <RD.Content
          style={{ maxWidth: width }}
          className={cn(
            "fixed inset-y-2 right-2 z-[51] flex w-[calc(100vw-16px)] flex-col overflow-hidden rounded-xl bg-surface-raised shadow-xl outline-none",
            "data-[state=open]:animate-[sheet-in_500ms_var(--ease-drawer)] data-[state=closed]:animate-[sheet-out_250ms_var(--ease-out)]",
          )}
        >
          <RD.Title className="sr-only">{title}</RD.Title>
          <RD.Description className="sr-only">{title} details</RD.Description>
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-5 py-3">
            <div className="min-w-0 flex-1">{header ?? <span className="text-[14px] font-semibold">{title}</span>}</div>
            <RD.Close asChild>
              <IconButton label="Close (Esc)">
                <X className="size-4" />
              </IconButton>
            </RD.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}
