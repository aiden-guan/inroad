"use client";

import { AnimatePresence, motion, useIsPresent } from "motion/react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useContext, useId, useState } from "react";
import { ReferralWrite } from "@/components/compose/composer";
import { Button } from "@/components/ui/button";
import { CheckStamp } from "@/components/ui/fx";
import { Input, Label } from "@/components/ui/field";
import { Menu, MenuItem, MenuLabel, MenuSeparator } from "@/components/ui/menu";
import { cn } from "@/lib/client/cn";
import type { Action } from "@/lib/domain/actions";
import { addDays, newId, nowISO } from "@/lib/domain/ids";
import type { Account, Person, ReplyIntent, SkipReason, Workspace } from "@/lib/domain/types";
import { ago, localDate, shortDay } from "@/lib/moves/util";
import { INTENTS, INTENT_LABEL, type IntentRead } from "@/lib/replies/intent";
import { dueLabel, type LaneActionId, type LaneRow } from "@/lib/replies/lane";
import { ease, spring } from "@/lib/motion";
import { MoveExits } from "./move-card";
import { DraftOrCompose, Quote, UnsubscribeBody } from "./move-body";
import { SkipReasons } from "./parts";

/**
 * The replies lane: every reply that needs the founder, in one compact list above the moves, most urgent first. A
 * row says how the reply reads (and why, on hover), when an answer is due, their words, and the actions that fit,
 * numbered 1–4. Enter opens it in place: their words, the note they answered, and the draft or the form that
 * finishes it. Nothing is sent from here.
 */

const TONE: Record<ReplyIntent | "unread", string> = {
  positive: "bg-success-subtle text-success ring-transparent",
  info_request: "bg-info-subtle text-info ring-transparent",
  objection: "bg-warning-subtle text-warning ring-transparent",
  referral: "bg-accent-subtle text-accent-text ring-transparent",
  not_now: "bg-bg-subtle text-fg-2 ring-border",
  negative: "bg-bg-subtle text-fg-2 ring-border",
  unsubscribe: "bg-danger-subtle text-danger ring-transparent",
  ooo: "bg-transparent text-fg-3 ring-border-strong/70",
  unread: "bg-transparent text-fg-3 ring-border-strong/70",
};

const VENDOR: Record<string, string> = { instantly: "Instantly", smartlead: "Smartlead", lemlist: "lemlist" };

/** Where a read came from, in a sentence. */
export function readWhy(read: IntentRead): string {
  switch (read.by) {
    case "founder":
      return "You set this.";
    case "model":
      return "Read by the model while drafting your reply.";
    case "code":
      return read.cue ? `Read in code from “${read.cue}”` : "Read in code.";
    case "vendor":
      return read.source ? `Labeled by ${VENDOR[read.source] ?? read.source}.` : "Labeled when it was logged.";
    default:
      return "Not read yet. Drafting reads it.";
  }
}

function IntentChip({ read, name, onChange }: { read: IntentRead; name: string; onChange: (intent: ReplyIntent | null) => void }) {
  const label = read.intent ? INTENT_LABEL[read.intent] : "Unread";
  const why = readWhy(read);
  return (
    <Menu
      align="start"
      trigger={
        <button
          type="button"
          title={why}
          aria-label={`${name}'s reply reads as ${label}. ${why} Change it`}
          className={cn(
            "relative z-10 inline-flex h-5 max-w-full items-center gap-0.5 rounded-xs px-1.5 text-[12px] font-medium ring-1 ring-inset transition-[filter] duration-150 hover:brightness-95 focus-visible:outline-2 focus-visible:outline-[var(--ring)]",
            TONE[read.intent ?? "unread"],
          )}
        >
          <span className="truncate">{label}</span>
          <ChevronDown aria-hidden className="size-3 shrink-0 opacity-60" />
        </button>
      }
    >
      <MenuLabel>
        <span className="block max-w-64 whitespace-normal font-normal leading-4">{why}</span>
      </MenuLabel>
      {INTENTS.map((i) => (
        <MenuItem key={i} onSelect={() => onChange(i)} hint={read.intent === i ? "Current" : undefined}>
          {INTENT_LABEL[i]}
        </MenuItem>
      ))}
      {read.by === "founder" && (
        <>
          <MenuSeparator />
          <MenuItem onSelect={() => onChange(null)}>Go back to the read</MenuItem>
        </>
      )}
    </Menu>
  );
}

