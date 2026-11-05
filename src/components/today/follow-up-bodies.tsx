"use client";

import { ArrowUpRight, Check } from "lucide-react";
import Link from "next/link";
import { useId, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { copyText, gmailComposeUrl } from "@/components/compose/handoff";
import { DraftView } from "@/components/compose/composer";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/field";
import { CopyButton } from "@/components/ui/misc";
import type { Action } from "@/lib/domain/actions";
import { addBusinessDays, addDays, newId, nowISO } from "@/lib/domain/ids";
import { OPEN_STAGES, STAGE_LABELS, type Deal, type Intro, type Meeting, type Person, type Stage } from "@/lib/domain/types";
import { targetLabel, type IntroNext } from "@/lib/intros/rules";
import { messageFor } from "@/lib/intros/templates";
import { bumpText, checkBackText, sentWhat, stepNudge, waitingOn } from "@/lib/moves/radar";
import { companyName, emailOf, first, localDate, shortDay } from "@/lib/moves/util";
import { DealResolver } from "./deal-resolver";
import type { BodyProps } from "./move-body";
import { ModeLink, NudgeComposer, TheyReplied } from "./nudge";
import { HoldButton } from "./parts";

function Lead({ children }: { children: ReactNode }) {
  return <p className="max-w-[62ch] text-[13.5px] leading-[21px] text-fg-2">{children}</p>;
}

function Links({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]">{children}</div>;
}

/** The note a follow-up follows up on: when it went and what it said, in a few lines. */
function SentNote({ when, what, body }: { when: string; what: string; body?: string }) {
  return (
    <figure className="border-l-2 border-border pl-3">
      <figcaption className="text-[12px] text-fg-3">
        {what} · {when}
      </figcaption>
      {body && <blockquote className="mt-0.5 line-clamp-3 whitespace-pre-wrap text-[13.5px] leading-[21px] text-fg-2">{body}</blockquote>}
    </figure>
  );
}

const upper = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * A reminder came due: nothing back since the founder's note. The bump is written in code and names that note; the
 * deal's next step can be set instead, a reply that did come can be pasted, or the reminder dropped. No bare Done.
 */
export function RemindBody({ move, ws, now, today, focused, onComplete, onChanged }: BodyProps) {
  const { dispatch } = useWorkspace();
  const [mode, setMode] = useState<"bump" | "step">("bump");
  const w = waitingOn(ws, new Date(now)).find((x) => `mv_remind_${x.touch.id}` === move.id);
  if (!w) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Lead>They wrote back, or a later note replaced this one. Nothing to chase.</Lead>
        <Button variant="ghost" onClick={onComplete}>
          Done
        </Button>
      </div>
    );
  }
  const deal: Deal | undefined = w.dealId ? ws.deals[w.dealId] : undefined;
  const name = first(w.person.name) || "them";
  const stop = async () => {
    if (!(await dispatch({ type: "activity.setRemind", id: w.touch.id, on: null }))) return;
    onComplete();
    toast(`Stopped the reminder for ${name}.`, { duration: 8_000, action: { label: "Undo", onClick: () => void dispatch([{ type: "activity.setRemind", id: w.touch.id, on: w.remindOn }, { type: "move.reopen", id: move.id }]) } });
  };
  return (
    <div className="space-y-4">
      <SentNote when={shortDay(localDate(w.first.at))} what={upper(sentWhat(ws, w.first))} body={w.first.body ?? w.first.summary} />
      <Lead>
        {w.sends > 1 ? `${w.sends} notes and no reply.` : "No reply yet."} A short bump that names your note and asks one question gets answered more often than a new pitch.
      </Lead>
      {mode === "bump" || !deal ? (
        <NudgeComposer
          key={w.touch.id}
          ws={ws}
          person={w.person}
          domain={w.domain}
          dealId={w.dealId}
          initial={bumpText(ws, w, today)}
          summary={`Followed up with ${w.person.name}`}
          label={`Follow-up to ${name}`}
          focused={focused}
          moveId={move.id}
          channel={w.touch.channel}
          onSent={onComplete}
        />
      ) : (
        <DealResolver deal={deal} today={today} company={companyName(ws, deal.accountDomain)} onResolved={onComplete} />
      )}
      <Links>
        {deal && <ModeLink onClick={() => setMode((m) => (m === "bump" ? "step" : "bump"))}>{mode === "bump" ? "Set a next step instead" : "Write the bump instead"}</ModeLink>}
        <TheyReplied
          person={w.person}
          domain={w.domain}
          dealId={w.dealId}
          touchIds={[w.touch.id]}
          onLogged={() => {
            onChanged();
            onComplete();
          }}
        />
        <ModeLink onClick={() => void stop()}>Stop reminding</ModeLink>
      </Links>
    </div>
  );
}

