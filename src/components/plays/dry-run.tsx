"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/client/cn";
import type { Workspace } from "@/lib/domain/types";
import { backtestPlay, type PlayDef } from "@/lib/plays/catalog";
import type { Recipe } from "@/lib/plays/recipe-types";
import { compileRecipe, dryRun, orList, personaLabel, recipeAccountTest, type RecipeMatch, type RecipeSkip } from "@/lib/plays/recipes";
import { BacktestLine, companyHref, Micro, MatchRow } from "./parts";

/** A recipe as a play the dry run and the backtest can use, with its company traits. */
export function recipePlay(ws: Workspace, id: string, recipe: Recipe, sentence?: string): PlayDef {
  return { ...compileRecipe(id, recipe, { version: null, sentence, ws }), accountTest: recipeAccountTest(ws, recipe) };
}

const STAGE: Record<RecipeSkip["stage"], string> = { always: "Always skipped", trigger: "Trigger", audience: "Audience", guardrail: "Limits" };

function Disclosure({ label, children, defaultOpen = false }: { label: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="mt-3">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="inline-flex items-center gap-1 rounded-sm text-[12px] font-medium text-fg-3 outline-none hover:text-fg-2 focus-visible:ring-2 focus-visible:ring-[var(--ring)]">
        <ChevronRight aria-hidden className={cn("size-3 transition-transform duration-150", open && "rotate-90")} />
        {label}
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  );
}

function who(ws: Workspace, recipe: Recipe, m: RecipeMatch): ReactNode {
  if (m.personName) return null;
  const role = recipe.audience.personas[0];
  return <span className="text-[12.5px] text-fg-3">{role ? `No ${personaLabel(ws, role, { titled: false })} on file yet` : "No one on file yet"}</span>;
}

/**
 * What the play would do today, without doing it: the companies it fires on with the dated fact behind each,
 * what waits for next week's cap, what's already handled, what it skipped and why, and the backtest. With
 * `compareTo` (the version that runs now) it also says what the unsaved changes would change.
 */
