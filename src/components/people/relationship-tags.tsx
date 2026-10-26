"use client";

import { Tag } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { postJson } from "@/components/import/api";
import { Badge } from "@/components/ui/badge";
import { Menu, MenuCheckItem, MenuLabel } from "@/components/ui/menu";
import { cn } from "@/lib/client/cn";
import type { RelationshipTag } from "@/lib/domain/types";
import { PICKABLE_TAGS, TAG_LABEL, knowsByTag } from "@/lib/network/tags";

/**
 * "How do they know you?" in one click: design partner, past user, ex-colleague, investor, connector.
 * Saved on the person's LinkedIn connection and their record, so when someone who knows the product
 * changes jobs, the next re-import flags it as the strongest signal there is.
 */
export function TagMenu({
  connectionId,
  personId,
  tags,
  name,
  onChange,
  className,
}: {
  connectionId?: string;
  personId?: string;
  tags?: RelationshipTag[];
  name: string;
  onChange?: (tags: RelationshipTag[]) => void;
  className?: string;
}) {
  const [current, setCurrent] = useState<RelationshipTag[]>(tags ?? []);
  const [prop, setProp] = useState(tags);
  // Follow the parent when it reloads (a refetch, another row tagged the same person).
  if (prop !== tags) {
    setProp(tags);
    setCurrent(tags ?? []);
  }

  async function toggle(tag: RelationshipTag, on: boolean) {
    const before = current;
    const next = on ? [...current.filter((t) => t !== tag), tag] : current.filter((t) => t !== tag);
    setCurrent(next);
    try {
      const r = await postJson<{ tags: RelationshipTag[] }>("/api/network/tags", { connectionId, personId, tags: next });
      setCurrent(r.tags);
      onChange?.(r.tags);
      if (on && knowsByTag([tag]) && !knowsByTag(before)) toast(`If ${name.split(" ")[0]} changes jobs, I'll flag it first.`);
    } catch (e) {
      setCurrent(before);
      toast.error(e instanceof Error ? e.message : "That tag didn't save.");
    }
  }

  const shown = current.filter((t) => t !== "signup" && t !== "customer");
  const auto = current.filter((t) => t === "signup" || t === "customer");
  return (
    <Menu
      align="end"
      trigger={
        <button
          type="button"
          aria-label={`How ${name} knows you`}
          className={cn(
            "inline-flex h-6 shrink-0 items-center gap-1 rounded-xs px-1.5 text-[12px] text-fg-3 ring-1 ring-inset ring-transparent transition-colors duration-150 hover:bg-bg-subtle hover:text-fg-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] data-[state=open]:bg-bg-subtle",
            className,
          )}
        >
          {[...shown, ...auto].length ? (
            <>
              {[...shown, ...auto].slice(0, 2).map((t) => (
                <Badge key={t} tone={knowsByTag([t]) ? "agent" : "neutral"}>
                  {TAG_LABEL[t]}
                </Badge>
              ))}
              {[...shown, ...auto].length > 2 && <span className="font-mono text-[11px]">+{[...shown, ...auto].length - 2}</span>}
            </>
          ) : (
            <>
              <Tag className="size-3" aria-hidden />
              Tag
            </>
          )}
        </button>
      }
    >
      <MenuLabel>How does {name.split(" ")[0]} know you?</MenuLabel>
      {PICKABLE_TAGS.map((t) => (
        <MenuCheckItem key={t} checked={current.includes(t)} onCheckedChange={(on) => void toggle(t, on)}>
          {TAG_LABEL[t]}
        </MenuCheckItem>
      ))}
      {auto.length > 0 && <p className="px-2 pb-1 pt-1.5 text-[11.5px] leading-4 text-fg-3">{auto.map((t) => TAG_LABEL[t]).join(" · ")}: from your imports.</p>}
    </Menu>
  );
}