/** A not-now's check-back day came: one short note, park it again with a date, or let it go. */
export function CheckBackBody({ move, ws, today, focused, onComplete, onSnooze }: BodyProps) {
  const { dispatch } = useWorkspace();
  const id = useId();
  const [parking, setParking] = useState(false);
  const [until, setUntil] = useState(() => addDays(today, 30));
  const reply = ws.activities.find((a) => a.id === move.activityId);
  const person = reply?.personId ? ws.people[reply.personId] : undefined;
  if (!reply || !person) return <Lead>This reply is no longer in your workspace.</Lead>;
  const name = first(person.name) || "them";
  const park = async () => {
    if (!until || until <= today) return;
    if (!(await dispatch({ type: "activity.setHold", id: reply.id, until }))) return;
    onSnooze?.(until);
    toast(`Parked until ${shortDay(until)}. I'll bring ${name} back then.`, {
      duration: 8_000,
      action: { label: "Undo", onClick: () => void dispatch([{ type: "activity.setHold", id: reply.id, until: reply.holdUntil ?? null }, { type: "move.reopen", id: move.id }]) },
    });
  };
  return (
    <div className="space-y-4">
      <figure className="border-l-2 border-border-strong pl-3">
        <blockquote className="line-clamp-3 whitespace-pre-wrap text-[14px] leading-[22px] text-fg">{reply.body ?? reply.summary}</blockquote>
        <figcaption className="mt-1 text-[12px] text-fg-3">
          {person.name} · {shortDay(localDate(reply.at))}
        </figcaption>
      </figure>
      <NudgeComposer ws={ws} person={person} domain={person.accountDomain} initial={checkBackText(ws, reply)} summary={`Checked back with ${person.name}`} label={`Check-back note to ${name}`} focused={focused} moveId={move.id} onSent={onComplete} />
      {parking && (
        <div className="flex flex-wrap items-end gap-2 animate-[fade-in_150ms_var(--ease-out)]">
          <div>
            <Label htmlFor={`${id}-until`}>Check back on</Label>
            <Input id={`${id}-until`} type="date" value={until} min={addDays(today, 1)} onChange={(e) => setUntil(e.target.value)} className="w-40 font-mono text-[12.5px]" />
          </div>
          <Button size="sm" variant="primary" disabled={!until || until <= today} onClick={() => void park()}>
            Park it
          </Button>
        </div>
      )}
      <Links>
        {!parking && <ModeLink onClick={() => setParking(true)}>Not yet: park it again</ModeLink>}
        <ModeLink onClick={onComplete}>Let it go</ModeLink>
      </Links>
    </div>
  );
}

/** The open stage a parked deal left from, so reopening puts it back where it was. */
function stageBefore(deal: Deal): Stage {
  const before = [...deal.stageHistory].reverse().find((h) => OPEN_STAGES.includes(h.stage));
  return before?.stage ?? "talking";
}

/**
 * A parked deal's check-back day, or a not-now reply's: write to them, then reopen the deal, park it again with a
 * date, or close it. There's no bare Done: that used to drop a parked deal from Today for good.
 */
