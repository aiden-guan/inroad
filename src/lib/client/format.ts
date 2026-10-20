/** Small, dependency-free formatters used across the UI. */

export function relativeTime(iso: string | undefined, now = Date.now()): string {
  if (!iso) return "";
  const t = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).getTime();
  if (Number.isNaN(t)) return "";
  const s = Math.round((now - t) / 1000);
  const abs = Math.abs(s);
  const fut = s < 0;
  const fmt = (n: number, u: string) => (fut ? `in ${n}${u}` : `${n}${u} ago`);
  if (abs < 45) return fut ? "soon" : "just now";
  if (abs < 3600) return fmt(Math.round(abs / 60), "m");
  if (abs < 86_400) return fmt(Math.round(abs / 3600), "h");
  if (abs < 86_400 * 30) return fmt(Math.round(abs / 86_400), "d");
  if (abs < 86_400 * 365) return fmt(Math.round(abs / (86_400 * 30)), "mo");
  return fmt(Math.round(abs / (86_400 * 365)), "y");
}

/** Compact age for source notes: "12d", "3mo". */
export function age(iso: string | undefined, now = Date.now()): string {
  if (!iso) return "";
  const t = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).getTime();
  if (Number.isNaN(t)) return "";
  const d = Math.max(0, Math.round((now - t) / 86_400_000));
  if (d < 1) return "today";
  if (d < 30) return `${d}d`;
  if (d < 365) return `${Math.round(d / 30)}mo`;
  return `${Math.round(d / 365)}y`;
}

export function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${String(s % 60).padStart(2, "0")}s`;
}

export function usd(n: number | undefined, { cents = true } = {}): string {
  if (n === undefined || Number.isNaN(n)) return "—";
  if (cents && n < 1) return `$${n.toFixed(n < 0.01 ? 3 : 2)}`;
  return n >= 1000 ? `$${Math.round(n / 1000)}K` : `$${n.toFixed(cents ? 2 : 0)}`;
}

export function money(n: number | undefined): string {
  if (n === undefined) return "—";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M`;
  if (n >= 1000) return `$${Math.round(n / 1000)}K`;
  return `$${n}`;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function firstName(name: string | undefined): string {
  return (name ?? "").trim().split(/\s+/)[0] ?? "";
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function longDate(d = new Date()): string {
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

export function shortDate(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
