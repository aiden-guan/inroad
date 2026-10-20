import { addDays, todayISO, weekOf } from "@/lib/domain/ids";
import type { Activity, Scoreboard, Workspace } from "@/lib/domain/types";
import { isOpen, localDate } from "./util";

/**
 * Counts in code, never by the model. "Conversations held" is the number that matters; emails sent
 * is never shown. Rates hide below n=20 and dollars hide until a price has been quoted.
 */

export const INTRO_ASKS_PER_WEEK = 4;

/** A cold-email first touch: step 1 of a cold package, actually sent (not reverted as "didn't send"). */
export function isColdFirstTouch(ws: Workspace, a: Activity): boolean {
  if (a.kind !== "touch_sent" || a.outcome === "not_sent") return false;
  if (!a.draftRef || a.draftRef.step !== 1) return false;
  return ws.outreach[a.draftRef.packageId]?.mode === "cold";
}

export interface Counters {
  today: string;
  weekStart: string;
  coldThisWeek: number;
  coldToday: number;
  /** Distinct people touched per account this week (cap: contactsPerAccountPerWeek). */
  peopleThisWeek: Map<string, Set<string>>;
  introAsksThisWeek: number;
}

export function counters(ws: Workspace, now: Date): Counters {
  const today = todayISO(now);
  const weekStart = weekOf(today);
  let coldThisWeek = 0;
  let coldToday = 0;
  let introAsksThisWeek = 0;
  const peopleThisWeek = new Map<string, Set<string>>();
  for (const a of ws.activities) {
    const day = localDate(a.at);
    if (day < weekStart) continue;
    if (isColdFirstTouch(ws, a)) {
      coldThisWeek++;
      if (day === today) coldToday++;
    }
    if (a.kind === "intro_requested") introAsksThisWeek++;
    if (a.kind === "touch_sent" && a.accountDomain && a.personId && a.outcome !== "not_sent") {
      const set = peopleThisWeek.get(a.accountDomain) ?? new Set<string>();
      set.add(a.personId);
      peopleThisWeek.set(a.accountDomain, set);
    }
  }
  return { today, weekStart, coldThisWeek, coldToday, peopleThisWeek, introAsksThisWeek };
}

/** Cold first touches still allowed today (the smaller of the weekly and daily headroom). */
export function coldQuotaLeft(ws: Workspace, c: Counters): number {
  return Math.max(0, Math.min(ws.caps.firstTouchesPerWeek - c.coldThisWeek, ws.caps.firstTouchesPerDayMax - c.coldToday));
}

export function conversationsTarget(ws: Workspace): number {
  return ws.foundation?.channelPlan?.funnel?.perWeek?.conversations || ws.goal.conversationsPerWeek || 10;
}

/** Meetings held in [from, until] plus logged "meeting held" activities that no meeting record covers. */
export function conversationsBetween(ws: Workspace, from: string, until: Date): number {
  const untilMs = until.getTime();
  const fromMs = new Date(`${from}T00:00:00`).getTime();
  const held = Object.values(ws.meetings).filter((m) => {
    const t = new Date(m.startsAt).getTime();
    return t >= fromMs && t <= untilMs;
  });
  const covered = new Set(held.map((m) => `${m.dealId}:${localDate(m.startsAt)}`));
  const logged = ws.activities.filter((a) => {
    if (a.kind !== "meeting_held") return false;
    const t = new Date(a.at).getTime();
    return t >= fromMs && t <= untilMs && !covered.has(`${a.dealId}:${localDate(a.at)}`);
  });
  return held.length + logged.length;
}

export function isQualified(ws: Workspace, dealId: string): boolean {
  const d = ws.deals[dealId];
  if (!isOpen(d)) return false;
  if (d.stage !== "talking") return true;
  return !!d.qualification?.qualified || ((d.qualification?.total ?? 0) >= 8 && !!d.nextStep?.date);
}

/** Paid pilots or design partners: won deals, plus pilots/proposals whose pilot is paid. */
export function goalWins(ws: Workspace): number {
  return Object.values(ws.deals).filter((d) => d.stage === "won" || ((d.stage === "pilot" || d.stage === "proposal") && d.pilot?.paid)).length;
}

export function dealsMissingNextStep(ws: Workspace, today: string): string[] {
  return Object.values(ws.deals)
    .filter((d) => isOpen(d) && (!d.nextStep?.date || d.nextStep.date < today))
    .map((d) => d.id);
}

export function computeScoreboard(ws: Workspace, now: Date): Scoreboard {
  const c = counters(ws, now);
  const weekStart = c.weekStart;
  const inWeek = (iso: string) => localDate(iso) >= weekStart;

  const repliesThisWeek = ws.activities.filter((a) => a.kind === "reply_received" && inWeek(a.at));
  const meetingsBooked = Object.values(ws.meetings).filter((m) => localDate(m.startsAt) >= weekStart && localDate(m.startsAt) < addDays(weekStart, 7)).length;

  const open = Object.values(ws.deals).filter(isOpen);
  const qualified = open.filter((d) => isQualified(ws, d.id));
  const priced = Object.values(ws.deals).some((d) => (d.priceQuotes?.length ?? 0) > 0);

  // Reply rate over the trailing 28 days of first touches, by person; hidden below n=20.
  const since = addDays(c.today, -28);
  const touched = new Map<string, string>();
  for (const a of ws.activities) {
    if (!isColdFirstTouch(ws, a) || !a.personId || localDate(a.at) < since) continue;
    if (!touched.has(a.personId) || a.at < touched.get(a.personId)!) touched.set(a.personId, a.at);
  }
  let replied = 0;
  for (const [personId, firstAt] of touched) {
    if (ws.activities.some((a) => a.kind === "reply_received" && a.personId === personId && a.at > firstAt)) replied++;
  }
  const n = touched.size;

  const sb: Scoreboard = {
    weekOf: weekStart,
    conversations: [conversationsBetween(ws, weekStart, now), conversationsTarget(ws)],
    firstTouches: [c.coldThisWeek, ws.caps.firstTouchesPerWeek],
    replies: repliesThisWeek.length,
    positiveReplies: repliesThisWeek.filter((a) => a.sentiment === "positive").length,
    meetingsBooked,
    qualifiedDeals: qualified.length,
    dealsMissingNextStep: dealsMissingNextStep(ws, c.today).length,
    goalProgress: [goalWins(ws), ws.goal.target],
    introAsks: [c.introAsksThisWeek, INTRO_ASKS_PER_WEEK],
  };
  if (n >= 20) sb.replyRate = { value: replied / n, n };
  if (priced) {
    sb.qualifiedPipelineUsd = qualified.reduce((sum, d) => sum + (d.amountUsd ?? d.priceQuotes?.at(-1)?.amountUsd ?? 0), 0);
  }
  return sb;
}

/** n < 20 anecdote (rates hidden), 20–99 directional, ≥100 reliable. */
export function sampleLabel(n: number): "anecdote" | "directional" | "reliable" {
  return n >= 100 ? "reliable" : n >= 20 ? "directional" : "anecdote";
}
