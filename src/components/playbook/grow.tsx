"use client";

import { useState } from "react";
import { toast } from "sonner";
import { GrowthLogForm, PmfSurveyForm, VerdictList } from "@/components/consumer/growth-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Num } from "@/components/ui/misc";
import { cn } from "@/lib/client/cn";
import { shortDate } from "@/lib/client/format";
import { PMF_SURVEY, SUBSCRIPTION_APPS } from "@/lib/consumer/benchmarks";
import { iceScore, readGrowth, sizeExperiment, STAGE_LABELS, type FunnelStage } from "@/lib/consumer/growth";
import { ACTIVE_MOTIONS, consumerChannelPlan, growthDefaults } from "@/lib/consumer/plan";
import { addDays, daysBetween, newId, nowISO } from "@/lib/domain/ids";
import type { Experiment, GrowthModel } from "@/lib/domain/types";
import { AssetsBlock } from "./assets";
import { usePlaybook } from "./context";
import { Channels, Objections } from "./how";
import { CONSUMER_STRUCTURES, STRUCTURE_LABELS, plural } from "./model";
import { AddRow, Choice, Editable, FieldLabel, RemoveButton, Section, Stamp, Stepper, StringList, Sub } from "./ui";

/**
 * Playbook → How we grow: the consumer replacement for "How we sell". The plan is retention-first math, the numbers
 * are logged weekly and read in code, channels are ranked with at most three "now", and experiments are sized before
 * anyone calls a winner.
 */
export function GrowSection() {
  const { ws, today } = usePlaybook();
  const g = readGrowth(ws, today);
  const label = g.retentionHolds
    ? `Confirmed by ${g.model.retention.metric === "m3_repeat" ? "repeat purchase" : "week-4 retention"} at ${g.retention}%`
    : `From your site · ${plural(g.weeks.length, "week")} of numbers · retention hasn't confirmed this yet`;
  return (
    <Section id="how" title="How we grow" kicker={<Stamp label={label} isBet={!g.retentionHolds} />}>
      <GrowthPlan />
      <Numbers />
      <Channels active={ACTIVE_MOTIONS} hint="Ranked for your model and stage. Three at most at a time: none of the startups in the first-1,000-users research succeeded with more. Paid waits for retention." />
      <ConsumerPricing />
      <Experiments />
      <Objections />
      <AssetsBlock />
    </Section>
  );
}

/* ───────────────────────────── Plan ───────────────────────────── */

