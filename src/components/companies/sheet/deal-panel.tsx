"use client";

import { Check, ChevronDown, ChevronRight, Circle, FileText, Plus, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useRunFor, useRuns } from "@/components/providers/runs-provider";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/field";
import { Menu, MenuItem } from "@/components/ui/menu";
import { CopyButton, Markdown, Segmented } from "@/components/ui/misc";
import { WorkLog } from "@/components/ui/work-log";
import { cn } from "@/lib/client/cn";
import { money, shortDate } from "@/lib/client/format";
import {
  BOARD_STAGES,
  LOSS_REASONS,
  STAGE_RANK,
  computeQualification,
  hasDatedNextStep,
  mapToMarkdown,
  missingCriteria,
  nextStage,
  scoresFrom,
  stageCriteria,
} from "@/lib/deals/rules";
import { addDays, daysBetween, newId, nowISO } from "@/lib/domain/ids";
import { STAGE_LABELS, type Account, type Deal, type MutualActionPlan, type Person, type PersonaRole, type Stage } from "@/lib/domain/types";
import { BAND_LABEL, BAND_TONE, RiskList } from "@/components/revenue/risk-list";
import { CallMenu } from "@/components/revenue/deal-calls";
import { callDeal } from "@/lib/revenue/forecast";
import type { RiskCode } from "@/lib/revenue/risk";
import { openStage, periodOf, revenueStats } from "@/lib/revenue/stats";
import { MeetingsSection } from "./meetings";
import { QualificationCardView } from "./qualification";
import { Callout, CommitInput, HoldButton, ROLE_LABEL, Section } from "./shared";

export function DealPanel({ deal, account, today, focusLog }: { deal: Deal; account: Account; today: string; focusLog: boolean }) {
  return (
    <div className="space-y-9">
      <StageControl deal={deal} today={today} />
      <ForecastRisk deal={deal} today={today} />
      <NextStep deal={deal} today={today} />
      <QualificationCardView deal={deal} today={today} />
      <MeetingsSection deal={deal} account={account} today={today} focusLog={focusLog} />
      <Contacts deal={deal} account={account} />
      <Tasks deal={deal} today={today} />
      <Plan deal={deal} account={account} today={today} />
    </div>
  );
}

/* ─────────────────────────────── Forecast & risk ─────────────────────────────── */

/** Inside the sheet, a fix that would open this same sheet scrolls to the section where it's made. */
const IN_SHEET: Partial<Record<RiskCode, string>> = {
  no_next_step: "deal-next-step",
  next_step_overdue: "deal-next-step",
  next_step_unconfirmed: "deal-next-step",
  no_champion: "deal-people",
  plan_behind: "deal-plan",
  no_pilot_criteria: "deal-pilot",
  unpaid_pilot: "deal-pilot",
};

/** The deal review in one place: how the forecast calls it, its health, and each risk with the fix. */
function ForecastRisk({ deal, today }: { deal: Deal; today: string }) {
  const { ws } = useWorkspace();
  const call = useMemo(() => {
    if (!ws || !openStage(deal.stage)) return null;
    return callDeal(ws, deal, revenueStats(ws, today), periodOf(ws.revenue?.target, today), today);
  }, [ws, deal, today]);
  if (!call) return null;
  return (
    <Section
      label="Forecast and risk"
      right={
        <span className="flex items-center gap-2">
          <span className={cn("text-[12px] font-medium", BAND_TONE[call.band])}>
            {BAND_LABEL[call.band]} · <span className="font-mono tnum">{call.health}</span>
          </span>
          <CallMenu c={call} />
        </span>
      }
    >
      <p className="mb-1 text-[12.5px] leading-5 text-fg-3">
        {money(call.amount.usd)}
        {call.amount.source === "average" ? " (typical deal, until an amount is set)" : ""} · closes {shortDate(call.closeDate)}
        {call.closeEstimated ? " (estimated)" : ""} · {call.inPeriod ? "in" : "outside"} {periodOf(ws?.revenue?.target, today).label} · {call.why}
      </p>
      <RiskList risks={call.risks} deal={deal} jump={IN_SHEET} />
    </Section>
  );
}

/* ─────────────────────────────── Stage ─────────────────────────────── */

