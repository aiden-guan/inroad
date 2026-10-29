"use client";

import NumberFlow, { type Format } from "@number-flow/react";
import { motion, useReducedMotion } from "motion/react";
import { Check, Copy } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import { cn } from "@/lib/client/cn";
import { spring } from "@/lib/motion";
import { BrandMark } from "./brand-mark";

/** Segmented control with a sliding indicator (layout spring). */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
  layoutId = "segmented",
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: ReactNode; count?: number }[];
  className?: string;
  layoutId?: string;
}) {
  const id = useId();
  const reduce = useReducedMotion();
  const [keyboard, setKeyboard] = useState(false);
  return (
    <div role="tablist" className={cn("inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-lg bg-bg-subtle p-1 ring-1 ring-inset ring-border scrollbar-none", className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={(event) => { setKeyboard(event.detail === 0); onChange(o.value); }}
            onKeyDown={(event) => {
              const index = options.findIndex((option) => option.value === o.value);
              const next = event.key === "ArrowRight" ? (index + 1) % options.length : event.key === "ArrowLeft" ? (index - 1 + options.length) % options.length : event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : -1;
              if (next < 0) return;
              event.preventDefault();
              setKeyboard(true);
              onChange(options[next].value);
              (event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next])?.focus();
            }}
            className={cn(
              "relative inline-flex h-8 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2 text-[12px] font-medium transition-colors duration-150 sm:gap-2 sm:px-3 sm:text-[13px]",
              active ? "text-fg" : "text-fg-3 hover:text-fg-2",
            )}
          >
            {active && <motion.span layoutId={`${id}-${layoutId}`} transition={keyboard || reduce ? { duration: 0 } : spring.snappy} className="absolute inset-0 rounded-md bg-surface shadow-xs ring-1 ring-inset ring-border-strong/60" />}
            <span className="relative">{o.label}</span>
            {o.count !== undefined && <span className="relative font-mono text-[11px] tnum text-fg-3">{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function Num({ value, format, className }: { value: number; format?: Format; className?: string }) {
  return <NumberFlow value={value} format={format} className={cn("tnum", className)} respectMotionPreference />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("skeleton rounded-sm", className)} />;
}

export function EmptyState({ title, body, action, icon }: { title: string; body?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-xl px-6 py-16 text-center">
      <div aria-hidden className="relative mb-7 flex size-24 items-center justify-center">
        <span className="absolute inset-0 rounded-full border border-dashed border-border" />
        <span className="absolute inset-3 rounded-full border border-border/70" />
        <span className="absolute inset-0 [animation:fx-orbit-once_1600ms_var(--ease-in-out)_200ms_both]">
          <span className="absolute left-0 top-1/2 size-1.5 -translate-y-1/2 rounded-full bg-border-strong ring-4 ring-bg" />
        </span>
        <span className="fx-lift relative flex size-12 items-center justify-center rounded-xl bg-surface text-fg-2 shadow-sm ring-1 ring-border">{icon ?? <BrandMark draw="once" className="size-6" />}</span>
      </div>
      <h3 className="fx-rise max-w-[30ch] text-balance font-serif text-[28px] leading-[34px] tracking-[-0.025em] text-fg [--fx-delay:120ms]">{title}</h3>
      {body && <p className="fx-rise mt-3 max-w-[46ch] text-pretty text-[14px] leading-[23px] text-fg-2 [--fx-delay:200ms]">{body}</p>}
      {action && <div className="fx-rise mt-6 max-w-full [--fx-delay:280ms]">{action}</div>}
    </div>
  );
}

export function CopyButton({ text, label = "Copy", className, onCopied }: { text: string; label?: string; className?: string; onCopied?: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          toast.error("Couldn't copy. Select the text and copy it manually.");
          return;
        }
        setCopied(true);
        onCopied?.();
        setTimeout(() => setCopied(false), 1500);
      }}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-sm px-2 text-[12px] font-medium text-fg-2 ring-1 ring-border transition-[background-color,transform] duration-150 hover:bg-bg-subtle active:scale-[0.97]",
        className,
      )}
    >
      <span className="relative size-3.5">
        <Copy className={cn("absolute inset-0 size-3.5 transition-[transform,opacity] duration-150", copied ? "scale-75 opacity-0" : "opacity-100")} />
        <Check className={cn("absolute inset-0 size-3.5 text-success transition-[transform,opacity] duration-150", copied ? "opacity-100" : "scale-75 opacity-0")} />
      </span>
      {copied ? "Copied" : label}
    </button>
  );
}

/** Renders agent markdown (assets, reviews, proposals) in the reading face. */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div
      className={cn(
        "prose-agent space-y-3 [&_a]:text-accent-text [&_a]:underline-offset-2 hover:[&_a]:underline [&_h1]:text-[24px] [&_h1]:leading-[30px] [&_h2]:mt-5 [&_h2]:text-[19px] [&_h2]:font-medium [&_h3]:font-sans [&_h3]:text-[13px] [&_h3]:font-semibold [&_li]:ml-5 [&_ol]:list-decimal [&_strong]:font-semibold [&_table]:w-full [&_table]:text-[14px] [&_td]:border-t [&_td]:border-border [&_td]:py-1.5 [&_td]:pr-3 [&_td:last-child]:pr-0 [&_th]:pr-3 [&_th:last-child]:pr-0 [&_th]:text-left [&_th]:font-sans [&_th]:text-[12px] [&_th]:text-fg-3 [&_ul]:list-disc",
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}
