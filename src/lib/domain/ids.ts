/** `acc_3f9k2m1x0q`-style ids. Works in Node and the browser. */
export function newId(prefix: string): string {
  const raw = (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`).replace(/-/g, "");
  return `${prefix}_${raw.slice(0, 10)}`;
}

export function nowISO(): string {
  return new Date().toISOString();
}

/** Local calendar date `YYYY-MM-DD` (not UTC), so "today" matches the founder's wall clock. */
export function todayISO(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The local calendar date of a date or a timestamp: "2026-10-20" stays as it is, and "2026-10-21T01:30:00.000Z"
 * (6:30 pm on Oct 20 in Los Angeles) is "2026-10-20" there. Slicing a timestamp gives its UTC date instead, which is
 * the next day for every evening west of Greenwich. Anything unparseable comes back as its first 10 characters.
 */
export function localDay(value: string): string {
  if (DATE_ONLY.test(value)) return value;
  const t = Date.parse(value);
  return Number.isNaN(t) ? value.slice(0, 10) : todayISO(new Date(t));
}

/** A calendar date as a day count. UTC has no daylight-saving jumps, so day arithmetic on it is exact. */
function dayNumber(value: string): number {
  const [y, m, d] = localDay(value).split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

function fromDayNumber(n: number): string {
  // Not a date in, not a date out (as before), instead of a RangeError from toISOString.
  return Number.isFinite(n) ? new Date(n * 86_400_000).toISOString().slice(0, 10) : "NaN-NaN-NaN";
}

/** The local date `days` after `date` (a date, or a timestamp's local date). */
export function addDays(date: string, days: number): string {
  return fromDayNumber(dayNumber(date) + days);
}

/** `days` working days after `date` (Saturdays and Sundays don't count). */
export function addBusinessDays(date: string, days: number): string {
  let d = localDay(date);
  for (let left = days; left > 0; ) {
    d = addDays(d, 1);
    const dow = new Date(`${d}T12:00:00`).getDay();
    if (dow !== 0 && dow !== 6) left--;
  }
  return d;
}

/** Monday of the week containing `date` (local; a timestamp counts on its local date). */
export function weekOf(date = todayISO()): string {
  const n = dayNumber(date);
  // Day 0 (1970-01-01) was a Thursday: Monday-based weekday is (n + 3) mod 7.
  return fromDayNumber(n - (((n + 3) % 7) + 7) % 7);
}

export function monthKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Calendar days from `a` to `b`, each a date or a timestamp (counted on its local date, so a deal moved at 6 pm is
 * 0 days old that evening and 1 the next morning, wherever the founder is).
 */
export function daysBetween(a: string, b: string): number {
  return dayNumber(b) - dayNumber(a);
}
