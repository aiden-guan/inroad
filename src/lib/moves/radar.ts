import { addDays, daysBetween, todayISO } from "@/lib/domain/ids";
import { OPEN_STAGES, type Activity, type Deal, type ID, type ISODate, type Move, type Person, type Workspace } from "@/lib/domain/types";
import { senderOwnsSequence } from "@/lib/quality/sequence";
import { isAutoReply, replyPackageFor } from "@/lib/replies/intent";
import { STEP_SPACING } from "@/lib/replies/remind";
import { bookingLoops } from "./replies";
import { companyName, emailOf, first, isOpen, isSuppressed, localDate, overdueBoost, shortDay, stageMult } from "./util";

/**
 * The follow-up radar (audit 15 #4, Superhuman's remind-me). Every send marked from a draft carries "Remind me if
 * no reply" unless the founder turned it off. When the day comes and nothing came back (no reply, no meeting, no
 * booking), a card brings the thread back with a short bump written in code that names the note it follows up on.
 * Threads in a live sequence come back through the sequence's own follow-up card. Pure, zero tokens.
 */

export const REMIND = { base: 66, label: "A send's reminder came due and nothing came back" } as const;
export const CHECK_BACK = { base: 60, label: "A reply asked you to check back, and the day came" } as const;

/** What the radar watches: emails and LinkedIn messages the founder sent. Intro asks keep their own clock (Intros). */
const SENDS = new Set<Activity["kind"]>(["touch_sent", "linkedin_dm"]);
/** A thread quiet this long is history, not waiting. */
export const WAITING_DAYS = 60;

export interface Waiting {
  personId: ID;
  person: Person;
  name: string;
  company: string;
  domain: string;
  /** The latest send: the reminder rides on it. */
  touch: Activity;
  /** The first unanswered send since they last wrote: what a bump refers to. */
  first: Activity;
  /** Unanswered sends since they last wrote. */
  sends: number;
  remindOn: ISODate;
  /** "reminder": a reminder on the send. "sequence": the sequence's next step is the reminder. */
  basis: "reminder" | "sequence";
  due: boolean;
  /** An out-of-office held follow-ups until this day. */
  heldUntil?: ISODate;
  dealId?: ID;
  /** Sequence basis: the next step that comes due. */
  packageId?: ID;
  nextStep?: number;
}

/** The latest out-of-office (or "not now") hold on a person after `since`. */
export function holdFor(ws: Workspace, personId: ID | undefined, since: string): ISODate | undefined {
  if (!personId) return undefined;
  let hold: ISODate | undefined;
  for (const a of ws.activities) {
    if (a.kind === "reply_received" && a.personId === personId && a.at > since && a.holdUntil && (!hold || a.holdUntil > hold)) hold = a.holdUntil;
  }
  return hold;
}

/** Anything back from them since `since`: a real reply, a meeting held or booked, a bounce or an opt-out. */
export function heardFrom(ws: Workspace, personId: ID, domain: string | undefined, since: string, latest?: Activity): boolean {
  if (latest?.outcome === "replied" || latest?.outcome === "bounced") return true;
  for (const a of ws.activities) {
    if (a.at <= since) continue;
    if (a.personId === personId) {
      if (a.kind === "reply_received" && !isAutoReply(ws, a)) return true;
      if (a.kind === "unsubscribe" || a.kind === "bounce") return true;
      // Calendly and Cal.com bookings log a note on the person ("… booked “Intro call” for …").
      if (a.kind === "note" && a.channel === "integration" && / booked /.test(a.summary)) return true;
    }
    if (domain && a.accountDomain === domain && a.kind === "meeting_held") return true;
  }
  const deal = domain ? ws.deals[ws.accounts[domain]?.dealId ?? ""] : undefined;
  return !!deal?.meetingIds.some((id) => (ws.meetings[id]?.startsAt ?? "") > since);
}

