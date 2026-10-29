"use client";

import { AnimatePresence, motion } from "motion/react";
import { ArrowUpRight, ChevronRight, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ComposeButton } from "@/components/compose/composer";
import { useAsk } from "@/components/providers/ask-provider";
import { useRuns } from "@/components/providers/runs-provider";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { useToday } from "@/components/companies/list/lib";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SectionLabel } from "@/components/ui/card";
import { Favicon } from "@/components/ui/favicon";
import { LoadingSignal } from "@/components/ui/loading";
import { PageHeader } from "@/components/ui/page-header";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/client/cn";
import { nowISO } from "@/lib/domain/ids";
import type { Workspace } from "@/lib/domain/types";
import { ease, listItem } from "@/lib/motion";
import { visibleMoves } from "@/lib/moves/rules";
import {
  backtestPlay,
  FAMILY_LABELS,
  matchAge,
  PLAYS,
  playEnabled,
  playMatches,
  playResults,
  playSkips,
  type PlayBacktest,
  type PlayDef,
  type PlayFamily,
  type PlayMatch,
  type PlayResults,
} from "@/lib/plays/catalog";
import { money } from "@/lib/revenue/forecast";

const FAMILIES: PlayFamily[] = ["signal", "network", "pipeline", "customer"];
const BULK = 3;

interface Row {
  play: PlayDef;
  on: boolean;
  matches: PlayMatch[];
  live: number;
  onToday: number;
  results: PlayResults;
}

/**
 * Plays: the programs a GTM engineer would wire up in Clay and a sequencer, run here in code against
 * the workspace every day. Each shows its trigger, why it works, what matches right now (with the fact
 * that triggered it), and what it has produced. Running plays put their best match on Today.
 */