export function NurtureBody({ move, ws, today, focused, onComplete, onSnooze }: BodyProps) {
  const { dispatch } = useWorkspace();
  const id = useId();
  const [mode, setMode] = useState<"note" | "park" | "lost">("note");
  const [until, setUntil] = useState(() => addDays(today, 60));
  const deal = move.ref?.kind === "deal" ? ws.deals[move.ref.id] : undefined;
  const contact = deal ? deal.contacts.map((c) => ws.people[c.personId]).find((p): p is Person => !!p && !p.doNotContact && !!emailOf(p)) : move.ref?.kind === "person" ? ws.people[move.ref.id] : undefined;
  const company = companyName(ws, deal?.accountDomain ?? contact?.accountDomain);
  if (!deal && !contact) return <Lead>This deal is no longer in your workspace.</Lead>;
  const name = first(contact?.name);
  const note = name ? `Hi ${name}, you asked me to check back around now. Has anything changed on your side since we last spoke, and is this worth another look this quarter?` : "";

  const park = async () => {
    if (!until || until <= today) return;
    if (deal) {
      if (!(await dispatch({ type: "deal.setStage", id: deal.id, stage: "nurture", nurtureUntil: until, at: nowISO() }))) return;
      onComplete();
    } else onSnooze?.(until);
    toast(`Parked until ${shortDay(until)}. I'll bring ${company} back then.`);
  };
  const reopen = async () => {
    if (!deal) return;
    const stage = stageBefore(deal);
    if (!(await dispatch({ type: "deal.setStage", id: deal.id, stage, at: nowISO() }))) return;
    onComplete();
    toast(`${company} is back at ${STAGE_LABELS[stage]}. Today will ask for its next step.`);
  };
  return (
    <div className="space-y-4">
      <Lead>
        {deal?.nurtureUntil ? `Parked until ${shortDay(deal.nurtureUntil)}. ` : ""}
        Check back with one short, specific note, then decide where it stands: reopen it, park it again with a date, or close it.
      </Lead>
      {mode === "note" && contact && (
        <NudgeComposer ws={ws} person={contact} domain={contact.accountDomain} dealId={deal?.id} initial={note} summary={`Checked back with ${contact.name}`} label={`Check-back note to ${name}`} focused={focused} moveId={move.id} onSent={onComplete} />
      )}
      {mode === "note" && !contact && <Lead>No one on this deal has an address on file. Open the company to add one, or decide below.</Lead>}
      {mode === "park" && (
        <div className="flex flex-wrap items-end gap-2 animate-[fade-in_150ms_var(--ease-out)]">
          <div>
            <Label htmlFor={`${id}-until`}>Check back on</Label>
            <Input id={`${id}-until`} type="date" value={until} min={addDays(today, 1)} onChange={(e) => setUntil(e.target.value)} className="w-40 font-mono text-[12.5px]" />
          </div>
          <Button size="sm" variant="primary" disabled={!until || until <= today} onClick={() => void park()}>
            Park it
          </Button>
        </div>
      )}
      {mode === "lost" && deal && (
        <div className="flex flex-wrap items-center gap-3 animate-[fade-in_150ms_var(--ease-out)]">
          <HoldButton
            onConfirm={async () => {
              if (await dispatch({ type: "deal.setStage", id: deal.id, stage: "lost", lossReason: "timing", at: nowISO() })) onComplete();
            }}
          >
            Hold to close as lost
          </HoldButton>
          <span className="text-[12px] text-fg-3">Lost, timing. It stays on the timeline.</span>
        </div>
      )}
      <Links>
        {mode !== "note" && contact && <ModeLink onClick={() => setMode("note")}>Write to {name}</ModeLink>}
        {deal && <ModeLink onClick={() => void reopen()}>Reopen the deal</ModeLink>}
        {mode !== "park" && <ModeLink onClick={() => setMode("park")}>Park it again</ModeLink>}
        {deal && mode !== "lost" && <ModeLink onClick={() => setMode("lost")}>Close as lost</ModeLink>}
        {!deal && <ModeLink onClick={onComplete}>Let it go</ModeLink>}
        {deal && (
          <Link href={`/companies?c=${encodeURIComponent(deal.accountDomain)}`} className="ml-auto text-fg-3 hover:text-fg">
            Open {company}
          </Link>
        )}
      </Links>
    </div>
  );
}

