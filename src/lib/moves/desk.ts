import { addDays, todayISO } from "@/lib/domain/ids";
import type { ID, ISODate, Move, Person, Workspace } from "@/lib/domain/types";
import { stepNudge, waitingOn } from "./radar";
import { TOP_MOVES } from "./rules";
import { clockTime, companyName, first, localDate, plural } from "./util";

/**
 * How Today lays out what's visible: replies in their own lane, the top moves, every overdue move after them (an
 * overdue card never folds under Later), then Later. One function, so the page, the sidebar count and the tests agree.
 */

export interface Desk {
  /** Reply cards with the reply they answer on file: the lane. */
  replies: Move[];
  top: Move[];
  /** Overdue moves past the top five: shown, never folded. */
  overdue: Move[];
  later: Move[];
}

export function deskLayout(visible: Move[], ws?: Pick<Workspace, "activities">): Desk {
  const ids = ws ? new Set(ws.activities.filter((a) => a.kind === "reply_received").map((a) => a.id)) : null;
  const isLane = (m: Move) => m.kind === "reply" && !!m.activityId && (!ids || ids.has(m.activityId));
  const replies = visible.filter(isLane);
  const rest = visible.filter((m) => !isLane(m));
  const top = rest.slice(0, TOP_MOVES);
  const after = rest.slice(TOP_MOVES);
  return { replies, top, overdue: after.filter((m) => (m.overdueDays ?? 0) > 0), later: after.filter((m) => !((m.overdueDays ?? 0) > 0)) };
}

export interface Progress {
  done: number;
  total: number;
  replies: { done: number; total: number };
}

/** Settled by the founder today: finished, skipped, or put off past today. Engine auto-closes don't count. */
function settledToday(m: Move, today: ISODate): boolean {
  if (!m.settledAt || localDate(m.settledAt) !== today) return false;
  if (m.status === "done") return !m.autoDone;
  if (m.status === "skipped") return true;
  return m.status === "snoozed" && (m.snoozedUntil ?? "") > today;
}

/** Today's progress: what the founder settled today against that plus what's still on the desk. */
export function deskProgress(moves: Record<ID, Move>, visible: Move[], today: ISODate): Progress {
  const settled = Object.values(moves).filter((m) => settledToday(m, today));
  const lane = (m: Move) => m.kind === "reply";
  return {
    done: settled.length,
    total: settled.length + visible.length,
    replies: { done: settled.filter(lane).length, total: settled.filter(lane).length + visible.filter(lane).length },
  };
}

export interface NextItem {
  key: string;
  /** "Tomorrow", "Mon", "Today 3:00 PM". */
  when: string;
  text: string;
  date: ISODate;
  href?: string;
}

const dayWord = (date: ISODate, today: ISODate) =>
  date === today ? "Later today" : date === addDays(today, 1) ? "Tomorrow" : new Date(`${date}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

/**
 * What comes next once the desk is clear, so Today never dead-ends: the next meeting, the first card due on a later
 * day (or back from a snooze), and the next reminder that comes due. Soonest first, three at most.
 */
export function nextUp(ws: Workspace, now: Date): NextItem[] {
  const today = todayISO(now);
  const out: NextItem[] = [];
  const nowIso = now.toISOString();
  const meeting = Object.values(ws.meetings)
    .filter((m) => m.startsAt > nowIso && !m.title.startsWith("Canceled:"))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
  if (meeting) {
    const date = localDate(meeting.startsAt);
    const domain = ws.deals[meeting.dealId]?.accountDomain;
    out.push({
      key: `mtg:${meeting.id}`,
      when: `${date === today ? "Today" : dayWord(date, today)} ${clockTime(meeting.startsAt)}`,
      text: `${meeting.title}${meeting.attendees.length ? ` with ${meeting.attendees.map((a) => first(a.name)).filter(Boolean).slice(0, 2).join(" and ")}` : ""}`,
      date,
      href: domain ? `/companies?c=${encodeURIComponent(domain)}` : undefined,
    });
  }
  const upcoming = Object.values(ws.moves)
    .map((m) => ({ m, on: m.status === "snoozed" && m.snoozedUntil && m.snoozedUntil > today ? m.snoozedUntil : m.status === "open" && m.dueOn > today ? m.dueOn : null }))
    .filter((x): x is { m: Move; on: ISODate } => !!x.on)
    .sort((a, b) => a.on.localeCompare(b.on) || b.m.priority - a.m.priority)[0];
  if (upcoming) out.push({ key: `mv:${upcoming.m.id}`, when: dayWord(upcoming.on, today), text: upcoming.m.title, date: upcoming.on });
  const reminder = waitingOn(ws, now).find((w) => !w.due);
  if (reminder) {
    out.push({
      key: `rem:${reminder.touch.id}`,
      when: dayWord(reminder.remindOn, today),
      text: `Follow up with ${first(reminder.name)} at ${companyName(ws, reminder.domain)} if there's no reply`,
      date: reminder.remindOn,
      href: `/companies?c=${encodeURIComponent(reminder.domain)}`,
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date)).slice(0, 3);
}

/** "3 of 8 done · 2 replies cleared": the calm line under the moves heading. */
export function progressLine(p: Progress): string {
  const parts = [`${p.done} of ${p.total} done`];
  if (p.replies.done) parts.push(`${plural(p.replies.done, "reply", "replies")} cleared`);
  return parts.join(" · ");
}

/**
 * Who "until they reply" waits on for a card: the person it's about, or for a deal the contact who owes the next step
 * (else its first contact). Undefined for cards that aren't about anyone (reviews, setup, research).
 */
export function waitFor(ws: Workspace, move: Move, now: Date): Person | undefined {
  if (move.kind === "reply") return undefined;
  if (move.ref?.kind === "person") return ws.people[move.ref.id];
  if (move.ref?.kind === "deal") {
    const deal = ws.deals[move.ref.id];
    if (!deal) return undefined;
    return stepNudge(ws, deal, now)?.person ?? deal.contacts.map((c) => ws.people[c.personId]).find((p): p is Person => !!p && !p.doNotContact);
  }
  return undefined;
}
