"use client";

import { Check, ChevronDown, Lock, Plus, X } from "lucide-react";
import { forwardRef, useState, type ButtonHTMLAttributes, type KeyboardEvent, type ReactNode } from "react";
import { Input } from "@/components/ui/field";
import { Menu, MenuCheckItem, MenuItem, MenuLabel, Popover } from "@/components/ui/menu";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/client/cn";
import { STAGE_LABELS, type Account, type PersonaRole, type Stage, type Workspace } from "@/lib/domain/types";
import { clip } from "@/lib/moves/util";
import type { Recipe, RecipeDealFilter, RecipeStatus } from "@/lib/plays/recipe-types";
import {
  ACTION_KINDS,
  ACTION_LABELS,
  ALWAYS_SKIPPED,
  DEAL_LABELS,
  fold,
  MEASURE_LABELS,
  MEASURES,
  normalizeRecipe,
  PERSONA_ROLES,
  personaLabel,
  RECIPE_SIGNALS,
  SIGNAL_INFO,
  STAGE_CHOICES,
  STATUS_LABELS,
  type RecipeSignal,
} from "@/lib/plays/recipes";
import { Micro } from "./parts";

const WINDOWS = [7, 14, 21, 30, 45, 60, 90, 120, 180, 365];
const FITS = [0, 50, 60, 70, 80, 90];
const COOLDOWNS = [0, 14, 30, 45, 60, 90, 120, 180];
const CAPS = [1, 3, 5, 10, 20, 30, 50];
const TIERS: Account["tier"][] = ["A", "B", "C"];
const STATUSES: RecipeStatus[] = ["new", "tracked", "in_pipeline"];
const DEALS: RecipeDealFilter[] = ["none", "open", "any"];

const withCurrent = (list: number[], n: number) => (list.includes(n) ? list : [...list, n].sort((a, b) => a - b));
const signalLabel = (s: string) => SIGNAL_INFO[s as RecipeSignal]?.label ?? s.replace(/_/g, " ");
const tierText = (tiers: Account["tier"][]) => (!tiers.length || tiers.length === 3 ? "Any tier" : `${tiers.join(" or ")} tier`);

/* ─────────────────────────────── Chips ─────────────────────────────── */

const chip =
  "inline-flex h-7 max-w-full min-w-0 items-center gap-1 rounded-sm px-2 text-[12.5px] transition-[background-color,box-shadow,transform] duration-150 ease-out-quad outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]";