export function PlaysPage() {
  const { ws } = useWorkspace();
  const today = useToday();
  const [open, setOpen] = useState<string | null>(null);

  const rows = useMemo<Row[] | null>(() => {
    if (!ws || !today) return null;
    const desk = visibleMoves(ws.moves, today);
    return PLAYS.map((play) => {
      const matches = playMatches(ws, play, today);
      return {
        play,
        on: playEnabled(ws, play.id),
        matches,
        live: matches.filter((m) => !m.worked).length,
        onToday: desk.filter((m) => m.playId === play.id).length,
        results: playResults(ws, play),
      };
    });
  }, [ws, today]);

  if (!ws || !rows) return <LoadingSignal label="Matching your plays" className="min-h-[60dvh]" />;
  const running = rows.filter((r) => r.on).length;
  const live = rows.filter((r) => r.on).reduce((n, r) => n + r.live, 0);
  const onToday = rows.reduce((n, r) => n + r.onToday, 0);
  const pipeline = rows.reduce((n, r) => n + r.results.pipelineUsd + r.results.wonUsd, 0);

  return (
    <div className="page-shell max-w-[1000px]">
      <PageHeader
        title="Plays"
        eyebrow="Always on"
        description="Repeatable programs I run against your accounts every day: a trigger you could write down, one action, and results counted from your deals. Running plays put their best match on Today; pause one and its cards come off."
      >
        <p className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-fg-3">
          <span>
            <span className="font-mono tnum text-fg-2">{running}</span> of {rows.length} running
          </span>
          <span aria-hidden>·</span>
          <span>
            <span className="font-mono tnum text-fg-2">{live}</span> live {live === 1 ? "match" : "matches"}
          </span>
          <span aria-hidden>·</span>
          <span>
            <span className="font-mono tnum text-fg-2">{onToday}</span> on Today
          </span>
          {pipeline > 0 && (
            <>
              <span aria-hidden>·</span>
              <span>
                <span className="font-mono tnum text-fg-2">{money(pipeline)}</span> in deals they touched
              </span>
            </>
          )}
          <span aria-hidden>·</span>
          <span>Free public signals only: no intent data bought</span>
        </p>
      </PageHeader>

      {FAMILIES.map((family) => {
        const group = rows.filter((r) => r.play.family === family);
        if (!group.length) return null;
        return (
          <section key={family} className="mt-10" aria-labelledby={`family-${family}`}>
            <SectionLabel>
              <span id={`family-${family}`}>{FAMILY_LABELS[family]}</span>
            </SectionLabel>
            <div className="space-y-2.5">
              {group.map((row, i) => (
                <motion.div key={row.play.id} variants={listItem} initial="hidden" animate="show" custom={i}>
                  <PlayCard row={row} ws={ws} today={today} open={open === row.play.id} onToggle={() => setOpen((o) => (o === row.play.id ? null : row.play.id))} />
                </motion.div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function PlayCard({ row, ws, today, open, onToggle }: { row: Row; ws: Workspace; today: string; open: boolean; onToggle: () => void }) {
  const { dispatch } = useWorkspace();
  const { play, on, matches, live, onToday, results } = row;
  const toggle = async () => {
    const ok = await dispatch({ type: "play.set", id: play.id, enabled: !on, at: nowISO() });
    if (ok) toast(on ? `${play.name} paused. Its cards come off Today.` : `${play.name} is running.`);
  };

  return (
    <div className={cn("overflow-hidden rounded-xl bg-surface shadow-sm ring-1 ring-inset ring-border transition-opacity", !on && "opacity-75")}>
      <div className="grid gap-x-6 gap-y-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:px-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[14.5px] font-medium text-fg">{play.name}</h3>
            {play.data === "paid" && <Badge tone="outline">Needs paid data</Badge>}
          </div>
          <p className="mt-1 text-[13px] leading-5 text-fg-2">
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
        </div>
        <div className="flex items-start gap-3 sm:flex-col sm:items-end">
          <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-label={`${play.name}: ${on ? "running" : "paused"}`}
            onClick={() => void toggle()}
            className="inline-flex h-7 items-center gap-2 rounded-full px-2.5 text-[12px] font-medium ring-1 ring-inset ring-border transition-[background-color,transform] duration-150 hover:bg-bg-subtle active:scale-[0.97]"
          >
            <span aria-hidden className={cn("relative inline-flex h-3.5 w-6 items-center rounded-full transition-colors duration-150", on ? "bg-fg" : "bg-border-strong")}>
              <span className={cn("absolute size-2.5 rounded-full bg-bg transition-transform duration-150", on ? "translate-x-3" : "translate-x-0.5")} />
            </span>
            {on ? "Running" : "Paused"}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border px-4 py-2.5 text-[12.5px] text-fg-3 sm:px-5">
        <button type="button" onClick={onToggle} aria-expanded={open} className="inline-flex items-center gap-1.5 rounded-sm font-medium text-fg-2 outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-[var(--ring)]">
          <ChevronRight aria-hidden className={cn("size-3.5 transition-transform duration-150", open && "rotate-90")} />
          <span className="font-mono tnum">{live}</span> live {live === 1 ? "match" : "matches"}
          {matches.length > live && <span className="font-normal text-fg-3">· {matches.length - live} worked</span>}
        </button>
        {onToday > 0 && (
          <Link href="/today" className="text-fg-2 underline-offset-2 hover:text-fg hover:underline">
            {onToday} on Today
          </Link>
        )}
        <span className="ml-auto flex flex-wrap items-center gap-x-3">
          <ResultsLine r={results} />
        </span>
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0, transition: { duration: 0.12 } }} transition={{ duration: 0.2, ease: ease.out }} className="overflow-hidden">
            <Matches row={row} ws={ws} today={today} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ResultsLine({ r }: { r: PlayResults }) {
  if (!r.worked) return <span>No results yet</span>;
  const parts = [
    `${r.worked} worked`,
    r.touched ? `${r.touched} touched` : "",
    r.replied ? `${r.replied} replied` : "",
    r.meetings ? `${r.meetings} met` : "",
    r.pipeline ? `${money(r.pipelineUsd)} pipeline` : "",
    r.won ? `${money(r.wonUsd)} won` : "",
  ].filter(Boolean);
  return (
    <Tooltip content="Counted from the first day this play worked each company: touches, replies, meetings and deals since.">
      <span tabIndex={0} className="cursor-help rounded-[2px] font-mono text-[12px] tnum outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]">
        {parts.join(" · ")}
      </span>
    </Tooltip>
  );
}

function Matches({ row, ws, today }: { row: Row; ws: Workspace; today: string }) {
  const { dispatch } = useWorkspace();
  const { start } = useRuns();
  const { play, matches } = row;
  const [busy, setBusy] = useState(false);
  const toResearch = matches.filter((m) => !m.worked && !ws.accounts[m.domain]?.dossier).slice(0, BULK);
  const test = backtestPlay(ws, play, today);
  const skips = playSkips(ws, play, today);
  const [showSkips, setShowSkips] = useState(false);

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
    <div className="border-t border-border bg-bg-subtle/40 px-4 pb-4 pt-3 sm:px-5">
      <p className="mb-3 text-[12.5px] leading-5 text-fg-2">
        <span className="font-medium text-fg">How to run it. </span>
        {play.coach}
      </p>
      {test && <BacktestLine t={test} play={play} />}
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
                  <Link href={`/companies?c=${encodeURIComponent(x.domain)}`} className="font-medium text-fg-2 hover:text-fg">
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

/** The play run against the deals on file: did the trigger come before the wins, and before the losses? */
function BacktestLine({ t, play }: { t: PlayBacktest; play: PlayDef }) {
  const decided = t.won[1] + t.lost[1];
  return (
    <p className="mb-3 text-[12.5px] leading-5 text-fg-2">
      <span className="font-medium text-fg">Backtest on your deals. </span>
      {decided === 0 && t.open[1] === 0 ? (
        "No deals yet to test it against."
      ) : (
        <>
          The trigger showed up in the {play.windowDays} days before the first call for{" "}
          <span className="font-mono tnum">
            {t.won[0]}/{t.won[1]}
          </span>{" "}
          won,{" "}
          <span className="font-mono tnum">
            {t.lost[0]}/{t.lost[1]}
          </span>{" "}
          lost and{" "}
          <span className="font-mono tnum">
            {t.open[0]}/{t.open[1]}
          </span>{" "}
          open deals.
        </>
      )}{" "}
      In the last 90 days it fired at <span className="font-mono tnum">{t.fired}</span> {t.fired === 1 ? "company" : "companies"}
      {t.fired > 0 && (
        <>
          ; <span className="font-mono tnum">{t.becameDeals}</span> became {t.becameDeals === 1 ? "a deal" : "deals"}
        </>
      )}
      .{decided < 10 && decided > 0 && <span className="text-fg-3"> Too few closed deals to call it a pattern yet.</span>}
    </p>
  );
}

function MatchRow({ m, play, ws, today }: { m: PlayMatch; play: PlayDef; ws: Workspace; today: string }) {
  const { openAsk } = useAsk();
  const { start } = useRuns();
  const { dispatch } = useWorkspace();
  const acc = ws.accounts[m.domain];
  // Record the account against the play once, the first time it's worked from here.
  const note = () => {
    if (ws.plays?.[play.id]?.runs?.some((r) => r.domains.includes(m.domain))) return;
    void dispatch({ type: "play.run", id: play.id, domains: [m.domain], at: nowISO() });
  };

  let action: React.ReactNode = null;
  if (!m.worked) {
    if (play.prompt) {
      action = (
        <Button
          size="xs"
          variant="agent"
          onClick={() => {
            note();
            openAsk({ context: m.dealId ? { kind: "deal", id: m.dealId } : { kind: "account", id: m.domain }, prefill: play.prompt!(m, ws) });
          }}
        >
          {play.action.label}
        </Button>
      );
    } else if (play.action.kind === "research") {
      action = acc?.dossier ? null : (
        <Button
          size="xs"
          variant="agent"
          onClick={async () => {
            note();
            if (await start("dossier", { domain: m.domain }, { notify: true })) toast(`Researching ${m.company}`);
          }}
        >
          {play.action.label}
        </Button>
      );
    } else if (acc) {
      action = (
        <span onClickCapture={note}>
          <ComposeButton domain={m.domain} personId={m.personId} mode={play.action.kind === "intro" ? "warm_intro" : "cold"} label={play.action.kind === "intro" ? "Draft the intro ask" : "Draft the first touch"} />
        </span>
      );
    }
  }

  return (
    <li className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 sm:px-4", m.worked && "opacity-60")}>
      <Favicon domain={m.domain} name={m.company} size={18} />
      <div className="min-w-0 flex-1 basis-56">
        <p className="flex flex-wrap items-baseline gap-x-2 text-[13.5px]">
          <Link href={`/companies?c=${encodeURIComponent(m.domain)}`} className="font-medium text-fg underline-offset-2 hover:underline">
            {m.company}
          </Link>
          {m.personName && <span className="text-[12.5px] text-fg-3">{m.personName}</span>}
          {m.worked && <Badge tone="neutral">Worked</Badge>}
        </p>
        <p className="truncate text-[12.5px] text-fg-2">
          {m.headline}
          {m.date && <span className="ml-1.5 font-mono text-[11.5px] text-fg-3">{matchAge(m.date, today)}</span>}
          {m.url && (
            <a href={m.url} target="_blank" rel="noreferrer" aria-label="Source" className="ml-1.5 inline-flex translate-y-[1px] text-fg-3 hover:text-fg">
              <ArrowUpRight className="size-3.5" />
            </a>
          )}
        </p>
      </div>
      {action}
    </li>
  );
}

