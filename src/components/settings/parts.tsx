"use client";

import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, Check, Minus, Plus, X } from "lucide-react";
import { useId, useState, type KeyboardEvent, type ReactNode } from "react";
import { FieldError, Input, Textarea } from "@/components/ui/field";
import { cn } from "@/lib/client/cn";
import { ease } from "@/lib/motion";
import type { CheckStatus } from "./types";

/* ───────────── Document structure ───────────── */

export function SettingsSection({ id, title, description, children }: { id: string; title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-24 pt-16 first:pt-0">
      <header className="mb-6 border-b border-border pb-3">
        <h2 id={`${id}-title`} className="font-serif text-[26px] leading-[32px] tracking-[-0.015em] text-fg [font-variation-settings:'opsz'_48]">
          {title}
        </h2>
        {description && <p className="mt-1 max-w-[62ch] text-[13px] leading-5 text-fg-3 text-pretty">{description}</p>}
      </header>
      <div className="space-y-10">{children}</div>
    </section>
  );
}

/** A titled group of rows on one card. */
export function Group({ id, title, hint, right, children, className }: { id?: string; title?: string; hint?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div id={id} className={cn("scroll-mt-24", className)}>
      {(title || right) && (
        <div className="mb-2 flex min-h-7 items-end justify-between gap-3">
          {title && <h3 className="text-[14px] font-semibold tracking-[-0.005em] text-fg">{title}</h3>}
          {right}
        </div>
      )}
      {hint && <p className="-mt-1 mb-3 max-w-[62ch] text-[13px] leading-5 text-fg-3 text-pretty">{hint}</p>}
      <div className="divide-y divide-border rounded-lg bg-surface shadow-xs ring-1 ring-border">{children}</div>
    </div>
  );
}

/** Label and help on the left, the control on the right; stacked below 640px. */
export function Row({ label, hint, htmlFor, children, className, align = "center" }: { label: ReactNode; hint?: ReactNode; htmlFor?: string; children?: ReactNode; className?: string; align?: "center" | "start" }) {
  return (
    <div className={cn("flex flex-col gap-2.5 px-4 py-3.5 sm:flex-row sm:gap-6", align === "center" ? "sm:items-center" : "sm:items-start", className)}>
      <div className="min-w-0 flex-1">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="text-[13px] font-medium text-fg">
            {label}
          </label>
        ) : (
          <div className="text-[13px] font-medium text-fg">{label}</div>
        )}
        {hint && <div className="mt-0.5 text-[12.5px] leading-[18px] text-fg-3 text-pretty">{hint}</div>}
      </div>
      {children !== undefined && <div className="min-w-0 sm:w-[300px] sm:shrink-0">{children}</div>}
    </div>
  );
}

/** An inline confirm or detail that opens under its row (never a modal). */
export function Expand({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0, transition: { duration: 0.15 } }}
          transition={{ duration: 0.22, ease: ease.out }}
          className="overflow-hidden"
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** A quiet "Saved" that appears for a moment after a field commits. */
export function SavedMark({ show, className }: { show: boolean; className?: string }) {
  return (
    <AnimatePresence>
      {show && (
        <motion.span
          initial={{ opacity: 0, y: 2 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, transition: { duration: 0.12 } }}
          transition={{ duration: 0.18, ease: ease.out }}
          className={cn("inline-flex items-center gap-1 text-[11.5px] text-fg-3", className)}
          role="status"
        >
          <Check className="size-3" aria-hidden /> Saved
        </motion.span>
      )}
    </AnimatePresence>
  );
}

/**
 * A text setting that saves on blur (or Enter, for single-line fields). Shows the stored value
 * until the founder types; validation errors stay inline and nothing saves until they're fixed.
 */
export function TextSetting({
  label,
  hint,
  value,
  onSave,
  validate,
  placeholder,
  multiline,
  mono,
  type = "text",
  autoComplete = "off",
  inputMode,
  required,
  normalize = (v) => v.trim(),
}: {
  label: string;
  hint?: ReactNode;
  value: string;
  onSave: (next: string) => Promise<boolean> | boolean | void;
  validate?: (next: string) => string | null;
  /** The message to show when the field is emptied; omit to allow clearing. */
  required?: string;
  placeholder?: string;
  multiline?: boolean;
  mono?: boolean;
  type?: "text" | "email" | "url";
  autoComplete?: string;
  inputMode?: "text" | "email" | "url" | "numeric";
  normalize?: (raw: string) => string;
}) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const shown = draft ?? value;

  const commit = async () => {
    if (draft === null) return;
    const next = normalize(draft);
    if (next === value.trim()) {
      setDraft(null);
      return;
    }
    const problem = next ? (validate?.(next) ?? null) : (required ?? null);
    if (problem) {
      setError(problem);
      return;
    }
    setDraft(null);
    const ok = await onSave(next);
    if (ok === false) return;
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Enter" && (!multiline || e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      (e.currentTarget as HTMLElement).blur();
    } else if (e.key === "Escape" && draft !== null) {
      e.preventDefault();
      e.stopPropagation();
      setDraft(null);
      setError(null);
    }
  };

  const common = {
    id,
    value: shown,
    placeholder,
    autoComplete,
    spellCheck: false,
    "aria-invalid": !!error,
    "aria-describedby": error ? `${id}-error` : undefined,
    onChange: (e: { target: { value: string } }) => {
      setDraft(e.target.value);
      if (error) setError(null);
    },
    onBlur: () => void commit(),
    onKeyDown,
  };

  return (
    <Row label={label} hint={hint} htmlFor={id} align={multiline ? "start" : "center"}>
      <div className="relative">
        {multiline ? (
          <Textarea {...common} rows={2} className={cn("min-h-[52px]", mono && "font-mono text-[12.5px]")} />
        ) : (
          <Input {...common} type={type} inputMode={inputMode} className={cn(mono && "font-mono text-[12.5px]")} />
        )}
        <span className={cn("pointer-events-none absolute right-1.5 flex", multiline ? "top-1.5" : "inset-y-0 items-center")}>
          <SavedMark show={saved} className="rounded-xs bg-surface px-1" />
        </span>
      </div>
      <div id={`${id}-error`}>
        <FieldError>{error}</FieldError>
      </div>
    </Row>
  );
}