function GrowthPlan() {
  const { ws, f, dispatch, set, today } = usePlaybook();
  const model = growthDefaults(ws);
  const plan = consumerChannelPlan(ws, { today }).funnel.consumer!;
  const g = readGrowth(ws, today);
  const weeksLeft = Math.max(0, Math.ceil(daysBetween(today, ws.goal.byDate) / 7));
  const goal = (patch: Partial<typeof ws.goal>) => void dispatch({ type: "goal.update", patch });
  // The strategist's model, or the defaults written back the first time the founder edits one part.
  const save = (patch: Partial<GrowthModel>) => set(["growth"], { ...(f.growth ?? model), ...patch, retention: model.retention });

  return (
    <Sub id="plan" title="Plan" hint="Retention first: every point of retention cuts the signups the goal needs. Change an input and the number follows.">
      <div className="overflow-hidden rounded-lg bg-surface ring-1 ring-border">
        <div className="px-4 pb-4 pt-5 sm:px-5">
          <p className="font-serif text-[22px] leading-[30px] tracking-[-0.005em] text-fg">
            {plural(ws.goal.target, ws.goal.targetLabel.replace(/s$/, ""), ws.goal.targetLabel)} by {shortDate(ws.goal.byDate)} takes about <Num value={plan.signupsNeeded} className="font-medium" /> signups at a {plan.retentionTarget}% retention bar.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[13px] text-fg-3">
            <span>Goal</span>
            <Stepper value={ws.goal.target} min={10} max={100000} step={ws.goal.target >= 1000 ? 500 : ws.goal.target >= 200 ? 50 : 10} label={ws.goal.targetLabel} onChange={(v) => goal({ target: v })} />
            <Choice
              label="What the goal counts"
              value={ws.goal.metric === "paying" ? "paying" : "active_users"}
              options={{ active_users: "weekly active users", paying: "paying customers" }}
              onChange={(v) => goal({ metric: v, targetLabel: v === "paying" ? "paying customers" : "weekly active users" })}
            />
            <span>by</span>
            <input
              type="date"
              aria-label="Goal date"
              value={ws.goal.byDate}
              min={today}
              onChange={(e) => e.target.value && goal({ byDate: e.target.value })}
              className="h-7 rounded-sm bg-surface px-2 font-mono text-[12.5px] text-fg ring-1 ring-border outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            />
            <span className="font-mono text-[12px] tnum">
              · {plural(weeksLeft, "week")} left{g.goal.current !== null ? ` · ${g.goal.current} now` : ""}
            </span>
          </div>
        </div>
        <div className="divide-y divide-border border-t border-border">
          <div className="grid grid-cols-[1fr_auto] items-center gap-x-4 px-4 py-3 sm:px-5">
            <span className="text-[14px] font-medium">Signups a week</span>
            <span className="font-mono text-[14px] tnum">
              <Num value={plan.signupsPerWeek} />
            </span>
            <span className="text-[12.5px] text-fg-3">
              {g.latest ? `Last logged: ${g.latest.signups}` : "Log a week of numbers to compare"} · over {plural(plan.weeks, "week")}
            </span>
          </div>
          <div className="grid grid-cols-[1fr_auto] items-center gap-x-4 px-4 py-3 sm:px-5">
            <span className="text-[14px] font-medium">User conversations a week</span>
            <Stepper value={ws.goal.userTalksPerWeek ?? 5} min={0} max={20} label="user conversations a week" onChange={(v) => goal({ userTalksPerWeek: v })} />
            <span className="text-[12.5px] text-fg-3">New, active and churned users. Counted from what you log.</span>
          </div>
        </div>
      </div>
      {plan.signupsPerWeek > 150 && (
        <p className="mt-3 text-pretty text-[13px] leading-5 text-warning">That&apos;s a lot of signups a week for this stage. Raise retention or give it more weeks before adding channels.</p>
      )}

      <div className="mt-6 grid gap-5 sm:grid-cols-2">
        <div>
          <FieldLabel className="mb-1">North star</FieldLabel>
          <Editable value={model.northStar.metric} label="north star" onSave={(v) => save({ northStar: { ...model.northStar, metric: v } })} className="text-[14.5px] font-medium leading-[21px]" />
          <Editable value={model.northStar.why} label="why this north star" multiline onSave={(v) => save({ northStar: { ...model.northStar, why: v } })} className="mt-0.5 text-[13px] leading-5 text-fg-3" />
        </div>
        <div>
          <FieldLabel className="mb-1">First win (activation)</FieldLabel>
          <Editable value={model.activation.event} label="activation event" onSave={(v) => save({ activation: { ...model.activation, event: v } })} className="text-[14.5px] font-medium leading-[21px]" />
          <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[13px] text-fg-3">
            within
            <Stepper value={model.activation.withinDays} min={1} max={30} label="days to the first win" suffix="d" onChange={(v) => save({ activation: { ...model.activation, withinDays: v } })} />
            · {model.activation.status === "validated" ? "validated" : "a hypothesis"}
          </p>
        </div>
        <div>
          <FieldLabel className="mb-1">The bar retention has to clear</FieldLabel>
          <p className="text-[14.5px] font-medium leading-[21px]">
            {model.retention.metric === "m3_repeat" ? "Repeat purchase within 90 days" : "Week-4 retention"} ≥ {model.retention.target}%
            <span className="ml-2 font-mono text-[12px] font-normal text-fg-3">strong ≥ {model.retention.good}%</span>
          </p>
          <p className="mt-0.5 text-pretty text-[12px] leading-[17px] text-fg-3">{model.retention.source}</p>
        </div>
        <div>
          <FieldLabel className="mb-1">The loop to build once it holds</FieldLabel>
          <Editable value={model.primaryLoop.how} label="primary growth loop" multiline onSave={(v) => save({ primaryLoop: { ...model.primaryLoop, how: v } })} className="text-[13.5px] leading-5 text-fg-2" />
        </div>
      </div>
      <div className="mt-5">
        <FieldLabel className="mb-1.5">Where the first 100 come from</FieldLabel>
        <StringList items={model.firstHundred} max={3} label="first-100 source" addLabel="Add a source" onChange={(v) => save({ firstHundred: v })} />
      </div>
    </Sub>
  );
}

