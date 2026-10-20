import { addDays, todayISO } from "@/lib/domain/ids";
import type { ISODate, ISODateTime } from "@/lib/domain/types";

/**
 * Every date in the sample is relative to the moment it is loaded, so the workspace always looks
 * current: "yesterday's call" is always yesterday. Offsets are calendar days from today (negative = past).
 */
export interface Clock {
  now: Date;
  today: ISODate;
  /** Local calendar date `n` days from today. */
  d(n: number): ISODate;
  /** Local wall-clock time on the date `n` days from today. Use `ago` for earlier-today times. */
  at(n: number, hhmm: string): ISODateTime;
  /** A moment `minutes` before now. */
  ago(minutes: number): ISODateTime;
  /** A moment `minutes` after `iso`. */
  plus(iso: ISODateTime, minutes: number): ISODateTime;
  /** "Nov 4" for the date `n` days from today, for copy that names a date. */
  label(n: number): string;
  /** "Thursday" for the date `n` days from today. */
  weekday(n: number): string;
  /** Offset of the next date (after today) that falls on one of `days` (0 = Sunday). */
  next(days: number[], after?: number): number;
}

function localDate(iso: ISODate, hours = 12, minutes = 0): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d, hours, minutes);
}

export function makeClock(now = new Date()): Clock {
  const today = todayISO(now);
  const d = (n: number) => addDays(today, n);
  return {
    now,
    today,
    d,
    at(n, hhmm) {
      const [h, m] = hhmm.split(":").map(Number);
      return localDate(d(n), h, m).toISOString();
    },
    ago(minutes) {
      return new Date(now.getTime() - minutes * 60_000).toISOString();
    },
    plus(iso, minutes) {
      return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
    },
    label(n) {
      return localDate(d(n)).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    },
    weekday(n) {
      return localDate(d(n)).toLocaleDateString("en-US", { weekday: "long" });
    },
    next(days, after = 0) {
      for (let n = after + 1; n <= after + 14; n++) if (days.includes(localDate(d(n)).getDay())) return n;
      return after + 1;
    },
  };
}

/**
 * Today's meeting must still be ahead of the founder when the sample loads: 2pm, or two hours from
 * now rounded up to the half hour, whichever is later (kept on today's date).
 */
export function upcomingToday(clock: Clock): ISODateTime {
  const twoPm = localDate(clock.today, 14, 0).getTime();
  const soon = clock.now.getTime() + 2 * 3_600_000;
  const rounded = Math.ceil(soon / 1_800_000) * 1_800_000;
  const lastSlot = localDate(clock.today, 23, 30).getTime();
  return new Date(Math.min(Math.max(twoPm, rounded), lastSlot)).toISOString();
}

export function timeLabel(iso: ISODateTime): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}