/** The second line: their words, or for an auto-reply when they're back and who covers. */
function lineOf(row: LaneRow): string {
  if (row.read.intent === "ooo") return `Back ${row.backOn ? shortDay(row.backOn) : "soon"}${row.delegate ? ` · ${row.delegate} covers` : ""}`;
  return row.snippet ? `“${row.snippet}”` : row.reply.summary;
}

const agentAction = (id: LaneActionId) => id === "draft" || id === "refer";

/** The person a referral names, as the actions that add them (and their company if it's new). Mirrors the composer's ReferralWrite. */
export function referralActions(ws: Workspace, row: LaneRow, patch: { name?: string; email?: string; title?: string } = {}): { actions: Action[]; person: Person } | null {
  const r = { ...row.referral, ...patch };
  const name = r.name?.trim() || (r.email ? r.email.split("@")[0] : "");
  if (!name || !row.referral) return null;
  if (row.referral.personId && !patch.name && !patch.email && ws.people[row.referral.personId]) return { actions: [], person: ws.people[row.referral.personId] };
  const domain = row.referral.domain;
  const actions: Action[] = [];
  const via = row.person?.name ?? "a referral";
  if (!ws.accounts[domain]) {
    const account: Account = {
      domain,
      name: domain.split(".")[0].replace(/^./, (c) => c.toUpperCase()),
      status: "new",
      source: "referral",
      sourceDetail: `Referred by ${via}`,
      addedAt: nowISO(),
      fitScore: 0,
      tier: "C",
      criteria: [],
      signals: [],
      whyNow: null,
      whyNowScore: 0,
      peopleIds: [],
      warmPathCount: 0,
      watch: false,
    };
    actions.push({ type: "account.add", account });
  }
  const email = r.email?.trim().toLowerCase() || undefined;
  const person: Person = {
    id: newId("per"),
    accountDomain: domain,
    name,
    title: r.title?.trim() ?? "",
    email,
    evidenceIds: [],
    confidence: "medium",
    mayHaveLeft: false,
    contactPaths: email ? [{ kind: "published_email", value: email, via, verified: false, founderConfirmed: true }] : [],
    jurisdiction: "unknown",
    doNotContact: false,
    notes: `Referred by ${via} in a reply on ${shortDay(localDate(row.reply.at))}`,
    source: "referral",
  };
  actions.push({ type: "person.upsert", person });
  return { actions, person };
}

export interface LaneProps {
  ws: Workspace;
  rows: LaneRow[];
  now: number;
  today: string;
  weekStart: string;
  focusId: string | null;
  expandedId: string | null;
  skipFor: string | null;
  open: boolean;
  /** Replies settled today. */
  cleared: number;
  reveal: boolean;
  bindRow: (id: string, el: HTMLButtonElement | null) => void;
  onToggleOpen: () => void;
  onFocus: (id: string) => void;
  onToggle: (id: string) => void;
  onAction: (row: LaneRow, action: LaneActionId) => void;
  onIntent: (row: LaneRow, intent: ReplyIntent | null) => void;
  onSkip: (row: LaneRow, reason: SkipReason) => void;
  onSkipCancel: () => void;
  /** The row's own work finished it (a draft marked sent, a suppression): no toast. */
  onComplete: (row: LaneRow) => void;
  onChanged: () => void;
  /** The open row finished expanding: scroll it into view. */
  onOpened: (id: string) => void;
}

