"use client";

import { motion } from "motion/react";
import { Check, ChevronDown, Minus, Plus, X } from "lucide-react";
import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { Menu, MenuItem } from "@/components/ui/menu";
import { MarginNote, SourceChip } from "@/components/ui/source";
import { cn } from "@/lib/client/cn";
import { usePlaybook } from "./context";
import { words } from "./model";

/* ───────────────────────────── Inline editing ───────────────────────────── */

const fieldShell =
  "w-full rounded-xs bg-surface outline-none ring-1 ring-border-strong transition-shadow duration-150 focus-visible:ring-2 focus-visible:ring-[var(--ring)] [font:inherit] [letter-spacing:inherit]";

/**
 * Click text → it becomes an input with the same typography. Enter or blur saves, Escape cancels,
 * Shift+Enter adds a line in multiline fields. A short blue-pencil underline confirms the save.
 */
export function Editable({
  value,
  onSave,
  label,
  placeholder = "Add…",
  multiline,
  className,
  maxWords,
  allowEmpty,
  inline,
  children,
}: {
  value: string;
  onSave: (next: string) => void;
  label: string;
  placeholder?: string;
  multiline?: boolean;
  className?: string;
  maxWords?: number;
  allowEmpty?: boolean;
  inline?: boolean;
  /** Custom rendering of the saved value. */
  children?: ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saved, setSaved] = useState(0);
  const cancelled = useRef(false);
  /** Set when the edit ends from the keyboard, so focus returns to the text instead of the page. */
  const refocus = useRef(false);
  const display = useRef<HTMLButtonElement>(null);
  const restoreFocus = () => {
    if (!refocus.current) return;
    refocus.current = false;
    requestAnimationFrame(() => display.current?.focus());
  };

  const begin = () => {
    cancelled.current = false;
    setDraft(value);
    setEditing(true);
  };
  const commit = () => {
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    setEditing(false);
    restoreFocus();
    const next = draft.trim();
    if (next === value.trim() || (!next && !allowEmpty)) return;
    onSave(next);
    setSaved((n) => n + 1);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      refocus.current = true;
      (e.currentTarget as HTMLElement).blur();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      cancelled.current = true;
      refocus.current = true;
      setEditing(false);
      restoreFocus();
    }
  };

  if (editing) {
    const n = words(draft);
    return (
      <span className={cn("relative", inline ? "inline-block min-w-40 align-baseline" : "block")}>
        {multiline ? (
          <textarea
            autoFocus
            aria-label={label}
            value={draft}
            rows={1}
            placeholder={placeholder}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={onKeyDown}
            onFocus={(e) => e.currentTarget.setSelectionRange(e.currentTarget.value.length, e.currentTarget.value.length)}
            className={cn(fieldShell, "-mx-1.5 -my-1 block w-[calc(100%+12px)] resize-none px-1.5 py-1", className)}
          />
        ) : (
          <input
            autoFocus
            aria-label={label}
            value={draft}
            placeholder={placeholder}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={onKeyDown}
            className={cn(fieldShell, "-mx-1.5 -my-0.5 w-[calc(100%+12px)] px-1.5 py-0.5", className)}
          />
        )}
        {maxWords !== undefined && <WordCount n={n} max={maxWords} className="absolute -bottom-5 right-0" />}
      </span>
    );
  }

  return (
    <span className={cn("group/edit relative", inline ? "inline" : "block")}>
      <button
        ref={display}
        type="button"
        onClick={begin}
        className={cn(
          "-mx-1 cursor-text rounded-xs px-1 text-left [overflow-wrap:anywhere] transition-colors duration-150 ease-out-quad hover:bg-bg-subtle focus-visible:bg-bg-subtle",
          inline ? "inline" : "block w-[calc(100%+8px)]",
          className,
        )}
      >
        {value ? (children ?? value) : <span className="text-fg-3">{placeholder}</span>}
        <span className="sr-only">. Edit {label}</span>
      </button>
      {saved > 0 && (
        <motion.span
          key={saved}
          aria-hidden
          className="pointer-events-none absolute inset-x-0 -bottom-px h-px origin-left bg-accent"
          initial={{ scaleX: 0, opacity: 1 }}
          animate={{ scaleX: [0, 1, 1], opacity: [1, 1, 0] }}
          transition={{ duration: 0.9, times: [0, 0.45, 1], ease: "easeOut" }}
        />
      )}
    </span>
  );
}

