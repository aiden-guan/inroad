"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { SectionLabel } from "@/components/ui/card";
import { cn } from "@/lib/client/cn";
import { shortDate } from "@/lib/client/format";
import type { GoalPace, GrowthRead } from "@/lib/consumer/growth";
import { partnerCopy, partnerResults } from "@/lib/consumer/partners";
import type { ChannelPlan, Workspace } from "@/lib/domain/types";
import { perWeek } from "./growth-hero";

type Funnel = NonNullable<ChannelPlan["funnel"]["consumer"]>;

function Row({ label, note, need, now, short }: { label: string; note?: string; need: string; now: string; short?: boolean }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_72px_72px] items-baseline gap-x-3 px-4 py-2.5 sm:grid-cols-[minmax(0,1fr)_96px_96px] sm:px-5">
      <span className="text-[13.5px] text-fg-2">
        {label}
        {note && <span className="block text-[12px] text-fg-3">{note}</span>}
      </span>
      <span className="text-right font-mono text-[14px] tnum text-fg-2">{need}</span>
      <span className={cn("text-right font-mono text-[14px] tnum", short ? "font-medium text-warning" : "text-fg")}>{now}</span>
    </div>
  );
}

/**
 * The plan behind the number, retention first: active users needed ÷ the retention bar = the signups the goal takes.
 * Each line is what the plan needs against what the last logged week shows. The plan itself is edited in the
 * Playbook; this page reads it.
 */
export function WhatItTakes({ ws, g, pace, funnel, talks }: { ws: Workspace; g: GrowthRead; pace: GoalPace | null; funnel: Funnel; talks: number }) {
  const { goal } = ws;
  const repeat = g.model.retention.metric === "m3_repeat";
  const talksTarget = goal.userTalksPerWeek ?? 5;
  const signups = g.latest?.signups;
  return (
    <section className="mt-12" aria-labelledby="takes-label">
      <SectionLabel
        right={
          <Link href="/playbook#plan" className="inline-flex items-center gap-1 rounded-xs text-[12px] text-fg-3 underline-offset-4 transition-colors hover:text-fg hover:underline">
            Change the plan <ArrowRight className="size-3" aria-hidden />
          </Link>
        }
      >
        <span id="takes-label">What it takes</span>
      </SectionLabel>
      <div className="overflow-hidden rounded-xl bg-surface shadow-sm ring-1 ring-inset ring-border">
        <p className="px-4 pb-4 pt-5 text-pretty font-serif text-[19px] leading-[28px] text-fg sm:px-5">
          {goal.target.toLocaleString("en-US")} {goal.targetLabel} by {shortDate(goal.byDate)} takes about {funnel.signupsNeeded.toLocaleString("en-US")} signups at a {funnel.retentionTarget}%
          retention bar: {funnel.signupsPerWeek.toLocaleString("en-US")} a week.
        </p>
        <div className="grid grid-cols-[minmax(0,1fr)_72px_72px] gap-x-3 border-y border-border bg-bg-subtle/60 px-4 py-1.5 text-[11.5px] text-fg-3 sm:grid-cols-[minmax(0,1fr)_96px_96px] sm:px-5">
          <span />
          <span className="text-right">Plan</span>
          <span className="text-right">Now</span>
        </div>
        <div className="divide-y divide-border">
          <Row label="Signups a week" need={funnel.signupsPerWeek.toLocaleString("en-US")} now={signups !== undefined ? signups.toLocaleString("en-US") : "—"} short={signups !== undefined && signups < funnel.signupsPerWeek * 0.8} />
          <Row
            label={repeat ? "Repeat within 90 days" : "Week-4 retention"}
            note="Every point above the bar cuts the signups the goal needs"
            need={`${funnel.retentionTarget}%`}
            now={g.retention !== undefined ? `${g.retention}%` : "—"}
            short={g.retentionStatus === "below"}
          />
          {pace && (
            <Row
              label="Growth a week, net"
              note={`${goal.targetLabel.charAt(0).toUpperCase()}${goal.targetLabel.slice(1)}, to reach ${goal.target.toLocaleString("en-US")} by ${shortDate(goal.byDate)}`}
              need={perWeek(pace.needPerWeek)}
              now={perWeek(pace.perWeek)}
              short={!pace.onPace}
            />
          )}
          <Row label="User conversations this week" note="New, active and churned users" need={String(talksTarget)} now={String(talks)} short={talks < talksTarget} />
        </div>
      </div>
    </section>
  );
}

