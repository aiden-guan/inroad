"use client";

import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, ChevronDown, MoreHorizontal } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Menu, MenuItem } from "@/components/ui/menu";
import { Num } from "@/components/ui/misc";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/client/cn";
import { shortDate } from "@/lib/client/format";
import { newId, nowISO } from "@/lib/domain/ids";
import type { ObjectionCard } from "@/lib/domain/types";
import { listItem, spring } from "@/lib/motion";
import { conversationsTarget } from "@/lib/moves/scoreboard";
import { AssetsBlock, ContentBlock, DesignPartnerBlock } from "./assets";
import { usePlaybook } from "./context";
import {
  BAND_LABELS,
  MOTION_LABELS,
  OBJECTION_CATEGORIES,
  OBSERVED_MIN_N,
  PRICE_BANDS,
  QUOTES_TO_REPLACE,
  STRUCTURE_LABELS,
  pct,
  pilotDays,
  planMath,
  plural,
  priceBand,
  provenance,
  quoteLog,
  usdRange,
  type AssetKind,
  type Rate,
} from "./model";
import { starterObjections } from "./templates";
import { AddRow, Choice, DraftLabel, Drafted, Editable, FieldLabel, Section, Stamp, Stepper, Sub, undoable } from "./ui";

export function HowSection() {
  const { ws } = usePlaybook();
  const prov = provenance(ws, "how");
  return (
    <Section id="how" title="How we sell" kicker={<Stamp label={prov.label} isBet={prov.isBet} />}>
      <Plan />
      <Channels />
      <Commercial />
      <Objections />
      <AssetsBlock />
      <ContentBlock />
      <DesignPartnerBlock />
    </Section>
  );
}

/* ───────────────────────────── Plan ───────────────────────────── */

function RateNote({ rate, unit }: { rate: Rate; unit: string }) {
  return (
    <Tooltip
      content={
        rate.source === "observed"
          ? `Your own rate, from ${rate.n} ${unit}.`
          : `A starting default. Your own rate replaces it after ${OBSERVED_MIN_N} ${unit}${rate.n ? ` (you have ${rate.n})` : ""}.`
      }
    >
      <span tabIndex={0} className="cursor-help rounded-[2px] border-b border-dotted border-border-strong outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]">
        {pct(rate.value)}
      </span>
    </Tooltip>
  );
}

function PlanRow({ label, note, value, control }: { label: string; note: React.ReactNode; value: number; control: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 px-4 py-3 sm:px-5">
      <span className="text-[14px] font-medium text-fg">{label}</span>
      <span className="flex items-center gap-2 text-[12.5px] text-fg-3">
        {control}
        <span className="hidden sm:inline">a week</span>
      </span>
      <span className="text-[12.5px] text-fg-3">{note}</span>
      <span className="text-right font-mono text-[12.5px] tnum text-fg-2">
        = <Num value={Math.round(value * 10) / 10} format={{ minimumFractionDigits: 1, maximumFractionDigits: 1 }} /> meetings
      </span>
    </div>
  );
}

