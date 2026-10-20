"use client";

import { motion } from "motion/react";
import { Check, ChevronDown } from "lucide-react";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { AiBadge, Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionLabel } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/field";
import { Menu, MenuItem } from "@/components/ui/menu";
import { SourceChip } from "@/components/ui/source";
import { cn } from "@/lib/client/cn";
import type { DinnerPlan, GtmEvent } from "@/lib/domain/types";
import { spring } from "@/lib/motion";
import { GOALS, GOAL_LABEL, START_TIME, computeTimeline, eventDateTime, eventDay, type EventGoal } from "./plan-math";
import { AgentNote, Sources, Stat } from "./ui";

const COHOST_KIND: Record<NonNullable<DinnerPlan["coHost"]>["kind"], string> = {
  vc_platform: "VC platform team",
  non_competing_startup: "Non-competing startup",
  community: "Community",
  customer: "Customer",
};

function Themes({ ev, plan }: { ev: GtmEvent; plan: DinnerPlan }) {
  const { dispatch } = useWorkspace();
  const chosen = ev.chosenThemeIdx ?? 0;
  return (
    <section>
      <SectionLabel right={<span className="text-[12px] text-fg-3">The theme is a live question, never a pitch</span>}>The question</SectionLabel>
      <div role="radiogroup" aria-label="The question" className="space-y-2">
        {plan.themes.map((t, i) => {
          const active = i === chosen;
          return (
            <div key={i} className="relative rounded-lg bg-surface ring-1 ring-border transition-shadow duration-150 hover:shadow-sm">
              {active && (
                <motion.span layoutId={`theme-ring-${ev.id}`} transition={spring.snappy} className="pointer-events-none absolute inset-0 rounded-lg ring-2 ring-fg" aria-hidden />
              )}
              <button
                role="radio"
                aria-checked={active}
                onClick={() => void dispatch({ type: "event.chooseTheme", id: ev.id, index: i })}
                className="flex w-full items-start gap-3 rounded-lg p-4 pb-2 text-left"
              >
                <span
                  className={cn(
                    "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full ring-1 transition-colors duration-150",
                    active ? "bg-primary text-primary-fg ring-primary" : "ring-border-strong",
                  )}
                  aria-hidden
                >
                  {active && <Check className="size-2.5" strokeWidth={3} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[12.5px] font-medium text-fg-3">{t.title}</span>
                  <span className="mt-1 block font-serif text-[19px] leading-[27px] text-fg text-pretty">{t.question}</span>
                  <span className="mt-2 block text-[13px] leading-5 text-fg-2">{t.whyNow}</span>
                </span>
              </button>
              <div className="flex flex-wrap items-center gap-2 px-4 pb-3 pl-11">
                <Sources ids={t.evidenceIds} sources={t.sources} />
                {t.prompts.length > 0 && (
                  <span className="font-mono text-[11px] text-fg-3">
                    {t.prompts.length} prompts · {t.reservePrompts.length} in reserve
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function WhenWhere({ ev, plan }: { ev: GtmEvent; plan: DinnerPlan }) {
  const { dispatch } = useWorkspace();
  const day = eventDay(ev) ?? "";
  const time = ev.date && ev.date.length >= 16 ? ev.date.slice(11, 16) : START_TIME[ev.kind];

  const setDate = (date: string, t = time) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    const timeline = computeTimeline(ev.kind, date, { coHost: Boolean(plan.coHost), prev: plan.timeline });
    void dispatch({ type: "event.update", id: ev.id, patch: { date: eventDateTime(ev.kind, date, t), plan: { ...plan, targetDate: date, timeline } } });
  };
  const setVenue = (patch: Partial<NonNullable<GtmEvent["venue"]>>) => {
    const next = { name: ev.venue?.name ?? "", ...ev.venue, ...patch };
    if (next.name === (ev.venue?.name ?? "") && next.address === ev.venue?.address) return;
    void dispatch({ type: "event.update", id: ev.id, patch: { venue: next.name || next.address ? next : undefined } });
  };

  return (
    <section>
      <SectionLabel>When and where</SectionLabel>
      <Card className="@container p-4">
        <div className="grid gap-4 @xl:grid-cols-2">
          <div>
            <Label htmlFor="ev-date" hint="Moves every task with it">
              Date
            </Label>
            <div className="flex flex-wrap gap-2">
              <Input id="ev-date" type="date" value={day} onChange={(e) => setDate(e.target.value)} className="min-w-0 flex-1 font-mono" />
              <Input aria-label="Start time" type="time" value={time} onChange={(e) => e.target.value && setDate(day, e.target.value)} className="w-28 font-mono" />
            </div>
          </div>
          {ev.kind === "dinner" ? (
            <div>
              <Label htmlFor="ev-venue" hint={ev.venue?.name ? undefined : "Not booked yet"}>
                Venue
              </Label>
              <Input id="ev-venue" key={`v-${ev.venue?.name ?? ""}`} defaultValue={ev.venue?.name ?? ""} placeholder="Restaurant, private room" onBlur={(e) => setVenue({ name: e.target.value.trim() })} />
              <Input
                aria-label="Address"
                key={`a-${ev.venue?.address ?? ""}`}
                defaultValue={ev.venue?.address ?? ""}
                placeholder="Address"
                className="mt-2"
                onBlur={(e) => setVenue({ address: e.target.value.trim() || undefined })}
              />
            </div>
          ) : (
            <div>
              <Label htmlFor="ev-link" hint="Goes into the reminder and day-of text">
                Video link
              </Label>
              <Input
                id="ev-link"
                key={`l-${ev.venue?.address ?? ""}`}
                defaultValue={ev.venue?.address ?? ""}
                placeholder="https://meet.google.com/…"
                className="font-mono"
                onBlur={(e) => setVenue({ name: "Video call", address: e.target.value.trim() || undefined })}
              />
            </div>
          )}
        </div>

        {ev.kind === "dinner" && (
          <div className="mt-5 border-t border-border pt-4">
            <p className="text-[12px] font-medium text-fg-3">What to look for</p>
            <ul className="mt-2 grid gap-x-6 gap-y-1 text-[13px] leading-5 text-fg-2 @xl:grid-cols-2">
              {plan.venueCriteria.map((c) => (
                <li key={c} className="flex gap-2">
                  <span className="mt-2 size-1 shrink-0 rounded-full bg-fg-4" aria-hidden />
                  {c}
                </li>
              ))}
            </ul>
            {plan.venueIdeas.length > 0 ? (
              <ul className="mt-4 space-y-2">
                {plan.venueIdeas.map((v) => (
                  <li key={v.url + v.name} className="flex flex-col gap-2 rounded-md bg-bg-subtle px-3 py-2.5 @md:flex-row @md:items-start @md:gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-fg">{v.name}</p>
                      <p className="mt-0.5 text-[12.5px] leading-[18px] text-fg-2">{v.why}</p>
                      {v.quote && <p className="mt-1 font-serif text-[13.5px] italic leading-5 text-fg-3">“{v.quote}”</p>}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <SourceChip url={v.url} quote={v.quote} claim={v.name} />
                      <Button size="xs" variant="secondary" onClick={() => setVenue({ name: v.name })} disabled={ev.venue?.name === v.name}>
                        {ev.venue?.name === v.name ? "Chosen" : "Use"}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-4 text-[12.5px] text-fg-3">No venue ideas I could tie to a source. Ask your co-host where they host; they usually have a room.</p>
            )}
          </div>
        )}
      </Card>
    </section>
  );
}

function CoHost({ ev, plan }: { ev: GtmEvent; plan: DinnerPlan }) {
  const { dispatch } = useWorkspace();
  const suggested = plan.suggestedCoHost;
  /** Co-host tasks, seating and the budget split only start once someone has said yes. */
  const confirm = (coHost: DinnerPlan["coHost"]) => {
    const day = eventDay(ev);
    const timeline = day ? computeTimeline(ev.kind, day, { coHost: Boolean(coHost), prev: plan.timeline }) : plan.timeline;
    // Once the suggested co-host is confirmed, it stops being a suggestion (clearing them later doesn't bring it back).
    const accepted = Boolean(coHost && suggested && coHost.name === suggested.name);
    void dispatch({ type: "event.update", id: ev.id, patch: { plan: { ...plan, coHost, timeline, ...(accepted ? { suggestedCoHost: undefined } : {}) } } });
  };
  const save = (name: string) => {
    const current = plan.coHost?.name ?? "";
    if (name === current) return;
    const picked = suggested && suggested.name.toLowerCase() === name.toLowerCase() ? suggested : undefined;
    confirm(name ? (picked ?? { name, kind: plan.coHost?.kind ?? "non_competing_startup", why: "Your pick." }) : null);
  };
  return (
    <section>
      <SectionLabel>Co-host</SectionLabel>
      <Card className="p-4">
        {plan.coHost ? (
          <div className="mb-3 flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 text-[14px] font-medium text-fg">
                {plan.coHost.name}
                <Badge tone="outline">{COHOST_KIND[plan.coHost.kind]}</Badge>
              </p>
              <p className="mt-1 text-[13px] leading-5 text-fg-2">{plan.coHost.why}</p>
            </div>
          </div>
        ) : suggested ? (
          <div className="mb-3 flex flex-wrap items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 text-[14px] font-medium text-fg">
                <span>
                  <span className="font-normal text-fg-3">Suggested: </span>
                  {suggested.name}
                </span>
                <Badge tone="outline">{COHOST_KIND[suggested.kind]}</Badge>
                <AiBadge />
              </p>
              <p className="mt-1 text-[13px] leading-5 text-fg-2">{suggested.why}</p>
              <p className="mt-1 text-[12px] leading-[17px] text-fg-3">Ask them first. Their tasks and the cost split start when they say yes.</p>
            </div>
            <Button size="sm" variant="secondary" onClick={() => confirm(suggested)}>
              They said yes
            </Button>
          </div>
        ) : (
          <p className="mb-3 text-[13px] leading-5 text-fg-2">
            {ev.kind === "dinner"
              ? "No co-host yet. A VC platform team, a non-competing startup that sells to the same buyer, or a community lends its brand and its list; that's what fills a dinner."
              : "Optional for a roundtable. A co-host with the same buyer doubles your list."}
          </p>
        )}
        <Label htmlFor="ev-cohost-edit">{plan.coHost ? "Change co-host" : "Add a co-host"}</Label>
        <Input id="ev-cohost-edit" key={plan.coHost?.name ?? "none"} defaultValue={plan.coHost?.name ?? ""} placeholder="Name of the team or company" onBlur={(e) => save(e.target.value.trim())} />
      </Card>
    </section>
  );
}

function Notes({ plan }: { plan: DinnerPlan }) {
  if (!plan.notes?.length) return null;
  return (
    <section>
      <SectionLabel>
        <span className="inline-flex items-center gap-1.5">
          Before you invite <AiBadge />
        </span>
      </SectionLabel>
      <div className="space-y-3 rounded-lg bg-accent-subtle/50 p-4 ring-1 ring-accent/15">
        {plan.notes.map((n) => (
          <AgentNote key={n}>{n}</AgentNote>
        ))}
      </div>
    </section>
  );
}

function Rail({ ev, plan }: { ev: GtmEvent; plan: DinnerPlan }) {
  const { dispatch } = useWorkspace();
  const m = plan.inviteMath;
  const c = plan.composition;
  const setGoal = (goal: EventGoal) => void dispatch({ type: "event.update", id: ev.id, patch: { plan: { ...plan, goal } } });
  return (
    <aside className="space-y-6">
      <div className="hidden xl:block">
        <Notes plan={plan} />
      </div>

      <section>
        <SectionLabel>Goal</SectionLabel>
        <Menu
          align="start"
          trigger={
            <button className="flex w-full items-center justify-between gap-2 rounded-md bg-surface px-3 py-2 text-left text-[13px] font-medium text-fg ring-1 ring-border transition-colors hover:bg-bg-subtle">
              {GOAL_LABEL[plan.goal]}
              <ChevronDown className="size-3.5 text-fg-3" />
            </button>
          }
        >
          {GOALS.map((g) => (
            <MenuItem key={g.value} onSelect={() => setGoal(g.value)} hint={g.value === plan.goal ? "Current" : undefined}>
              <span className="block">{g.label}</span>
              <span className="block text-[11.5px] text-fg-3">{g.hint}</span>
            </MenuItem>
          ))}
        </Menu>
        <p className="mt-1.5 text-[11.5px] leading-4 text-fg-3">One goal per room. Re-plan to re-rank guests for a new goal.</p>
      </section>

      <section>
        <SectionLabel>Invite math</SectionLabel>
        <Card className="p-4">
          <dl className="grid grid-cols-3 gap-x-3 gap-y-4">
            <Stat label="Seats" value={m.seats} />
            <Stat label="Confirm" value={m.confirmsTarget} hint="125% of seats" />
            <Stat label="Invites" value={m.invites} />
            <Stat label="Warm" value={m.warmInvites ?? "—"} />
            <Stat label="Cold" value={m.coldInvites ?? "—"} hint="Count against the cap" />
            <Stat label="Accept" value={`${Math.round(m.expectedAcceptRate * 100)}%`} hint={`Show ${Math.round(m.expectedShowRate * 100)}%`} />
          </dl>
          {c && (
            <p className="mt-4 border-t border-border pt-3 text-[12.5px] leading-[18px] text-fg-2">
              {[
                `${c.hosts} host${c.hosts === 1 ? "" : "s"}`,
                c.anchor ? `1 ${ev.kind === "roundtable" ? "framer" : "anchor"}` : null,
                c.customers ? `${c.customers} customer${c.customers === 1 ? "" : "s"}` : null,
                `${c.prospects} prospects`,
                c.connector ? "1 connector" : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}
        </Card>
      </section>

      <section>
        <SectionLabel>Budget</SectionLabel>
        <Card className="p-4">
          <p className="font-mono text-[15px] tnum text-fg">
            {plan.budgetUsd.high === 0
              ? "$0"
              : plan.budgetUsd.low === plan.budgetUsd.high
                ? `$${plan.budgetUsd.high.toLocaleString("en-US")}`
                : `$${plan.budgetUsd.low.toLocaleString("en-US")}–${plan.budgetUsd.high.toLocaleString("en-US")}`}
          </p>
          <p className="mt-1 text-[12px] leading-[17px] text-fg-3">
            {ev.kind === "dinner"
              ? plan.coHost
                ? "Before splitting with the co-host; your share is usually half."
                : "For 10–12 at about $350–600 a head. A co-host splits it."
              : "A roundtable costs nothing but your hour. Thank-you gifts are optional."}
          </p>
        </Card>
      </section>

      {plan.anchorBrief && (
        <section>
          <SectionLabel>{ev.kind === "roundtable" ? "Framer's 5 minutes" : "Anchor's 5–10 minutes"}</SectionLabel>
          <p className="font-serif text-[15px] leading-[23px] text-fg-2">{plan.anchorBrief}</p>
        </section>
      )}
    </aside>
  );
}

export function PlanTab({ ev }: { ev: GtmEvent }) {
  const plan = ev.plan!;
  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0 space-y-8">
        <div className="xl:hidden">
          <Notes plan={plan} />
        </div>
        <Themes ev={ev} plan={plan} />
        <WhenWhere ev={ev} plan={plan} />
        <CoHost ev={ev} plan={plan} />
      </div>
      <Rail ev={ev} plan={plan} />
    </div>
  );
}