export function RepliesLane(p: LaneProps) {
  const { rows } = p;
  if (!rows.length) return null;
  const late = rows.filter((r) => (r.dueIn ?? 1) < 0).length;
  const dueToday = rows.filter((r) => r.dueIn === 0).length;
  const lead = rows[0];
  return (
    <section className="mt-7" aria-label="Replies">
      <div className="mb-2 flex min-h-7 items-center justify-between gap-3">
        <button
          type="button"
          onClick={p.onToggleOpen}
          aria-expanded={p.open}
          className="-ml-1.5 inline-flex min-w-0 items-center gap-1.5 rounded-sm px-1.5 py-1 text-[13px] font-medium text-fg transition-colors hover:bg-bg-subtle"
        >
          <ChevronRight aria-hidden className={cn("size-3.5 shrink-0 text-fg-3 transition-transform duration-150", p.open && "rotate-90")} />
          Replies
          <span className="font-mono text-[12px] tnum text-fg-3">{rows.length}</span>
          {(late > 0 || dueToday > 0) && (
            <span className={cn("truncate font-normal", late ? "text-danger" : "text-fg-2")}>
              · {late ? `${late} late` : `${dueToday} due today`}
              {late && dueToday ? `, ${dueToday} due today` : ""}
            </span>
          )}
          {!p.open && <span className="hidden truncate font-normal text-fg-3 sm:inline">· {lead.name}</span>}
        </button>
        {p.cleared > 0 && <span className="shrink-0 font-mono text-[12px] tnum text-fg-3">{p.cleared} cleared today</span>}
      </div>
      {p.open && <LaneList {...p} />}
    </section>
  );
}

function LaneList(p: LaneProps) {
  return (
    <ul className="overflow-hidden rounded-xl bg-surface shadow-xs ring-1 ring-inset ring-border">
      <AnimatePresence initial={p.reveal}>
        {p.rows.map((row, i) => (
          <LaneItem key={row.move.id} row={row} index={i} {...p} />
        ))}
      </AnimatePresence>
    </ul>
  );
}

