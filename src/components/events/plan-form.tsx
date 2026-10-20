"use client";

import { motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useMemo, useState, type KeyboardEvent } from "react";
import { useRuns } from "@/components/providers/runs-provider";
import { AiBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label } from "@/components/ui/field";
import { Kbd } from "@/components/ui/kbd";
import { Segmented } from "@/components/ui/misc";
import { cn } from "@/lib/client/cn";
import { newId } from "@/lib/domain/ids";
import { OPEN_STAGES, type Workspace } from "@/lib/domain/types";
import { ease } from "@/lib/motion";
import { GOALS, cityClusters, monthLabel, upcomingMonths, type EventGoal, type EventKind } from "./plan-math";
import { AgentNote } from "./ui";

function stats(ws: Workspace) {
  const deals = Object.values(ws.deals);
  return {
    won: deals.filter((d) => d.stage === "won").length,
    open: deals.filter((d) => OPEN_STAGES.includes(d.stage)).length,
    investors: ws.connectors.filter((c) => c.relationship === "investor" || c.relationship === "angel"),
  };
}

function Chip({ active, onClick, children, disabled }: { active: boolean; onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-sm px-2.5 text-[13px] ring-1 transition-[background-color,box-shadow,color,transform] duration-150 active:scale-[0.97]",
        active ? "bg-primary text-primary-fg ring-primary" : "bg-surface text-fg-2 ring-border hover:bg-bg-subtle hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}

/**
 * The planner expands in place at the top of /events (never a modal). It asks five things and
 * recommends the room that fits the founder's stage: a roundtable until there's a customer to host.
 */
export function PlanForm({ ws, onClose }: { ws: Workspace; onClose: () => void }) {
  const router = useRouter();
  const { start } = useRuns();
  const s = useMemo(() => stats(ws), [ws]);
  const clusters = useMemo(() => cityClusters(ws), [ws]);

  const [kind, setKind] = useState<EventKind>(s.won > 0 ? "dinner" : "roundtable");
  const [city, setCity] = useState(clusters[0]?.city ?? "");
  const months = upcomingMonths(kind);
  const [monthPick, setMonth] = useState<string | null>(null);
  const month = monthPick && months.includes(monthPick) ? monthPick : months[0];
  const [goal, setGoal] = useState<EventGoal>(s.open >= 3 ? "accelerate_deals" : "create_pipeline");
  const [budget, setBudget] = useState("");
  const [coHost, setCoHost] = useState("");
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);

  const cityMissing = kind === "dinner" && !city.trim();
  const budgetNum = budget.trim() ? Number(budget.replace(/[$,\s]/g, "")) : undefined;
  const budgetBad = budgetNum !== undefined && (!Number.isFinite(budgetNum) || budgetNum < 0);

  async function submit() {
    setTried(true);
    if (cityMissing || budgetBad || busy) return;
    setBusy(true);
    const eventId = newId("evt");
    const run = await start(
      "dinner_plan",
      {
        eventId,
        kind,
        city: kind === "dinner" ? city.trim() : undefined,
        month,
        goal,
        budgetUsd: budgetNum,
        coHost: coHost.trim() || undefined,
      },
      { notify: true },
    );
    setBusy(false);
    if (run) router.push(`/events/${eventId}`);
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void submit();
    }
  }

  const recommendation =
    kind === "roundtable"
      ? s.won === 0
        ? "A good first room. No customers needed, it costs nothing, and it rehearses the dinner: 6–8 peers, 60 minutes, one live question."
        : "Quick to fill (about 3 weeks) and cheap. Ask a customer to frame the first 5 minutes."
      : s.won === 0
        ? "Dinners fill when someone else's brand is on the invite. With no customer to host yet, borrow a co-host: a VC platform team, a non-competing startup that sells to the same buyer, or a community."
        : `You have ${s.won} customer${s.won === 1 ? "" : "s"}. Ask one to host: dinners where customers tell the story make more pipeline than host-led ones.`;

  return (
    <motion.section
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4, transition: { duration: 0.12 } }}
      transition={{ duration: 0.2, ease: ease.out }}
      onKeyDown={onKeyDown}
      aria-label="Plan an event"
      className="mt-6 rounded-xl bg-surface p-5 shadow-md ring-1 ring-border md:p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-[-0.01em]">Plan an event</h2>
        <Segmented<EventKind>
          layoutId="event-kind"
          value={kind}
          onChange={setKind}
          options={[
            { value: "roundtable", label: "Virtual roundtable" },
            { value: "dinner", label: "Dinner" },
          ]}
        />
      </div>

      <AgentNote className="mt-4 max-w-[64ch]">
        {recommendation}
        {kind === "dinner" && s.won === 0 && (
          <>
            {" "}
            <button type="button" onClick={() => setKind("roundtable")} className="font-sans text-[13px] text-accent-text underline-offset-4 hover:underline">
              Start with a roundtable
            </button>
          </>
        )}
      </AgentNote>

      <div className="mt-6 grid gap-x-8 gap-y-5 md:grid-cols-2">
        {kind === "dinner" && (
          <div>
            <Label htmlFor="ev-city" hint={clusters.length ? "Where your accounts cluster" : undefined}>
              City
            </Label>
            <Input id="ev-city" value={city} onChange={(e) => setCity(e.target.value)} placeholder="New York" autoComplete="off" />
            {clusters.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {clusters.map((c) => (
                  <Chip key={c.city} active={city === c.city} onClick={() => setCity(c.city)}>
                    {c.city}
                    <span className="font-mono text-[11px] opacity-70">{c.accounts}</span>
                  </Chip>
                ))}
              </div>
            )}
            <FieldError>{tried && cityMissing ? "A dinner needs a city. Pick the one where most of your accounts are." : null}</FieldError>
          </div>
        )}

        <div>
          <Label hint={kind === "dinner" ? "I'll pick a Tue–Thu about 6 weeks out" : "I'll pick a Tue–Thu about 3 weeks out"}>Month</Label>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Month">
            {months.map((m) => (
              <Chip key={m} active={m === month} onClick={() => setMonth(m)}>
                {monthLabel(m)}
              </Chip>
            ))}
          </div>
        </div>

        <div className="md:col-span-2">
          <Label>Goal</Label>
          <div role="radiogroup" aria-label="Goal" className="grid gap-2 sm:grid-cols-2">
            {GOALS.map((g) => {
              const active = g.value === goal;
              return (
                <button
                  key={g.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setGoal(g.value)}
                  className={cn(
                    "rounded-md px-3 py-2.5 text-left ring-1 transition-[background-color,box-shadow,transform] duration-150 active:scale-[0.99]",
                    active ? "bg-bg-subtle ring-2 ring-fg" : "ring-border hover:bg-bg-subtle",
                  )}
                >
                  <span className="block text-[13px] font-medium text-fg">{g.label}</span>
                  <span className="mt-0.5 block text-[12px] leading-4 text-fg-3">{g.hint}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <Label htmlFor="ev-cohost" hint="Optional">
            Co-host
          </Label>
          <Input
            id="ev-cohost"
            value={coHost}
            onChange={(e) => setCoHost(e.target.value)}
            placeholder={kind === "dinner" ? "A VC platform team or a non-competing startup" : "Someone whose list you can borrow"}
            autoComplete="off"
          />
          {s.investors.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {s.investors.slice(0, 3).map((c) => {
                const v = `${c.name}'s platform team`;
                return (
                  <Chip key={c.id} active={coHost === v} onClick={() => setCoHost(coHost === v ? "" : v)}>
                    {v}
                  </Chip>
                );
              })}
            </div>
          )}
        </div>

        <div>
          <Label htmlFor="ev-budget" hint={kind === "dinner" ? "Typical: $3.5–7K for 10–12, half with a co-host" : "Usually $0; thank-you gifts at most"}>
            Budget
          </Label>
          <div className="relative">
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[13px] text-fg-3">$</span>
            <Input
              id="ev-budget"
              inputMode="numeric"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              placeholder={kind === "dinner" ? "5,000" : "0"}
              className="pl-6 font-mono"
            />
          </div>
          <FieldError>{tried && budgetBad ? "Enter a dollar amount, like 5000." : null}</FieldError>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-border pt-4">
        <span className="flex items-center gap-1.5 font-mono text-[11.5px] text-fg-3">
          <AiBadge /> About a minute · ~${kind === "dinner" ? "0.12" : "0.08"}
        </span>
        <span className="flex-1" />
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="agent" loading={busy} onClick={() => void submit()}>
          {kind === "dinner" ? "Plan the dinner" : "Plan the roundtable"}
          <Kbd className="ml-1 hidden bg-transparent text-accent-fg/80 ring-accent-fg/30 sm:inline-flex">⌘↵</Kbd>
        </Button>
      </div>
    </motion.section>
  );
}