/** When a cold sequence's next step comes due (the moves engine's own spacing), or null when it has none. */
export function sequenceNext(pkg: Workspace["outreach"][string]): { step: number; due: ISODate } | null {
  if ((pkg.mode !== "cold" && pkg.mode !== "follow_up") || senderOwnsSequence(pkg) || pkg.steps.some((s) => s.status === "cancelled_by_reply")) return null;
  const sent = pkg.steps.filter((s) => s.status === "sent" || s.status === "approved").sort((a, b) => a.step - b.step);
  if (!sent.length) return null;
  const last = sent[sent.length - 1];
  if (last.step >= 3) return null;
  const nextNo = last.step + 1;
  const firstOn = localDate(sent[0].sentAt ?? pkg.createdAt);
  const draft = pkg.steps.find((s) => s.step === nextNo && s.status === "draft");
  return { step: nextNo, due: draft?.sendOn ?? addDays(firstOn, STEP_SPACING[nextNo] ?? 4) };
}

/**
 * Everyone the founder is waiting to hear from: their latest send has a reminder (or a live sequence step) and
 * nothing has come back since. Soonest first. People a booking card already chases are left to it.
 */
export function waitingOn(ws: Workspace, now: Date): Waiting[] {
  const today = todayISO(now);
  const nowIso = now.toISOString();
  const booking = new Set(bookingLoops(ws, now).map((l) => l.personId));
  const byPerson = new Map<ID, Activity[]>();
  for (const a of ws.activities) {
    if (!SENDS.has(a.kind) || !a.personId || a.outcome === "not_sent" || a.at > nowIso) continue;
    byPerson.set(a.personId, [...(byPerson.get(a.personId) ?? []), a]);
  }
  const out: Waiting[] = [];
  for (const [personId, sends] of byPerson) {
    const person = ws.people[personId];
    if (!person || booking.has(personId) || isSuppressed(ws, person)) continue;
    sends.sort((a, b) => a.at.localeCompare(b.at));
    const touch = sends[sends.length - 1];
    if (daysBetween(localDate(touch.at), today) > WAITING_DAYS) continue;
    const domain = person.accountDomain;
    if (heardFrom(ws, personId, domain, touch.at, touch)) continue;
    if (touch.remindOn === null) continue; // the founder chose not to chase this one
    const pkg = touch.draftRef ? ws.outreach[touch.draftRef.packageId] : undefined;
    const seq = pkg ? sequenceNext(pkg) : null;
    const held = holdFor(ws, personId, touch.at);
    let remindOn: ISODate | undefined = touch.remindOn ?? seq?.due;
    if (!remindOn) continue;
    if (held && held > remindOn) remindOn = held;
    // The thread starts after their last real word.
    const lastWord = ws.activities
      .filter((a) => a.kind === "reply_received" && a.personId === personId && !isAutoReply(ws, a))
      .reduce((m, a) => (a.at > m ? a.at : m), "");
    const unanswered = sends.filter((s) => s.at > lastWord);
    const dealId = ws.accounts[domain]?.dealId;
    out.push({
      personId,
      person,
      name: person.name,
      company: companyName(ws, domain),
      domain,
      touch,
      first: unanswered[0] ?? touch,
      sends: unanswered.length,
      remindOn,
      basis: seq ? "sequence" : "reminder",
      due: remindOn <= today,
      ...(held ? { heldUntil: held } : {}),
      ...(dealId && isOpen(ws.deals[dealId]) ? { dealId } : {}),
      ...(seq && pkg ? { packageId: pkg.id, nextStep: seq.step } : {}),
    });
  }
  return out.sort((a, b) => a.remindOn.localeCompare(b.remindOn) || a.name.localeCompare(b.name));
}

/** What a send was, said to the founder ("your recap") or in the bump itself ("my recap"). */
export function sentWhat(ws: Workspace, a: Activity, voice: "you" | "me" = "you"): string {
  const mine = voice === "me" ? "my" : "your";
  const pkg = a.draftRef ? ws.outreach[a.draftRef.packageId] : undefined;
  if (pkg?.mode === "reply") return `${mine} reply`;
  if (a.kind === "linkedin_dm") return `${mine} LinkedIn message`;
  if (pkg && a.draftRef!.step > 1) return `${mine} follow-up`;
  const s = a.summary ?? "";
  if (/\brecap\b/i.test(s)) return `${mine} recap`;
  if (/\b(proposal|order form)\b/i.test(s)) return "the proposal";
  if (/\b(one-pager|deck)\b/i.test(s)) return voice === "me" ? "the one-pager I sent" : "the one-pager";
  return `${mine} note`;
}

