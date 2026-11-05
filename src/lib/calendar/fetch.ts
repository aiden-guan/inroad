import "server-only";
import { fetchText, isPublicUrl } from "@/lib/signals/http";
import { isPublicGoogleAddress, providerOf } from "./address";

/**
 * Reads the feed through the same SSRF guard as research (public addresses only, on every redirect hop and
 * again at connect time), with a size cap and a timeout. Plain HTTP, zero tokens. Error messages never
 * contain the address.
 */

export type FeedErrorCode = "auth" | "rate_limited" | "upstream" | "network" | "validation";
export type FeedFetch = { ok: true; text: string; truncated: boolean } | { ok: false; code: FeedErrorCode; message: string };

/** A busy Google calendar with years of history is a few MB; this leaves room. */
const MAX_BYTES = 15_000_000;
const TIMEOUT_MS = 30_000;

export async function fetchFeed(url: string): Promise<FeedFetch> {
  const host = new URL(url).hostname;
  const { label } = providerOf(host);
  const tool = label === "Calendar" ? host : label;
  if (!(await isPublicUrl(url))) {
    return { ok: false, code: "validation", message: `I can't read ${host}: it isn't a public address, or it doesn't resolve. Check the address and try again.` };
  }
  const res = await fetchText(url, { timeoutMs: TIMEOUT_MS, maxBytes: MAX_BYTES, accept: "text/calendar, text/plain;q=0.9, */*;q=0.5", allowErrors: true });
  if (!res) return { ok: false, code: "network", message: `Couldn't reach ${tool}. Check your internet connection; I'll try again in a few minutes.` };
  if (res.status === 401 || res.status === 403) {
    return { ok: false, code: "auth", message: `${tool} refused this address. It may have been reset: copy the private address again and paste it here.` };
  }
  if (res.status === 404 || res.status === 410) {
    return {
      ok: false,
      code: "auth",
      message: isPublicGoogleAddress(url)
        ? "That's Google's public address, and this calendar isn't public. Copy the \"Secret address in iCal format\" instead."
        : `${tool} says this address doesn't exist anymore. If you reset the private address, paste the new one.`,
    };
  }
  if (res.status === 429) return { ok: false, code: "rate_limited", message: `${tool} is limiting requests. I'll try again later.` };
  if (res.status >= 500) return { ok: false, code: "upstream", message: `${tool} had a problem on its side (${res.status}). I'll try again in a few minutes.` };
  if (res.status >= 300) return { ok: false, code: "validation", message: `${tool} didn't return the calendar (${res.status}). Check the address and try again.` };
  const text = res.body;
  if (!/BEGIN:VCALENDAR/i.test(text.slice(0, 4096))) {
    return {
      ok: false,
      code: "auth",
      message: /<html|<!doctype/i.test(text.slice(0, 2048))
        ? "That address opens a web page, not a calendar file. Copy the private iCal (ICS) address: in Google Calendar it's \"Secret address in iCal format\"."
        : "That address didn't return a calendar file. Copy the private iCal (ICS) address and try again.",
    };
  }
  return { ok: true, text, truncated: text.length >= MAX_BYTES - 1024 };
}
