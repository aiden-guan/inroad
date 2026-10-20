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

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return todayISO(new Date(y, m - 1, d + days));
}

/** Monday of the week containing `date` (local). */
export function weekOf(date = todayISO()): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const offset = (dt.getDay() + 6) % 7;
  return todayISO(new Date(y, m - 1, d - offset));
}

export function monthKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function daysBetween(a: string, b: string): number {
  const pa = a.slice(0, 10).split("-").map(Number);
  const pb = b.slice(0, 10).split("-").map(Number);
  return Math.round((new Date(pb[0], pb[1] - 1, pb[2]).getTime() - new Date(pa[0], pa[1] - 1, pa[2]).getTime()) / 86_400_000);
}
