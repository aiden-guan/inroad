"use client";

import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { SectionLabel } from "@/components/ui/card";
import { cn } from "@/lib/client/cn";

export interface DiagnosticTab {
  id: string;
  label: string;
  /** Section ids inside the tab, so an old deep link (/revenue#pipeline-conversion) opens the right tab. */
  anchors?: string[];
  content: ReactNode;
}

/** The tab a page anchor lives in, if any. */
export function tabForAnchor(tabs: Pick<DiagnosticTab, "id" | "anchors">[], anchor: string): string | undefined {
  return tabs.find((t) => t.id === anchor || t.anchors?.includes(anchor))?.id;
}

/**
 * What's under the number, one view at a time: tabs that follow the WAI-ARIA pattern (arrow keys, Home and End move
 * and select; the panel is next in the tab order). The page owns which tab is open, so links and the URL can set it.
 */
export function DiagnosticTabs({ id, title, tabs, active, onChange, footer }: { id: string; title: string; tabs: DiagnosticTab[]; active: string; onChange: (id: string) => void; footer?: ReactNode }) {
  const list = useRef<HTMLDivElement>(null);
  const current = tabs.find((t) => t.id === active) ?? tabs[0];
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = e.key === "ArrowRight" ? (index + 1) % tabs.length : e.key === "ArrowLeft" ? (index - 1 + tabs.length) % tabs.length : e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    onChange(tabs[next].id);
    list.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  };
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="mt-14 scroll-mt-24">
      <SectionLabel>
        <span id={`${id}-title`}>{title}</span>
      </SectionLabel>
      <div ref={list} role="tablist" aria-label={title} className="scrollbar-none -mx-1 mb-5 flex gap-1 overflow-x-auto border-b border-border px-1">
        {tabs.map((t, i) => {
          const on = t.id === current.id;
          return (
            <button
              key={t.id}
              id={`${id}-tab-${t.id}`}
              type="button"
              role="tab"
              aria-selected={on}
              // Only the open tab's panel is rendered, so only it is referenced.
              aria-controls={on ? `${id}-panel-${t.id}` : undefined}
              tabIndex={on ? 0 : -1}
              onClick={() => onChange(t.id)}
              onKeyDown={(e) => onKey(e, i)}
              className={cn(
                "relative -mb-px inline-flex h-10 shrink-0 items-center whitespace-nowrap rounded-t-sm border-b-2 px-3 text-[13px] font-medium outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ring)]",
                on ? "border-fg text-fg" : "border-transparent text-fg-3 hover:text-fg-2",
              )}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      <div id={`${id}-panel-${current.id}`} role="tabpanel" aria-labelledby={`${id}-tab-${current.id}`} tabIndex={0} className="rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-4 focus-visible:ring-offset-bg">
        {current.content}
      </div>
      {footer && <div className="mt-6">{footer}</div>}
    </section>
  );
}