export function WordCount({ n, max, className }: { n: number; max: number; className?: string }) {
  return (
    <span
      className={cn(
        "font-mono text-[11px] tnum transition-colors duration-150",
        n > max ? "text-danger" : n > max * 0.9 ? "text-warning" : "text-fg-3",
        className,
      )}
    >
      {n}/{max} words
    </span>
  );
}

/** "+ Add criterion" → an inline input. Enter adds and stays open for the next one; Escape closes. */
export function AddRow({ label, placeholder, onAdd, className }: { label: string; placeholder?: string; onAdd: (text: string) => void; className?: string }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn("inline-flex h-7 items-center gap-1.5 rounded-xs px-1 -mx-1 text-[13px] text-fg-3 transition-colors duration-150 hover:text-fg focus-visible:text-fg", className)}
      >
        <Plus className="size-3.5" />
        {label}
      </button>
    );
  }
  return (
    <input
      autoFocus
      aria-label={label}
      value={text}
      placeholder={placeholder ?? label}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        if (text.trim()) onAdd(text.trim());
        setText("");
        setOpen(false);
      }}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return;
        if (e.key === "Enter" && text.trim()) {
          e.preventDefault();
          onAdd(text.trim());
          setText("");
        } else if (e.key === "Escape") {
          e.stopPropagation();
          setText("");
          setOpen(false);
        }
      }}
      className={cn(fieldShell, "h-8 px-2 text-[14px]", className)}
    />
  );
}

/** Removal is instant and undoable; the hold gesture is reserved for truly destructive actions. */
export function undoable(message: string, undo: () => void) {
  toast(message, { action: { label: "Undo", onClick: undo } });
}

export function RemoveButton({ label, onClick, className }: { label: string; onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "inline-flex size-6 shrink-0 items-center justify-center rounded-xs text-fg-4 opacity-0 transition-[opacity,color,background-color] duration-150 hover:bg-bg-subtle hover:text-fg-2 focus-visible:opacity-100 group-hover/row:opacity-100 [@media(hover:none)]:opacity-100",
        className,
      )}
    >
      <X className="size-3.5" />
    </button>
  );
}

/** A string[] edited as rows: click to edit, × to remove (with undo), + to add. */
export function StringList({
  items,
  onChange,
  label,
  addLabel,
  className,
  itemClassName,
  bullet = true,
  max,
}: {
  items: string[];
  onChange: (next: string[]) => void;
  label: string;
  addLabel: string;
  className?: string;
  itemClassName?: string;
  bullet?: boolean;
  max?: number;
}) {
  return (
    <div className={className}>
      <ul className="space-y-1">
        {items.map((item, i) => (
          <li key={`${i}-${item.slice(0, 12)}`} className="group/row flex items-start gap-2">
            {bullet && <span aria-hidden className="mt-[9px] size-1 shrink-0 rounded-full bg-fg-4" />}
            <div className="min-w-0 flex-1">
              <Editable
                value={item}
                label={label}
                className={cn("text-[14px] leading-[22px]", itemClassName)}
                onSave={(v) => onChange(items.map((x, j) => (j === i ? v : x)))}
              />
            </div>
            <RemoveButton
              label={`Remove ${label}`}
              onClick={() => {
                onChange(items.filter((_, j) => j !== i));
                undoable(`Removed “${item.slice(0, 40)}”`, () => onChange(items));
              }}
            />
          </li>
        ))}
      </ul>
      {(max === undefined || items.length < max) && <AddRow label={addLabel} onAdd={(t) => onChange([...items, t])} className="mt-1" />}
    </div>
  );
}

