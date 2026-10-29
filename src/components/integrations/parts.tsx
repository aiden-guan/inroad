"use client";

import { Select as NativeSelect } from "@/components/ui/field";

import { ArrowUpRight, TriangleAlert } from "lucide-react";
import { useState, type ReactNode } from "react";
import { CopyButton } from "@/components/ui/misc";
import { Favicon } from "@/components/ui/favicon";
import { cn } from "@/lib/client/cn";
import { relativeTime } from "@/lib/client/format";
import { useNow } from "./use-hub";

export type Tone = "on" | "error" | "waiting" | "off";

export function StatusDot({ tone, className }: { tone: Tone; className?: string }) {
  if (tone === "off") return null;
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block size-1.5 shrink-0 rounded-full transition-colors duration-200",
        tone === "on" && "bg-success",
        tone === "error" && "bg-danger",
        tone === "waiting" && "bg-transparent ring-1 ring-fg-4",
        className,
      )}
    />
  );
}

/** "3m ago" from the shared clock; empty during server render. */
export function Ago({ iso, className }: { iso?: string; className?: string }) {
  const now = useNow();
  if (!iso || !now) return null;
  // Everything shown here already happened; the shared clock can lag it by a tick, which would read "soon".
  return <span className={cn("tnum", className)}>{relativeTime(iso, Math.max(now, Date.parse(iso) || 0))}</span>;
}

/** The tool's mark: its favicon, framed so every logo sits on the same paper. */
export function ToolMark({ domain, name, icon }: { domain?: string; name: string; icon?: ReactNode }) {
  if (icon || !domain) {
    return (
      <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-surface text-fg-3 shadow-xs ring-1 ring-border">
        {icon ?? <span className="text-[12px] font-medium">{name.charAt(0)}</span>}
      </span>
    );
  }
  return (
    <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-surface shadow-xs ring-1 ring-border">
      <Favicon domain={domain} name={name} size={18} className="ring-0" />
    </span>
  );
}

/** Ink switch for founder settings. The blue pencil is reserved for the agent. */
export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (next: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-8 shrink-0 items-center rounded-full transition-colors duration-150 ease-out-quad disabled:opacity-50",
        checked ? "bg-primary" : "bg-border-strong",
      )}
    >
      <span
        className={cn(
          "size-4 rounded-full bg-surface shadow-sm transition-transform duration-150 ease-out-quad",
          checked ? "translate-x-[14px]" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

export function ToggleRow({
  title,
  children,
  checked,
  onChange,
  disabled,
}: {
  title: string;
  children?: ReactNode;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-fg">{title}</p>
        {children && <p className="mt-0.5 max-w-[56ch] text-[13px] leading-[19px] text-fg-3">{children}</p>}
      </div>
      <Switch checked={checked} onChange={onChange} label={title} disabled={disabled} />
    </div>
  );
}

export function Steps({ steps }: { steps: ReactNode[] }) {
  return (
    <ol className="space-y-2.5">
      {steps.map((s, i) => (
        <li key={i} className="flex gap-3 text-[13px] leading-[20px] text-fg-2">
          <span className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-bg-subtle font-mono text-[11px] text-fg-3 ring-1 ring-border">
            {i + 1}
          </span>
          <span className="min-w-0 text-pretty">{s}</span>
        </li>
      ))}
    </ol>
  );
}

/** A numbered block with a title, for the two-step connect flow. */
export function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-bg-subtle font-mono text-[11px] text-fg-3 ring-1 ring-border">{n}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-fg">{title}</p>
        <div className="mt-1.5">{children}</div>
      </div>
    </div>
  );
}

/** One copyable machine value (URL, secret, variable). `display` lets secrets show masked. */
export function CopyField({ value, display, label, className }: { value: string; display?: string; label?: string; className?: string }) {
  return (
    <div className={cn("flex min-w-0 items-center gap-2 rounded-md bg-sunken py-1 pl-2.5 pr-1 ring-1 ring-border", className)}>
      <code className="min-w-0 flex-1 truncate font-mono text-[12px] leading-6 text-fg" title={display ? undefined : value}>
        {display ?? value}
      </code>
      <CopyButton text={value} label={label ?? "Copy"} className="h-6 shrink-0 bg-surface" />
    </div>
  );
}

/** Multi-line code (JSON, curl). Scrolls inside itself so the page never scrolls sideways. */
export function CodeBlock({ code, label = "Copy" }: { code: string; label?: string }) {
  return (
    <div className="relative">
      <pre className="max-h-72 overflow-auto rounded-md bg-sunken p-3 pr-20 font-mono text-[12px] leading-[18px] text-fg-2 ring-1 ring-border">{code}</pre>
      <CopyButton text={code} label={label} className="absolute right-1.5 top-1.5 h-6 bg-surface" />
    </div>
  );
}

export function ExternalLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className={cn("inline-flex items-center gap-0.5 text-[13px] font-medium text-fg underline decoration-border-strong underline-offset-[3px] transition-colors duration-150 hover:decoration-fg", className)}
    >
      {children}
      <ArrowUpRight className="size-3.5 text-fg-3" aria-hidden />
    </a>
  );
}

export function Callout({ children, tone = "warning" }: { children: ReactNode; tone?: "warning" | "neutral" }) {
  return (
    <div className={cn("flex gap-2.5 rounded-md px-3 py-2.5 text-[13px] leading-[19px]", tone === "warning" ? "bg-warning-subtle text-fg" : "bg-bg-subtle text-fg-2")}>
      {tone === "warning" && <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** Small disclosure without a modal: "What to send", "How to verify". */
export function Disclosure({ title, children, defaultOpen = false }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 rounded-sm text-[13px] font-medium text-fg-2 transition-colors duration-150 hover:text-fg"
      >
        <span className={cn("inline-block text-fg-4 transition-transform duration-150 ease-out-quad", open && "rotate-90")} aria-hidden>
          ›
        </span>
        {title}
      </button>
      {open && <div className="mt-2.5 animate-[rise-in_180ms_var(--ease-out)]">{children}</div>}
    </div>
  );
}

/** A two-click confirm for mild, reversible-by-reconnecting actions (disconnect, remove endpoint). */
export function ConfirmButton({ children, confirmLabel, onConfirm, className }: { children: ReactNode; confirmLabel: string; onConfirm: () => void; className?: string }) {
  const [armed, setArmed] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else {
          setArmed(true);
          setTimeout(() => setArmed(false), 3000);
        }
      }}
      onBlur={() => setArmed(false)}
      className={cn(
        "inline-flex h-7 items-center rounded-sm px-2 text-[12px] font-medium transition-[background-color,color,transform] duration-150 active:scale-[0.97]",
        armed ? "bg-danger-subtle text-danger" : "text-fg-3 hover:bg-bg-subtle hover:text-fg-2",
        className,
      )}
    >
      {armed ? confirmLabel : children}
    </button>
  );
}

export function SubLabel({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-3">
      <p className="text-[12px] font-medium text-fg-3">{children}</p>
      {right}
    </div>
  );
}

/** Native select styled like the kit's inputs (keyboard and mobile pickers for free). */
export function Select({
  value,
  onChange,
  children,
  label,
  className,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
  label: string;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <div className={cn("relative min-w-0", className)}>
      <NativeSelect
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "h-8 w-full min-w-0 appearance-none truncate rounded-sm bg-surface pl-2.5 pr-8 text-[13px] text-fg ring-1 ring-border-strong/70",
          "transition-[box-shadow] duration-150 hover:ring-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:opacity-60",
        )}
      >
        {children}
      </NativeSelect>
    </div>
  );
}
