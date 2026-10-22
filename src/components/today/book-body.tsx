"use client";

import { ArrowUpRight, Check } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { copyText, gmailFromUrl } from "@/components/compose/handoff";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/field";
import { CopyButton } from "@/components/ui/misc";
import { newDeal } from "@/lib/deals/rules";
import type { Action } from "@/lib/domain/actions";
import { addDays, newId, nowISO } from "@/lib/domain/ids";
import type { Meeting } from "@/lib/domain/types";
import { BOOKING_NUDGES, bookingLoops, bookingNudge, type BookingLoop } from "@/lib/moves/replies";
import { ago, first, localDate } from "@/lib/moves/util";
import { signOff } from "@/lib/quality/gates";
import type { BodyProps } from "./move-body";
import { HoldButton } from "./parts";

const pad = (n: number) => String(n).padStart(2, "0");
/** Tomorrow at 10:00, local, for a datetime-local input. */
function tomorrowAtTen(today: string): string {
  return `${addDays(today, 1)}T${pad(10)}:00`;
}

/**
 * "Book Dana: said yes Oct 12, no time picked". The interested prospect who went quiet after the
 * founder offered times: one short nudge with times (written in code from the founder's
 * availability), the meeting once they pick one, or a clean close-out. Nothing here drops the lead
 * silently; each path ends in a booked call, a dated check-back, or a decision.
 */
export function BookBody({ move, ws, now, today, focused, onComplete, onSnooze }: BodyProps) {
  const loop = bookingLoops(ws, new Date(now)).find((l) => l.reply.id === move.activityId);
  if (!loop) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-[13.5px] leading-[21px] text-fg-2">Nothing to chase: a time is booked or this was closed out.</p>
        <Button variant="ghost" onClick={onComplete}>
          Done
        </Button>
      </div>
    );
  }
  return <Booking key={`${loop.reply.id}:${loop.nudges}`} loop={loop} move={move} ws={ws} now={now} today={today} focused={focused} onComplete={onComplete} onSnooze={onSnooze} />;
}

const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