/**
 * What's working, from what was logged: the channel that led each week, what creators and communities brought, the
 * share that came from a friend, and the experiments that read out. Nothing estimated; nothing logged, nothing shown.
 */
export function Working({ ws, g }: { ws: Workspace; g: GrowthRead }) {
  const channels = new Map<string, number>();
  const recent = g.weeks.slice(-8);
  for (const w of recent) if (w.topChannel) channels.set(w.topChannel, (channels.get(w.topChannel) ?? 0) + 1);
  const led = [...channels.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  const creators = Object.values(ws.partners ?? {})
    .map((p) => ({ p, r: partnerResults(p) }))
    .filter(({ r }) => r.signups + r.orders > 0)
    .sort((a, b) => b.r.signups + b.r.orders - (a.r.signups + a.r.orders))
    .slice(0, 3);
  const experiments = Object.values(ws.experiments ?? {});
  const read = experiments.filter((e) => e.status === "won" || e.status === "lost").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 2);
  const running = experiments.filter((e) => e.status === "running").length;
  const copy = partnerCopy("consumer");
  const empty = !led.length && !creators.length && g.referredShare === undefined && !read.length && !running;

  return (
    <section className="mt-12" aria-labelledby="working-label">
      <SectionLabel>
        <span id="working-label">What&apos;s working</span>
      </SectionLabel>
      {empty ? (
        <div className="rounded-xl bg-surface px-5 py-6 ring-1 ring-inset ring-border">
          <p className="font-serif text-[19px] leading-[28px] text-fg">Log where most signups came from each week, and I&apos;ll show what&apos;s working.</p>
          <p className="mt-1.5 max-w-[60ch] text-[13.5px] leading-[21px] text-fg-2">
            The channel that led each week, what each creator and community brought, how many came from a friend, and the experiments that read out. Only what you log; nothing estimated.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {led.length > 0 && (
            <Card title="Where signups came from" more={{ href: "#numbers", label: "The weeks" }}>
              {led.map(([name, weeks]) => (
                <Line key={name} label={name} value={`led ${weeks} of ${recent.length} ${recent.length === 1 ? "week" : "weeks"}`} />
              ))}
            </Card>
          )}
          {creators.length > 0 && (
            <Card title={copy.title} more={{ href: "/partners", label: "All of them" }}>
              {creators.map(({ p, r }) => (
                <Line
                  key={p.id}
                  label={p.name}
                  value={[r.signups ? `${r.signups} signups` : null, r.orders ? `${r.orders} orders` : null, r.costPer !== undefined ? `$${r.costPer.toFixed(2)} each` : null].filter(Boolean).join(" · ")}
                />
              ))}
            </Card>
          )}
          {(read.length > 0 || running > 0) && (
            <Card title="Experiments" more={{ href: "/playbook#experiments", label: "All of them" }}>
              {read.map((e) => (
                <Line key={e.id} label={e.result || e.hypothesis} value={e.status === "won" ? "Won" : "Lost"} />
              ))}
              {running > 0 && <Line label={`${running} running`} value="reads on its end date" muted />}
            </Card>
          )}
          {g.referredShare !== undefined && (
            <Card title="From a friend">
              <Line label="Of last week's signups" value={`${Math.round(g.referredShare)}%`} />
            </Card>
          )}
        </div>
      )}
    </section>
  );
}

function Card({ title, more, children }: { title: string; more?: { href: string; label: string }; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl bg-surface shadow-sm ring-1 ring-inset ring-border">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5 sm:px-5">
        <h3 className="text-[12.5px] font-medium text-fg-2">{title}</h3>
        {more && (
          <Link href={more.href} className="rounded-xs text-[12px] text-fg-3 underline-offset-4 transition-colors hover:text-fg hover:underline">
            {more.label}
          </Link>
        )}
      </div>
      <ul className="divide-y divide-border">{children}</ul>
    </div>
  );
}

function Line({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <li className="flex items-baseline justify-between gap-4 px-4 py-2.5 sm:px-5">
      <span className={cn("min-w-0 truncate text-[13.5px]", muted ? "text-fg-3" : "text-fg")}>{label}</span>
      <span className="shrink-0 font-mono text-[12.5px] tnum text-fg-2">{value}</span>
    </li>
  );
}