export function DryRunPanel({ ws, today, recipe, playId, compareTo, sentence, className }: { ws: Workspace; today: string; recipe: Recipe; playId: string; compareTo?: Recipe; sentence?: string; className?: string }) {
  const dry = useMemo(() => dryRun(ws, recipe, playId, today), [ws, recipe, playId, today]);
  const before = useMemo(() => (compareTo ? dryRun(ws, compareTo, playId, today) : null), [ws, compareTo, playId, today]);
  const play = useMemo(() => recipePlay(ws, playId, recipe, sentence), [ws, playId, recipe, sentence]);
  const test = useMemo(() => backtestPlay(ws, play, today), [ws, play, today]);
  const live = useMemo(() => [...dry.fire, ...dry.waiting], [dry]);
  const diff = useMemo(() => {
    if (!before) return null;
    const was = new Set([...before.fire, ...before.waiting].map((m) => m.domain));
    const now = new Set(live.map((m) => m.domain));
    return {
      count: was.size,
      added: live.filter((m) => !was.has(m.domain)).map((m) => m.company),
      removed: [...before.fire, ...before.waiting].filter((m) => !now.has(m.domain)).map((m) => m.company),
    };
  }, [before, live]);
  const groups = (["trigger", "audience", "guardrail", "always"] as const).map((stage) => ({ stage, skips: dry.skips.filter((s) => s.stage === stage) })).filter((g) => g.skips.length);

  return (
    <div className={cn("rounded-lg bg-bg-subtle/50 px-4 py-4 ring-1 ring-inset ring-border sm:px-5", className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <Micro>Dry run · today · nothing is sent</Micro>
        <span className="text-[12px] text-fg-3">
          {dry.capLeft} of {recipe.guardrails.maxPerWeek} new left this week
        </span>
      </div>
      <p className="mt-2 text-[15px] font-medium text-fg" aria-live="polite">
        {live.length ? (
          <>
            Would fire on <span className="font-mono tnum">{live.length}</span> {live.length === 1 ? "company" : "companies"} today
          </>
        ) : (
          "Nothing new to fire on today"
        )}
      </p>
      <p className="mt-0.5 text-[12.5px] leading-5 text-fg-3">
        {[dry.handled.length ? `${dry.handled.length} already handled` : "", dry.skips.length ? `${dry.skips.length} skipped` : "", !live.length && !dry.handled.length && !dry.skips.length ? "No company on file has this signal yet. It checks again every time your accounts change." : ""]
          .filter(Boolean)
          .join(" · ")}
      </p>
      {diff && (diff.added.length > 0 || diff.removed.length > 0 || diff.count !== live.length) && (
        <p className="mt-2 text-[12.5px] leading-5 text-fg-2">
          <span className="font-medium text-fg">Against what runs now: </span>
          {diff.count} → {live.length}.{diff.added.length > 0 && ` Adds ${orList(diff.added.slice(0, 3))}${diff.added.length > 3 ? ` and ${diff.added.length - 3} more` : ""}.`}
          {diff.removed.length > 0 && ` Drops ${orList(diff.removed.slice(0, 3), "and")}${diff.removed.length > 3 ? ` and ${diff.removed.length - 3} more` : ""}.`}
        </p>
      )}

      {dry.fire.length > 0 && (
        <ul className="mt-3 divide-y divide-border overflow-hidden rounded-lg bg-surface ring-1 ring-inset ring-border">
          {dry.fire.slice(0, 8).map((m) => (
            <MatchRow key={m.key} m={m} play={play} ws={ws} today={today} extra={<>{who(ws, recipe, m)}{m.matched && <Badge tone="outline">“{m.matched}”</Badge>}{m.stacked > 1 && <Badge tone="info">{m.stacked} signals</Badge>}</>} />
          ))}
        </ul>
      )}
      {dry.fire.length > 8 && <p className="mt-2 text-[12px] text-fg-3">and {dry.fire.length - 8} more, best first.</p>}
      {dry.waiting.length > 0 && (
        <p className="mt-2 text-[12.5px] leading-5 text-fg-3">
          Past this week&apos;s cap of {recipe.guardrails.maxPerWeek}: {orList(dry.waiting.slice(0, 4).map((m) => m.company), "and")}
          {dry.waiting.length > 4 ? ` and ${dry.waiting.length - 4} more` : ""} wait for Monday.
        </p>
      )}

      {dry.handled.length > 0 && (
        <Disclosure label={`${dry.handled.length} already handled: it won't double up`}>
          <ul className="space-y-1 text-[12px] leading-5">
            {dry.handled.map((m) => (
              <li key={m.key} className="flex flex-wrap gap-x-2">
                <Link href={companyHref(m.domain)} className="font-medium text-fg-2 hover:text-fg">
                  {m.company}
                </Link>
                <span className="text-fg-3">{m.inMotion}</span>
              </li>
            ))}
          </ul>
        </Disclosure>
      )}
      {groups.length > 0 && (
        <Disclosure label={`${dry.skips.length} with the signal that it skipped, and why`}>
          <div className="space-y-2.5">
            {groups.map((g) => (
              <div key={g.stage}>
                <Micro>{STAGE[g.stage]}</Micro>
                <ul className="mt-1 space-y-1 text-[12px] leading-5">
                  {g.skips.map((x) => (
                    <li key={x.domain} className="flex flex-wrap gap-x-2">
                      <Link href={companyHref(x.domain)} className="font-medium text-fg-2 hover:text-fg">
                        {x.company}
                      </Link>
                      <span className="text-fg-3">{x.reason}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Disclosure>
      )}
      {test && <BacktestLine t={test} play={play} className="mt-4 border-t border-border pt-3" />}
    </div>
  );
}
