"use client";

import NumberFlow, { type Format } from "@number-flow/react";
import { motion } from "motion/react";
import { Check, Copy } from "lucide-react";
import { useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/client/cn";
import { spring } from "@/lib/motion";

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
  return (
    <div role="tablist" className={cn("inline-flex h-8 items-center gap-0.5 rounded-md bg-bg-subtle p-0.5 ring-1 ring-border", className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "relative inline-flex h-7 items-center gap-1.5 rounded-[6px] px-3 text-[13px] font-medium transition-colors duration-150",
              active ? "text-fg" : "text-fg-3 hover:text-fg-2",
            )}
          >
            {active && <motion.span layoutId={layoutId} transition={spring.snappy} className="absolute inset-0 rounded-[6px] bg-surface shadow-sm ring-1 ring-border" />}
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
  return <div className={cn("skeleton rounded-sm", className)} />;
}

export function EmptyState({ title, body, action, icon }: { title: string; body?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-16 text-center">
      {icon && <div className="mb-4 text-fg-4">{icon}</div>}
      <h3 className="font-serif text-[24px] leading-[30px] tracking-[-0.01em] text-fg">{title}</h3>
      {body && <p className="mt-2 max-w-[44ch] text-[14px] leading-[21px] text-fg-2">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function CopyButton({ text, label = "Copy", className, onCopied }: { text: string; label?: string; className?: string; onCopied?: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        await navigator.clipboard.writeText(text);
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
        <Copy className={cn("absolute inset-0 size-3.5 transition-all duration-150", copied ? "scale-75 opacity-0" : "opacity-100")} />
        <Check className={cn("absolute inset-0 size-3.5 text-success transition-all duration-150", copied ? "opacity-100" : "scale-75 opacity-0")} />
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
        "prose-agent space-y-3 [&_a]:text-accent-text [&_a]:underline-offset-2 hover:[&_a]:underline [&_h1]:text-[24px] [&_h1]:leading-[30px] [&_h2]:mt-5 [&_h2]:text-[19px] [&_h2]:font-medium [&_h3]:font-sans [&_h3]:text-[13px] [&_h3]:font-semibold [&_li]:ml-5 [&_ol]:list-decimal [&_strong]:font-semibold [&_table]:w-full [&_table]:text-[14px] [&_td]:border-t [&_td]:border-border [&_td]:py-1.5 [&_th]:text-left [&_th]:font-sans [&_th]:text-[12px] [&_th]:text-fg-3 [&_ul]:list-disc",
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}
