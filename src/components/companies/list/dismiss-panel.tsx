"use client";

import * as RP from "@radix-ui/react-popover";
import { useState, type KeyboardEvent, type RefObject } from "react";
import { Input } from "@/components/ui/field";
import { Kbd } from "@/components/ui/kbd";
import { DISMISS_REASONS, type DismissReason } from "./lib";

type Measurable = { getBoundingClientRect: () => DOMRect };

/**
 * "Why dismiss?" — anchored to the row (or the bulk bar), never a modal. Number keys pick a
 * reason; Other asks for one line.
 */
export function DismissPopover({
  open,
  onOpenChange,
  anchor,
  title,
  onChoose,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchor: RefObject<Measurable>;
  title: string;
  onChoose: (reason: DismissReason, note?: string) => void;
}) {
  return (
    <RP.Root open={open} onOpenChange={onOpenChange}>
      <RP.Anchor virtualRef={anchor} />
      <RP.Portal>
        <RP.Content
          side="bottom"
          align="end"
          sideOffset={6}
          collisionPadding={12}
          className="z-[70] w-64 origin-[var(--radix-popover-content-transform-origin)] rounded-lg bg-surface-raised p-1 shadow-lg ring-1 ring-border outline-none data-[state=closed]:animate-[pop-out_100ms_var(--ease-in-quad)] data-[state=open]:animate-[pop-in_160ms_var(--ease-out)]"
        >
          {open && <Reasons title={title} onChoose={onChoose} />}
        </RP.Content>
      </RP.Portal>
    </RP.Root>
  );
}

function Reasons({ title, onChoose }: { title: string; onChoose: (reason: DismissReason, note?: string) => void }) {
  const [other, setOther] = useState(false);
  const [note, setNote] = useState("");

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (other) return;
    const n = Number(e.key);
    if (n >= 1 && n <= DISMISS_REASONS.length) {
      e.preventDefault();
      const r = DISMISS_REASONS[n - 1];
      if (r.value === "other") setOther(true);
      else onChoose(r.value);
    }
  };

  return (
    <div onKeyDown={onKeyDown}>
      <p className="truncate px-2 pb-1 pt-1.5 text-[12px] font-medium text-fg-2">{title}</p>
      {other ? (
        <form
          className="p-1"
          onSubmit={(e) => {
            e.preventDefault();
            onChoose("other", note.trim() || undefined);
          }}
        >
          <Input autoFocus value={note} maxLength={160} onChange={(e) => setNote(e.target.value)} placeholder="What's off about them? (optional)" />
          <p className="mt-1.5 px-0.5 text-[11.5px] text-fg-3">Enter to dismiss. I use reasons to tighten the anti-ICP.</p>
        </form>
      ) : (
        <div role="group" aria-label="Reasons">
          {DISMISS_REASONS.map((r, i) => (
            <button
              key={r.value}
              autoFocus={i === 0}
              onClick={() => (r.value === "other" ? setOther(true) : onChoose(r.value))}
              className="flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left text-[13px] text-fg outline-none transition-colors duration-100 hover:bg-bg-subtle focus-visible:bg-bg-subtle"
            >
              <span className="flex-1">{r.label}</span>
              <Kbd>{i + 1}</Kbd>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