/* ───────────────────────────── Numbers ───────────────────────────── */

const STAGE_ORDER: FunnelStage[] = ["acquisition", "activation", "retention", "referral", "revenue"];

function Numbers() {
  const { ws, today, dispatch } = usePlaybook();
  const g = readGrowth(ws, today);
  const [logging, setLogging] = useState(!g.latest);
  const [surveying, setSurveying] = useState(false);
  const recent = g.weeks.slice(-6).reverse();
  const repeat = g.model.retention.metric === "m3_repeat";
  const stats: { label: string; value: string }[] = [];
  if (g.activationRate !== undefined) stats.push({ label: "Reach the first win", value: `${g.activationRate.toFixed(0)}%` });
  if (g.retention !== undefined) stats.push({ label: repeat ? "Repeat in 90 days" : "Week-4 retention", value: `${g.retention}%` });
  if (g.referredShare !== undefined) stats.push({ label: "From a friend", value: `${g.referredShare.toFixed(0)}%` });
  if (g.quickRatio !== undefined) stats.push({ label: "Quick ratio", value: g.quickRatio.toFixed(1) });
  if (g.cac !== undefined) stats.push({ label: g.cacBasis === "paying" ? "Paid cost per customer" : "Paid cost per signup", value: `$${g.cac.toFixed(2)}` });
  if (g.paybackMonths !== undefined) stats.push({ label: "Payback", value: `${g.paybackMonths.toFixed(1)} mo` });
  if (g.pmf) stats.push({ label: `Very disappointed (${g.pmf.answers})`, value: `${g.pmf.score.toFixed(0)}%` });

  return (
    <Sub
      id="numbers"
      title="Numbers"
      hint="Log last week every Monday. I read them in code: rates hide below 20 signups, and paid spend waits until retention clears the bar."
      right={
        !logging && (
          <Button size="sm" variant="ghost" onClick={() => setLogging(true)}>
            Log last week
          </Button>
        )
      }
    >
      <div className="mb-4 flex flex-wrap gap-1.5" aria-label="Funnel stages">
        {STAGE_ORDER.map((s) => (
          <span key={s} className={cn("rounded-full px-2.5 py-0.5 text-[12px] ring-1", s === g.focus ? "bg-surface font-medium text-fg ring-border-strong" : "text-fg-3 ring-border")}>
            {STAGE_LABELS[s]}
            {s === g.focus && <span className="ml-1 font-mono text-[10.5px] text-fg-3">focus</span>}
          </span>
        ))}
      </div>

      {logging && (
        <div className="mb-5 rounded-lg bg-surface p-4 ring-1 ring-border sm:p-5">
          <GrowthLogForm ws={ws} today={today} onSaved={() => setLogging(false)} />
        </div>
      )}

      {stats.length > 0 && (
        <dl className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="rounded-md bg-surface px-3 py-2.5 ring-1 ring-border">
              <dt className="text-[11.5px] text-fg-3">{s.label}</dt>
              <dd className="mt-0.5 font-mono text-[15px] font-medium tnum text-fg">{s.value}</dd>
            </div>
          ))}
        </dl>
      )}

      <VerdictList verdicts={g.verdicts} />

      {recent.length > 0 && (
        <div className="mt-5 overflow-x-auto rounded-lg ring-1 ring-border">
          <table className="w-full min-w-[520px] text-left text-[12.5px]">
            <thead className="bg-bg-subtle text-fg-3">
              <tr>
                {["Week of", "Signups", "First win", "Active", repeat ? "Repeat %" : "Wk-4 %", "Paying", "Spend", ""].map((h) => (
                  <th key={h} scope="col" className="px-3 py-2 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border font-mono tnum">
              {recent.map((w) => (
                <tr key={w.weekOf}>
                  <td className="px-3 py-2">{shortDate(w.weekOf)}</td>
                  <td className="px-3 py-2">{w.signups}</td>
                  <td className="px-3 py-2">{w.activated ?? "—"}</td>
                  <td className="px-3 py-2">{w.active ?? "—"}</td>
                  <td className="px-3 py-2">{w.retainedPct ?? "—"}</td>
                  <td className="px-3 py-2">{w.paying ?? "—"}</td>
                  <td className="px-3 py-2">{w.spendUsd ? `$${w.spendUsd}` : "—"}</td>
                  <td className="px-2 py-1 text-right">
                    <RemoveButton label={`Remove the week of ${w.weekOf}`} onClick={() => void dispatch({ type: "growth.remove", weekOf: w.weekOf })} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-5">
        {surveying ? (
          <div className="rounded-lg bg-surface p-4 ring-1 ring-border sm:p-5">
            <PmfSurveyForm onSaved={() => setSurveying(false)} />
          </div>
        ) : (
          <button type="button" onClick={() => setSurveying(true)} className="text-[13px] text-fg-2 underline-offset-4 hover:text-fg hover:underline">
            Log a product-market fit survey ({PMF_SURVEY.threshold.value}% “very disappointed” is the line)
          </button>
        )}
      </div>
    </Sub>
  );
}

/* ───────────────────────────── Pricing ───────────────────────────── */

function ConsumerPricing() {
  const { p, set } = usePlaybook();
  const c = p.commercial;
  const structure = (CONSUMER_STRUCTURES as readonly string[]).includes(c.structure) ? (c.structure as (typeof CONSUMER_STRUCTURES)[number]) : "free_trial";
  const options = Object.fromEntries(CONSUMER_STRUCTURES.map((s) => [s, STRUCTURE_LABELS[s].label])) as Record<(typeof CONSUMER_STRUCTURES)[number], string>;
  return (
    <Sub id="commercial" title="Pricing" hint="Charge where the value lands, and test prices on new users only. Every renewal states its price, date and how to cancel.">
      <div className="flex flex-wrap items-center gap-2 text-[13px] text-fg-3">
        <span>How people pay</span>
        <Choice label="How people pay" value={structure} options={options} onChange={(v) => set(["commercial", "structure"], v)} />
        <span>{STRUCTURE_LABELS[structure].hint}</span>
      </div>
      <div className="mt-4 space-y-3">
        <div>
          <FieldLabel className="mb-1">Terms</FieldLabel>
          <Editable value={c.terms} label="pricing terms" multiline onSave={(v) => set(["commercial", "terms"], v)} className="text-[13.5px] leading-5 text-fg-2" />
        </div>
        <div>
          <FieldLabel className="mb-1">Price anchor</FieldLabel>
          <Editable value={c.priceAnchor} label="price anchor" multiline onSave={(v) => set(["commercial", "priceAnchor"], v)} className="text-[13.5px] leading-5 text-fg-2" />
        </div>
        <div>
          <FieldLabel className="mb-1">Discounts</FieldLabel>
          <Editable value={c.discountRule} label="discount rule" multiline onSave={(v) => set(["commercial", "discountRule"], v)} className="text-[13.5px] leading-5 text-fg-2" />
        </div>
      </div>
      {(structure === "free_trial" || structure === "freemium") && (
        <p className="mt-4 text-pretty text-[12px] leading-[17px] text-fg-3">
          RevenueCat, State of Subscription Apps 2026 (vendor data): {SUBSCRIPTION_APPS.longTrialToPaid.value}% trial-to-paid for 17–32-day trials vs {SUBSCRIPTION_APPS.shortTrialToPaid.value}% under 4 days; median
          refunds {SUBSCRIPTION_APPS.refundMedian.value}% in North America; {SUBSCRIPTION_APPS.reach1kMrr.value}% of new apps reach $1K MRR within two years.
        </p>
      )}
    </Sub>
  );
}

/* ───────────────────────────── Experiments ───────────────────────────── */

const STATUS_LABELS: Record<Experiment["status"], string> = { idea: "Idea", running: "Running", won: "Won", lost: "Lost", inconclusive: "Inconclusive" };

/** The readout, inline: what happened in one line, then the verdict. */
function Readout({ onDone }: { onDone: (status: "won" | "lost" | "inconclusive", result: string) => void }) {
  const [result, setResult] = useState("");
  return (
    <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
      <Input value={result} onChange={(ev) => setResult(ev.target.value)} placeholder="What happened, in one line" maxLength={200} aria-label="What happened" className="text-[16px] sm:flex-1 sm:text-[13px]" />
      <div className="flex gap-1">
        {(["won", "lost", "inconclusive"] as const).map((s) => (
          <Button
            key={s}
            size="sm"
            variant="ghost"
            onClick={() => {
              onDone(s, result.trim());
              toast(`Marked ${STATUS_LABELS[s].toLowerCase()}.`);
            }}
          >
            {STATUS_LABELS[s]}
          </Button>
        ))}
      </div>
    </div>
  );
}

function Experiments() {
  const { ws, today, dispatch } = usePlaybook();
  const g = readGrowth(ws, today);
  const weekly = g.latest?.signups ?? 0;
  const list = Object.values(ws.experiments ?? {}).sort((a, b) => (a.status === "running" ? -1 : 0) - (b.status === "running" ? -1 : 0) || iceScore(b) - iceScore(a));
  const update = (id: string, patch: Partial<Experiment>) => void dispatch({ type: "experiment.update", id, patch, at: nowISO() });

  return (
    <Sub id="experiments" title="Experiments" hint="One a week, ranked by ICE. Below the users a test needs, ship it to everyone and compare before and after: never call a winner from a small test.">
      {list.length === 0 && <p className="mb-3 text-[13.5px] text-fg-2">No experiments yet. The Monday growth review proposes one for your leakiest stage.</p>}
      <ul className="space-y-3">
        {list.map((e) => {
          const size = sizeExperiment(e, weekly);
          return (
            <li key={e.id} className="rounded-lg bg-surface p-3.5 ring-1 ring-border sm:p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[12px] text-fg-3">
                    {STAGE_LABELS[e.stage]} · {STATUS_LABELS[e.status]}
                    {e.ice && ` · ICE ${iceScore(e)}`}
                    {e.endsOn && e.status === "running" && ` · reads ${shortDate(e.endsOn)}`}
                  </p>
                  <Editable value={e.hypothesis} label="hypothesis" multiline onSave={(v) => update(e.id, { hypothesis: v })} className="mt-0.5 text-[14px] font-medium leading-[21px]" />
                  {e.change && <p className="mt-0.5 text-[13px] leading-5 text-fg-2">Change: {e.change}</p>}
                  {e.metric && <p className="text-[13px] leading-5 text-fg-2">Measure: {e.metric}</p>}
                  <p className="mt-1 text-[12px] leading-[17px] text-fg-3">
                    {size.perArm
                      ? size.abReadable
                        ? `A readable A/B test needs about ${size.perArm.toLocaleString("en-US")} users per variant (about ${plural(size.weeksToRead ?? 0, "week")}).`
                        : `An A/B test would need about ${size.perArm.toLocaleString("en-US")} users per variant. Ship it and compare before and after.`
                      : "No baseline yet: ship it and compare before and after, with an end date."}
                  </p>
                  {e.result && <p className="mt-1 text-[13px] leading-5 text-fg">Result: {e.result}</p>}
                </div>
                <RemoveButton label="Remove experiment" onClick={() => void dispatch({ type: "experiment.remove", id: e.id })} />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {e.status === "idea" && (
                  <Button size="sm" onClick={() => update(e.id, { status: "running", startedOn: today, endsOn: addDays(today, 14) })}>
                    Start, read in 2 weeks
                  </Button>
                )}
              </div>
              {e.status === "running" && <Readout onDone={(status, result) => update(e.id, { status, result: result || e.result })} />}
            </li>
          );
        })}
      </ul>
      <AddRow
        label="Add an experiment"
        placeholder="If we ask for an invite right after the first win, more friends sign up"
        className="mt-3"
        onAdd={(hypothesis) => {
          const at = nowISO();
          void dispatch({ type: "experiment.upsert", experiment: { id: newId("exp"), stage: g.focus, hypothesis, change: "", metric: "", status: "idea", createdAt: at, updatedAt: at } });
        }}
      />
    </Sub>
  );
}
