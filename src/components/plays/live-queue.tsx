"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { SectionLabel } from "@/components/ui/card";
import { Favicon } from "@/components/ui/favicon";
import type { Workspace } from "@/lib/domain/types";
import type { PlayDef, PlayMatch } from "@/lib/plays/catalog";
import { companyHref, MatchAction, Trigger } from "./parts";

export interface QueueItem {
  m: PlayMatch;
  play: PlayDef;
  /** Other running plays that also match this company. */
  also: string[];
}

/** One row per company across every running play, best match first: the reason, the play, and the one thing to do. */
export function liveQueue(rows: { play: PlayDef; on: boolean; matches: PlayMatch[] }[]): QueueItem[] {
  const best = new Map<string, QueueItem>();
  for (const { play, on, matches } of rows) {
    if (!on) continue;
    for (const m of matches) {
      if (m.worked) continue;
      const prev = best.get(m.domain);
      if (!prev) best.set(m.domain, { m, play, also: [] });
      else if (m.score > prev.m.score) best.set(m.domain, { m, play, also: [...prev.also, prev.play.name] });
      else if (!prev.also.includes(play.name)) prev.also.push(play.name);
    }
  }
  return [...best.values()].sort((a, b) => b.m.score - a.m.score || a.m.company.localeCompare(b.m.company));
}

const FIRST = 6;

export function LiveQueue({ items, ws, today, onOpenPlay }: { items: QueueItem[]; ws: Workspace; today: string; onOpenPlay: (id: string) => void }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, FIRST);
  return (
    <section className="mt-8" aria-labelledby="live-matches">
      <SectionLabel right={items.length > 0 && <span className="text-[12px] text-fg-3">{items.length === 1 ? "1 company" : `${items.length} companies`} · best first · one row each</span>}>
        <span id="live-matches">Live matches</span>
      </SectionLabel>
      {!items.length ? (
        <p className="rounded-xl bg-surface px-4 py-5 text-[13px] leading-5 text-fg-3 ring-1 ring-inset ring-border sm:px-5">
          Nothing new matches a running play right now. I check again every time your accounts, signals or deals change.
        </p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl bg-surface shadow-sm ring-1 ring-inset ring-border">
          {shown.map(({ m, play, also }) => (
            <li key={`${play.id}:${m.key}`} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 sm:px-4">
              <Favicon domain={m.domain} name={m.company} size={18} />
              <div className="min-w-0 flex-1 basis-60">
                <p className="flex flex-wrap items-baseline gap-x-2 text-[13.5px]">
                  <Link href={companyHref(m.domain)} className="font-medium text-fg underline-offset-2 hover:underline">
                    {m.company}
                  </Link>
                  {m.personName && <span className="text-[12.5px] text-fg-3">{m.personName}</span>}
                </p>
                <Trigger m={m} today={today} />
              </div>
              <button
                type="button"
                onClick={() => onOpenPlay(play.id)}
                title={also.length ? `Also matches: ${also.join(", ")}` : `Open ${play.name}`}
                className="inline-flex max-w-[16rem] min-w-0 items-center gap-1.5 rounded-xs px-1.5 py-0.5 text-[12px] text-fg-2 ring-1 ring-inset ring-border transition-colors hover:bg-bg-subtle hover:text-fg"
              >
                <span className="truncate">{play.name}</span>
                {play.custom && <Badge tone="agent">Custom</Badge>}
                {also.length > 0 && <span className="font-mono text-[11px] text-fg-3">+{also.length}</span>}
              </button>
              <MatchAction m={m} play={play} ws={ws} />
            </li>
          ))}
        </ul>
      )}
      {items.length > FIRST && (
        <button type="button" onClick={() => setAll((v) => !v)} aria-expanded={all} className="mt-2 inline-flex items-center gap-1 rounded-sm text-[12px] font-medium text-fg-3 hover:text-fg-2">
          <ChevronDown aria-hidden className={`size-3 transition-transform duration-150 ${all ? "rotate-180" : ""}`} />
          {all ? "Show fewer" : `Show all ${items.length}`}
        </button>
      )}
    </section>
  );
}