/** The subject the thread started with, when the send came from a draft that had one. */
function subjectOf(ws: Workspace, a: Activity): string | undefined {
  const pkg = a.draftRef ? ws.outreach[a.draftRef.packageId] : undefined;
  const subject = pkg?.steps.find((s) => s.step === 1)?.subject?.trim();
  return subject || undefined;
}

const lowerFirst = (s: string) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);

/**
 * The bump, written in code (zero tokens) and always editable: it names the note it follows up on and ends on one
 * question that fits where things stand. Never "just checking in".
 */
export function bumpText(ws: Workspace, w: Waiting, today: ISODate): string {
  const name = first(w.person.name) || "there";
  const about = subjectOf(ws, w.first);
  const deal = w.dealId ? ws.deals[w.dealId] : undefined;
  const opener = `Hi ${name}, following up on ${sentWhat(ws, w.first, "me")} from ${shortDay(localDate(w.first.at))}${about ? ` about “${about}”` : ""}.`;
  let ask: string;
  if (deal?.nextStep?.date && deal.nextStep.date >= today) ask = `Are we still on for ${lowerFirst(deal.nextStep.what.trim().replace(/\.$/, ""))} on ${shortDay(deal.nextStep.date)}?`;
  else if (ws.outreach[w.touch.draftRef?.packageId ?? ""]?.mode === "reply") ask = "Did that answer your question? Happy to walk through it on a short call if that's easier.";
  else if (deal) ask = "Would a short call next week help settle the next step?";
  else ask = "Is this worth a short call, or is the timing wrong for now?";
  return `${opener} ${ask}`;
}

/* ───────────── A deal step the buyer owed, now late ───────────── */

/** Words that put a step on the buyer's side. A step that starts with the founder's verb ("Send…") is theirs. */
const BUYER_SIDE = /\b(they|their|them|legal|counsel|procurement|security|redlines?|sign(s|ed|ature)?|approv(e|al|es)|review|budget|board|feedback|back from|confirm(s)?)\b/i;
const FOUNDER_VERB = /^(send|share|draft|write|prepare|book|schedule|follow up|call|email|set up|demo)\b/i;
const HANDOFF_VERB = /^(sends?|shares?|gets?|returns?|confirms?|brings?|signs?|books?)\s+/i;

/**
 * An overdue next step the buyer owes (their name is in it, or it reads as theirs) and no meeting since its date:
 * the right move is a one-line nudge to them, not a new date. Null otherwise (a meeting that happened, a step that's
 * the founder's own, no one to write to).
 */