/** A value in the recipe. Removable when `onRemove` is set. */
function Token({ children, onRemove, title, muted }: { children: ReactNode; onRemove?: () => void; title?: string; muted?: boolean }) {
  return (
    <span title={title} className={cn(chip, "bg-surface pr-1 text-fg ring-1 ring-inset ring-border-strong/70", muted && "text-fg-2", !onRemove && "pr-2")}>
      <span className="min-w-0 truncate">{children}</span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${typeof children === "string" ? children : "this"}`}
          className="inline-flex size-5 shrink-0 items-center justify-center rounded-xs text-fg-3 transition-colors hover:bg-bg-subtle hover:text-fg"
        >
          <X className="size-3" aria-hidden />
        </button>
      )}
    </span>
  );
}

/** Dashed: adds to a list. Forwards its ref so a menu or popover can open from it. */
const AddChip = forwardRef<HTMLButtonElement, { label: string } & ButtonHTMLAttributes<HTMLButtonElement>>(function AddChip({ label, className, ...props }, ref) {
  return (
    <button ref={ref} type="button" {...props} className={cn(chip, "border border-dashed border-border-strong text-fg-3 hover:bg-bg-subtle hover:text-fg-2 active:scale-[0.97]", className)}>
      <Plus className="size-3" aria-hidden />
      {label}
    </button>
  );
});

/** One value from a short list: the chip shows it, the menu changes it. */
function Pick<T extends string | number>({ value, options, label, onChange, ariaLabel }: { value: T; options: readonly T[]; label: (v: T) => string; onChange: (v: T) => void; ariaLabel: string }) {
  return (
    <Menu
      align="start"
      trigger={
        <button type="button" aria-label={`${ariaLabel}: ${label(value)}`} className={cn(chip, "bg-surface font-medium text-fg ring-1 ring-inset ring-border-strong/70 hover:bg-surface-raised hover:ring-border-strong active:scale-[0.97]")}>
          <span className="truncate">{label(value)}</span>
          <ChevronDown className="size-3 shrink-0 text-fg-3" aria-hidden />
        </button>
      }
    >
      <MenuLabel>{ariaLabel}</MenuLabel>
      {options.map((o) => (
        <MenuItem key={String(o)} onSelect={() => onChange(o)} icon={o === value ? <Check className="size-3.5" /> : <span />}>
          {label(o)}
        </MenuItem>
      ))}
    </Menu>
  );
}

/** Several values from a list, toggled in one open menu. */
function MultiPick<T extends string>({ values, options, label, onToggle, add, title, hint }: { values: readonly T[]; options: readonly T[]; label: (v: T) => string; onToggle: (v: T, on: boolean) => void; add: string; title: string; hint?: (v: T) => string | undefined }) {
  return (
    <Menu align="start" trigger={<AddChip label={add} aria-label={title} />}>
      <MenuLabel>{title}</MenuLabel>
      {options.map((o) => (
        <MenuCheckItem key={o} checked={values.includes(o)} onCheckedChange={(on) => onToggle(o, on)}>
          <span className="block">{label(o)}</span>
          {hint?.(o) && <span className="block text-[11.5px] leading-4 text-fg-3">{hint(o)}</span>}
        </MenuCheckItem>
      ))}
    </Menu>
  );
}

/** Words to match: chips, and a small field to add more (comma-separated is fine). */
function Words({ words, onChange, add, title }: { words: string[]; onChange: (next: string[]) => void; add: string; title: string }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const commit = () => {
    const next = [...words];
    for (const w of text.split(/[,;\n]+/).map((x) => fold(x)).filter((x) => x.length >= 2 && x.length <= 40)) if (!next.includes(w)) next.push(w);
    if (next.length !== words.length) onChange(next.slice(0, 8));
    setText("");
    setOpen(false);
  };
  return (
    <>
      {words.map((w) => (
        <Token key={w} onRemove={() => onChange(words.filter((x) => x !== w))}>
          “{w}”
        </Token>
      ))}
      {words.length < 8 && (
        <Popover
          open={open}
          onOpenChange={(o) => {
            setOpen(o);
            if (!o) setText("");
          }}
          trigger={<AddChip label={add} aria-label={title} />}
          className="w-72"
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              commit();
            }}
            className="space-y-2"
          >
            <label className="block text-[12px] font-medium text-fg-2">
              {title}
              <Input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="billing, revops" className="mt-1.5 h-8" />
            </label>
            <p className="text-[11.5px] leading-4 text-fg-3">Matched from the start of a word, so “reconcil” also finds “reconciliation”.</p>
          </form>
        </Popover>
      )}
    </>
  );
}

/** The angle the drafts follow: edited in place, saved on blur or Enter. */
function Angle({ value, onCommit }: { value: string; onCommit: (next: string) => void }) {
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      e.currentTarget.blur();
    }
    if (e.key === "Escape") {
      e.stopPropagation();
      e.currentTarget.value = value;
      e.currentTarget.blur();
    }
  };
  return (
    <textarea
      key={value}
      defaultValue={value}
      rows={2}
      aria-label="The angle drafts follow"
      placeholder="The reason to write, in one sentence the drafts follow"
      onBlur={(e) => {
        const next = e.target.value.replace(/\s+/g, " ").trim();
        if (next !== value) onCommit(next);
      }}
      onKeyDown={onKey}
      className="min-h-[52px] w-full min-w-0 flex-1 basis-64 resize-none rounded-sm bg-transparent px-2 py-1.5 font-serif text-[15px] leading-[22px] text-fg ring-1 ring-inset ring-border transition-[box-shadow,background-color] duration-150 placeholder:font-sans placeholder:text-[13px] placeholder:text-fg-3 hover:ring-border-strong focus-visible:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
    />
  );
}

/** One line of the sentence: a micro-label, then its parts. */
function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-x-3 gap-y-1.5 border-t border-border px-4 py-3 first:border-t-0 sm:grid-cols-[76px_minmax(0,1fr)] sm:px-5">
      <Micro className="pt-1.5">{label}</Micro>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-[12.5px] text-fg-3">{children}</div>
    </div>
  );
}

/* ─────────────────────────────── The card ─────────────────────────────── */

/**
 * The recipe as a sentence the founder can read and change in place: when, at which companies, who, what to do,
 * the limits, and what it's measured on. Every change goes through `onChange` as a whole recipe.
 */
export function RecipeCard({ recipe, ws, onChange, className }: { recipe: Recipe; ws: Workspace; onChange: (next: Recipe) => void; className?: string }) {
  const r = recipe;
  const set = (patch: (draft: Recipe) => void) => {
    const next = structuredClone(r);
    patch(next);
    onChange(normalizeRecipe(next));
  };
  const toggle = <T,>(list: T[], v: T, on: boolean) => (on ? (list.includes(v) ? list : [...list, v]) : list.filter((x) => x !== v));
  const criteria = ws.foundation?.icp.criteria ?? [];
  const personas = PERSONA_ROLES.filter((p) => ws.foundation?.personas.some((x) => x.role === p) || r.audience.personas.includes(p) || r.audience.excludePersonas.includes(p) || p === "champion" || p === "economic_buyer");
  const signals = r.trigger.signals;

  return (
    <div className={cn("overflow-hidden rounded-lg bg-surface ring-1 ring-inset ring-border", className)}>
      <Line label="When">
        {signals.map((s) => (
          <Tooltip key={s} content={`From ${SIGNAL_INFO[s as RecipeSignal]?.source ?? "signals on file"}`}>
            <span className="inline-flex max-w-full">
              <Token onRemove={signals.length > 1 ? () => set((d) => { d.trigger.signals = d.trigger.signals.filter((x) => x !== s); }) : undefined}>{signalLabel(s)}</Token>
            </span>
          </Tooltip>
        ))}
        <MultiPick
          values={signals as RecipeSignal[]}
          options={[...RECIPE_SIGNALS]}
          label={(s) => SIGNAL_INFO[s].label}
          hint={(s) => SIGNAL_INFO[s].source}
          onToggle={(s, on) => set((d) => { d.trigger.signals = on ? toggle(d.trigger.signals, s, true) : d.trigger.signals.length > 1 ? toggle(d.trigger.signals, s, false) : d.trigger.signals; })}
          add="Signal"
          title="Signals that fire it"
        />
        <span>in the last</span>
        <Pick value={r.trigger.withinDays} options={withCurrent(WINDOWS, r.trigger.withinDays)} label={(n) => `${n} days`} onChange={(n) => set((d) => { d.trigger.withinDays = n; })} ariaLabel="Freshness window" />
        <span>{r.trigger.keywords.length ? "that mention" : "mentioning anything"}</span>
        <Words words={r.trigger.keywords} onChange={(k) => set((d) => { d.trigger.keywords = k; })} add="Word" title="The signal must mention one of these" />
        <Pick value={r.trigger.minStrength} options={[1, 2, 3]} label={(n) => (n === 1 ? "any strength" : n === 2 ? "strength 2+" : "strong only")} onChange={(n) => set((d) => { d.trigger.minStrength = n as 1 | 2 | 3; })} ariaLabel="Signal strength" />
        {signals.length > 1 && (
          <Pick
            value={r.trigger.stack}
            options={([1, 2, 3] as const).filter((n) => n <= signals.length)}
            label={(n) => (n === 1 ? "any one of them" : `${n} at once`)}
            onChange={(n) => set((d) => { d.trigger.stack = n; })}
            ariaLabel="Signals at once"
          />
        )}
      </Line>

      <Line label="At">
        <Menu
          align="start"
          trigger={
            <button type="button" aria-label={`Tiers: ${tierText(r.audience.tiers)}`} className={cn(chip, "bg-surface font-medium text-fg ring-1 ring-inset ring-border-strong/70 hover:bg-surface-raised active:scale-[0.97]")}>
              {tierText(r.audience.tiers)}
              <ChevronDown className="size-3 text-fg-3" aria-hidden />
            </button>
          }
        >
          <MenuLabel>Account tiers</MenuLabel>
          {TIERS.map((t) => (
            <MenuCheckItem key={t} checked={r.audience.tiers.includes(t)} onCheckedChange={(on) => set((d) => { d.audience.tiers = toggle(d.audience.tiers, t, on); })}>
              Tier {t}
            </MenuCheckItem>
          ))}
        </Menu>
        <span>companies with</span>
        <Pick value={r.audience.minFit} options={withCurrent(FITS, r.audience.minFit)} label={(n) => (n ? `fit ${n}+` : "any fit")} onChange={(n) => set((d) => { d.audience.minFit = n; })} ariaLabel="Minimum fit" />
        <span>and</span>
        <Pick value={r.audience.deal} options={DEALS} label={(v) => DEAL_LABELS[v]} onChange={(v) => set((d) => { d.audience.deal = v; })} ariaLabel="Deal" />
        {r.audience.deal === "open" && (
          <>
            <span>at</span>
            {r.audience.stages.length ? (
              r.audience.stages.map((s) => (
                <Token key={s} onRemove={() => set((d) => { d.audience.stages = d.audience.stages.filter((x) => x !== s); })}>
                  {STAGE_LABELS[s]}
                </Token>
              ))
            ) : (
              <span className="text-fg-2">any stage</span>
            )}
            <MultiPick values={r.audience.stages} options={STAGE_CHOICES} label={(s: Stage) => STAGE_LABELS[s]} onToggle={(s, on) => set((d) => { d.audience.stages = toggle(d.audience.stages, s, on); })} add="Stage" title="Deal stages" />
          </>
        )}
        {criteria.length > 0 && (
          <>
            {r.audience.criteria.length > 0 && <span>that meet</span>}
            {r.audience.criteria.map((id) => {
              const text = criteria.find((c) => c.id === id)?.text ?? "a criterion no longer in your playbook";
              return (
                <Token key={id} title={text} onRemove={() => set((d) => { d.audience.criteria = d.audience.criteria.filter((x) => x !== id); })}>
                  {clip(text, 42)}
                </Token>
              );
            })}
            <MultiPick values={r.audience.criteria} options={criteria.map((c) => c.id)} label={(id) => clip(criteria.find((c) => c.id === id)?.text ?? id, 60)} onToggle={(id, on) => set((d) => { d.audience.criteria = toggle(d.audience.criteria, id, on); })} add="ICP criterion" title="Must meet" />
          </>
        )}
        {r.audience.keywords.length > 0 && <span>whose facts mention</span>}
        <Words words={r.audience.keywords} onChange={(k) => set((d) => { d.audience.keywords = k; })} add="Company word" title="The company's facts must mention one of these (market, stack, city)" />
        <Menu
          align="start"
          trigger={
            <button type="button" aria-label="Account status" className={cn(chip, "text-fg-3 ring-1 ring-inset ring-border hover:bg-bg-subtle hover:text-fg-2")}>
              {r.audience.statuses.length ? `${r.audience.statuses.map((s) => STATUS_LABELS[s]).join(" or ")} only` : "any status"}
              <ChevronDown className="size-3" aria-hidden />
            </button>
          }
        >
          <MenuLabel>Only companies that are</MenuLabel>
          {STATUSES.map((s) => (
            <MenuCheckItem key={s} checked={r.audience.statuses.includes(s)} onCheckedChange={(on) => set((d) => { d.audience.statuses = toggle(d.audience.statuses, s, on); })}>
              {STATUS_LABELS[s]}
            </MenuCheckItem>
          ))}
        </Menu>
      </Line>

      <Line label="Who">
        {r.audience.personas.length ? (
          r.audience.personas.map((p, i) => (
            <Token key={p} title={i ? "Next if the first isn't on file" : "First choice"} onRemove={() => set((d) => { d.audience.personas = d.audience.personas.filter((x) => x !== p); })}>
              {personaLabel(ws, p)}
            </Token>
          ))
        ) : (
          <span className="text-fg-2">The best person on file</span>
        )}
        <MultiPick values={r.audience.personas} options={personas} label={(p: PersonaRole) => personaLabel(ws, p)} onToggle={(p, on) => set((d) => { d.audience.personas = toggle(d.audience.personas, p, on); })} add="Persona" title="Write to, in this order" />
        {(r.audience.excludePersonas.length > 0 || r.audience.personas.length === 0) && <span>never</span>}
        {r.audience.excludePersonas.map((p) => (
          <Token key={p} muted onRemove={() => set((d) => { d.audience.excludePersonas = d.audience.excludePersonas.filter((x) => x !== p); })}>
            {personaLabel(ws, p, { titled: false })}
          </Token>
        ))}
        <MultiPick values={r.audience.excludePersonas} options={personas} label={(p: PersonaRole) => personaLabel(ws, p)} onToggle={(p, on) => set((d) => { d.audience.excludePersonas = toggle(d.audience.excludePersonas, p, on); })} add="Never" title="Never contact" />
      </Line>

      <Line label="Do">
        <Pick value={r.action.kind} options={[...ACTION_KINDS]} label={(k) => ACTION_LABELS[k]} onChange={(k) => set((d) => { d.action.kind = k; })} ariaLabel="Action" />
        <Angle value={r.action.angle} onCommit={(a) => set((d) => { d.action.angle = a; })} />
      </Line>

      <Line label="Limits">
        <Pick value={r.guardrails.cooldownDays} options={withCurrent(COOLDOWNS, r.guardrails.cooldownDays)} label={(n) => (n ? `${n}-day cooldown` : "no cooldown")} onChange={(n) => set((d) => { d.guardrails.cooldownDays = n; })} ariaLabel="Cooldown per company" />
        <span>per company · at most</span>
        <Pick value={r.guardrails.maxPerWeek} options={withCurrent(CAPS, r.guardrails.maxPerWeek)} label={(n) => `${n} new a week`} onChange={(n) => set((d) => { d.guardrails.maxPerWeek = n; })} ariaLabel="New companies a week" />
        <Tooltip content="On for every play, whatever the recipe says.">
          <span tabIndex={0} className={cn(chip, "cursor-default text-fg-3 ring-1 ring-inset ring-border")}>
            <Lock className="size-3 shrink-0" aria-hidden />
            <span className="truncate">Skips {ALWAYS_SKIPPED.charAt(0).toLowerCase() + ALWAYS_SKIPPED.slice(1)}</span>
          </span>
        </Tooltip>
      </Line>

      <Line label="Measure">
        <Pick value={r.measure} options={[...MEASURES]} label={(m) => MEASURE_LABELS[m]} onChange={(m) => set((d) => { d.measure = m; })} ariaLabel="Measured on" />
        <span>per company worked, counted from the day it was worked</span>
      </Line>
    </div>
  );
}
