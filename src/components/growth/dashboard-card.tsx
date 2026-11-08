"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDown, ArrowUp, Columns2, GripVertical, MoreHorizontal, StretchHorizontal, X } from "lucide-react";
import { useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { IconButton } from "@/components/ui/button";
import { Menu, MenuItem } from "@/components/ui/menu";
import { cn } from "@/lib/client/cn";
import type { GrowthCard } from "@/lib/consumer/dashboard";

export function DashboardCard({ card, title, editing, first, last, onMove, onWidth, onRemove, children }: {
  card: GrowthCard; title: string; editing: boolean; first: boolean; last: boolean;
  onMove: (direction: -1 | 1) => void; onWidth: () => void; onRemove: () => void; children: ReactNode;
}) {
  const reduce = useReducedMotion();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: card.id, disabled: !editing });
  return <div ref={setNodeRef} id={card.id === "waitlist" ? "waitlist" : undefined} data-growth-card={card.id} style={{ transform: CSS.Transform.toString(transform ? { ...transform, scaleX: 1, scaleY: 1 } : null), transition: reduce ? undefined : transition }} className={cn("relative flex min-w-0 flex-col rounded-xl", card.wide && "md:col-span-2 xl:col-span-3", isDragging && "z-20 opacity-60", editing && "bg-surface ring-1 ring-border-strong")}>
    {editing && <div className="flex items-center gap-2 border-b border-border px-3 py-2">
      <button ref={setActivatorNodeRef} {...attributes} {...listeners} aria-label={`Move ${title}`} className="flex size-8 shrink-0 touch-none cursor-grab items-center justify-center rounded-md text-fg-3 hover:bg-bg-subtle focus-visible:outline-2 focus-visible:outline-[var(--ring)] active:cursor-grabbing"><GripVertical className="size-4" aria-hidden /></button>
      <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-fg-2">{title}</span>
      <Menu trigger={<IconButton label={`Options for ${title}`} className="size-8"><MoreHorizontal className="size-4" /></IconButton>}>
        {!first && <MenuItem icon={<ArrowUp className="size-4" />} onSelect={() => onMove(-1)}>Move earlier</MenuItem>}
        {!last && <MenuItem icon={<ArrowDown className="size-4" />} onSelect={() => onMove(1)}>Move later</MenuItem>}
        <MenuItem icon={card.wide ? <Columns2 className="size-4" /> : <StretchHorizontal className="size-4" />} onSelect={onWidth}>{card.wide ? "Compact width" : "Full width"}</MenuItem>
        <MenuItem icon={<X className="size-4" />} onSelect={onRemove}>Hide card</MenuItem>
      </Menu>
    </div>}
    <div className={cn("min-w-0 flex-1", editing && "p-3 [&>section]:m-0 [&_section]:mt-0")}>{children}</div>
  </div>;
}