function Booking({ loop, move, ws, now, today, focused, onComplete, onSnooze }: Pick<BodyProps, "move" | "ws" | "now" | "today" | "focused" | "onComplete" | "onSnooze"> & { loop: BookingLoop }) {
  const { dispatch } = useWorkspace();
  const id = useId();
  const name = first(loop.person.name) || "them";
  const decide = loop.nudges >= BOOKING_NUDGES;
  const deal = loop.dealId ? ws.deals[loop.dealId] : undefined;
  const email = loop.person.email ?? loop.person.contactPaths.find((c) => c.value.includes("@") && !c.bounced)?.value;
  const viaLinkedIn = loop.lastTouch.channel === "linkedin";
  const [text, setText] = useState(() => bookingNudge(ws, loop));
  const [mode, setMode] = useState<"nudge" | "booked" | "park" | "let_go">(decide ? "booked" : "nudge");
  const [when, setWhen] = useState(() => tomorrowAtTen(today));
  const [until, setUntil] = useState(() => addDays(today, 30));
  const so = signOff(ws);
  const outgoing = `${text.trim()}${so ? `\n\n${so}` : ""}`;

  const nudged = async () => {
    const activityId = newId("act");
    const ok = await dispatch({
      type: "activity.log",
      activity: {
        id: activityId,
        at: nowISO(),
        kind: viaLinkedIn ? "linkedin_dm" : "touch_sent",
        personId: loop.personId,
        accountDomain: loop.domain,
        dealId: loop.dealId,
        channel: viaLinkedIn ? "linkedin" : "email",
        summary: `Nudged ${loop.person.name} to pick a time`,
        body: text.trim(),
        source: "founder",
      },
    });
    if (!ok) return;
    onComplete();
    toast(`Logged the nudge to ${name}. I'll bring it back if no time is picked.`, {
      duration: 10_000,
      action: { label: "Undo", onClick: () => void dispatch([{ type: "activity.remove", id: activityId }, { type: "move.reopen", id: move.id }]) },
    });
  };

  const booked = async () => {
    const startsAt = new Date(when);
    if (Number.isNaN(startsAt.getTime())) return;
    const at = nowISO();
    const actions: Action[] = [];
    let dealId = deal?.id;
    if (!dealId) {
      const acc = ws.accounts[loop.domain];
      if (!acc) return;
      const d = { ...newDeal(acc, newId("deal"), at), contacts: [{ personId: loop.personId, role: loop.person.role }] };
      actions.push({ type: "deal.create", deal: d });
      dealId = d.id;
    }
    const meeting: Meeting = {
      id: newId("mtg"),
      dealId,
      title: `${loop.company} <> ${ws.company?.name ?? "us"}`,
      startsAt: startsAt.toISOString(),
      attendees: [{ personId: loop.personId, name: loop.person.name, title: loop.person.title || undefined }],
    };
    actions.push({ type: "meeting.upsert", meeting });
    actions.push({ type: "deal.setNextStep", id: dealId, nextStep: { what: `Call with ${name}`, date: localDate(meeting.startsAt), buyerAgreed: true }, at });
    if (await dispatch(actions)) {
      onComplete();
      toast(`Booked. The call with ${name} is on the ${loop.company} deal.`);
    }
  };

  const park = async () => {
    const parked = `Parked until ${new Date(`${until}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}. I'll bring ${name} back then.`;
    if (deal) {
      if (!(await dispatch({ type: "deal.setStage", id: deal.id, stage: "nurture", nurtureUntil: until, at: nowISO() }))) return;
      onComplete();
      toast(parked);
      return;
    }
    // No deal to park: the card itself sleeps until then (and leaves the desk now), never marked done.
    if (onSnooze) onSnooze(until);
    else if (!(await dispatch({ type: "move.snooze", id: move.id, until }))) return;
    toast(parked, { duration: 10_000, action: { label: "Undo", onClick: () => void dispatch({ type: "move.reopen", id: move.id }) } });
  };

  const letGo = async () => {
    if (deal) {
      const ok = await dispatch({ type: "deal.setStage", id: deal.id, stage: "lost", lossReason: "went_dark", at: nowISO() });
      if (!ok) return;
      onComplete();
      toast(`Closed ${loop.company} as lost: went dark.`);
      return;
    }
    // No deal to close: the reply itself is marked, so neither Today nor Check replies chases it again.
    const ok = await dispatch({ type: "activity.closeLoop", id: loop.reply.id, at: nowISO() });
    if (!ok) return;
    onComplete();
    toast(`Let ${name} go. I won't bring this one back.`, {
      duration: 10_000,
      action: { label: "Undo", onClick: () => void dispatch([{ type: "activity.closeLoop", id: loop.reply.id, at: null }, { type: "move.reopen", id: move.id }]) },
    });
  };

  // A marks the nudge as sent, like approving a draft: the card's own way to finish (Today stands down for it).
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    keyRef.current = (e) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || typing(e.target) || e.key.toLowerCase() !== "a") return;
      if (document.querySelector('[role="dialog"]')) return;
      if (mode !== "nudge" || !text.trim()) return;
      e.preventDefault();
      void nudged();
    };
  });
  useEffect(() => {
    if (!focused) return;
    const listener = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [focused]);

  const said = loop.intent === "positive" ? `said yes ${ago(loop.reply.at, new Date(now))}` : `asked for more ${ago(loop.reply.at, new Date(now))}`;
  return (
    <div className="space-y-4">
      <figure className="border-l-2 border-border-strong pl-3">
        <blockquote className="line-clamp-3 whitespace-pre-wrap text-[14px] leading-[22px] text-fg">{loop.reply.body ?? loop.reply.summary}</blockquote>
        <figcaption className="mt-1 text-[12px] text-fg-3">
          {loop.person.name} {said}
        </figcaption>
      </figure>
      <p className="max-w-[62ch] text-[13.5px] leading-[21px] text-fg-2">
        {decide
          ? `Two nudges and still no time. Close the loop: add the call if ${name} booked somewhere else, park it with a date, or let it go.`
          : "Nothing is on the calendar yet. Interested people go quiet all the time; one short line with times usually gets the call booked. Send it, then mark it as sent here so I know when to check again."}
      </p>

      {mode === "nudge" && (
        <div className="space-y-2.5">
          <div className="draft-rule rounded-r-md py-2 pl-3.5 pr-2">
            <Label htmlFor={`${id}-nudge`} className="sr-only">
              Nudge to {name}
            </Label>
            <Textarea id={`${id}-nudge`} value={text} onChange={(e) => setText(e.target.value)} className="min-h-20 text-[15px] leading-6 ring-border" />
            {so && <p className="mt-1.5 text-[15px] leading-6 text-fg-2">{so}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {email && !viaLinkedIn && (
              <Button
                size="sm"
                variant="secondary"
                icon={<ArrowUpRight className="size-3.5" />}
                onClick={async () => {
                  await copyText(outgoing);
                  window.open(gmailFromUrl(ws, email), "_blank", "noopener,noreferrer");
                  toast("Copied. Paste it as a reply in your thread with them, then press Mark as sent.");
                }}
              >
                Open thread in Gmail
              </Button>
            )}
            <CopyButton text={outgoing} className="h-7" />
            <Button size="sm" variant="primary" icon={<Check className="size-3.5" />} kbd={focused ? "A" : undefined} onClick={() => void nudged()} disabled={!text.trim()}>
              Mark as sent
            </Button>
          </div>
        </div>
      )}

      {mode === "booked" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void booked();
          }}
          className="flex flex-wrap items-end gap-2 animate-[fade-in_150ms_var(--ease-out)]"
        >
          <div>
            <Label htmlFor={`${id}-when`}>When is the call?</Label>
            <Input id={`${id}-when`} type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="w-auto font-mono text-[12.5px]" />
          </div>
          <Button type="submit" size="sm" variant="primary" disabled={!when}>
            Add the meeting
          </Button>
        </form>
      )}

      {mode === "park" && (
        <div className="flex flex-wrap items-end gap-2 animate-[fade-in_150ms_var(--ease-out)]">
          <div>
            <Label htmlFor={`${id}-until`}>Check back on</Label>
            <Input id={`${id}-until`} type="date" value={until} min={today} onChange={(e) => setUntil(e.target.value)} className="w-40 font-mono text-[12.5px]" />
          </div>
          <Button size="sm" variant="primary" onClick={() => void park()}>
            Park it
          </Button>
        </div>
      )}

      {mode === "let_go" && (
        <div className="flex flex-wrap items-center gap-3 animate-[fade-in_150ms_var(--ease-out)]">
          {deal ? (
            <HoldButton onConfirm={() => void letGo()}>Hold to close as lost</HoldButton>
          ) : (
            <Button size="sm" variant="secondary" onClick={() => void letGo()}>
              Let it go
            </Button>
          )}
          <span className="text-[12px] text-fg-3">{deal ? "Lost, went dark. It stays on the timeline." : "I'll stop chasing this one."}</span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]">
        {mode !== "nudge" && !decide && <ModeLink onClick={() => setMode("nudge")}>Nudge {name} instead</ModeLink>}
        {mode !== "booked" && <ModeLink onClick={() => setMode("booked")}>They picked a time</ModeLink>}
        {mode !== "park" && <ModeLink onClick={() => setMode("park")}>Not now: check back later</ModeLink>}
        {mode !== "let_go" && <ModeLink onClick={() => setMode("let_go")}>Let it go</ModeLink>}
      </div>
    </div>
  );
}

function ModeLink({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="text-fg-2 underline-offset-4 hover:text-fg hover:underline">
      {children}
    </button>
  );
}
