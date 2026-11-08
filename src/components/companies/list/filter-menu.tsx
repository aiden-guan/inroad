"use client";

import * as DM from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/client/cn";

/** A multi-select filter: stays open while you tick options; the trigger summarizes the choice. */
export function FilterMenu<T extends string>({
  label,
  options,
  value,
  onChange,
  align = "start",
}: {
  label: string;
  options: { value: T; label: ReactNode; count?: number; hint?: string }[];
  value: Set<T>;
  onChange: (next: Set<T>) => void;
  align?: "start" | "end";
}) {
  const active = value.size > 0;
  const chosen = options.filter((o) => value.has(o.value));
  const summary = chosen.length === 1 ? chosen[0].label : chosen.length > 1 ? `${chosen.length}` : null;

  return (
    <DM.Root modal={false}>
      <DM.Trigger asChild>
        <button
          className={cn(
            "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[12.5px] font-medium ring-1 ring-inset transition-[background-color,color,box-shadow] duration-150 ease-out-quad",
            active ? "bg-surface text-fg ring-border-strong" : "text-fg-2 ring-border hover:bg-bg-subtle hover:text-fg",
          )}
        >
          <span className={cn(active && "text-fg-3")}>{label}</span>
          {summary && <span className="max-w-28 truncate">{summary}</span>}
          <ChevronDown className="size-3 shrink-0 text-fg-3" />
        </button>
      </DM.Trigger>
      <DM.Portal>
        <DM.Content
          align={align}
          sideOffset={6}
          className="z-[70] min-w-48 origin-[var(--radix-dropdown-menu-content-transform-origin)] overflow-hidden rounded-xl bg-surface-raised p-1.5 shadow-lg ring-1 ring-inset ring-border data-[state=closed]:animate-[pop-out_100ms_var(--ease-out)] data-[state=open]:animate-[pop-in_160ms_var(--ease-out)]"
        >
          {options.map((o) => (
            <DM.CheckboxItem
              key={o.value}
              checked={value.has(o.value)}
              onSelect={(e) => e.preventDefault()}
              onCheckedChange={(checked) => {
                const next = new Set(value);
                if (checked) next.add(o.value);
                else next.delete(o.value);
                onChange(next);
              }}
              className="flex h-9 cursor-default select-none items-center gap-2 rounded-sm px-2 text-[13px] text-fg outline-none data-[highlighted]:bg-bg-subtle"
            >
              <span className={cn("flex size-4 items-center justify-center rounded-[4px] ring-1 ring-border-strong", value.has(o.value) && "bg-primary ring-primary")}>
                <DM.ItemIndicator>
                  <Check className="size-3 text-primary-fg" strokeWidth={3} />
                </DM.ItemIndicator>
              </span>
              <span className="flex-1">{o.label}</span>
              {o.count !== undefined && <span className="font-mono text-[11px] tnum text-fg-3">{o.count}</span>}
            </DM.CheckboxItem>
          ))}
          {active && (
            <>
              <DM.Separator className="my-1 h-px bg-border" />
              <DM.Item
                onSelect={() => onChange(new Set())}
                className="flex h-9 cursor-default select-none items-center rounded-sm px-2 text-[12.5px] text-fg-2 outline-none data-[highlighted]:bg-bg-subtle"
              >
                Clear {label.toLowerCase()}
              </DM.Item>
            </>
          )}
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}
