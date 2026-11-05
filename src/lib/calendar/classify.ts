/**
 * Which calendar events are sales meetings, in code. An event is external when at least one guest's
 * address isn't the founder's own (the workspace company's domain, the sender identity's domain, the
 * founder's addresses, and the calendar owner, who is on most events). Rooms, resource calendars and
 * no-reply robots aren't guests. Personal mailboxes (gmail.com and the like) are people without a
 * company: counted and listed, never turned into a company.
 */
import type { Workspace } from "@/lib/domain/types";
import { isFreeMail, normalizeDomain, normalizeEmail } from "@/lib/hub/records";
import type { Occurrence, Party } from "./ics";
import type { Guest } from "./types";

export interface Identity {
  emails: Set<string>;
  domains: Set<string>;
}

export type EventKind = "external" | "personal" | "internal" | "solo" | "all_day" | "declined";

export interface Classified {
  occ: Occurrence;
  kind: EventKind;
  /** Company guests by domain, the busiest company first (ties: the organizer's company). */
  companies: { domain: string; guests: Guest[] }[];
  personal: Guest[];
}

const NOT_A_GUEST = /(^|\.)(resource\.calendar\.google\.com|group\.calendar\.google\.com|group\.v\.calendar\.google\.com|import\.calendar\.google\.com)$/;
const ROBOT = /^(no-?reply|do-?not-?reply|calendar-notification|notifications?|mailer-daemon)([+.-].*)?@/;

function isRoom(p: Party): boolean {
  if (p.cutype === "ROOM" || p.cutype === "RESOURCE") return true;
  const domain = p.email?.split("@")[1] ?? "";
  return NOT_A_GUEST.test(domain) || (!!p.email && ROBOT.test(p.email));
}

const domainOf = (email: string | undefined) => (email ? normalizeDomain(email.split("@")[1]) : null);

/**
 * The founder's own addresses and domains. Besides what the workspace knows, the calendar's owner is the
 * address on most events that have guests (and the feed's name when it's an address, as Google's is).
 */
export function identityFor(ws: Pick<Workspace, "company" | "sender" | "founder">, occurrences: Occurrence[], calendarName?: string): Identity {
  const emails = new Set<string>();
  const add = (e: string | undefined | null) => {
    const n = normalizeEmail(e ?? undefined);
    if (n) emails.add(n);
  };
  add(ws.founder.email);
  add(ws.sender?.email);
  add(calendarName);
  const withGuests = occurrences.filter((o) => o.attendees.length > 0);
  const seen = new Map<string, number>();
  for (const o of withGuests) {
    for (const e of new Set(o.attendees.map((a) => a.email).filter((x): x is string => !!x && !isRoom({ email: x })))) seen.set(e, (seen.get(e) ?? 0) + 1);
  }
  if (withGuests.length >= 3) for (const [e, n] of seen) if (n / withGuests.length >= 0.5) emails.add(e);
  const domains = new Set<string>();
  const companyDomain = normalizeDomain(ws.company?.domain);
  if (companyDomain) domains.add(companyDomain);
  for (const e of emails) {
    const d = domainOf(e);
    if (d && !isFreeMail(d)) domains.add(d);
  }
  return { emails, domains };
}

const guest = (p: Party): Guest => ({ ...(p.email ? { email: p.email } : {}), ...(p.name ? { name: p.name } : {}) });

export function classify(occ: Occurrence, id: Identity): Classified {
  const base = { occ, companies: [] as Classified["companies"], personal: [] as Guest[] };
  if (occ.allDay) return { ...base, kind: "all_day" };
  const people = [...occ.attendees];
  // Outlook's published calendars often list no guests; the organizer is still someone.
  if (occ.organizer?.email && !people.some((p) => p.email === occ.organizer!.email)) people.push(occ.organizer);
  const mine = (p: Party) => !!p.email && (id.emails.has(p.email) || id.domains.has(domainOf(p.email) ?? ""));
  if (occ.attendees.some((p) => p.partstat === "DECLINED" && !!p.email && id.emails.has(p.email))) return { ...base, kind: "declined" };

  const byDomain = new Map<string, Guest[]>();
  const personal: Guest[] = [];
  let internal = 0;
  for (const p of people) {
    if (isRoom(p)) continue;
    if (!p.email) continue;
    if (mine(p)) {
      if (!id.emails.has(p.email)) internal++;
      continue;
    }
    // Declined guests aren't coming, but the meeting with their colleagues still is.
    if (p.partstat === "DECLINED") continue;
    const d = domainOf(p.email);
    if (!d) continue;
    if (isFreeMail(d)) personal.push(guest(p));
    else byDomain.set(d, [...(byDomain.get(d) ?? []), guest(p)]);
  }
  const organizerDomain = domainOf(occ.organizer?.email);
  const companies = [...byDomain.entries()]
    .sort((a, b) => b[1].length - a[1].length || Number(b[0] === organizerDomain) - Number(a[0] === organizerDomain) || a[0].localeCompare(b[0]))
    .map(([domain, guests]) => ({ domain, guests }));
  if (companies.length) return { occ, kind: "external", companies, personal };
  if (personal.length) return { occ, kind: "personal", companies: [], personal };
  return { ...base, kind: internal ? "internal" : "solo" };
}

/** Zoom, Google Meet, Teams or Webex, from the location, the description or Google's conference field. */
export function conferenceOf(occ: Pick<Occurrence, "location" | "description" | "url" | "conference">): string | undefined {
  const text = [occ.conference, occ.location, occ.url, occ.description].filter(Boolean).join(" ");
  if (/meet\.google\.com\//i.test(text)) return "Google Meet";
  if (/(^|[./])zoom\.us\/(j|my|w)\//i.test(text)) return "Zoom";
  if (/teams\.(microsoft|live)\.com\//i.test(text)) return "Teams";
  if (/\.webex\.com\//i.test(text)) return "Webex";
  return undefined;
}

const SPLIT = /\s*(?:<>|<->|\/\/|\/|\||×|\+|&|\bx\b|:|\s[-–—]\s)\s*/i;
const FILLER = /\b(intro|introduction|call|meeting|sync|chat|catch[- ]?up|demo|discovery|follow[- ]?up|kickoff|kick-off|check[- ]?in|weekly|monthly|review|session|deep[- ]?dive|coffee|lunch|re|fwd|invitation|updated invitation)\b/gi;

/**
 * A readable name for a company first seen on a calendar: the title's other side ("Halcyon Freight <>
 * Ledgerline: intro" → "Halcyon Freight") when it fits the domain, else the domain's first label.
 */
export function guessCompanyName(domain: string, titles: string[], ours: string[] = []): string {
  const root = domain.split(".")[0] ?? domain;
  const flat = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const mine = ours.map(flat).filter(Boolean);
  for (const title of titles) {
    for (const part of title.split(SPLIT)) {
      const name = part.replace(FILLER, "").replace(/[()[\]"“”]/g, "").replace(/\s{2,}/g, " ").trim();
      const f = flat(name);
      if (f.length < 2 || name.length > 40 || mine.some((m) => f.includes(m) || m.includes(f))) continue;
      // The name has to look like the domain: "Halcyon Freight" for halcyonfreight.com, "Acme" for acme.io.
      if (f === flat(root) || flat(root).startsWith(f) || f.startsWith(flat(root))) return name;
    }
  }
  return root.charAt(0).toUpperCase() + root.slice(1);
}
