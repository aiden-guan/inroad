"use client";

import { AnimatePresence, motion } from "motion/react";
import { ArrowUpRight, ChevronRight, Lightbulb, Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useRuns } from "@/components/providers/runs-provider";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusLine, Switch } from "@/components/ui/fx";
import { cn } from "@/lib/client/cn";
import { nowISO } from "@/lib/domain/ids";
import type { Workspace } from "@/lib/domain/types";
import { ease } from "@/lib/motion";
import { backtestPlay, FAMILY_LABELS, playSkips, type PlayDef, type PlayMatch, type PlayResults } from "@/lib/plays/catalog";
import type { PlayLesson } from "@/lib/plays/custom";
import type { CustomPlay } from "@/lib/plays/recipe-types";
import { currentVersion } from "@/lib/plays/recipes";
import { BacktestLine, companyHref, MatchRow, ResultsLine } from "./parts";
import { PlayEditor } from "./play-editor";

export interface Row {
  play: PlayDef;
  /** Set for the founder's plays. */
  cp?: CustomPlay;
  on: boolean;
  matches: PlayMatch[];
  live: number;
  onToday: number;
  results: PlayResults;
  lessons: PlayLesson[];
}

const BULK = 3;

/** The column heads, on screens wide enough for columns. */
export function RowHeads() {
  return (
    <div aria-hidden className="hidden grid-cols-[minmax(0,1fr)_132px_56px_118px] gap-x-4 px-5 pb-2 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-fg-3 sm:grid lg:grid-cols-[minmax(0,1fr)_132px_56px_minmax(0,190px)_118px]">
      <span>Play</span>
      <span>Family</span>
      <span className="text-right">Live</span>
      <span className="hidden lg:block">Results</span>
      <span>Status</span>
    </div>
  );
}

/**
 * One play as a compact row: name, family, live matches, results and the switch. Open it for the detail; the
 * founder's own plays open into their editor (recipe, dry run, versions, lessons).
 */
export function PlayRow({ row, ws, today, open, onToggle, onRewrite }: { row: Row; ws: Workspace; today: string; open: boolean; onToggle: () => void; onRewrite: (sentence: string, id: string) => void }) {
  const { dispatch } = useWorkspace();
  const { play, cp, on, live, matches, onToday, results, lessons } = row;
  const ref = useRef<HTMLDivElement>(null);
  const version = cp ? currentVersion(cp) : undefined;
  const toggle = async () => {
    const ok = await dispatch({ type: "play.set", id: play.id, enabled: !on, at: nowISO() });
    if (ok) toast(on ? `${play.name} paused. Its cards come off Today.` : `${play.name} is running.`, { action: { label: "Undo", onClick: () => void dispatch({ type: "play.set", id: play.id, enabled: on, at: nowISO() }) } });
  };
  useEffect(() => {
    if (open) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [open]);

  return (
    <div ref={ref} className={cn("overflow-hidden rounded-xl bg-surface shadow-sm ring-1 ring-inset transition-[opacity,box-shadow] duration-150", open ? "ring-border-strong" : "ring-border", !on && !open && "opacity-80")}>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_132px_56px_118px] sm:px-5 lg:grid-cols-[minmax(0,1fr)_132px_56px_minmax(0,190px)_118px]">
        <button type="button" onClick={onToggle} aria-expanded={open} className="group flex min-w-0 items-start gap-2 rounded-sm py-0.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]">
          <ChevronRight aria-hidden className={cn("mt-[3px] size-3.5 shrink-0 text-fg-3 transition-transform duration-150 group-hover:text-fg-2", open && "rotate-90")} />
          <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-[14px] font-medium leading-5 text-fg">{play.name}</span>
              {cp && <Badge tone="agent">Custom{version ? ` · v${version.version}` : ""}</Badge>}
              {cp?.draft && version && <Badge tone="warning">Unsaved changes</Badge>}
              {play.data === "paid" && <Badge tone="outline">Needs paid data</Badge>}
              {lessons.length > 0 && (
                <span className="inline-flex items-center gap-1 text-[12px] font-medium text-accent-text">
                  <Lightbulb className="size-3.5" aria-hidden />
                  Got it: {lessons.length === 1 ? "1 change to review" : `${lessons.length} changes to review`}
                </span>
              )}
            </span>
            <span className="mt-0.5 block truncate text-[12.5px] text-fg-3">
              <span className="sm:hidden">{FAMILY_LABELS[play.family]} · </span>
              {play.trigger}
            </span>
          </span>
        </button>
        <span className="hidden truncate text-[12px] text-fg-3 sm:block">{cp ? "Yours" : FAMILY_LABELS[play.family]}</span>
        <span className="hidden text-right font-mono text-[13px] tnum text-fg sm:block" aria-label={`${live} live matches`}>
          {live || <span className="text-fg-3">0</span>}
        </span>
        <span className="hidden min-w-0 truncate text-fg-3 lg:block">
          <ResultsLine r={results} />
        </span>
        <span className="flex justify-end sm:justify-start">
          <Switch on={on} onChange={() => void toggle()} label={`${play.name}: ${on ? "running" : "paused"}`}>
            <StatusLine text={on ? "Running" : "Paused"} className="min-w-[46px]" />
          </Switch>
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border px-3 py-2 text-[12px] text-fg-3 sm:hidden">
        <span>
          <span className="font-mono tnum text-fg-2">{live}</span> live
        </span>
        <ResultsLine r={results} />
      </div>
      <div className="hidden flex-wrap items-center gap-x-4 gap-y-1 border-t border-border px-5 py-2 text-[12px] text-fg-3 sm:flex lg:hidden">
        <ResultsLine r={results} />
        {onToday > 0 && (
          <Link href="/today" className="text-fg-2 underline-offset-2 hover:text-fg hover:underline">
            {onToday} on Today
          </Link>
        )}
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0, transition: { duration: 0.12 } }} transition={{ duration: 0.2, ease: ease.out }} className="overflow-hidden">
            <div className="border-t border-border bg-bg-subtle/40 px-4 pb-5 pt-4 sm:px-5">
              {cp ? <PlayEditor cp={cp} ws={ws} today={today} onRewrite={onRewrite} focus={open} /> : <BuiltinDetail play={play} matches={matches} ws={ws} today={today} onToday={onToday} />}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** A built-in play, open: the trigger and why it works, how to run it, the backtest, its matches and skips. */