export function Stepper({
  value,
  min,
  max,
  step = 1,
  onChange,
  label,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (next: number) => void;
  label: string;
}) {
  return (
    <span className="inline-flex h-8 items-center rounded-sm bg-surface ring-1 ring-border-strong/70" role="group" aria-label={label}>
      <button
        type="button"
        aria-label={`Lower ${label}`}
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - step))}
        className="inline-flex size-8 items-center justify-center rounded-l-sm text-fg-3 transition-[background-color,color,transform] duration-150 hover:bg-bg-subtle hover:text-fg active:scale-[0.94] disabled:opacity-40"
      >
        <Minus className="size-3.5" />
      </button>
      <span className="min-w-10 px-1 text-center font-mono text-[13px] tnum text-fg" aria-live="polite">
        {value}
      </span>
      <button
        type="button"
        aria-label={`Raise ${label}`}
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, value + step))}
        className="inline-flex size-8 items-center justify-center rounded-r-sm text-fg-3 transition-[background-color,color,transform] duration-150 hover:bg-bg-subtle hover:text-fg active:scale-[0.94] disabled:opacity-40"
      >
        <Plus className="size-3.5" />
      </button>
    </span>
  );
}

/** Radio cards: one choice, each with a line of explanation. Arrow keys move between them. */
export function ChoiceList<T extends string>({
  name,
  value,
  options,
  onChange,
  label,
}: {
  name: string;
  value: T;
  options: { value: T; label: ReactNode; hint?: ReactNode; badge?: ReactNode }[];
  onChange: (next: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="divide-y divide-border">
      {options.map((o) => {
        const checked = o.value === value;
        return (
          <label key={o.value} className="flex cursor-pointer items-start gap-3 px-4 py-3 transition-colors duration-150 hover:bg-bg-subtle/60">
            <input type="radio" name={name} value={o.value} checked={checked} onChange={() => onChange(o.value)} className="peer sr-only" />
            <span
              aria-hidden
              className={cn(
                "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full ring-1 transition-[box-shadow,background-color] duration-150 peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--ring)]",
                checked ? "bg-primary ring-primary" : "bg-surface ring-border-strong",
              )}
            >
              <span className={cn("size-1.5 rounded-full bg-primary-fg transition-transform duration-150", checked ? "scale-100" : "scale-0")} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2 text-[13px] font-medium text-fg">
                {o.label}
                {o.badge}
              </span>
              {o.hint && <span className="mt-0.5 block text-[12.5px] leading-[18px] text-fg-3 text-pretty">{o.hint}</span>}
            </span>
          </label>
        );
      })}
    </div>
  );
}

const STATUS_STYLE: Record<CheckStatus, { icon: typeof Check; className: string; label: string }> = {
  pass: { icon: Check, className: "bg-success-subtle text-success", label: "Pass" },
  warn: { icon: AlertTriangle, className: "bg-warning-subtle text-warning", label: "Check" },
  fail: { icon: X, className: "bg-danger-subtle text-danger", label: "Fix" },
};

export function StatusIcon({ status, className }: { status: CheckStatus; className?: string }) {
  const s = STATUS_STYLE[status];
  const Icon = s.icon;
  return (
    <span className={cn("inline-flex size-5 shrink-0 items-center justify-center rounded-full", s.className, className)} role="img" aria-label={s.label}>
      <Icon className="size-3" strokeWidth={2.5} aria-hidden />
    </span>
  );
}

/** A tinted note for states that need attention (warning) or block work (danger). Never the accent. */
export function Callout({ tone, title, children, action }: { tone: "warning" | "danger" | "neutral"; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div
      role={tone === "danger" ? "alert" : undefined}
      className={cn(
        "flex flex-col gap-3 rounded-lg px-4 py-3 sm:flex-row sm:items-center",
        tone === "danger" && "bg-danger-subtle",
        tone === "warning" && "bg-warning-subtle",
        tone === "neutral" && "bg-bg-subtle ring-1 ring-inset ring-border",
      )}
    >
      <div className="min-w-0 flex-1">
        <p className={cn("text-[13px] font-medium", tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : "text-fg")}>{title}</p>
        {children && <div className="mt-0.5 text-[12.5px] leading-[18px] text-fg-2 text-pretty">{children}</div>}
      </div>
      {action}
    </div>
  );
}
