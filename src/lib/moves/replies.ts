import { addBusinessDays, addDays, daysBetween, todayISO } from "@/lib/domain/ids";
import { OPEN_STAGES, type Activity, type Deal, type Person, type ReplyIntent, type Workspace } from "@/lib/domain/types";
import { companyName, daysSince, emailOf, isOpen, isSuppressed, localDate } from "./util";

/**
 * "Check replies": there's no inbox access, so approving a draft counts as sent and the founder
 * reconciles once a day: one Gmail search for everyone touched in 14 days, then R / N / B / U per person.
 * Threads still waiting on a time (a yes the founder answered, nothing booked) stay in that search
 * past 14 days, until the call is booked or the loop is closed.
 */

export const REPLY_WINDOW_DAYS = 14;

export interface AwaitingPerson {
  personId: string;
  person?: Person;
  name: string;
  domain: string;
  company: string;
  email?: string;
  /** Unmarked email touches, oldest first. */
  touches: Activity[];
  lastAt: string;
  /** "First touch" / "Follow-up 2" / "Your reply". */
  lastLabel: string;
  /** They said yes and nothing is booked yet: kept in the search past 14 days. */
  awaitingTime?: boolean;
}

function touchLabel(ws: Workspace, a: Activity): string {
  if (!a.draftRef) return "Your email";
  if (ws.outreach[a.draftRef.packageId]?.mode === "reply") return "Your reply";
  const step = a.draftRef.step;
  return step <= 1 ? "First touch" : `Follow-up ${step - 1}`;
}

export function awaitingOutcome(ws: Workspace, now: Date): AwaitingPerson[] {
  const today = todayISO(now);
  const since = addDays(today, -REPLY_WINDOW_DAYS);
  const waiting = new Set(bookingLoops(ws, now).map((l) => l.personId));
  const lastReply = new Map<string, string>();
  for (const a of ws.activities) {
    if (a.kind === "reply_received" && a.personId && (!lastReply.has(a.personId) || a.at > lastReply.get(a.personId)!)) lastReply.set(a.personId, a.at);
  }
  const byPerson = new Map<string, Activity[]>();
  for (const a of ws.activities) {
    if (a.kind !== "touch_sent" || !a.personId || a.outcome) continue;
    if (a.channel && a.channel !== "email") continue;
    if (localDate(a.at) < since && !(waiting.has(a.personId) && localDate(a.at) >= addDays(today, -BOOKING_LOOP_DAYS))) continue;
    const replied = lastReply.get(a.personId);
    if (replied && replied > a.at) continue;
    byPerson.set(a.personId, [...(byPerson.get(a.personId) ?? []), a]);
  }
  const out: AwaitingPerson[] = [];
  for (const [personId, touches] of byPerson) {
    touches.sort((x, y) => x.at.localeCompare(y.at));
    const person = ws.people[personId];
    const last = touches[touches.length - 1];
    const domain = person?.accountDomain ?? last.accountDomain ?? "";
    out.push({
      personId,
      person,
      name: person?.name ?? "Unknown contact",
      domain,
      company: companyName(ws, domain),
      email: emailOf(person),
      touches,
      lastAt: last.at,
      lastLabel: touchLabel(ws, last),
      ...(waiting.has(personId) ? { awaitingTime: true } : {}),
    });
  }
  return out.sort((a, b) => a.lastAt.localeCompare(b.lastAt));
}

/** How far back one search has to look to cover every row (14 days, or more for threads waiting on a time). */
export function searchDays(people: AwaitingPerson[], today: string): number {
  const oldest = people.flatMap((p) => p.touches.map((t) => localDate(t.at))).sort()[0];
  return Math.max(REPLY_WINDOW_DAYS, oldest ? daysBetween(oldest, today) + 1 : 0);
}

/* ───────────── A yes, answered, nothing booked ───────────── */

/** How long an answered yes is chased before it drops off (the card asks to close it out well before). */
export const BOOKING_LOOP_DAYS = 60;
/** Working days after the founder's answer before the first nudge, and between nudges. */
export const BOOKING_NUDGE_AFTER = { first: 2, next: 3 } as const;
/** Nudges before the card asks to decide: book it, park it, or let it go. */
export const BOOKING_NUDGES = 2;

export interface BookingLoop {
  personId: string;
  person: Person;
  domain: string;
  company: string;
  /** Their yes ("positive"), or "send me info". */
  reply: Activity;
  intent: Extract<ReplyIntent, "positive" | "info_request">;
  /** The founder's first answer after it. */
  answeredAt: string;
  /** The founder's latest touch since (the answer, or the last nudge). */
  lastTouch: Activity;
  /** Founder touches after the answer. */
  nudges: number;
  /** When the next nudge, or the decision, is due. */
  dueOn: string;
  /** The open deal it rides on, when there is one. */
  dealId?: string;
}

const FOUNDER_TOUCH = new Set<Activity["kind"]>(["touch_sent", "linkedin_dm", "intro_requested"]);