function LaneItem({ row, index, ...p }: LaneProps & { row: LaneRow; index: number }) {
  const id = row.move.id;
  const focused = p.focusId === id;
  const expanded = p.expandedId === id;
  const exits = useContext(MoveExits);
  const present = useIsPresent();
  const leaving = present ? undefined : exits[id];
  const due = dueLabel(row);
  const late = (row.dueIn ?? 1) < 0;
  return (
    <motion.li
      data-move={id}
      layout="position"
      initial={p.reveal ? { opacity: 0, y: 4 } : { opacity: 0 }}
      animate={{ opacity: 1, y: 0, transition: p.reveal ? { duration: 0.26, ease: ease.out, delay: 0.1 + Math.min(index, 6) * 0.04 } : { duration: 0.15 } }}
      exit={
        leaving === "skip"
          ? { opacity: 0, height: 0, transition: { opacity: { duration: 0.12 }, default: { duration: 0.22, ease: ease.inOut } } }
          : { opacity: 0, height: 0, transition: { opacity: { delay: 0.32, duration: 0.14 }, default: { delay: 0.36, duration: 0.26, ease: ease.inOut } } }
      }
      transition={spring.layout}
      onPointerDownCapture={() => p.onFocus(id)}
      // A click anywhere in the row keeps focus on the desk, where the number keys live.
      tabIndex={-1}
      className="relative scroll-mt-24 scroll-mb-6 overflow-hidden border-t border-border outline-none first:border-t-0"
    >
      <div className={cn("relative flex gap-3 px-4 py-2.5 transition-colors duration-150 md:px-5", focused && "draft-wash")}>
        <div className="hidden w-[96px] shrink-0 pt-px sm:block">
          {leaving === "done" ? <CheckStamp size={18} /> : <IntentChip read={row.read} name={row.firstName || row.name} onChange={(intent) => p.onIntent(row, intent)} />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="shrink-0 sm:hidden">
              <IntentChip read={row.read} name={row.firstName || row.name} onChange={(intent) => p.onIntent(row, intent)} />
            </span>
            <h3 className="min-w-0 truncate text-[13.5px] font-medium leading-5 text-fg">
              <button
                ref={(el) => p.bindRow(id, el)}
                type="button"
                onFocus={() => p.onFocus(id)}
                onClick={() => p.onToggle(id)}
                aria-expanded={expanded}
                className="text-left outline-none after:absolute after:inset-0 after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-[var(--ring)]"
              >
                <span className={cn("relative transition-colors duration-300", leaving === "done" && "text-fg-3")}>
                  {row.name} <span className="font-normal text-fg-3">· {row.company}</span>
                </span>
              </button>
            </h3>
            <span className="ml-auto shrink-0 whitespace-nowrap font-mono text-[12px] tnum text-fg-3" title={`Received ${new Date(row.reply.at).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`}>
              {ago(row.reply.at, new Date(p.now))}
              {due && <span className={cn("font-sans", late ? "font-medium text-danger" : row.dueIn === 0 ? "text-fg-2" : "")}> · {due}</span>}
            </span>
          </div>
          <div className="mt-1 flex flex-col gap-1.5 md:flex-row md:items-center md:gap-3">
            <p className="min-w-0 flex-1 truncate text-[13px] leading-5 text-fg-2" title={row.reply.body ?? row.reply.summary}>
              {lineOf(row)}
            </p>
            {!leaving && (
              <div className="relative z-10 flex shrink-0 flex-wrap items-center gap-1" role="group" aria-label={`Actions for ${row.name}'s reply`}>
                {row.actions.map((a, i) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      p.onFocus(id);
                      p.onAction(row, a.id);
                    }}
                    className={cn(
                      "inline-flex h-6 items-center gap-1 rounded-sm px-1.5 text-[12px] font-medium transition-[background-color,color,transform] duration-150 active:scale-[0.97]",
                      i === 0
                        ? agentAction(a.id)
                          ? "bg-accent text-accent-fg shadow-btn hover:bg-accent-hover"
                          : "bg-primary text-primary-fg shadow-btn hover:bg-primary-hover"
                        : "text-fg-2 ring-1 ring-inset ring-border hover:bg-bg-subtle hover:text-fg",
                    )}
                  >
                    <kbd className={cn("hidden min-w-3 font-mono text-[12px] md:pointer-fine:inline", i === 0 ? "opacity-70" : "text-fg-3")}>{i + 1}</kbd>
                    {a.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {p.skipFor === id && <SkipReasons onPick={(r) => p.onSkip(row, r)} onCancel={p.onSkipCancel} />}

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0, transition: { duration: 0.15 } }}
            transition={spring.smooth}
            onAnimationComplete={(def) => {
              if (typeof def === "object" && def && "height" in def && (def as { height?: unknown }).height === "auto") p.onOpened(id);
            }}
            className="overflow-hidden"
          >
            <div className="border-t border-border px-4 pb-4 pt-4 sm:pl-[124px] md:px-5 md:pl-[128px]">
              <LaneBody row={row} {...p} focused={focused} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.li>
  );
}

/** What their reply answered: your note, when it went, its first lines. */
function InReplyTo({ row }: { row: LaneRow }) {
  const [more, setMore] = useState(false);
  const t = row.touch;
  if (!t) return null;
  const text = t.body ?? t.summary;
  return (
    <div className="text-[12.5px] leading-[19px] text-fg-3">
      <button type="button" onClick={() => setMore((m) => !m)} aria-expanded={more} className="inline-flex items-center gap-1 hover:text-fg-2">
        <ChevronRight aria-hidden className={cn("size-3 transition-transform duration-150", more && "rotate-90")} />
        In reply to your note of {shortDay(localDate(t.at))}
      </button>
      {more && <p className="mt-1 whitespace-pre-wrap border-l border-border pl-3 text-fg-2 animate-[fade-in_150ms_var(--ease-out)]">{text}</p>}
      {!more && <p className="mt-0.5 truncate pl-4">{text}</p>}
    </div>
  );
}

function DateAction({ label, value, min, onChange, cta, onSubmit, note }: { label: string; value: string; min: string; onChange: (v: string) => void; cta: string; onSubmit: () => void; note?: string }) {
  const id = useId();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (value && value >= min) onSubmit();
      }}
      className="flex flex-wrap items-end gap-2"
    >
      <div>
        <Label htmlFor={id}>{label}</Label>
        <Input id={id} type="date" value={value} min={min} onChange={(e) => onChange(e.target.value)} className="w-40 font-mono text-[12.5px]" />
      </div>
      <Button type="submit" size="sm" variant="primary" disabled={!value || value < min}>
        {cta}
      </Button>
      {note && <span className="pb-2 text-[12px] text-fg-3">{note}</span>}
    </form>
  );
}