/**
 * A deal without a dated next step. When the step is the buyer's and it's gone late, the card leads with the nudge
 * (what the brief says to do, so the two agree) and setting a new date is the second option.
 */
export function NextStepBody({ move, ws, now, today, focused, onComplete }: BodyProps) {
  const [mode, setMode] = useState<"nudge" | "date">("nudge");
  const deal = move.ref?.kind === "deal" ? ws.deals[move.ref.id] : undefined;
  if (!deal) return <Lead>This deal is no longer in your workspace.</Lead>;
  const company = companyName(ws, deal.accountDomain);
  const nudge = stepNudge(ws, deal, new Date(now));
  if (!nudge || mode === "date") {
    return (
      <div className="space-y-3">
        <DealResolver deal={deal} today={today} company={company} onResolved={onComplete} />
        {nudge && (
          <Links>
            <ModeLink onClick={() => setMode("nudge")}>Nudge {first(nudge.person.name)} instead</ModeLink>
          </Links>
        )}
      </div>
    );
  }
  const name = first(nudge.person.name);
  return (
    <div className="space-y-4">
      <Lead>
        {name} owes the next step and it&apos;s late. One line that names it and offers help usually gets it moving; the date can change once you hear back.
      </Lead>
      <NudgeComposer ws={ws} person={nudge.person} domain={deal.accountDomain} dealId={deal.id} initial={nudge.text} summary={`Nudged ${nudge.person.name} about the next step`} label={`Nudge to ${name}`} focused={focused} moveId={move.id} onSent={onComplete} />
      <Links>
        <ModeLink onClick={() => setMode("date")}>Set a new date instead</ModeLink>
        <Link href={`/companies?c=${encodeURIComponent(deal.accountDomain)}`} className="text-fg-3 hover:text-fg">
          Open {company}
        </Link>
      </Links>
    </div>
  );
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * An intro that's waiting on a time (reply to it, follow up to book). "Meeting booked" asks when the meeting is,
 * defaulting to the next working day at 10:00, so Today doesn't ask how it went before it happened.
 */
export function IntroBookBody({ intro, next, today, onComplete }: { intro: Intro; next: IntroNext; today: string; onComplete: () => void }) {
  const { ws, dispatch } = useWorkspace();
  const id = useId();
  const [booking, setBooking] = useState(false);
  const [when, setWhen] = useState(() => `${addBusinessDays(today, 1)}T${pad(10)}:00`);
  const msg = ws && next.action ? messageFor(next.action, intro, ws, today, next.side) : null;
  const [text, setText] = useState(msg?.body ?? "");
  if (!ws || !msg || !next.action) return null;
  const t = targetLabel(intro);
  const c = first(intro.connectorName) || "your connector";
  const url = gmailComposeUrl(ws, { to: msg.to ?? null, subject: msg.subject ?? null, body: text });
  const done = async () => {
    const field = next.action === "reply" ? "repliedOn" : "nudgedOn";
    if (await dispatch({ type: "intro.mark", id: intro.id, field, at: nowISO() })) onComplete();
  };
  const booked = async () => {
    const startsAt = new Date(when);
    if (Number.isNaN(startsAt.getTime())) return;
    const at = nowISO();
    const deal = intro.accountDomain ? ws.deals[ws.accounts[intro.accountDomain]?.dealId ?? ""] : undefined;
    const person = intro.personId ? ws.people[intro.personId] : undefined;
    const actions: Action[] = [{ type: "intro.advance", id: intro.id, stage: "meeting", at, meetingOn: localDate(startsAt.toISOString()) }];
    // With a deal on file, the meeting goes on it too: Today preps it that day and asks for notes after.
    if (deal && OPEN_STAGES.includes(deal.stage)) {
      const meeting: Meeting = { id: newId("mtg"), dealId: deal.id, title: `${companyName(ws, deal.accountDomain)} intro call`, startsAt: startsAt.toISOString(), attendees: person ? [{ personId: person.id, name: person.name, title: person.title || undefined }] : [] };
      actions.push({ type: "meeting.upsert", meeting }, { type: "deal.setNextStep", id: deal.id, nextStep: { what: `Intro call with ${first(person?.name) || t}`, date: localDate(meeting.startsAt), buyerAgreed: true }, at });
    }
    if (await dispatch(actions)) {
      onComplete();
      toast(`Booked for ${startsAt.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}. I'll ask how it went after.`);
    }
  };
  return (
    <div className="space-y-3">
      <Lead>{next.action === "reply" ? `Reply all within a day: it's the first thing ${t} sees of you. Thank ${c}, move them to BCC, offer times.` : `One follow-up. If ${t} still doesn't pick a time, leave it there.`}</Lead>
      <div className="rounded-md bg-surface ring-1 ring-border">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-3 py-1.5 text-[12px] text-fg-3">
          <span>{msg.where}</span>
          {msg.to && <span className="truncate font-mono text-[11.5px]">{msg.to}</span>}
        </div>
        <Textarea value={text} onChange={(e) => setText(e.target.value)} aria-label="Message" className="min-h-24 rounded-none bg-transparent px-3 py-2.5 text-[13.5px] leading-[21px] ring-0 hover:ring-0" />
        <div className="flex flex-wrap items-center gap-2 border-t border-border px-2 py-1.5">
          {url && (
            <a href={url} target="_blank" rel="noreferrer" className="inline-flex h-7 items-center gap-1.5 rounded-sm px-2 text-[12px] font-medium text-fg-2 ring-1 ring-border transition-[background-color,transform] duration-150 hover:bg-bg-subtle active:scale-[0.97]">
              Open in Gmail <ArrowUpRight className="size-3.5" />
            </a>
          )}
          <CopyButton text={text} />
        </div>
      </div>
      {booking ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void booked();
          }}
          className="flex flex-wrap items-end gap-2 animate-[fade-in_150ms_var(--ease-out)]"
        >
          <div>
            <Label htmlFor={`${id}-when`}>When is the meeting?</Label>
            <Input id={`${id}-when`} type="datetime-local" value={when} min={`${today}T00:00`} onChange={(e) => setWhen(e.target.value)} className="w-auto font-mono text-[12.5px]" />
          </div>
          <Button type="submit" size="sm" variant="primary" disabled={!when}>
            Save the meeting
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setBooking(false)}>
            Cancel
          </Button>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            size="sm"
            icon={<Check className="size-3.5" />}
            onClick={async () => {
              await copyText(text);
              void done();
            }}
          >
            {next.action === "reply" ? "I replied" : "I followed up"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setBooking(true)}>
            Meeting booked
          </Button>
          <Button size="sm" variant="ghost" className="text-fg-3" onClick={() => void dispatch({ type: "intro.advance", id: intro.id, stage: "no_answer", at: nowISO() }).then((ok) => ok && onComplete())}>
            {first(intro.targetName) || "They"} went quiet
          </Button>
        </div>
      )}
    </div>
  );
}

/** A draft an outside agent submitted over MCP or REST: the composer, with who wrote it. A approves it. */
export function AgentDraftBody({ move, ws, focused, onComplete }: BodyProps) {
  const pkg = move.draft ? ws.outreach[move.draft.packageId] : undefined;
  if (!pkg) return <Lead>This draft is no longer in your workspace.</Lead>;
  return (
    <div className="space-y-3">
      {pkg.origin && (
        <Lead>
          {pkg.origin.keyName} wrote this{pkg.origin.note ? `: ${pkg.origin.note}` : "."} It isn&apos;t mine, so check every fact and claim before you send it.
        </Lead>
      )}
      <DraftView pkg={pkg} step={move.draft!.step} focused={focused} onApproved={onComplete} moveId={move.id} />
    </div>
  );
}
