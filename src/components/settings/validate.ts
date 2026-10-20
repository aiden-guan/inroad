/** Inline validators for settings fields. Each returns the message to show, or null when fine. */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function emailProblem(v: string): string | null {
  return EMAIL.test(v) ? null : "That doesn't look like an email address.";
}

export function urlProblem(v: string): string | null {
  try {
    const u = new URL(v.includes("://") ? v : `https://${v}`);
    if (u.protocol !== "https:" && u.protocol !== "http:") return "Use a web link (https://…).";
    return u.hostname.includes(".") ? null : "That doesn't look like a link.";
  } catch {
    return "That doesn't look like a link.";
  }
}

/** Adds https:// to a bare link so it opens when a prospect clicks it. */
export function normalizeUrl(v: string): string {
  const t = v.trim();
  if (!t) return t;
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

/** Gmail's /mail/u/{x}/ accepts an account index (0, 1, …) or the signed-in address. */
export function gmailProblem(v: string): string | null {
  if (/^\d{1,2}$/.test(v)) return null;
  return EMAIL.test(v) ? null : "Use your Gmail address, or an account number like 0 or 1.";
}

export function domainOf(email: string | undefined): string | null {
  const d = email?.split("@")[1]?.trim().toLowerCase();
  return d && d.includes(".") ? d : null;
}

export function normalizeDomain(v: string): string | null {
  const raw = v.trim().toLowerCase();
  if (!raw) return null;
  const host = raw.includes("@") ? raw.split("@").pop()! : raw;
  try {
    const u = new URL(host.includes("://") ? host : `https://${host}`);
    const h = u.hostname.replace(/^www\./, "");
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(h) ? h : null;
  } catch {
    return null;
  }
}