/** How a reply was read: by the reply draft that answered it, else by its logged sentiment. */
function intentOf(ws: Workspace, reply: Activity): ReplyIntent | undefined {
  const pkg = Object.values(ws.outreach).find(
    (p) => p.mode === "reply" && p.personId === reply.personId && !!p.reply && (p.reply.receivedAt === reply.at || (!!reply.body && p.reply.text === reply.body.slice(0, 4000))),
  );
  if (pkg?.reply) return pkg.reply.intent;
  return reply.sentiment === "positive" ? "positive" : undefined;
}

/**
 * Interested prospects the founder answered whose call isn't booked: the loop stays open until a
 * meeting is on the deal's calendar (or one was held), the deal is parked, lost or won, or a dated
 * next step they agreed to covers it. Their latest reply decides: a later "not now" closes it.
 */
export function bookingLoops(ws: Workspace, now: Date): BookingLoop[] {
  const today = todayISO(now);
  const latest = new Map<string, Activity>();
  for (const a of ws.activities) {
    if (a.kind !== "reply_received" || !a.personId) continue;
    const prev = latest.get(a.personId);
    if (!prev || a.at > prev.at) latest.set(a.personId, a);
  }
  const out: BookingLoop[] = [];
  for (const [personId, reply] of latest) {
    const intent = intentOf(ws, reply);
    if (intent !== "positive" && intent !== "info_request") continue;
    const person = ws.people[personId];
    if (!person || isSuppressed(ws, person)) continue;
    const touches = ws.activities.filter((a) => a.personId === personId && FOUNDER_TOUCH.has(a.kind) && a.at > reply.at && a.outcome !== "not_sent").sort((x, y) => x.at.localeCompare(y.at));
    if (!touches.length) continue; // not answered yet: the reply card asks for that
    const last = touches[touches.length - 1];
    if (daysSince(last.at, today) > BOOKING_LOOP_DAYS) continue;
    const domain = person.accountDomain;
    const deal: Deal | undefined = ws.deals[ws.accounts[domain]?.dealId ?? ""];
    const replyMs = new Date(reply.at).getTime();
    if (deal?.meetingIds.some((id) => new Date(ws.meetings[id]?.startsAt ?? 0).getTime() >= replyMs)) continue;
    if (ws.activities.some((a) => a.kind === "meeting_held" && a.accountDomain === domain && a.at > reply.at)) continue;
    if (deal && !OPEN_STAGES.includes(deal.stage) && deal.stageHistory.some((h) => h.at > reply.at)) continue;
    if (isOpen(deal) && deal.nextStep?.buyerAgreed && deal.nextStep.date >= today) continue;
    const nudges = touches.length - 1;
    out.push({
      personId,
      person,
      domain,
      company: companyName(ws, domain),
      reply,
      intent,
      answeredAt: touches[0].at,
      lastTouch: last,
      nudges,
      dueOn: addBusinessDays(localDate(last.at), nudges === 0 ? BOOKING_NUDGE_AFTER.first : BOOKING_NUDGE_AFTER.next),
      ...(isOpen(deal) ? { dealId: deal.id } : {}),
    });
  }
  return out.sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.personId.localeCompare(b.personId));
}

/** A one-line nudge with times, built in code from the founder's availability (zero tokens). */
export function bookingNudge(ws: Workspace, loop: BookingLoop): string {
  const first = loop.person.name.trim().split(/\s+/)[0] || "there";
  const availability = ws.founder.availability?.trim();
  const link = ws.founder.schedulingUrl?.trim();
  if (loop.intent === "info_request") return `Hi ${first}, following up on my last note. Is this worth 20 minutes now, or should I check back next quarter?`;
  const times = availability ? `I'm free ${availability}. Does any time there work for 20 minutes?` : "Would Tuesday or Wednesday afternoon next week work for 20 minutes?";
  return `Hi ${first}, picking this back up. ${times}${link ? ` Or grab a time that suits here: ${link}` : ""}`;
}

/* ───────────── Gmail search deep links ───────────── */

const MAX_URL = 1800;

export function gmailBase(authUser?: string): string {
  return `https://mail.google.com/mail/u/${encodeURIComponent(authUser?.trim() || "0")}/`;
}

/** `from:{a@x.com b@y.com} newer_than:14d` — braces mean OR in Gmail search. */
export function gmailQuery(emails: string[], days = REPLY_WINDOW_DAYS): string {
  return `from:{${emails.join(" ")}} newer_than:${days}d`;
}

/** One search covering everyone, split into several links so each stays under ~1,800 characters. */
export function gmailSearchLinks(emails: string[], authUser?: string, days = REPLY_WINDOW_DAYS): { url: string; query: string; count: number }[] {
  const unique = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter((e) => e.includes("@")))];
  const base = `${gmailBase(authUser)}#search/`;
  const links: { url: string; query: string; count: number }[] = [];
  let chunk: string[] = [];
  const build = (list: string[]) => {
    const query = gmailQuery(list, days);
    return { url: base + encodeURIComponent(query), query, count: list.length };
  };
  for (const email of unique) {
    const next = [...chunk, email];
    if (chunk.length && build(next).url.length > MAX_URL) {
      links.push(build(chunk));
      chunk = [email];
    } else {
      chunk = next;
    }
  }
  if (chunk.length) links.push(build(chunk));
  return links;
}