function Plan() {
  const { ws, dispatch, today } = usePlaybook();
  const m = planMath(ws, today);
  const rounded = Math.round(m.projected);
  const onTrack = m.gap <= 0.05 || rounded >= m.target;
  const goal = (patch: Partial<typeof ws.goal>) => void dispatch({ type: "goal.update", patch });
  // What Today's masthead actually aims for (the bet's channel plan until the founder picks a number here).
  const todayTarget = conversationsTarget(ws);

  return (
    <Sub id="plan" title="Plan" hint="The goal is an output of what you can do each week, not a wish. Change an input and the number follows.">
      <div className="overflow-hidden rounded-lg bg-surface ring-1 ring-border">
        <div className="px-4 pb-4 pt-5 sm:px-5">
          <p className="font-serif text-[22px] leading-[30px] tracking-[-0.005em] text-fg">
            At this pace, about <Num value={rounded} className="font-medium" /> {m.targetLabel} by {shortDate(m.byDate)}.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[13px] text-fg-3">
            <span>Goal</span>
            <Stepper value={m.target} min={1} max={50} label="paid pilots in the goal" onChange={(v) => goal({ target: v })} />
            <span>by</span>
            <input
              type="date"
              aria-label="Goal date"
              value={m.byDate}
              min={today}
              onChange={(e) => e.target.value && goal({ byDate: e.target.value })}
              className="h-7 rounded-sm bg-surface px-2 font-mono text-[12.5px] text-fg ring-1 ring-border outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            />
            <span className="font-mono text-[12px] tnum">
              · {m.weeksLeft} {m.weeksLeft === 1 ? "week" : "weeks"} left · {m.paidSoFar} paid so far
            </span>
          </div>
        </div>

        <div className="divide-y divide-border border-t border-border">
          <PlanRow
            label="Cold email first touches"
            control={<Stepper value={m.cold.perWeek} min={10} max={50} step={5} label="cold emails a week" onChange={(v) => void dispatch({ type: "caps.update", patch: { firstTouchesPerWeek: v } })} />}
            note={
              <>
                × <RateNote rate={m.cold.rate} unit="cold first touches" /> become meetings
              </>
            }
            value={m.cold.meetings}
          />
          <PlanRow
            label="Intro asks"
            control={<Stepper value={m.intro.perWeek} min={0} max={20} label="intro asks a week" onChange={(v) => goal({ introAsksPerWeek: v })} />}
            note={
              <>
                × <RateNote rate={m.intro.rate} unit="intro asks" /> become meetings
              </>
            }
            value={m.intro.meetings}
          />
          <PlanRow
            label="Community conversations"
            control={<Stepper value={m.community.perWeek} min={0} max={10} label="community conversations a week" onChange={(v) => goal({ communityPerWeek: v })} />}
            note="Threads where your buyer asked for help"
            value={m.community.meetings}
          />
          <div className="bg-bg-subtle/60 px-4 py-3 sm:px-5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[14px] font-medium">Meetings a week</span>
              <span className="font-mono text-[15px] font-medium tnum">
                <Num value={Math.round(m.meetingsPerWeek * 10) / 10} format={{ minimumFractionDigits: 1, maximumFractionDigits: 1 }} />
              </span>
            </div>
            <p className="mt-1 text-[12.5px] leading-5 text-fg-3">
              × {m.weeksLeft} weeks × <RateNote rate={m.discoveryToQualified} unit="deals" /> qualify × <RateNote rate={m.qualifiedToPaid} unit="qualified deals" /> become paid ≈{" "}
              <span className="font-mono tnum text-fg-2">{(m.projected - m.paidSoFar).toFixed(1)}</span>
              {m.paidSoFar > 0 && <> + {m.paidSoFar} already paid</>}
              {[m.cold.rate, m.intro.rate, m.discoveryToQualified, m.qualifiedToPaid].some((r) => r.source === "default") && (
                <span className="block">Dotted rates are starting defaults until you have {OBSERVED_MIN_N} data points of your own.</span>
              )}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-4 font-serif text-[16px] leading-[25px] text-fg-2">
        {m.weeksLeft === 0 ? (
          <p>Your date has passed. Pick a new one and the plan recalculates.</p>
        ) : onTrack ? (
          <p>
            On track for {m.target} if these rates hold.{" "}
            {m.cold.rate.source === "default" ? "Watch them as your own numbers come in." : "Most of them are your own now."}
          </p>
        ) : (
          <>
            <p>
              About {Math.max(1, Math.round(m.gap))} short of {m.target}. More cold email isn&apos;t the lever; the cap protects your domain.{" "}
              {m.levers.introAsksPerWeek || m.levers.byDate ? "Two ways to close it:" : "Add intro asks or community conversations, or give it more weeks."}
            </p>
            {(m.levers.introAsksPerWeek || m.levers.byDate) && (
              <div className="mt-3 flex flex-wrap gap-2 font-sans">
                {m.levers.introAsksPerWeek && (
                  <Button
                    size="sm"
                    onClick={() => {
                      goal({ introAsksPerWeek: m.levers.introAsksPerWeek! });
                      toast(`Today now aims for ${m.levers.introAsksPerWeek} intro asks a week.`);
                    }}
                  >
                    Ask for {m.levers.introAsksPerWeek} intros a week
                  </Button>
                )}
                {m.levers.byDate && (
                  <Button size="sm" onClick={() => goal({ byDate: m.levers.byDate! })}>
                    Move the date to {shortDate(m.levers.byDate)}
                  </Button>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <div className="mt-5 space-y-2 text-[13px] leading-5 text-fg-3">
        {m.warm ? (
          <p>
            Warm capacity: {plural(m.warm.atIcp, "person", "people")} in your network at companies that fit, {m.warm.buyerTitles} in buyer roles.
            {m.warm.weeksOfAsks !== null && ` At ${m.intro.perWeek} asks a week, that's about ${plural(m.warm.weeksOfAsks, "week")} before you need new sources.`}
          </p>
        ) : (
          <p>
            <Link href="/integrations?import=linkedin" className="inline-flex items-center gap-1 text-fg-2 underline-offset-2 hover:text-fg hover:underline">
              Import your LinkedIn connections <ArrowRight className="size-3" />
            </Link>{" "}
            to see how many intro asks your network can carry.
          </p>
        )}
        <p>Cold email never goes above 20 a day. LinkedIn invites, intro asks and replies don&apos;t count against the cap.</p>
        {todayTarget !== m.conversationsPerWeek && (
          <p className="flex flex-wrap items-center gap-x-2">
            Today aims for {plural(todayTarget, "conversation")} a week; this plan supports about {m.conversationsPerWeek}.
            <button
              type="button"
              onClick={() => {
                goal({ conversationsPerWeek: m.conversationsPerWeek, conversationsChosenAt: nowISO() });
                toast(`Today now aims for ${plural(m.conversationsPerWeek, "conversation")} a week.`);
              }}
              className="text-fg-2 underline underline-offset-2 hover:text-fg"
            >
              Use {m.conversationsPerWeek}
            </button>
          </p>
        )}
      </div>
    </Sub>
  );
}

/* ───────────────────────────── Channels ───────────────────────────── */

const TRUST_ORDER = [
  "People who already know you or your product",
  "Investor and advisor intros",
  "Signal-based cold email",
  "Communities where your buyer asks for help",
  "Founder content, one optional post a week from your calls",
  "Rooms: a virtual roundtable first, a dinner only with a co-host",
  "Launches, once people can try it without a sales call",
];

/** The channels whose first action is a draft: each opens the matching Founder content draft. */
const MOTION_DRAFT: Partial<Record<string, { kind: AssetKind; label: string }>> = {
  communities: { kind: "community_answer", label: "Find a question to answer" },
  founder_content: { kind: "post", label: "Draft this week's post" },
  launches: { kind: "launch", label: "Draft a Show HN post" },
};

function Channels() {
  const { p, set, setComposer } = usePlaybook();
  const startDraft = (kind: AssetKind) => {
    setComposer({ kind });
    requestAnimationFrame(() => document.getElementById("content")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  const plan = p.channelPlan;
  const motions = plan ? [...plan.motions].map((m, i) => ({ m, i })).sort((a, b) => a.m.rank - b.m.rank) : [];
  return (
    <Sub id="motions" title="Channels" hint="Ranked for you, in trust order: warm before cold, rooms before launches.">
      {plan ? (
        <ol className="space-y-5">
          {motions.map(({ m, i }, k) => (
            <li key={m.motion} className="grid grid-cols-[28px_1fr] gap-x-2">
              <span className="pt-0.5 font-mono text-[13px] tnum text-fg-3">{k + 1}</span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                  <span className="text-[14.5px] font-semibold">{MOTION_LABELS[m.motion] ?? m.motion}</span>
                  <Editable inline value={m.weeklyTarget} label="weekly target" onSave={(v) => set(["channelPlan", "motions", i, "weeklyTarget"], v)} className="font-mono text-[12.5px] text-fg-2" />
                </div>
                <Editable value={m.why} label="why this channel" multiline onSave={(v) => set(["channelPlan", "motions", i, "why"], v)} className="mt-0.5 text-[13.5px] leading-5 text-fg-2" />
                {m.firstActions.length > 0 && (
                  <ul className="mt-1.5 space-y-0.5">
                    {m.firstActions.map((a) => (
                      <li key={a} className="flex items-start gap-2 text-[13px] leading-5 text-fg-3">
                        <span aria-hidden className="mt-2 h-px w-2 shrink-0 bg-fg-4" />
                        {a}
                      </li>
                    ))}
                  </ul>
                )}
                {MOTION_DRAFT[m.motion] && (
                  <button
                    type="button"
                    onClick={() => startDraft(MOTION_DRAFT[m.motion]!.kind)}
                    className="mt-1.5 inline-flex items-center gap-1 text-[13px] text-fg-2 underline-offset-2 hover:text-fg hover:underline"
                  >
                    {MOTION_DRAFT[m.motion]!.label}
                    <ArrowRight className="size-3.5" aria-hidden />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <div className="rounded-lg bg-surface p-4 ring-1 ring-border sm:p-5">
          <p className="font-serif text-[16px] leading-[25px] text-fg-2">I&apos;ll rank your channels at your first Monday review, once there&apos;s a week of real activity to rank against. Until then, the default order:</p>
          <ol className="mt-3 space-y-1">
            {TRUST_ORDER.map((t, i) => (
              <li key={t} className="flex gap-3 text-[13.5px] leading-5 text-fg-2">
                <span className="w-4 shrink-0 font-mono text-[12.5px] tnum text-fg-3">{i + 1}</span>
                {t}
              </li>
            ))}
          </ol>
        </div>
      )}
    </Sub>
  );
}

/* ───────────────────────────── Pricing & terms ───────────────────────────── */

function Commercial() {
  const { ws, p, set } = usePlaybook();
  const c = p.commercial;
  const { band, assumed } = priceBand(ws);
  const b = PRICE_BANDS[band];
  const log = quoteLog(ws);
  const days = pilotDays(c);
  return (
    <Sub id="commercial" title="Pricing and terms" hint="Charge from day one. Price on the value you can quantify in discovery, not on your cost.">
      <div className="flex flex-wrap items-center gap-2 text-[13px] text-fg-3">
        <span>Default structure</span>
        <Choice
          label="Default structure"
          value={c.structure}
          options={{ paid_pilot: STRUCTURE_LABELS.paid_pilot.label, paid_design_partner: STRUCTURE_LABELS.paid_design_partner.label, annual_with_opt_out: STRUCTURE_LABELS.annual_with_opt_out.label }}
          onChange={(v) => set(["commercial", "structure"], v)}
        />
        <span>{STRUCTURE_LABELS[c.structure].hint}</span>
      </div>

      <div className="mt-5 overflow-hidden rounded-lg bg-surface ring-1 ring-border">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-4 py-3 sm:px-5">
          <span className="text-[13.5px] font-medium">
            Price anchors for {BAND_LABELS[band]} employees
            {assumed && (
              <a href="#icp" className="ml-1.5 text-[12.5px] font-normal text-fg-3 underline underline-offset-2 hover:text-fg">
                set your company size
              </a>
            )}
          </span>
          <span className="text-[12px] text-fg-3">
            {log.replacesHeuristic ? "From your quote log" : `Starting heuristic until ${QUOTES_TO_REPLACE} quotes · ${log.quotes.length} so far`}
          </span>
        </div>
        <dl className="divide-y divide-border">
          <div className="flex items-baseline justify-between gap-4 px-4 py-2.5 sm:px-5">
            <dt className="text-[13.5px] text-fg-2">First annual contract</dt>
            <dd className="font-mono text-[13.5px] tnum">
              {log.replacesHeuristic && log.min !== null && log.max !== null ? usdRange([log.min, log.max]) : usdRange(b.annual)}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-4 px-4 py-2.5 sm:px-5">
            <dt className="text-[13.5px] text-fg-2">Paid pilot, credited to the annual</dt>
            <dd className="font-mono text-[13.5px] tnum">{usdRange(b.pilot)}</dd>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2.5 sm:px-5">
            <dt className="text-[13.5px] text-fg-2">
              Pilot length
              <span className="block text-[12.5px] text-fg-3">2 × days to first value, at least 14, at most 45</span>
            </dt>
            <dd className="flex items-center gap-3">
              <span className="flex items-center gap-1.5 text-[12.5px] text-fg-3">
                <Stepper value={c.daysToFirstValue ?? 7} min={1} max={45} label="days to first value" onChange={(v) => set(["commercial", "daysToFirstValue"], v)} />
                <span className="hidden sm:inline">days to value</span>
              </span>
              <span className="font-mono text-[13.5px] tnum">{days} days</span>
            </dd>
          </div>
        </dl>
        <p className="border-t border-border px-4 py-3 text-[12.5px] leading-5 text-fg-3 sm:px-5">
          Aim for 10–20% of the annual value you can quantify. Keep the pilot fee inside your champion&apos;s own sign-off limit. A win rate above 50% after 10 deals means you&apos;re cheap.
          {b.note && <span className="mt-1 block text-fg-2">{b.note}</span>}
        </p>
      </div>

      {log.quotes.length > 0 && (
        <div className="mt-5">
          <FieldLabel className="mb-1.5">Quote log</FieldLabel>
          <ul className="divide-y divide-border border-y border-border">
            {log.quotes.slice(0, 8).map((q, i) => (
              <li key={`${q.dealId}-${i}`} className="flex items-baseline gap-3 py-2 text-[13px]">
                <span className="w-14 shrink-0 font-mono text-[12px] text-fg-3">{shortDate(q.at)}</span>
                <span className="min-w-0 flex-1 truncate">{q.deal}</span>
                <span className="font-mono tnum">${q.amountUsd.toLocaleString("en-US")}</span>
                <span className={cn("w-16 text-right text-[12px]", q.outcome === "lost" ? "text-danger" : q.outcome === "pushback" ? "text-warning" : "text-fg-3")}>{q.outcome ?? "open"}</span>
              </li>
            ))}
          </ul>
          {log.replacesHeuristic && log.median !== null && (
            <p className="mt-2 text-[12.5px] text-fg-3">
              Median ${log.median.toLocaleString("en-US")} · {log.accepted} accepted · {log.pushback} pushback · {log.lost} lost. Raise the next quote until you hear real pushback.
            </p>
          )}
        </div>
      )}

      <div className="mt-6 grid gap-5">
        <div>
          <FieldLabel>Terms</FieldLabel>
          <Editable value={c.terms} label="terms" multiline placeholder="Pilot length, fee credit, opt-out window" onSave={(v) => set(["commercial", "terms"], v)} className="text-[14px] leading-[22px]" />
        </div>
        <div>
          <FieldLabel>How we anchor</FieldLabel>
          <Editable value={c.priceAnchor} label="price anchor" multiline placeholder="What you say when they ask what it costs" onSave={(v) => set(["commercial", "priceAnchor"], v)} className="text-[14px] leading-[22px]" />
        </div>
        <div>
          <FieldLabel>Discounts</FieldLabel>
          <Editable
            value={c.discountRule}
            label="discount rule"
            multiline
            placeholder="Only for something in return: a case study, a multi-year term, a reference, or signing by a date."
            onSave={(v) => set(["commercial", "discountRule"], v)}
            className="text-[14px] leading-[22px]"
          />
        </div>
      </div>
    </Sub>
  );
}

/* ───────────────────────────── Objections ───────────────────────────── */

function Objections() {
  const { ws, dispatch } = usePlaybook();
  const [openId, setOpenId] = useState<string | null>(null);
  const list = [...ws.objections].sort((a, b) => Number(a.approved) - Number(b.approved) || b.timesHeard - a.timesHeard);
  const drafts = list.filter((o) => !o.approved).length;

  const seed = () => {
    const starters = starterObjections(ws, () => newId("obj"));
    void dispatch(starters.map((o) => ({ type: "objection.upsert" as const, objection: o })));
    toast(`Added ${starters.length} common objections as drafts. Make each one sound like you, then approve it.`);
  };

  return (
    <Sub
      id="objections"
      title="Objections"
      hint="Acknowledge, ask what's underneath, answer with evidence, confirm, then move to a next step. Approved answers are what I use in call prep and replies."
      right={drafts > 0 && <span className="font-mono text-[12px] tnum text-fg-3">{drafts} to review</span>}
    >
      {list.length === 0 && (
        <div className="mb-3 flex flex-col gap-3 rounded-lg bg-surface p-4 ring-1 ring-border sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-[48ch] text-[13.5px] leading-5 text-fg-2">Nothing logged yet. I&apos;ll add objections from your debriefs, or start from the nine early-stage founders hear most.</p>
          <Button size="sm" onClick={seed}>
            Start with 9 common ones
          </Button>
        </div>
      )}
      <ul className="space-y-2">
        <AnimatePresence>
          {list.map((o, i) => (
            <motion.li key={o.id} layout="position" variants={listItem} initial="hidden" animate="show" exit={{ opacity: 0, transition: { duration: 0.1 } }} custom={i}>
              <ObjectionRow objection={o} open={openId === o.id} onToggle={() => setOpenId((x) => (x === o.id ? null : o.id))} />
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
      <AddRow
        label="Add an objection you heard"
        className="mt-2"
        onAdd={(text) => {
          const objection: ObjectionCard = { id: newId("obj"), objection: text, category: "priority", underlyingConcern: "", clarifyingQ: "", response: "", walkAwayIf: "", approved: false, timesHeard: 1 };
          void dispatch({ type: "objection.upsert", objection });
          setOpenId(objection.id);
        }}
      />
    </Sub>
  );
}

function ObjectionRow({ objection: o, open, onToggle }: { objection: ObjectionCard; open: boolean; onToggle: () => void }) {
  const { dispatch } = usePlaybook();
  const upsert = (patch: Partial<ObjectionCard>) => void dispatch({ type: "objection.upsert", objection: { ...o, ...patch } });
  const incomplete = !o.response.trim() || !o.clarifyingQ.trim();
  return (
    <div className="rounded-lg bg-surface ring-1 ring-border">
      <Drafted draft={!o.approved} className="rounded-lg py-3 pr-3 sm:pr-4">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <Editable value={o.objection} label="objection" onSave={(v) => upsert({ objection: v })} className="text-[14.5px] font-medium leading-[21px]">
              “{o.objection}”
            </Editable>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] text-fg-3">
              {!o.approved && <DraftLabel />}
              <Choice label="Category" value={o.category} options={OBJECTION_CATEGORIES} onChange={(v) => upsert({ category: v })} />
              {o.timesHeard > 0 && (
                <span className="font-mono tnum">
                  heard {o.timesHeard}×{o.lastHeard ? ` · last ${shortDate(o.lastHeard)}` : ""}
                </span>
              )}
            </div>
          </div>
          {!o.approved && (
            <Tooltip content={incomplete ? "Add a question and an answer first" : undefined}>
              <span>
                <Button size="xs" variant="primary" disabled={incomplete} onClick={() => upsert({ approved: true })}>
                  Approve
                </Button>
              </span>
            </Tooltip>
          )}
          <button
            type="button"
            aria-expanded={open}
            aria-label={open ? "Collapse" : "Expand"}
            onClick={onToggle}
            className="inline-flex size-6 items-center justify-center rounded-xs text-fg-3 transition-colors hover:bg-bg-subtle hover:text-fg"
          >
            <ChevronDown className={cn("size-4 transition-transform duration-200", open && "rotate-180")} />
          </button>
          <Menu
            trigger={
              <button type="button" aria-label="More for this objection" className="inline-flex size-6 items-center justify-center rounded-xs text-fg-3 transition-colors hover:bg-bg-subtle hover:text-fg">
                <MoreHorizontal className="size-4" />
              </button>
            }
          >
            {o.approved && <MenuItem onSelect={() => upsert({ approved: false })}>Back to draft</MenuItem>}
            <MenuItem
              danger
              onSelect={() => {
                void dispatch({ type: "objection.remove", id: o.id });
                undoable("Objection removed", () => void dispatch({ type: "objection.upsert", objection: o }));
              }}
            >
              Remove
            </MenuItem>
          </Menu>
        </div>
        <motion.div initial={false} animate={{ height: open ? "auto" : 0, opacity: open ? 1 : 0 }} transition={spring.smooth} className="overflow-hidden">
          {open && (
            <dl className="mt-3 grid gap-x-6 gap-y-3 border-t border-border pt-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <dt>
                  <FieldLabel>Ask first</FieldLabel>
                </dt>
                <dd>
                  <Editable value={o.clarifyingQ} label="clarifying question" multiline placeholder="The question that finds what's underneath" onSave={(v) => upsert({ clarifyingQ: v })} className="text-[14px] leading-[21px]" />
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt>
                  <FieldLabel>Then answer</FieldLabel>
                </dt>
                <dd>
                  <Editable value={o.response} label="response" multiline placeholder="Your answer, with evidence or a reframe" onSave={(v) => upsert({ response: v })} className="text-[14px] leading-[21px]" />
                </dd>
              </div>
              <div>
                <dt>
                  <FieldLabel>What&apos;s underneath</FieldLabel>
                </dt>
                <dd>
                  <Editable value={o.underlyingConcern} label="underlying concern" multiline onSave={(v) => upsert({ underlyingConcern: v })} className="text-[13.5px] leading-5 text-fg-2" />
                </dd>
              </div>
              <div>
                <dt>
                  <FieldLabel>Walk away if</FieldLabel>
                </dt>
                <dd>
                  <Editable value={o.walkAwayIf} label="walk away if" multiline onSave={(v) => upsert({ walkAwayIf: v })} className="text-[13.5px] leading-5 text-fg-2" />
                </dd>
              </div>
            </dl>
          )}
        </motion.div>
      </Drafted>
    </div>
  );
}