function BuiltinDetail({ play, matches, ws, today, onToday }: { play: PlayDef; matches: PlayMatch[]; ws: Workspace; today: string; onToday: number }) {
  const { dispatch } = useWorkspace();
  const { start } = useRuns();
  const [busy, setBusy] = useState(false);
  const [showSkips, setShowSkips] = useState(false);
  const toResearch = matches.filter((m) => !m.worked && !ws.accounts[m.domain]?.dossier).slice(0, BULK);
  const test = backtestPlay(ws, play, today);
  const skips = playSkips(ws, play, today);
  const live = matches.filter((m) => !m.worked).length;

  const researchTop = async () => {
    setBusy(true);
    const domains = toResearch.map((m) => m.domain);
    await dispatch({ type: "play.run", id: play.id, domains, at: nowISO() });
    let started = 0;
    for (const domain of domains) if (await start("dossier", { domain }, { notify: true })) started++;
    setBusy(false);
    if (started) toast(`Researching ${started} ${started === 1 ? "company" : "companies"} from ${play.name}. Drafts follow on Today.`);
  };

  return (
    <div>
      <p className="text-[13px] leading-5 text-fg-2">
        <span className="text-fg-3">When </span>
        {play.trigger.charAt(0).toLowerCase() + play.trigger.slice(1)}
      </p>
      <p className="mt-1 text-[12.5px] leading-5 text-fg-3">
        {play.why}
        {play.source && (
          <a href={play.source.url} target="_blank" rel="noreferrer" className="ml-1 text-fg-3 underline decoration-dotted underline-offset-4 hover:text-fg-2">
            {play.source.label}
            <ArrowUpRight className="ml-0.5 inline size-3 align-[-2px]" aria-hidden />
          </a>
        )}
      </p>
      <p className="mt-3 text-[12.5px] leading-5 text-fg-2">
        <span className="font-medium text-fg">How to run it. </span>
        {play.coach}
      </p>
      {test && <BacktestLine t={test} play={play} className="mt-3" />}
      <p className="mb-2 mt-4 text-[12.5px] text-fg-3">
        <span className="font-mono tnum text-fg-2">{live}</span> live {live === 1 ? "match" : "matches"}
        {matches.length > live && ` · ${matches.length - live} worked`}
        {onToday > 0 && (
          <>
            {" · "}
            <Link href="/today" className="text-fg-2 underline-offset-2 hover:text-fg hover:underline">
              {onToday} on Today
            </Link>
          </>
        )}
      </p>
      {!matches.length ? (
        <p className="text-[13px] text-fg-3">Nothing matches right now. I check again every time your accounts or deals change.</p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg bg-surface ring-1 ring-inset ring-border">
          {matches.slice(0, 8).map((m) => (
            <MatchRow key={m.key} m={m} play={play} ws={ws} today={today} />
          ))}
        </ul>
      )}
      {matches.length > 8 && <p className="mt-2 text-[12px] text-fg-3">and {matches.length - 8} more, best first.</p>}
      {skips.length > 0 && (
        <div className="mt-3">
          <button type="button" onClick={() => setShowSkips((v) => !v)} aria-expanded={showSkips} className="inline-flex items-center gap-1 text-[12px] font-medium text-fg-3 hover:text-fg-2">
            <ChevronRight aria-hidden className={cn("size-3 transition-transform duration-150", showSkips && "rotate-90")} />
            {skips.length} with the trigger that the play skipped, and why
          </button>
          {showSkips && (
            <ul className="mt-2 space-y-1 text-[12px] leading-5">
              {skips.map((x) => (
                <li key={x.domain} className="flex flex-wrap gap-x-2">
                  <Link href={companyHref(x.domain)} className="font-medium text-fg-2 hover:text-fg">
                    {x.company}
                  </Link>
                  <span className="text-fg-3">{x.reason}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {toResearch.length > 0 && (play.action.kind === "write" || play.action.kind === "research") && play.family !== "pipeline" && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button size="sm" variant="agent" icon={<Search className="size-3.5" />} loading={busy} onClick={() => void researchTop()}>
            Research the top {toResearch.length}
          </Button>
          <span className="text-[12px] text-fg-3">A cited dossier each, about 2 minutes. First touches land on Today as drafts.</span>
        </div>
      )}
    </div>
  );
}