export function stepNudge(ws: Workspace, deal: Deal, now: Date): { person: Person; text: string } | null {
  const today = todayISO(now);
  const step = deal.nextStep;
  if (!step?.date || step.date >= today || !OPEN_STAGES.includes(deal.stage)) return null;
  const nowIso = now.toISOString();
  if (deal.meetingIds.some((id) => {
    const m = ws.meetings[id];
    return !!m && localDate(m.startsAt) >= step.date && m.startsAt <= nowIso;
  })) return null;
  const people = deal.contacts.map((c) => ws.people[c.personId]).filter((p): p is Person => !!p && !isSuppressed(ws, p) && !!emailOf(p));
  if (!people.length) return null;
  const what = step.what.trim().replace(/\.$/, "");
  const named = people.find((p) => {
    const f = first(p.name);
    return !!f && new RegExp(`\\b${f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(what);
  });
  const person = named ?? (BUYER_SIDE.test(what) && !FOUNDER_VERB.test(what) ? (people.find((p) => deal.contacts.find((c) => c.personId === p.id)?.role === "champion") ?? people[0]) : undefined);
  if (!person) return null;
  const name = first(person.name);
  const own = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+`, "i");
  const handed = own.test(what) && HANDOFF_VERB.test(what.replace(own, "")) ? what.replace(own, "").replace(HANDOFF_VERB, "") : null;
  const when = shortDay(step.date);
  const text = handed
    ? `Hi ${name}, checking in on the ${handed}, which we had down for ${when}. Is anything holding it up that I can help with?`
    : `Hi ${name}, checking in on our next step ("${what}", planned for ${when}). Is it still on track, or is anything holding it up that I can help with?`;
  return { person, text };
}

/* ───────────── Cards ───────────── */

type Card = Omit<Move, "createdAt" | "status" | "rule" | "evidenceIds" | "dueOn"> & { rule: "remind" | "check_back"; dueOn?: string; evidenceIds?: ID[] };

const sheet = (domain: string) => `/companies?c=${encodeURIComponent(domain)}`;

/**
 * Due reminders (outside a live sequence) and "check back" dates a not-now reply asked for. A reminder to a deal's
 * contact covers that deal (its subjectIds), so the deal's next-step card stands down: one card per deal.
 */
export function radarMoves(ws: Workspace, now: Date): Card[] {
  const today = todayISO(now);
  const out: Card[] = [];
  for (const w of waitingOn(ws, now)) {
    if (!w.due || w.basis !== "reminder") continue;
    const deal = w.dealId ? ws.deals[w.dealId] : undefined;
    const overdue = Math.max(0, daysBetween(w.remindOn, today));
    out.push({
      id: `mv_remind_${w.touch.id}`,
      kind: "follow_up",
      rule: "remind",
      title: `Follow up with ${first(w.person.name) || "them"} at ${w.company}`,
      why: `No reply to ${sentWhat(ws, w.touch)} since ${shortDay(localDate(w.touch.at))}${w.sends > 1 ? ` · ${w.sends} notes unanswered` : ""} · the bump is written`,
      minutes: 2,
      priority: REMIND.base * stageMult(deal?.stage) + overdueBoost(overdue),
      overdueDays: overdue || undefined,
      ref: { kind: "person", id: w.personId },
      ...(deal ? { subjectIds: [deal.id] } : {}),
      href: sheet(w.domain),
    });
  }

  // "Check back in January": the date a not-now reply was held to. One card per reply, until the founder writes again.
  const latest = new Map<ID, Activity>();
  for (const a of ws.activities) {
    if (a.kind !== "reply_received" || !a.personId || isAutoReply(ws, a)) continue;
    const prev = latest.get(a.personId);
    if (!prev || a.at > prev.at) latest.set(a.personId, a);
  }
  for (const [personId, reply] of latest) {
    const hold = reply.holdUntil;
    if (!hold || hold > today) continue;
    const person = ws.people[personId];
    if (!person || isSuppressed(ws, person)) continue;
    if (replyPackageFor(ws, reply)?.nurtureUntil) continue; // the reply draft's own check-back card covers it
    const deal = ws.deals[ws.accounts[person.accountDomain]?.dealId ?? ""];
    // A parked deal's own card brings it back; a won deal isn't a check-back. A lost one can be.
    if (deal && (deal.stage === "nurture" || deal.stage === "won")) continue;
    if (ws.activities.some((a) => a.personId === personId && SENDS.has(a.kind) && localDate(a.at) >= hold)) continue;
    const overdue = daysBetween(hold, today);
    out.push({
      id: `mv_checkback_${reply.id}`,
      kind: "next_step_missing",
      rule: "check_back",
      title: `Check back with ${first(person.name) || "them"} at ${companyName(ws, person.accountDomain)}`,
      why: `Asked you to check back ${shortDay(hold)} · one short, specific note`,
      minutes: 3,
      priority: CHECK_BACK.base + overdueBoost(Math.floor(overdue / 7)),
      overdueDays: overdue || undefined,
      ref: { kind: "person", id: personId },
      activityId: reply.id,
      href: sheet(person.accountDomain),
    });
  }
  return out;
}

/** The check-back note, written in code: names their "not now" and asks one question. */
export function checkBackText(ws: Workspace, reply: Activity): string {
  const person = reply.personId ? ws.people[reply.personId] : undefined;
  const name = first(person?.name) || "there";
  return `Hi ${name}, you asked me to check back around now. Is this a better time to look at it, or should I try again later in the year?`;
}
