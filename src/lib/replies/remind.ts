import { addBusinessDays, addDays, daysBetween, todayISO } from "@/lib/domain/ids";
import type { DraftStep, ISODate, OutreachPackage } from "@/lib/domain/types";
import { senderOwnsSequence } from "@/lib/quality/sequence";

/**
 * "Remind me if no reply", on by default for every draft marked sent (Superhuman's remind-me): the follow-up comes
 * back when the sequence's next step is due, else after four working days. Pure; the reducer runs it on both sides.
 */

export const REMIND_BUSINESS_DAYS = 4;

/** Calendar days after the first send that steps 2 and 3 come due, as the moves engine schedules them. */
export const STEP_SPACING: Record<number, number> = { 2: 3, 3: 8 };

/**
 * The reminder a send gets unless the founder changes it. Null where something else already chases the thread:
 * a sequencer sends the follow-ups, or Intros tracks the ask.
 */
export function defaultRemindOn(pkg: OutreachPackage, step: Pick<DraftStep, "step">, at: string): ISODate | null {
  if (pkg.mode === "warm_intro" || senderOwnsSequence(pkg)) return null;
  const sentOn = todayISO(new Date(at));
  if ((pkg.mode === "cold" || pkg.mode === "follow_up") && step.step < 3) {
    const nextNo = step.step + 1;
    const next = pkg.steps.find((s) => s.step === nextNo && s.status === "draft");
    const first = pkg.steps.find((s) => s.step === 1);
    const firstOn = step.step === 1 ? sentOn : first?.sentAt ? todayISO(new Date(first.sentAt)) : sentOn;
    const spaced = addDays(firstOn, STEP_SPACING[nextNo] ?? 4);
    const due = next?.sendOn && next.sendOn > sentOn ? next.sendOn : spaced;
    return due > sentOn ? due : addDays(sentOn, 1);
  }
  return addBusinessDays(sentOn, REMIND_BUSINESS_DAYS);
}

/** Moves a reminder by whole working days (−/+ in the toast), never before the day after it went. */
export function shiftRemind(on: ISODate, by: number, sentOn: ISODate): ISODate {
  let d = on;
  const step = by > 0 ? 1 : -1;
  for (let i = 0; i < Math.abs(by); i++) {
    const next = step > 0 ? addBusinessDays(d, 1) : previousBusinessDay(d);
    if (next <= sentOn) break;
    d = next;
  }
  return d;
}

function previousBusinessDay(date: ISODate): ISODate {
  let d = addDays(date, -1);
  for (let i = 0; i < 3 && [0, 6].includes(new Date(`${d}T12:00:00`).getDay()); i++) d = addDays(d, -1);
  return d;
}

/** "tomorrow", "on Monday", "Wed, Nov 11": when a reminder lands, said the short way. */
export function remindLabel(on: ISODate, today: ISODate): string {
  const days = daysBetween(today, on);
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  const d = new Date(`${on}T12:00:00`);
  if (days < 7) return `on ${d.toLocaleDateString("en-US", { weekday: "long" })}`;
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}
