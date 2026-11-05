"use client";

import * as RD from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useRef, type ReactNode } from "react";
import { cn } from "@/lib/client/cn";
import { InkPattern } from "./ink-pattern";

const NOT_TYPED = new Set(["button", "checkbox", "color", "file", "image", "radio", "range", "reset", "submit"]);

/** Focus is in something the founder types into: a text field, a text area, an editable block. */
function isTypingIn(el: Element | null): el is HTMLElement {
  if (el instanceof HTMLInputElement) return !NOT_TYPED.has(el.type);
  return el instanceof HTMLElement && (el.isContentEditable || el.tagName === "TEXTAREA");
}

/**
 * Right-side sheet for detail views (company, deal, event). Fast, origin-aware drawer motion.
 * Width grows instead of stacking: never open a modal on top of a sheet. With a `seed` (a company's
 * domain), the header carries that company's generative ink mark, inking in as the sheet lands.
 *
 * Esc in a field leaves the field, not the sheet: half-typed call notes and transcripts aren't thrown away by one
 * key. The field's own Esc runs first (some put their value back); a second Esc closes the sheet. Esc that ends an
 * IME composition only ends the composition.
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
  const content = useRef<HTMLDivElement>(null);
  return (
    <RD.Root open={open} onOpenChange={onOpenChange}>
      <RD.Portal>
        <RD.Overlay className="fixed inset-0 z-[50] bg-overlay/60 backdrop-blur-[2px] data-[state=open]:animate-[fade-in_250ms_var(--ease-out)] data-[state=closed]:animate-[fade-out_150ms_var(--ease-out)]" />
        <RD.Content
          ref={content}
          style={{ maxWidth: width }}
          onEscapeKeyDown={(e) => {
            if (e.isComposing || e.keyCode === 229) {
              e.preventDefault();
              return;
            }
            const field = document.activeElement;
            if (!isTypingIn(field)) return;
            e.preventDefault();
            // After the field has had its own Esc (it runs after this capture-phase handler): then leave it, keeping
            // focus in the sheet so the next Esc closes it.
            setTimeout(() => {
              if (document.activeElement === field) field.blur();
              if (!content.current?.contains(document.activeElement)) content.current?.focus({ preventScroll: true });
            }, 0);
          }}
          className={cn(
            "fixed inset-y-2 right-2 z-[51] flex w-[calc(100vw-16px)] flex-col overflow-hidden rounded-2xl bg-surface-raised shadow-xl ring-1 ring-inset ring-border outline-none",
            "data-[state=open]:animate-[sheet-in_280ms_var(--ease-drawer)] data-[state=closed]:animate-[sheet-out_180ms_var(--ease-out)]",
          )}
        >
          <RD.Title className="sr-only">{title}</RD.Title>
          <RD.Description className="sr-only">{title} details</RD.Description>
          <div className="relative isolate flex shrink-0 items-center justify-between gap-3 overflow-hidden border-b border-border px-5 py-3">
            {seed && (
              // The mark fades out before the corner the close button sits in.
              <div aria-hidden className="absolute inset-0 -z-10 text-fg opacity-[0.15] [mask-image:linear-gradient(to_left,transparent_0,transparent_56px,#000_120px,transparent_70%)]">
                <InkPattern key={seed} seed={seed} reveal delay={160} scale={1.25} />
              </div>
            )}
            <div className="min-w-0 flex-1">{header ?? <span className="text-[14px] font-semibold">{title}</span>}</div>
            <RD.Close
              aria-label="Close (Esc)"
              title="Close (Esc)"
              className={cn(
                "inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-surface-raised text-fg-2 shadow-xs ring-1 ring-inset ring-border",
                "transition-[background-color,color,box-shadow,transform] duration-150 ease-out-quad hover:bg-bg-subtle hover:text-fg hover:ring-border-strong active:scale-[0.94]",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
              )}
            >
              <X className="size-4" aria-hidden />
            </RD.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}