/** The open row: their words, the note they answered, and the one thing that finishes it. */
function LaneBody({ row, ws, now, today, weekStart, focused, onComplete, onChanged, onAction }: LaneProps & { row: LaneRow; focused: boolean }) {
  const [until, setUntil] = useState(row.backOn ?? row.revisitOn ?? addDays(today, 7));
  const intent = row.read.intent;
  const person = row.person;
  const text = row.reply.body ?? row.reply.summary;
  const props = { move: row.move, ws, now, today, weekStart, focused, onComplete: () => onComplete(row), onChanged };
  const reply = person ? (
    <DraftOrCompose
      {...props}
      compose={{ domain: person.accountDomain, personId: person.id, mode: "reply", replyText: text, receivedAt: row.reply.at }}
      label={intent === null ? `Read it and draft a reply to ${row.firstName}` : `Draft a reply to ${row.firstName}`}
      lead={
        intent === "positive"
          ? "They're interested. Offer two specific times and keep it under 80 words."
          : intent === "info_request"
            ? "Answer the question in their words first, then offer a time."
            : intent === "objection"
              ? "The draft leans on your approved objection answers. One reason, then a question."
              : intent === "negative"
                ? "A short, kind close. No pitch, no follow-up."
                : intent === null
                  ? "I'll read it first, then draft the answer that fits."
                  : undefined
      }
    />
  ) : null;

  return (
    <div className="space-y-4">
      <Quote text={text} who={`${row.name}${person?.title ? `, ${person.title}` : ""} · ${ago(row.reply.at, new Date(now))}`} />
      <InReplyTo row={row} />
      {intent === "unsubscribe" && person ? (
        <UnsubscribeBody reply={row.reply} person={person} now={now} onComplete={() => onComplete(row)} quote={false} />
      ) : intent === "ooo" ? (
        <DateAction
          label="Hold follow-ups until"
          value={until}
          min={addDays(today, 1)}
          onChange={setUntil}
          cta="Hold them"
          note={row.delegate ? `${row.delegate} covers while they're out.` : undefined}
          onSubmit={() => onAction({ ...row, backOn: until }, "hold")}
        />
      ) : intent === "not_now" ? (
        <div className="space-y-4">
          <DateAction
            label="Check back on"
            value={until}
            min={addDays(today, 1)}
            onChange={setUntil}
            cta="Check back then"
            note={row.revisitGuessed ? "They named no time, so this is two months out." : "The day they named."}
            onSubmit={() => onAction({ ...row, revisitOn: until }, "revisit")}
          />
          {reply}
        </div>
      ) : intent === "referral" ? (
        <div className="space-y-4">
          {row.referral?.personId ? (
            <DraftOrCompose
              {...props}
              compose={{ domain: row.referral.domain, personId: row.referral.personId, mode: "cold", referredBy: row.reply.personId }}
              label={`Draft a note to ${row.referral.name?.split(" ")[0] ?? "them"}`}
              lead={`A note that says ${row.firstName} sent you is the warmest first touch there is.`}
            />
          ) : row.referral?.name ? (
            <ReferralWrite ws={ws} name={row.referral.name} email={row.referral.email} referrerId={row.reply.personId} fallbackDomain={row.domain} how={`in a reply on ${shortDay(localDate(row.reply.at))}`} className="mt-0" />
          ) : (
            <p className="text-[13px] text-fg-3">I couldn&apos;t tell who they named. Add them from {row.company}&apos;s page, then write to them here.</p>
          )}
          <div className="space-y-2">
            <p className="text-[12px] font-medium text-fg-3">Thank {row.firstName}</p>
            {reply}
          </div>
        </div>
      ) : (
        reply
      )}
    </div>
  );
}
