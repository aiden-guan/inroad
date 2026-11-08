"use client";

import { ArrowUpRight, CalendarDays, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Favicon } from "@/components/ui/favicon";
import { Num } from "@/components/ui/misc";
import { cn } from "@/lib/client/cn";
import { addDays, todayISO } from "@/lib/domain/ids";
import type { Workspace } from "@/lib/domain/types";
import { computeScoreboard, conversationsBetween } from "@/lib/moves/scoreboard";
import { localDate } from "@/lib/moves/util";

type Metric = "conversations" | "replies";

/** A seven-day view of recorded activity. Missing activity stays at zero; no interpolated trend. */
export function GrowthPulse({ ws, now }: { ws: Workspace; now: number }) {
  const scoreboard = useMemo(() => computeScoreboard(ws, new Date(now)), [ws, now]);
  const [metric, setMetric] = useState<Metric>("conversations");
  const [selected, setSelected] = useState(6);
  const today = todayISO(new Date(now));
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => {
    const day = addDays(today, i - 6);
    const end = day === today ? new Date(now) : new Date(`${day}T23:59:59.999`);
    return {
      day,
      label: new Date(`${day}T12:00:00`).toLocaleDateString("en-US", { weekday: "short" }),
      conversations: conversationsBetween(ws, day, end),
      replies: ws.activities.filter((a) => a.kind === "reply_received" && localDate(a.at) === day && new Date(a.at).getTime() <= now).length,
    };
  }), [ws, today, now]);
  const total = days.reduce((sum, day) => sum + day[metric], 0);
  const max = Math.max(2, ...days.map((day) => day[metric]));
  const ceiling = Math.ceil(max / 2) * 2;
  const active = days[selected];
  const upcoming = Object.values(ws.meetings).filter((meeting) => new Date(meeting.startsAt).getTime() > now).sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
  const domain = upcoming ? ws.deals[upcoming.dealId]?.accountDomain : undefined;

  return (
    <aside className="dashboard-rail" aria-label="Growth overview">
      <section aria-labelledby="momentum-title" className="rounded-xl bg-bg/65 p-5 ring-1 ring-inset ring-border xl:bg-transparent xl:p-0 xl:ring-0">
        <div className="flex items-center justify-between gap-2">
          <h2 id="momentum-title" className="text-[14px] font-medium">Your momentum</h2>
          <span className="text-[11px] text-fg-3">Past 7 days</span>
        </div>
        <div className="mt-4 inline-flex rounded-md bg-bg-subtle p-0.5" aria-label="Activity metric">
          {(["conversations", "replies"] as const).map((key) => (
            <button key={key} onClick={() => setMetric(key)} aria-pressed={metric === key} className={cn("rounded px-2.5 py-1.5 text-[12px] transition-colors duration-150", metric === key ? "bg-surface font-medium text-fg ring-1 ring-inset ring-border" : "text-fg-3 hover:text-fg")}>
              {key === "conversations" ? "Conversations" : "Replies"}
            </button>
          ))}
        </div>
        <div className="mt-4 flex items-baseline gap-2">
          <Num value={total} className="text-[32px] font-medium leading-10 tracking-[-0.04em]" />
          <span className="text-[12px] text-fg-3">{metric === "conversations" ? "held" : "received"}</span>
        </div>
        <div className="relative mt-4 h-[128px] pl-5" role="group" aria-label={`${metric === "conversations" ? "Conversations held" : "Replies received"} each day`}>
          {[ceiling, ceiling / 2, 0].map((tick, i) => (
            <div key={tick} aria-hidden className="pointer-events-none absolute inset-x-0 flex items-center gap-2" style={{ top: `${i * 50}%` }}>
              <span className="w-3 -translate-y-1/2 text-right font-mono text-[11px] leading-none text-fg-3">{tick}</span>
              <span className="h-px flex-1 bg-border/70" />
            </div>
          ))}
          <div className="relative grid h-full grid-cols-7 gap-2">
            {days.map((day, i) => (
              <button key={day.day} onClick={() => setSelected(i)} onPointerEnter={() => setSelected(i)} onFocus={() => setSelected(i)} data-selected={selected === i} aria-pressed={selected === i} aria-label={`${day.label}, ${day.day}: ${day[metric]} ${day[metric] === 1 ? metric === "replies" ? "reply" : "conversation" : metric}`} className="activity-column relative h-full rounded-sm">
                <span className="activity-bar absolute inset-0 rounded-t-[3px] bg-accent/60" style={{ transform: `scaleY(${day[metric] / ceiling})` }} />
              </button>
            ))}
          </div>
        </div>
        <div aria-hidden className="mt-2 grid grid-cols-7 gap-2 pl-5 text-center text-[11px] text-fg-3">{days.map((day) => <span key={day.day}>{day.label}</span>)}</div>
        <p className="mt-4 min-h-5 text-[12px] text-fg-3" aria-live="polite"><span className="font-medium text-fg-2">{active.day === today ? "Today" : active.label}</span> · {active[metric]} {metric === "conversations" ? active[metric] === 1 ? "conversation held" : "conversations held" : active[metric] === 1 ? "reply received" : "replies received"}</p>
        <Link href="/revenue" className="mt-4 flex items-center justify-between border-t border-border pt-3 text-[12px] font-medium text-fg-2 hover:text-fg">Open revenue overview <ArrowUpRight aria-hidden className="size-3.5" /></Link>
      </section>

      <section aria-labelledby="week-snapshot-title" className="pt-1">
        <h2 id="week-snapshot-title" className="mb-3 text-[14px] font-medium">At a glance</h2>
        <dl className="space-y-3 text-[13px]">
          {[
            ["Positive replies this week", scoreboard.positiveReplies],
            ["Meetings booked this week", scoreboard.meetingsBooked],
            ["Qualified deals", scoreboard.qualifiedDeals],
          ].map(([label, value]) => <div key={label} className="flex items-center justify-between gap-3"><dt className="text-fg-3">{label}</dt><dd className="font-mono tnum text-fg">{value}</dd></div>)}
        </dl>
      </section>

      <section aria-labelledby="up-next-title" className="border-t border-border pt-4">
        <div className="mb-3 flex items-center gap-2 text-[13px] font-medium"><CalendarDays aria-hidden className="size-4 text-fg-3" /><h2 id="up-next-title">Next conversation</h2></div>
        {upcoming ? <Link href={domain ? `/companies?c=${encodeURIComponent(domain)}` : "/companies?view=talking"} className="group block rounded-lg bg-bg p-3 ring-1 ring-inset ring-border transition-colors hover:bg-bg-subtle">
          <span className="flex items-center gap-2">{domain && <Favicon domain={domain} size={18} />}<span className="min-w-0 truncate text-[13px] font-medium">{upcoming.title}</span></span>
          <span className="mt-2 flex items-center justify-between gap-2 text-[12px] text-fg-3"><time dateTime={upcoming.startsAt}>{new Date(upcoming.startsAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })} · {new Date(upcoming.startsAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</time><ChevronRight aria-hidden className="size-3.5" /></span>
        </Link> : <p className="text-[13px] leading-5 text-fg-3">Your next meeting will appear here. Keep a few promising conversations moving.</p>}
      </section>
      <div className="text-[12px]">
        <Link href="/companies" className="dashboard-link"><span>Explore your companies</span><ArrowUpRight aria-hidden className="size-3.5" /></Link>
        <Link href="/plays" className="dashboard-link"><span>See your running plays</span><ArrowUpRight aria-hidden className="size-3.5" /></Link>
      </div>
    </aside>
  );
}