function StageControl({ deal, today }: { deal: Deal; today: string }) {
  const { dispatch } = useWorkspace();
  const [pending, setPending] = useState<Stage | null>(null);
  const [closing, setClosing] = useState<"lost" | "nurture" | null>(null);
  const [reason, setReason] = useState<NonNullable<Deal["lossReason"]>>("no_pain");
  const [until, setUntil] = useState("");
  const current = STAGE_RANK[deal.stage];
  const closed = deal.stage === "lost" || deal.stage === "nurture";

  const move = async (stage: Stage, extra: { lossReason?: Deal["lossReason"]; nurtureUntil?: string } = {}) => {
    const ok = await dispatch({ type: "deal.setStage", id: deal.id, stage, at: nowISO(), ...extra });
    if (ok) {
      toast(`${deal.name} · ${STAGE_LABELS[stage]}`);
      setPending(null);
      setClosing(null);
    }
  };
  const request = (stage: Stage) => {
    if (stage === deal.stage) return;
    const forward = STAGE_RANK[stage] > current || closed;
    if (forward && missingCriteria(stage, deal, today).length) {
      setPending(stage);
      setClosing(null);
    } else void move(stage);
  };
  const toggleCheck = (key: string) => dispatch({ type: "deal.update", id: deal.id, patch: { checklist: { ...deal.checklist, [key]: !deal.checklist?.[key] } }, at: nowISO() });

  const target = pending ?? (closed ? null : nextStage(deal.stage));
  const criteria = target ? stageCriteria(target, deal, today) : [];
  const allMet = criteria.every((c) => c.met);

  return (
    <section aria-label="Stage">
      <div className="flex flex-wrap items-center gap-x-0.5 gap-y-1.5" role="group" aria-label="Deal stage">
        {BOARD_STAGES.map((s, i) => {
          const done = !closed && STAGE_RANK[s] < current;
          const here = deal.stage === s;
          return (
            <span key={s} className="flex items-center">
              <button
                onClick={() => request(s)}
                aria-current={here ? "step" : undefined}
                className={cn(
                  "inline-flex h-7 items-center gap-1 rounded-sm px-2 text-[13px] font-medium sm:px-2.5 transition-[background-color,color,transform] duration-150 active:scale-[0.97]",
                  here ? "bg-primary text-primary-fg shadow-btn" : done ? "text-fg hover:bg-bg-subtle" : "text-fg-3 hover:bg-bg-subtle hover:text-fg-2",
                )}
              >
                {done && <Check className="size-3" aria-hidden />}
                {STAGE_LABELS[s]}
              </button>
              {i < BOARD_STAGES.length - 1 && <ChevronRight className="hidden size-3 text-fg-4 sm:block" aria-hidden />}
            </span>
          );
        })}
        <span className="ml-auto">
          <Menu
            trigger={
              <Button size="sm" variant="ghost" className={cn(closed && "text-fg")}>
                {closed ? STAGE_LABELS[deal.stage] : "Close"} <ChevronDown className="size-3" />
              </Button>
            }
          >
            <MenuItem
              onSelect={() => {
                setClosing("lost");
                setPending(null);
              }}
            >
              Lost…
            </MenuItem>
            <MenuItem
              onSelect={() => {
                setClosing("nurture");
                setPending(null);
                setUntil(addDays(today, 60));
              }}
            >
              Nurture…
            </MenuItem>
            {closed && <MenuItem onSelect={() => void move("talking")}>Reopen at Talking</MenuItem>}
          </Menu>
        </span>
      </div>

      {closed && !closing && (
        <p className="mt-2 text-[13px] text-fg-2">
          {deal.stage === "lost" ? `Closed as lost${deal.lossReason ? ` · ${LOSS_REASONS.find((r) => r.value === deal.lossReason)?.label.toLowerCase()}` : ""}.` : `Parked until ${deal.nurtureUntil ? shortDate(deal.nurtureUntil) : "later"}. I'll bring it back then.`}
        </p>
      )}

      {closing === "lost" && (
        <div className="mt-3 flex flex-wrap items-end gap-2 rounded-md bg-bg-subtle p-3 animate-[fade-in_150ms_var(--ease-out)]">
          <div className="min-w-48 flex-1">
            <Label htmlFor="loss-reason">Why did it end?</Label>
            <Select
              id="loss-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value as NonNullable<Deal["lossReason"]>)}
              className="h-8 w-full rounded-sm bg-surface px-2 text-[13px] ring-1 ring-border-strong/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            >
              {LOSS_REASONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </Select>
          </div>
          <HoldButton onConfirm={() => void move("lost", { lossReason: reason })}>Hold to close as lost</HoldButton>
          <Button size="sm" variant="ghost" onClick={() => setClosing(null)}>
            Cancel
          </Button>
        </div>
      )}
      {closing === "nurture" && (
        <div className="mt-3 flex flex-wrap items-end gap-2 rounded-md bg-bg-subtle p-3 animate-[fade-in_150ms_var(--ease-out)]">
          <div>
            <Label htmlFor="nurture-until">Check back on</Label>
            <Input id="nurture-until" type="date" value={until} min={today} onChange={(e) => setUntil(e.target.value)} className="w-44" />
          </div>
          <Button size="sm" variant="primary" disabled={!until} onClick={() => void move("nurture", { nurtureUntil: until })}>
            Move to Nurture
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setClosing(null)}>
            Cancel
          </Button>
        </div>
      )}

      {target && !closing && criteria.length > 0 && (
        <div className={cn("mt-3 rounded-md p-3", pending ? "bg-bg-subtle ring-1 ring-border" : "")}>
          <p className="mb-1.5 text-[12px] font-medium text-fg-3">{pending ? `${STAGE_LABELS[target]} needs` : `To reach ${STAGE_LABELS[target]}`}</p>
          <ul className="space-y-1">
            {criteria.map((c) => (
              <li key={c.key} className="flex items-start gap-2 text-[13px]">
                {c.manual ? (
                  <input type="checkbox" checked={c.met} onChange={() => void toggleCheck(c.key)} aria-label={c.label} className="mt-[3px] accent-[var(--fg)]" />
                ) : c.met ? (
                  <Check className="mt-[3px] size-3.5 shrink-0 text-success" aria-label="Met" />
                ) : (
                  <Circle className="mt-[3px] size-3.5 shrink-0 text-fg-4" aria-label="Not met" />
                )}
                <span className={cn(c.met ? "text-fg-2" : "text-fg")}>
                  {c.label}
                  {!c.met && c.hint && <span className="text-fg-3"> · {c.hint}</span>}
                </span>
              </li>
            ))}
          </ul>
          {pending && (
            <div className="mt-3 flex items-center gap-2">
              <Button size="sm" variant={allMet ? "primary" : "secondary"} onClick={() => void move(pending)}>
                {allMet ? `Move to ${STAGE_LABELS[pending]}` : "Move anyway"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setPending(null)}>
                Cancel
              </Button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/* ─────────────────────────────── Next step ─────────────────────────────── */

function NextStep({ deal, today }: { deal: Deal; today: string }) {
  const { dispatch } = useWorkspace();
  const ns = deal.nextStep;
  const [editing, setEditing] = useState(false);
  const [what, setWhat] = useState(ns?.what ?? "");
  const [date, setDate] = useState(ns?.date ?? "");
  const [agreed, setAgreed] = useState(ns?.buyerAgreed ?? false);
  const overdue = !!ns && ns.date < today;
  const closed = deal.stage === "won" || deal.stage === "lost" || deal.stage === "nurture";

  const save = async () => {
    if (!what.trim() || !date) return;
    const at = nowISO();
    const nextStep = { what: what.trim(), date, buyerAgreed: agreed };
    const actions = [{ type: "deal.setNextStep" as const, id: deal.id, nextStep, at }];
    const ok = await dispatch(
      deal.qualification ? [...actions, { type: "deal.update" as const, id: deal.id, patch: { qualification: computeQualification(scoresFrom(deal.qualification), hasDatedNextStep(nextStep, today)) }, at }] : actions,
    );
    if (ok) setEditing(false);
  };
  const startEdit = () => {
    setWhat(ns?.what ?? "");
    setDate(ns?.date ?? "");
    setAgreed(ns?.buyerAgreed ?? false);
    setEditing(true);
  };

  if (closed && !ns) return null;
  const form = (
    <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_150px_auto]">
      <Input value={what} onChange={(e) => setWhat(e.target.value)} placeholder="Technical deep-dive with their CTO" aria-label="Next step" onKeyDown={(e) => e.key === "Enter" && void save()} />
      <Input type="date" value={date} min={today} onChange={(e) => setDate(e.target.value)} aria-label="Date" />
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1.5 whitespace-nowrap text-[12.5px] text-fg-2">
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="accent-[var(--fg)]" /> They agreed
        </label>
        <Button size="sm" variant="primary" onClick={() => void save()} disabled={!what.trim() || !date}>
          Save
        </Button>
        {ns && (
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  );

  if (!ns) {
    return (
      <section id="deal-next-step" className="scroll-mt-14 rounded-lg bg-danger-subtle/60 p-3 ring-1 ring-danger/20">
        <p className="text-[13px] font-medium text-danger">No dated next step. Treat this deal as a soft no until one is booked.</p>
        {form}
      </section>
    );
  }
  return (
    <section id="deal-next-step" className={cn("scroll-mt-14 rounded-lg p-3 ring-1", overdue ? "bg-danger-subtle/60 ring-danger/20" : "bg-surface ring-border")}>
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <span className="text-[12px] font-medium text-fg-3">Next step</span>
        {!ns.buyerAgreed && <Badge tone="warning">Not agreed by them</Badge>}
        <span className={cn("ml-auto whitespace-nowrap font-mono text-[12px]", overdue ? "text-danger" : "text-fg-2")}>
          {shortDate(ns.date)}
          {overdue && ` · ${daysBetween(ns.date, today)}d overdue`}
        </span>
        {!editing && (
          <button onClick={startEdit} className="text-[12px] text-fg-3 hover:text-fg">
            {overdue ? "Update" : "Edit"}
          </button>
        )}
      </div>
      <p className={cn("mt-1 text-[14px] font-medium leading-5", overdue ? "text-danger" : "text-fg")}>{ns.what}</p>
      {editing && form}
    </section>
  );
}

/* ─────────────────────────────── Contacts ─────────────────────────────── */

const CHAMPION_LABEL = { coach: "Coach", untested: "Champion, untested", tested: "Champion, tested" } as const;

function Contacts({ deal, account }: { deal: Deal; account: Account }) {
  const { ws, dispatch } = useWorkspace();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  if (!ws) return null;
  const contacts = deal.contacts.map((c) => ({ ...c, person: ws.people[c.personId] })).filter((c): c is typeof c & { person: Person } => !!c.person);
  const available = account.peopleIds.map((id) => ws.people[id]).filter((p): p is Person => !!p && !deal.contacts.some((c) => c.personId === p.id));
  const at = () => nowISO();
  const setContacts = (next: Deal["contacts"]) => dispatch({ type: "deal.update", id: deal.id, patch: { contacts: next }, at: at() });
  const addNew = async () => {
    if (!name.trim()) return;
    const person: Person = {
      id: newId("per"),
      accountDomain: account.domain,
      name: name.trim(),
      title: title.trim(),
      evidenceIds: [],
      confidence: "medium",
      mayHaveLeft: false,
      contactPaths: [],
      jurisdiction: account.dossier?.snapshot.jurisdiction ?? "unknown",
      doNotContact: false,
      source: "manual",
    };
    const ok = await dispatch([
      { type: "person.upsert", person },
      { type: "deal.update", id: deal.id, patch: { contacts: [...deal.contacts, { personId: person.id }] }, at: at() },
    ]);
    if (ok) {
      setName("");
      setTitle("");
      setAdding(false);
    }
  };
  const single = STAGE_RANK[deal.stage] >= 1 && STAGE_RANK[deal.stage] <= 3 && contacts.length < 2;

  return (
    <Section
      id="deal-people"
      label="People on this deal"
      right={
        <div className="flex items-center gap-1">
          {available.length > 0 && (
            <Menu
              trigger={
                <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />}>
                  Add from {account.name}
                </Button>
              }
            >
              {available.slice(0, 12).map((p) => (
                <MenuItem key={p.id} onSelect={() => void setContacts([...deal.contacts, { personId: p.id, role: p.role }])} hint={p.title}>
                  {p.name}
                </MenuItem>
              ))}
            </Menu>
          )}
          <Button size="sm" variant="ghost" onClick={() => setAdding((a) => !a)} aria-expanded={adding}>
            New person
          </Button>
        </div>
      }
    >
      {single && <Callout tone="warning" className="mb-3">Single-threaded. Won deals involve more of the buying committee; ask your champion who else should be in the room.</Callout>}
      {adding && (
        <div className="mb-3 flex flex-wrap gap-2 animate-[fade-in_150ms_var(--ease-out)]">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" aria-label="Name" className="w-44" />
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" aria-label="Title" className="w-44" onKeyDown={(e) => e.key === "Enter" && void addNew()} />
          <Button size="sm" variant="primary" onClick={() => void addNew()} disabled={!name.trim()}>
            Add
          </Button>
        </div>
      )}
      {contacts.length === 0 ? (
        <p className="text-[13px] text-fg-3">No one on the deal yet. Add who you&apos;re talking to.</p>
      ) : (
        <ul className="divide-y divide-border rounded-md ring-1 ring-border">
          {contacts.map(({ person, role }) => (
            <li key={person.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2">
              <span className="min-w-0 flex-1 text-[13px]">
                <span className="font-medium text-fg">{person.name}</span>
                {person.title && <span className="text-fg-2"> · {person.title}</span>}
              </span>
              <Select
                value={role ?? ""}
                aria-label={`${person.name}'s role`}
                onChange={(e) => void setContacts(deal.contacts.map((c) => (c.personId === person.id ? { ...c, role: (e.target.value || undefined) as PersonaRole | undefined } : c)))}
                className="h-7 w-full rounded-sm bg-transparent px-1.5 text-[12px] text-fg-2 ring-1 ring-border hover:ring-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] sm:w-auto"
              >
                <option value="">Role?</option>
                {(Object.keys(ROLE_LABEL) as PersonaRole[]).map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </Select>
              <Select
                value={person.champion ?? ""}
                aria-label={`${person.name}'s champion status`}
                onChange={(e) => void dispatch({ type: "person.upsert", person: { ...person, champion: (e.target.value || undefined) as Person["champion"] } })}
                className="h-7 w-full rounded-sm bg-transparent px-1.5 text-[12px] text-fg-2 ring-1 ring-border hover:ring-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] sm:w-auto"
              >
                <option value="">Not a champion</option>
                {(Object.keys(CHAMPION_LABEL) as (keyof typeof CHAMPION_LABEL)[]).map((c) => (
                  <option key={c} value={c}>
                    {CHAMPION_LABEL[c]}
                  </option>
                ))}
              </Select>
              <button
                onClick={() => void setContacts(deal.contacts.filter((c) => c.personId !== person.id))}
                aria-label={`Remove ${person.name} from the deal`}
                className="inline-flex size-6 items-center justify-center rounded-xs text-fg-3 hover:bg-bg-subtle hover:text-fg"
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/* ─────────────────────────────── Tasks ─────────────────────────────── */

function Tasks({ deal, today }: { deal: Deal; today: string }) {
  const { dispatch } = useWorkspace();
  const [text, setText] = useState("");
  const tasks = deal.tasks ?? [];
  const open = tasks.filter((t) => !t.done);
  const done = tasks.filter((t) => t.done).slice(-3);
  const write = (next: NonNullable<Deal["tasks"]>) => dispatch({ type: "deal.update", id: deal.id, patch: { tasks: next }, at: nowISO() });
  const add = () => {
    if (!text.trim()) return;
    void write([...tasks, { id: newId("task"), what: text.trim(), owner: "founder", done: false }]);
    setText("");
  };
  return (
    <Section label={`Tasks${open.length ? ` · ${open.length} open` : ""}`}>
      <ul className="space-y-1">
        {[...open, ...done].map((t) => {
          const overdue = !t.done && !!t.due && t.due < today;
          return (
            <li key={t.id} className="flex items-start gap-2.5 rounded-sm px-1 py-1 text-[13px] hover:bg-bg-subtle">
              <input type="checkbox" checked={t.done} onChange={() => void write(tasks.map((x) => (x.id === t.id ? { ...x, done: !x.done } : x)))} aria-label={t.what} className="mt-[3px] accent-[var(--fg)]" />
              <span className={cn("min-w-0 flex-1", t.done ? "text-fg-3 line-through" : "text-fg")}>{t.what}</span>
              <span className="shrink-0 text-[12px] text-fg-3">{t.owner === "buyer" ? "Them" : "You"}</span>
              {t.due && <span className={cn("shrink-0 font-mono text-[11.5px]", overdue ? "text-danger" : "text-fg-3")}>{shortDate(t.due)}</span>}
            </li>
          );
        })}
      </ul>
      <Input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} placeholder="Add a task and press Enter" aria-label="New task" className="mt-2 h-7 text-[12.5px]" />
    </Section>
  );
}

/* ─────────────────────────────── Plan: MAP, pilot, price, proposal ─────────────────────────────── */

const MAP_TEMPLATE: [string, "buyer" | "seller" | "both", number][] = [
  ["Discovery recap confirmed", "both", -35],
  ["Technical deep-dive and data access", "both", -30],
  ["Security questionnaire and DPA", "seller", -25],
  ["Pilot success criteria signed", "buyer", -21],
  ["Pilot kickoff (ROI review booked)", "both", -20],
  ["Mid-pilot check-in", "both", -13],
  ["ROI review with the economic buyer", "buyer", -6],
  ["Proposal and order form", "seller", -4],
  ["Signature", "buyer", 0],
];

function draftMap(target: string, today: string): MutualActionPlan {
  return {
    targetDate: target,
    goal: "",
    milestones: MAP_TEMPLATE.map(([step, ownerSide, offset]) => {
      const due = addDays(target, offset);
      return { id: newId("ms"), step, ownerSide, due: due < today ? today : due, status: "todo" as const };
    }),
  };
}

function Plan({ deal, account, today }: { deal: Deal; account: Account; today: string }) {
  return (
    <div className="space-y-9">
      <MapEditor deal={deal} account={account} today={today} />
      <Pilot deal={deal} today={today} />
      <Pricing deal={deal} today={today} />
      <Proposal deal={deal} />
    </div>
  );
}

function MapEditor({ deal, account, today }: { deal: Deal; account: Account; today: string }) {
  const { ws, dispatch } = useWorkspace();
  const map = deal.map;
  const write = (next: MutualActionPlan | undefined) => dispatch({ type: "deal.update", id: deal.id, patch: { map: next }, at: nowISO() });
  const setMs = (id: string, patch: Partial<MutualActionPlan["milestones"][number]>) =>
    map && void write({ ...map, milestones: map.milestones.map((m) => (m.id === id ? { ...m, ...patch } : m)).sort((a, b) => a.due.localeCompare(b.due)) });

  if (!map) {
    const target = deal.card?.criticalEvent.date && deal.card.criticalEvent.date > today ? deal.card.criticalEvent.date : addDays(today, 45);
    return (
      <Section id="deal-plan" label="Mutual action plan">
        <p className="text-[13px] text-fg-2">
          A dated plan you agree with them, working back from their go-live or decision date. I draft one after a qualifying call, or start from the template now.
        </p>
        <Button size="sm" className="mt-2" onClick={() => void write(draftMap(target, today))}>
          Start from the template
        </Button>
      </Section>
    );
  }
  const md = mapToMarkdown(map, deal.name, ws?.company?.name);
  return (
    <Section
      id="deal-plan"
      label={`Mutual action plan · to ${shortDate(map.targetDate)}`}
      right={
        <div className="flex items-center gap-1.5">
          <CopyButton text={md} label="Copy for them" />
          <a href={`/api/deals/${encodeURIComponent(deal.id)}/map`} target="_blank" rel="noreferrer" className="text-[12px] text-fg-3 hover:text-fg">
            Markdown
          </a>
        </div>
      }
    >
      <div className="mb-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_160px]">
        <CommitInput value={map.goal} onCommit={(goal) => void write({ ...map, goal })} ariaLabel="Plan goal" placeholder={`What ${account.name} wants by the target date`} />
        <CommitInput type="date" value={map.targetDate} onCommit={(targetDate) => targetDate && void write({ ...map, targetDate })} ariaLabel="Target date" />
      </div>
      <ul className="divide-y divide-border rounded-md ring-1 ring-border">
        {map.milestones.map((m) => {
          const late = m.status !== "done" && m.due < today;
          const afterTarget = m.due > map.targetDate;
          return (
            <li key={m.id} className="grid grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 px-2.5 py-1.5 sm:grid-cols-[20px_minmax(0,1fr)_96px_140px_24px]">
              <input type="checkbox" checked={m.status === "done"} onChange={() => setMs(m.id, { status: m.status === "done" ? "todo" : "done" })} aria-label={`Done: ${m.step}`} className="accent-[var(--fg)]" />
              <CommitInput value={m.step} onCommit={(step) => step.trim() && setMs(m.id, { step: step.trim() })} ariaLabel="Milestone" className={cn(m.status === "done" && "text-fg-3 line-through")} />
              <Select
                value={m.ownerSide}
                onChange={(e) => setMs(m.id, { ownerSide: e.target.value as "buyer" | "seller" | "both" })}
                aria-label="Owner"
                className="col-start-2 h-7 rounded-sm bg-transparent px-1 text-[12px] text-fg-2 ring-1 ring-border sm:col-start-auto"
              >
                <option value="buyer">{account.name}</option>
                <option value="seller">You</option>
                <option value="both">Both</option>
              </Select>
              <span className={cn("col-start-2 sm:col-start-auto", late ? "text-danger" : afterTarget ? "text-warning" : "")}>
                <CommitInput type="date" value={m.due} onCommit={(due) => due && setMs(m.id, { due })} ariaLabel="Due date" className={cn("font-mono text-[12px]", late && "text-danger", afterTarget && !late && "text-warning")} />
              </span>
              <button onClick={() => void write({ ...map, milestones: map.milestones.filter((x) => x.id !== m.id) })} aria-label={`Remove ${m.step}`} className="row-start-1 inline-flex size-6 items-center justify-center rounded-xs text-fg-3 hover:bg-bg-subtle hover:text-fg sm:row-start-auto">
                <Trash2 className="size-3" />
              </button>
            </li>
          );
        })}
      </ul>
      <div className="mt-2 flex items-center justify-between gap-2">
        <Button
          size="xs"
          variant="ghost"
          icon={<Plus className="size-3" />}
          onClick={() => void write({ ...map, milestones: [...map.milestones, { id: newId("ms"), step: "New milestone", ownerSide: "both", due: map.targetDate, status: "todo" }] })}
        >
          Add a step
        </Button>
        <span className="text-[12px] text-fg-3">Review it with them. Never send it as final.</span>
      </div>
    </Section>
  );
}

const CRITERIA_TEMPLATE = "By {date}, using {product} on {scope}, {customer} will move {metric} from {baseline} to {target}, measured by {method/owner}. If met, {customer} moves to {plan} at {price} starting {date}.";

function Pilot({ deal, today }: { deal: Deal; today: string }) {
  const { dispatch } = useWorkspace();
  const [open, setOpen] = useState(!!deal.pilot || deal.stage === "pilot");
  const pilot = deal.pilot ?? { criteria: "", paid: true };
  const write = (patch: Partial<NonNullable<Deal["pilot"]>>) => dispatch({ type: "deal.update", id: deal.id, patch: { pilot: { ...pilot, ...patch } }, at: nowISO() });
  const unpaidDays = !pilot.paid && pilot.startedOn ? daysBetween(pilot.startedOn, today) : 0;
  const agreed = !!deal.checklist?.["pilot.criteria"];

  if (!open) {
    return (
      <Section id="deal-pilot" label="Pilot">
        <Button size="sm" onClick={() => setOpen(true)}>
          Write success criteria
        </Button>
      </Section>
    );
  }
  return (
    <Section id="deal-pilot" label="Pilot">
      <div className="space-y-3">
        <div>
          <Label hint={agreed ? "Agreed in writing" : undefined}>Success criteria</Label>
          <CommitInput multiline value={pilot.criteria} onCommit={(criteria) => void write({ criteria: criteria.trim() })} ariaLabel="Pilot success criteria" placeholder={CRITERIA_TEMPLATE} className="min-h-20 ring-border" />
          <label className="mt-1.5 flex items-center gap-1.5 text-[12.5px] text-fg-2">
            <input
              type="checkbox"
              checked={agreed}
              disabled={!pilot.criteria}
              onChange={() => void dispatch({ type: "deal.update", id: deal.id, patch: { checklist: { ...deal.checklist, "pilot.criteria": !agreed } }, at: nowISO() })}
              className="accent-[var(--fg)]"
            />
            They agreed to these in writing
          </label>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <Segmented
            layoutId={`pilot-paid-${deal.id}`}
            value={pilot.paid ? "paid" : "free"}
            onChange={(v) => void write({ paid: v === "paid" })}
            options={[
              { value: "paid", label: "Paid" },
              { value: "free", label: "Free" },
            ]}
          />
          {pilot.paid && (
            <div className="w-32">
              <Label htmlFor="pilot-fee">Fee ($)</Label>
              <CommitInput type="number" value={pilot.feeUsd ? String(pilot.feeUsd) : ""} onCommit={(v) => void write({ feeUsd: Number(v) > 0 ? Math.round(Number(v)) : undefined })} ariaLabel="Pilot fee" placeholder="10000" className="h-8 ring-border" />
            </div>
          )}
          <div className="w-40">
            <Label>Starts</Label>
            <CommitInput type="date" value={pilot.startedOn ?? ""} onCommit={(v) => void write({ startedOn: v || undefined })} ariaLabel="Pilot start" className="h-8 ring-border" />
          </div>
          <div className="w-40">
            <Label>Ends</Label>
            <CommitInput type="date" value={pilot.endsOn ?? ""} onCommit={(v) => void write({ endsOn: v || undefined })} ariaLabel="Pilot end" className="h-8 ring-border" />
          </div>
        </div>
        {!pilot.paid &&
          (unpaidDays > 30 ? (
            <Callout tone="danger">Unpaid for {unpaidDays} days. Ask for the conversion decision now, with the economic buyer in the room.</Callout>
          ) : (
            <Callout tone="warning">Free pilots rarely convert. Charge something, even a small fee credited to the annual contract, with a written conversion date.</Callout>
          ))}
      </div>
    </Section>
  );
}

function Pricing({ deal, today }: { deal: Deal; today: string }) {
  const { dispatch } = useWorkspace();
  const [amount, setAmount] = useState("");
  const [outcome, setOutcome] = useState<"" | "accepted" | "pushback" | "lost">("");
  const quotes = deal.priceQuotes ?? [];
  const log = () => {
    const n = Math.round(Number(amount.replace(/[^0-9.]/g, "")));
    if (!n) return;
    void dispatch({ type: "deal.update", id: deal.id, patch: { priceQuotes: [...quotes, { at: today, amountUsd: n, outcome: outcome || undefined }], amountUsd: deal.amountUsd ?? n }, at: nowISO() });
    setAmount("");
    setOutcome("");
  };
  return (
    <Section label="Pricing">
      {quotes.length > 0 ? (
        <>
          <ul className="mb-3 space-y-1 text-[13px]">
            {quotes.map((q, i) => (
              <li key={i} className="flex items-center gap-3">
                <span className="font-mono tnum text-fg">{money(q.amountUsd)}</span>
                <span className="font-mono text-[11.5px] text-fg-3">{shortDate(q.at)}</span>
                {q.outcome && <Badge tone={q.outcome === "accepted" ? "success" : q.outcome === "lost" ? "danger" : "warning"}>{q.outcome}</Badge>}
              </li>
            ))}
          </ul>
          <div className="mb-3 w-44">
            <Label>Deal value ($)</Label>
            <CommitInput type="number" value={deal.amountUsd ? String(deal.amountUsd) : ""} onCommit={(v) => void dispatch({ type: "deal.update", id: deal.id, patch: { amountUsd: Number(v) > 0 ? Math.round(Number(v)) : undefined }, at: nowISO() })} ariaLabel="Deal value" className="h-8 ring-border" />
          </div>
        </>
      ) : (
        <p className="mb-2 text-[13px] text-fg-2">No price quoted yet, so there&apos;s no dollar value on this deal. Log a quote once you&apos;ve said a number out loud.</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Input value={amount} onChange={(e) => setAmount(e.target.value)} onKeyDown={(e) => e.key === "Enter" && log()} placeholder="$ quoted" aria-label="Amount quoted" inputMode="numeric" className="w-32" />
        <Select value={outcome} onChange={(e) => setOutcome(e.target.value as typeof outcome)} aria-label="Their reaction" className="h-8 rounded-sm bg-surface px-2 text-[13px] ring-1 ring-border-strong/70">
          <option value="">Reaction?</option>
          <option value="accepted">Accepted</option>
          <option value="pushback">Pushback</option>
          <option value="lost">Lost on price</option>
        </Select>
        <Button size="sm" onClick={log} disabled={!amount.trim()}>
          Log quote
        </Button>
      </div>
    </Section>
  );
}

function Proposal({ deal }: { deal: Deal }) {
  const { start } = useRuns();
  const [open, setOpen] = useState(false);
  // Any proposal run for this deal (started here or from a debrief), so a second click never starts a duplicate paid run.
  const ref = useMemo(() => ({ kind: "deal" as const, id: deal.id }), [deal.id]);
  const run = useRunFor(ref, "asset");
  const active = run && (run.status === "running" || run.status === "queued");
  const [pending, setPending] = useState(false);
  const draft = async () => {
    if (active || pending) return;
    setPending(true);
    await start("asset", { kind: "pilot_proposal", dealId: deal.id, title: `${deal.name} pilot proposal` });
    setPending(false);
  };
  const body = useMemo(() => deal.proposal?.body ?? "", [deal.proposal]);
  return (
    <Section label="Pilot proposal">
      {deal.proposal ? (
        <div className="rounded-md ring-1 ring-border">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-[13px] font-medium text-fg">
              <ChevronDown className={cn("size-3.5 text-fg-3 transition-transform duration-200", !open && "-rotate-90")} aria-hidden />
              One-page proposal · {shortDate(deal.proposal.generatedAt)}
            </button>
            <CopyButton text={body} />
            <Button size="xs" variant="ghost" onClick={() => void draft()} disabled={!!active || pending}>
              Redraft
            </Button>
          </div>
          {open && <Markdown className="px-4 py-3">{body}</Markdown>}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="agent" size="sm" icon={<FileText className="size-3.5" />} onClick={() => void draft()} loading={!!active || pending}>
            Pilot proposal
          </Button>
          <span className="text-[12px] text-fg-3">One page: their problem in their words, success criteria, scope, timeline, price options, an order-form block.</span>
        </div>
      )}
      {run && (active || run.status === "error") && <WorkLog run={run} className="mt-3" />}
    </Section>
  );
}
