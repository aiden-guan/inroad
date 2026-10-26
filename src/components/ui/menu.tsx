"use client";

import * as DM from "@radix-ui/react-dropdown-menu";
import * as RP from "@radix-ui/react-popover";
import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/client/cn";

const surface =
  "z-[70] min-w-44 overflow-hidden rounded-lg bg-surface-raised p-1 shadow-lg ring-1 ring-border " +
  "data-[state=open]:animate-[pop-in_160ms_var(--ease-out)] data-[state=closed]:animate-[pop-out_100ms_var(--ease-in-quad)]";

export function Menu({ trigger, children, align = "end" }: { trigger: ReactNode; children: ReactNode; align?: "start" | "end" | "center" }) {
  return (
    <DM.Root>
      <DM.Trigger asChild>{trigger}</DM.Trigger>
      <DM.Portal>
        <DM.Content align={align} sideOffset={6} className={cn(surface, "origin-[var(--radix-dropdown-menu-content-transform-origin)]")}>
          {children}
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}

export function MenuItem({
  children,
  onSelect,
  icon,
  danger,
  hint,
}: {
  children: ReactNode;
  onSelect?: () => void;
  icon?: ReactNode;
  danger?: boolean;
  hint?: ReactNode;
}) {
  return (
    <DM.Item
      onSelect={onSelect}
      className={cn(
        "flex h-8 cursor-default select-none items-center gap-2 rounded-sm px-2 text-[13px] outline-none",
        "data-[highlighted]:bg-bg-subtle",
        danger ? "text-danger" : "text-fg",
      )}
    >
      {icon && <span className="flex size-4 items-center justify-center text-fg-3">{icon}</span>}
      <span className="flex-1">{children}</span>
      {hint && <span className="text-[12px] text-fg-3">{hint}</span>}
    </DM.Item>
  );
}

/** A menu item that toggles (a tag, a filter). The menu stays open so several can be set in one go. */
export function MenuCheckItem({ children, checked, onCheckedChange }: { children: ReactNode; checked: boolean; onCheckedChange: (checked: boolean) => void }) {
  return (
    <DM.CheckboxItem
      checked={checked}
      onCheckedChange={(v) => onCheckedChange(v === true)}
      onSelect={(e) => e.preventDefault()}
      className="flex h-8 cursor-default select-none items-center gap-2 rounded-sm px-2 text-[13px] text-fg outline-none data-[highlighted]:bg-bg-subtle"
    >
      <span className="flex size-4 items-center justify-center text-fg-2">
        <DM.ItemIndicator>
          <Check className="size-3.5" aria-hidden />
        </DM.ItemIndicator>
      </span>
      <span className="flex-1">{children}</span>
    </DM.CheckboxItem>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <DM.Label className="px-2 pb-1 pt-1.5 text-[11px] font-medium text-fg-3">{children}</DM.Label>;
}

export function MenuSeparator() {
  return <DM.Separator className="my-1 h-px bg-border" />;
}

export function Popover({
  trigger,
  children,
  align = "start",
  open,
  onOpenChange,
  className,
}: {
  trigger: ReactNode;
  children: ReactNode;
  align?: "start" | "end" | "center";
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}) {
  return (
    <RP.Root open={open} onOpenChange={onOpenChange}>
      <RP.Trigger asChild>{trigger}</RP.Trigger>
      <RP.Portal>
        <RP.Content
          align={align}
          sideOffset={6}
          className={cn(surface, "origin-[var(--radix-popover-content-transform-origin)] p-3", className)}
        >
          {children}
        </RP.Content>
      </RP.Portal>
    </RP.Root>
  );
}
