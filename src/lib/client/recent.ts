/**
 * Recently opened companies, newest first, for ⌘K. A per-browser convenience: kept in localStorage,
 * and everything works the same when storage is unavailable (private windows, blocked storage).
 */
const KEY = "inroad:recent-companies";
const MAX = 6;

export function readRecent(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]") as unknown;
    return Array.isArray(raw) ? raw.filter((d): d is string => typeof d === "string").slice(0, MAX) : [];
  } catch {
    return [];
  }
}

export function pushRecent(domain: string) {
  try {
    const next = [domain, ...readRecent().filter((d) => d !== domain)].slice(0, MAX);
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // storage unavailable: nothing to remember
  }
}