/** Compact chips for short lists (titles, KPIs, banned words). */
export function TagList({ items, onChange, label, placeholder }: { items: string[]; onChange: (next: string[]) => void; label: string; placeholder?: string }) {
  const [text, setText] = useState("");
  const add = () => {
    const t = text.trim().replace(/,$/, "");
    if (t && !items.some((x) => x.toLowerCase() === t.toLowerCase())) onChange([...items, t]);
    setText("");
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {items.map((item, i) => (
        <span key={item} className="inline-flex h-6 items-center gap-1 rounded-xs bg-bg-subtle pl-2 pr-0.5 text-[12.5px] text-fg-2 ring-1 ring-border">
          {item}
          <button
            type="button"
            aria-label={`Remove ${item}`}
            onClick={() => onChange(items.filter((_, j) => j !== i))}
            className="inline-flex size-5 items-center justify-center rounded-[3px] text-fg-3 transition-colors hover:bg-surface hover:text-fg"
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      <input
        aria-label={`Add ${label}`}
        value={text}
        placeholder={placeholder ?? `Add ${label}`}
        onChange={(e) => setText(e.target.value)}
        onBlur={add}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add();
          } else if (e.key === "Backspace" && !text && items.length) onChange(items.slice(0, -1));
        }}
        className="h-6 min-w-24 flex-1 rounded-xs bg-transparent px-1 text-[12.5px] text-fg outline-none placeholder:text-fg-3 focus-visible:ring-1 focus-visible:ring-border-strong"
      />
    </div>
  );
}

/** A small enum picker. */
export function Choice<T extends string>({
  value,
  options,
  onChange,
  label,
  className,
}: {
  value: T;
  options: Record<T, string>;
  onChange: (next: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <Menu
      align="start"
      trigger={
        <button
          type="button"
          aria-label={`${label}: ${options[value]}`}
          className={cn(
            "inline-flex h-6 items-center gap-1 rounded-xs px-1.5 text-[12px] font-medium text-fg-2 ring-1 ring-inset ring-border transition-colors duration-150 hover:bg-bg-subtle hover:text-fg",
            className,
          )}
        >
          {options[value]}
          <ChevronDown className="size-3 text-fg-3" />
        </button>
      }
    >
      {(Object.keys(options) as T[]).map((k) => (
        <MenuItem key={k} onSelect={() => onChange(k)} icon={k === value ? <Check className="size-3.5" /> : null}>
          {options[k]}
        </MenuItem>
      ))}
    </Menu>
  );
}

export function Stepper({
  value,
  min,
  max,
  step = 1,
  onChange,
  label,
  suffix,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (next: number) => void;
  label: string;
  suffix?: string;
}) {
  return (
    <span className="inline-flex h-7 items-center rounded-sm bg-surface ring-1 ring-border" role="group" aria-label={label}>
      <button
        type="button"
        aria-label={`Fewer ${label}`}
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - step))}
        className="inline-flex size-7 items-center justify-center rounded-l-sm text-fg-3 transition-colors hover:bg-bg-subtle hover:text-fg active:scale-[0.94] disabled:opacity-40"
      >
        <Minus className="size-3" />
      </button>
      <span className="min-w-9 px-0.5 text-center font-mono text-[12.5px] tnum text-fg" aria-live="polite">
        {value}
        {suffix}
      </span>
      <button
        type="button"
        aria-label={`More ${label}`}
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, value + step))}
        className="inline-flex size-7 items-center justify-center rounded-r-sm text-fg-3 transition-colors hover:bg-bg-subtle hover:text-fg active:scale-[0.94] disabled:opacity-40"
      >
        <Plus className="size-3" />
      </button>
    </span>
  );
}

/* ───────────────────────────── Document structure ───────────────────────────── */

export function Section({ id, title, kicker, right, children }: { id: string; title: string; kicker?: ReactNode; right?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-28 pt-16 first:pt-0">
      <header className="mb-8 border-b border-border pb-3">
        <div className="flex items-end justify-between gap-3">
          <h2 id={`${id}-title`} className="font-serif text-[28px] leading-[34px] tracking-[-0.015em] text-fg [font-variation-settings:'opsz'_48]">
            {title}
          </h2>
          {right}
        </div>
        {kicker && <div className="mt-1.5">{kicker}</div>}
      </header>
      <div className="space-y-14">{children}</div>
    </section>
  );
}

