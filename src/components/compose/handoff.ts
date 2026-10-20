import type { IntegrationId, Workspace } from "@/lib/domain/types";

/**
 * Approve → send handoff. Inroad never sends; it hands the founder a ready message.
 * Gmail compose URL: /mail/u/{account}/?tf=cm&to=&su=&body= (unofficial; verified via
 * til.simonwillison.net/google/gmail-compose-url). Mobile Safari opens the inbox, so keep mailto.
 */

const MAX_URL = 2000;
const enc = encodeURIComponent;

export function gmailAccount(ws: Workspace): string {
  return (ws.founder.gmailAuthUser || "0").trim() || "0";
}

/** Null when the URL would pass ~2,000 characters; the caller falls back to Copy. */
export function gmailComposeUrl(ws: Workspace, m: { to?: string | null; subject?: string | null; body: string }): string | null {
  let url = `https://mail.google.com/mail/u/${enc(gmailAccount(ws))}/?tf=cm`;
  if (m.to) url += `&to=${enc(m.to)}`;
  if (m.subject) url += `&su=${enc(m.subject)}`;
  url += `&body=${enc(m.body)}`;
  return url.length <= MAX_URL ? url : null;
}

export function mailtoUrl(m: { to?: string | null; subject?: string | null; body: string }): string | null {
  const q = [m.subject ? `subject=${enc(m.subject)}` : "", `body=${enc(m.body)}`].filter(Boolean).join("&");
  const url = `mailto:${m.to ? enc(m.to).replace(/%40/g, "@") : ""}?${q}`;
  return url.length <= MAX_URL ? url : null;
}

/** Follow-ups go out as replies on the first email's thread: open that thread, then paste. */
export function gmailThreadUrl(ws: Workspace, to: string | null, subject: string | null): string {
  const q = [to ? `to:${to}` : "", subject ? `subject:"${subject.replace(/"/g, "")}"` : ""].filter(Boolean).join(" ");
  return `https://mail.google.com/mail/u/${enc(gmailAccount(ws))}/#search/${enc(q || "in:sent")}`;
}

/** Their reply thread, newest first. */
export function gmailFromUrl(ws: Workspace, from: string): string {
  return `https://mail.google.com/mail/u/${enc(gmailAccount(ws))}/#search/${enc(`from:${from}`)}`;
}

/** Must match SEQUENCER_IDS in lib/connectors/catalog.ts, which POST /api/integrations/push accepts. */
export const SEQUENCERS: { id: IntegrationId; label: string }[] = [
  { id: "instantly", label: "Instantly" },
  { id: "smartlead", label: "Smartlead" },
  { id: "lemlist", label: "lemlist" },
];

export function enabledSequencer(ws: Workspace): { id: IntegrationId; label: string } | null {
  return SEQUENCERS.find((s) => ws.integrations[s.id]?.enabled) ?? null;
}

/**
 * POST /api/integrations/push (owned by the integrations area). Its errors are written for the
 * founder (no email, not connected, on the do-not-contact list), so they're shown as-is.
 */
export async function pushToSequencer(packageId: string, step: number, integrationId: IntegrationId): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const res = await fetch("/api/integrations/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ packageId, step, integrationId }),
    });
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    if (!res.ok) return { ok: false, message: body?.error ?? "That didn't push. Check the connection on Integrations." };
    return { ok: true };
  } catch {
    return { ok: false, message: "Couldn't reach the server. Try again." };
  }
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
