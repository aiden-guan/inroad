import { addDays, todayISO } from "@/lib/domain/ids";
import type { Activity, DraftStep, OutreachPackage } from "@/lib/domain/types";

/**
 * Cold sequence: 3 emails, then one blank LinkedIn invite, then stop.
 * Step 2 at day +3 (same thread, a new angle), step 3 at day +8 (referral or close the loop).
 * Belkins (belkins.io/blog/sales-follow-up-statistics): steps 2–6 bring 58.6% of replies and step 3
 * alone drives 35.6% of email-sourced meetings; after 3 unanswered emails, switch channel.
 */
export const SEQUENCE_OFFSETS: Record<number, number> = { 1: 0, 2: 3, 3: 8 };
export const MAX_STEPS = 3;
/** SPEC W5: write to the same person again only after ≥60 days (and a new signal). */
export const RECYCLE_DAYS = 60;

function dateOf(iso: string | undefined): string | null {
  return iso ? todayISO(new Date(iso)) : null;
}

/** When step `n` is due, counted from the day step 1 went out. */
export function dueOn(pkg: OutreachPackage, n: number): string | null {
  const first = pkg.steps.find((s) => s.step === 1);
  const sent = dateOf(first?.sentAt);
  if (!sent || SEQUENCE_OFFSETS[n] === undefined) return null;
  return addDays(sent, SEQUENCE_OFFSETS[n]);
}

/** Step 1 of this package, when it went out in the last 60 days (so a new first touch would be a second cold email). */
export function recentFirstTouch(pkg: OutreachPackage, today = todayISO()): DraftStep | undefined {
  const first = pkg.steps.find((s) => s.step === 1 && (s.status === "sent" || s.status === "approved"));
  const sent = dateOf(first?.sentAt ?? pkg.createdAt);
  return first && sent && sent >= addDays(today, -RECYCLE_DAYS) ? first : undefined;
}

/** True when the person answered after the first touch went out (Today's follow-up rule uses the same test). */
export function repliedSinceFirstTouch(pkg: OutreachPackage, activities: Activity[]): boolean {
  if (!pkg.personId) return false;
  const first = pkg.steps.find((s) => s.step === 1 && (s.status === "sent" || s.status === "approved"));
  const since = first?.sentAt ?? pkg.createdAt;
  return activities.some((a) => a.kind === "reply_received" && a.personId === pkg.personId && a.at > since);
}

/**
 * The next follow-up for a cold package, or null when the sequence is over, paused by a reply,
 * or step 1 hasn't gone out. `due` is true on or after its date. Today uses this to create moves;
 * the compose workflow (mode "follow_up") writes the draft when it's due. Pass `activities` so a
 * reply logged before the next step was drafted (nothing to cancel yet) also stops the sequence.
 */
export function nextFollowUp(
  pkg: OutreachPackage,
  today = todayISO(),
  activities?: Activity[],
): { step: number; dueOn: string; due: boolean; drafted: boolean } | null {
  if (pkg.mode !== "cold" && pkg.mode !== "follow_up") return null;
  if (pkg.steps.some((s) => s.status === "cancelled_by_reply")) return null;
  if (activities && repliedSinceFirstTouch(pkg, activities)) return null;
  const sentSteps = pkg.steps.filter((s) => s.status === "sent" || s.status === "approved").map((s) => s.step);
  if (!sentSteps.includes(1)) return null;
  const next = Math.max(...sentSteps) + 1;
  if (next > MAX_STEPS) return null;
  const existing = pkg.steps.find((s) => s.step === next);
  if (existing && existing.status !== "draft") return null;
  const date = dueOn(pkg, next);
  if (!date) return null;
  return { step: next, dueOn: date, due: date <= today, drafted: Boolean(existing) };
}