export function Sub({ id, title, hint, right, children }: { id?: string; title: string; hint?: ReactNode; right?: ReactNode; children: ReactNode }) {
  return (
    <div id={id} className="scroll-mt-28">
      <div className="mb-3 flex min-h-7 items-center justify-between gap-3">
        <h3 className="text-[15px] font-semibold tracking-[-0.005em] text-fg">{title}</h3>
        {right}
      </div>
      {/* `relative` on the full-width wrapper so margin notes inside the hint align to the column, not the measure. */}
      {hint && (
        <div className="relative -mt-1.5 mb-4">
          <p className="max-w-[62ch] text-[13px] leading-5 text-fg-3">{hint}</p>
        </div>
      )}
      {children}
    </div>
  );
}

/** Small uppercase-free field label used inside cards. */
export function FieldLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("mb-0.5 text-[12px] font-medium text-fg-3", className)}>{children}</p>;
}

/** "Bet · From your site + 2 answers · 0 conversations confirm this" */
export function Stamp({ label, isBet, className }: { label: string; isBet: boolean; className?: string }) {
  return (
    <p className={cn("flex items-center gap-1.5 font-serif text-[14px] italic leading-5 text-fg-3", className)}>
      {!isBet && <Check className="size-3.5 shrink-0 not-italic text-fg-2" aria-hidden />}
      <span>
        {isBet && <span className="not-italic font-sans text-[11px] font-medium uppercase tracking-[0.06em] text-fg-3">Bet · </span>}
        {label}
      </span>
    </p>
  );
}

/**
 * Agent-drafted content the founder hasn't approved: fg-2 text behind a 1px blue-pencil rule and a
 * "Draft" label. Approval turns it to ink.
 */
export function Drafted({ draft, children, className }: { draft: boolean; children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "relative pl-3.5 transition-colors duration-150",
        draft ? "text-fg-2 [box-shadow:inset_1px_0_0_var(--accent)]" : "text-fg [box-shadow:inset_1px_0_0_var(--border)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function DraftLabel() {
  return <span className="font-mono text-[10.5px] font-medium uppercase tracking-[0.08em] text-accent-text">Draft</span>;
}

/**
 * Citations: chips under the text in narrow layouts, margin notes in the right gutter when the page
 * is wide enough (container query on the page). The parent must be `relative`.
 */
export function Cite({ ids }: { ids: string[] }) {
  const { ws, dispatch } = usePlaybook();
  const ev = ids.map((id) => ws.evidence[id]).filter((e): e is NonNullable<typeof e> => !!e && !e.flaggedWrong);
  if (!ev.length) return null;
  return (
    <>
      <span className="mt-1.5 flex flex-wrap gap-1 @min-[1272px]/page:hidden">
        {ev.map((e) => (
          <SourceChip
            key={e.id}
            url={e.url}
            publishedAt={e.publishedAt}
            quote={e.quote}
            claim={e.claim}
            confidence={e.confidence}
            onFlagWrong={() => void dispatch({ type: "evidence.flagWrong", id: e.id, at: new Date().toISOString() })}
          />
        ))}
      </span>
      <span className="absolute left-[calc(100%+48px)] top-0.5 hidden w-[200px] space-y-2 @min-[1272px]/page:block">
        {ev.map((e) => (
          <motion.span key={e.id} className="block" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15, delay: 0.1 }}>
            <MarginNote url={e.url} publishedAt={e.publishedAt} quote={e.quote} />
          </motion.span>
        ))}
      </span>
    </>
  );
}

/** An external source the playbook itself cites (research), rendered like evidence. */
export function ResearchCite({ url, quote, date }: { url: string; quote: string; date?: string }) {
  return (
    <>
      <span className="ml-1 inline-block @min-[1272px]/page:hidden">
        <SourceChip url={url} quote={quote} publishedAt={date} />
      </span>
      <span className="absolute left-[calc(100%+48px)] top-0.5 hidden w-[200px] @min-[1272px]/page:block">
        <MarginNote url={url} quote={quote} publishedAt={date} />
      </span>
    </>
  );
}
