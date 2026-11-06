"use client";

import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { ComposeButton } from "@/components/compose/composer";
import { useAsk } from "@/components/providers/ask-provider";
import { useRuns } from "@/components/providers/runs-provider";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Favicon } from "@/components/ui/favicon";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/client/cn";
import { nowISO } from "@/lib/domain/ids";
import type { Workspace } from "@/lib/domain/types";
import { matchAge, type PlayBacktest, type PlayDef, type PlayMatch, type PlayResults } from "@/lib/plays/catalog";
import { money } from "@/lib/revenue/forecast";

/** The mono micro-label the app uses for section names inside a card. */
export function Micro({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("font-mono text-[11px] font-medium uppercase leading-4 tracking-[0.12em] text-fg-3", className)}>{children}</span>;
}

export function companyHref(domain: string): string {
  return `/companies?c=${encodeURIComponent(domain)}`;
}

/** The play run against the deals on file: did the trigger come before the wins, and before the losses? */
export function BacktestLine({ t, play, className }: { t: PlayBacktest; play: PlayDef; className?: string }) {
  const decided = t.won[1] + t.lost[1];
  const n = (pair: [number, number]) => (
    <span className="font-mono tnum">
      {pair[0]}/{pair[1]}
    </span>
  );
  return (
    <p className={cn("text-[12.5px] leading-5 text-fg-2", className)}>
      <span className="font-medium text-fg">Backtest on your deals. </span>
      {decided === 0 && t.open[1] === 0 ? (
        "No deals yet to test it against."
      ) : (
        <>
          The trigger showed up in the {play.windowDays} days before the first call for {n(t.won)} won, {n(t.lost)} lost and {n(t.open)} open deals.
        </>
      )}{" "}
      In the last 90 days it fired at <span className="font-mono tnum">{t.fired}</span> {t.fired === 1 ? "company" : "companies"}
      {t.fired > 0 && (
        <>
          ; <span className="font-mono tnum">{t.becameDeals}</span> became {t.becameDeals === 1 ? "a deal" : "deals"}
        </>
      )}
      .{decided < 10 && <span className="text-fg-3"> {decided === 0 ? "No closed deals yet, so it can't say whether it predicts wins." : "Too few closed deals to call it a pattern yet."}</span>}
    </p>
  );
}

/** "3 worked · 2 touched · 1 replied · $24K pipeline", counted from the first day the play worked each company. */
export function ResultsLine({ r, className }: { r: PlayResults; className?: string }) {
  if (!r.worked) return <span className={className}>No results yet</span>;
  const parts = [
    `${r.worked} worked`,
    r.touched ? `${r.touched} touched` : "",
    r.replied ? `${r.replied} replied` : "",
    r.meetings ? `${r.meetings} met` : "",
    r.pipeline ? (r.pipelineUsd ? `${money(r.pipelineUsd)} pipeline` : `${r.pipeline} open ${r.pipeline === 1 ? "deal" : "deals"}`) : "",
    r.won ? (r.wonUsd ? `${money(r.wonUsd)} won` : `${r.won} won`) : "",
  ].filter(Boolean);
  return (
    <Tooltip content="Counted from the first day this play worked each company: touches, replies, meetings and deals since. Kept for good, however old.">
      <span tabIndex={0} className={cn("cursor-help rounded-[2px] font-mono text-[12px] tnum outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]", className)}>
        {parts.join(" · ")}
      </span>
    </Tooltip>
  );
}

/**
 * The one thing to do about a match: draft the first touch (with its sources), research it, ask for the intro, or
 * open Ask on the deal. Working a match from here records it against the play, so results are attributed.
 */
export function MatchAction({ m, play, ws, size = "xs" }: { m: PlayMatch; play: PlayDef; ws: Workspace; size?: "xs" | "sm" }) {
  const { openAsk } = useAsk();
  const { start } = useRuns();
  const { dispatch } = useWorkspace();
  const acc = ws.accounts[m.domain];
  const note = () => {
    if (ws.plays?.[play.id]?.worked?.[m.domain] || ws.plays?.[play.id]?.runs?.some((r) => r.domains.includes(m.domain))) return;
    void dispatch({ type: "play.run", id: play.id, domains: [m.domain], at: nowISO() });
  };
  if (m.worked) return null;
  const compose = !!acc && (play.action.kind === "write" || play.action.kind === "intro") && (!!play.custom || !play.prompt);
  if (compose) {
    return (
      <span onClickCapture={note} className="shrink-0">
        <ComposeButton domain={m.domain} personId={m.personId} mode={play.action.kind === "intro" ? "warm_intro" : "cold"} label={play.action.kind === "intro" ? "Draft the intro ask" : "Draft the first touch"} />
      </span>
    );
  }
  if (play.action.kind === "research") {
    return acc?.dossier ? (
      <Link href={companyHref(m.domain)} className="shrink-0 text-[12.5px] font-medium text-fg-2 underline-offset-2 hover:text-fg hover:underline">
        Open the dossier
      </Link>
    ) : (
      <Button
        size={size}
        variant="agent"
        onClick={async () => {
          note();
          if (await start("dossier", { domain: m.domain }, { notify: true })) toast(`Researching ${m.company}`);
        }}
      >
        {play.action.label}
      </Button>
    );
  }
  if (play.prompt) {
    return (
      <Button
        size={size}
        variant="agent"
        onClick={() => {
          note();
          openAsk({ context: m.dealId ? { kind: "deal", id: m.dealId } : { kind: "account", id: m.domain }, prefill: play.prompt!(m, ws) });
        }}
      >
        {play.action.label}
      </Button>
    );
  }
  return null;
}

/** A dated fact with its age and source: "Billing Analyst to reconcile usage · 12d ago ↗". */
export function Trigger({ m, today, className }: { m: PlayMatch; today: string; className?: string }) {
  return (
    <p className={cn("min-w-0 truncate text-[12.5px] text-fg-2", className)}>
      {m.headline}
      {m.date && <span className="ml-1.5 font-mono text-[12px] text-fg-3">{matchAge(m.date, today)}</span>}
      {m.url && (
        <a href={m.url} target="_blank" rel="noreferrer" aria-label={`Source for ${m.company}`} className="ml-1.5 inline-flex translate-y-[1px] text-fg-3 hover:text-fg">
          <ArrowUpRight className="size-3.5" />
        </a>
      )}
    </p>
  );
}

export function MatchRow({ m, play, ws, today, extra, note }: { m: PlayMatch; play: PlayDef; ws: Workspace; today: string; extra?: ReactNode; note?: string }) {
  return (
    <li className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 sm:px-4", m.worked && "opacity-70")}>
      <Favicon domain={m.domain} name={m.company} size={18} />
      <div className="min-w-0 flex-1 basis-56">
        <p className="flex flex-wrap items-baseline gap-x-2 text-[13.5px]">
          <Link href={companyHref(m.domain)} className="font-medium text-fg underline-offset-2 hover:underline">
            {m.company}
          </Link>
          {m.personName && <span className="text-[12.5px] text-fg-3">{m.personName}</span>}
          {extra}
          {m.worked && <Badge tone="neutral">{note ?? "Worked"}</Badge>}
        </p>
        <Trigger m={m} today={today} />
      </div>
      <MatchAction m={m} play={play} ws={ws} />
    </li>
  );
}
