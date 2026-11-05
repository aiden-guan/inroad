/**
 * The private calendar address the founder pastes. It is a password: anyone with it can read the calendar.
 * So it is checked here, kept in secrets.json, fetched only through the SSRF guard, and shown back only as
 * its host and last few characters.
 */
import type { CalendarProvider, CalendarSource } from "./types";

export type AddressCheck = { ok: true; url: string } | { ok: false; message: string };

/** webcal:// → https://, trims, and refuses anything that would send the calendar in the clear or isn't a web address. */
export function normalizeAddress(raw: string): AddressCheck {
  const text = raw.trim().replace(/^<|>$/g, "");
  if (!text) return { ok: false, message: "Paste your calendar's private address first." };
  if (/^BEGIN:VCALENDAR/i.test(text)) return { ok: false, message: "That's the calendar file itself. Paste its address (it starts with https:// or webcal://)." };
  if (/<iframe|calendar\/embed/i.test(text)) return { ok: false, message: "That's the embed code. In Google Calendar, copy the \"Secret address in iCal format\" instead." };
  const withScheme = text.replace(/^webcals?:\/\//i, "https://");
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return { ok: false, message: "That doesn't look like an address. It should start with https:// or webcal://." };
  }
  if (url.protocol === "http:") return { ok: false, message: "Use the https:// address. A plain http:// address would send your calendar unencrypted." };
  if (url.protocol !== "https:") return { ok: false, message: "The address should start with https:// or webcal://." };
  if (url.username || url.password) return { ok: false, message: "Paste the address without a username or password in it." };
  return { ok: true, url: url.toString() };
}

/** Google's public address: it shows busy times only, or nothing, for a calendar that isn't shared publicly. */
export function isPublicGoogleAddress(url: string): boolean {
  try {
    const u = new URL(url);
    return /(^|\.)calendar\.google\.com$/i.test(u.hostname) && /\/public\/basic\.ics$/i.test(u.pathname);
  } catch {
    return false;
  }
}

export function providerOf(host: string): { provider: CalendarProvider; label: string } {
  const h = host.toLowerCase();
  if (/(^|\.)calendar\.google\.com$|(^|\.)google\.com$/.test(h)) return { provider: "google", label: "Google Calendar" };
  if (/(^|\.)outlook\.(office365|office|live)\.com$|(^|\.)office365\.com$/.test(h)) return { provider: "outlook", label: "Outlook" };
  if (/(^|\.)icloud\.com$/.test(h)) return { provider: "icloud", label: "iCloud Calendar" };
  if (/(^|\.)(fastmail\.com|user\.fm)$/.test(h)) return { provider: "fastmail", label: "Fastmail" };
  if (/(^|\.)proton\.me$/.test(h)) return { provider: "proton", label: "Proton Calendar" };
  if (/(^|\.)zoho\.(com|eu|in)$/.test(h)) return { provider: "zoho", label: "Zoho Calendar" };
  return { provider: "other", label: "Calendar" };
}

/** The last four letters or digits of the address's secret part (".../private-abc123/basic.ics" → "c123"). */
export function addressHint(url: string): string {
  try {
    const u = new URL(url);
    const segments = u.pathname
      .split("/")
      .filter(Boolean)
      .map((s) => s.replace(/\.(ics|ical|ifb)$/i, ""))
      .filter((s) => s && !/^(basic|calendar|full|ical|published|calendars?|\d)$/i.test(s));
    const secret = (segments.at(-1) ?? "") + u.search.replace(/[^a-z0-9]/gi, "");
    const tail = secret.replace(/[^a-z0-9]/gi, "").slice(-4);
    return tail ? `••••${tail}` : "••••";
  } catch {
    return "••••";
  }
}

export function sourceOf(url: string, name?: string): CalendarSource {
  const host = new URL(url).hostname.toLowerCase();
  const { provider, label } = providerOf(host);
  return { provider, label, host, hint: addressHint(url), ...(name ? { name } : {}) };
}

/** Scrubs the address (and its secret path) out of any text before it is shown or logged. */
export function scrub(text: string, url: string): string {
  if (!url) return text;
  let out = text.split(url).join("[calendar address]");
  try {
    const u = new URL(url);
    if (u.pathname.length > 8) out = out.split(u.pathname).join("/[private]");
  } catch {
    // not a URL: nothing more to scrub
  }
  return out;
}
