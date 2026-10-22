import { todayISO, weekOf } from "@/lib/domain/ids";
import type { Activity, Guest, ISODate, Workspace } from "@/lib/domain/types";
import { localDate } from "@/lib/moves/util";

/**
 * The cold cap, counted one way everywhere: Today's quota for new first touches, the pre-send gate,
 * the scoreboard and the guest list all read this. A cold first touch is step 1 of a cold package,
 * sent by hand or handed to a sequencer (pushed or exported), plus an email invite to an event guest
 * with no warm path (W11: cold invites count against the weekly cap). Follow-ups, replies, LinkedIn
 * and intro asks never count, and neither does a touch marked "didn't send".
 */

/** The send a cold activity stands for, so a step pushed to a sequencer and later marked sent counts once. */
function capKey(ws: Workspace, a: Activity): string | null {
  if (a.kind === "touch_sent" || a.kind === "pushed") {
    if (a.kind === "touch_sent" && (a.outcome === "not_sent" || a.channel === "linkedin")) return null;
    // A deleted person's touch keeps what it was (its draft is gone): it still used a slot.
    const ref = a.draftRef ?? a.forgotten?.draft;
    const mode = a.draftRef ? ws.outreach[a.draftRef.packageId]?.mode : a.forgotten?.draft?.mode;
    if (!ref || ref.step !== 1 || mode !== "cold") return null;
    return `pkg:${ref.packageId}`;
  }
  if (a.kind === "event_invited" && a.eventId && a.channel !== "linkedin") {
    const guests = Object.values(ws.events[a.eventId]?.guests ?? {});
    const g = guests.find((x) => (a.personId ? x.personId === a.personId : !!a.accountDomain && x.accountDomain === a.accountDomain));
    // A removed guest can't say whether the invite was warm; only invites we know were cold count.
    if (!g || g.warmPath) return null;
    return `inv:${a.eventId}:${g.id}`;
  }
  return null;
}

/** Whether an activity uses a slot of the cold cap. */
export function countsAgainstCap(ws: Workspace, a: Activity): boolean {
  return capKey(ws, a) !== null;
}

/** Cold first touches whose (first) send falls in [from, until], local dates. */
export function coldFirstTouches(ws: Workspace, range: { from: ISODate; until?: ISODate }): number {
  const firstAt = new Map<string, string>();
  for (const a of ws.activities) {
    const key = capKey(ws, a);
    if (!key) continue;
    const prev = firstAt.get(key);
    if (!prev || a.at < prev) firstAt.set(key, a.at);
  }
  let n = 0;
  for (const at of firstAt.values()) {
    const d = localDate(at);
    if (d >= range.from && (!range.until || d <= range.until)) n++;
  }
  return n;
}

/** This week's (Mon–Sun) and today's cold first touches against the caps. */
export function capUsage(ws: Workspace, today = todayISO()) {
  const thisWeek = coldFirstTouches(ws, { from: weekOf(today) });
  const todayCount = coldFirstTouches(ws, { from: today, until: today });
  return {
    thisWeek,
    today: todayCount,
    remainingWeek: Math.max(0, ws.caps.firstTouchesPerWeek - thisWeek),
    remainingToday: Math.max(0, Math.min(ws.caps.firstTouchesPerDayMax, ws.caps.firstTouchesPerWeek) - todayCount),
  };
}

/**
 * Marking a guest with no warm path invited by email uses a cold-cap slot, the same as a first touch. When the
 * week's (or the day's) slots are already gone, say which: the invite has gone, so the record stays true, but the
 * next cold ones should wait.
 */
export function inviteOverCap(ws: Workspace, guest: Pick<Guest, "warmPath">, today = todayISO()): "week" | "day" | null {
  if (guest.warmPath) return null;
  const u = capUsage(ws, today);
  return u.remainingWeek <= 0 ? "week" : u.remainingToday <= 0 ? "day" : null;
}
