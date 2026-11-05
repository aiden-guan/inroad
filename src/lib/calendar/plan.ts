/**
 * What a calendar read means for the workspace, decided in code. Pure: the sync (src/lib/calendar/sync.ts)
 * reads the feed and the stores, this decides, and the booking path (src/lib/hub/inbound.ts) writes.
 *
 * The rule for each meeting with a company:
 *  - the company has a deal: the meeting goes on it, past or future;
 *  - the company is on file without a deal: an upcoming meeting starts the deal at Talking, the way a
 *    Calendly booking does; a past one waits for the founder;
 *  - a new company, a customer without a deal, or a past meeting with a tracked company: listed for the
 *    founder to Track or Ignore. Tracking puts all of its meetings on the deal;
 *  - an ignored domain or a disqualified company: left alone.
 * A meeting that moves is moved, one cancelled (or deleted from a complete feed while still ahead) is
 * cancelled; past meetings are never deleted. Consumer workspaces are read, never written.
 */
import { isConsumer } from "@/lib/consumer/market";
import { localDate } from "@/lib/moves/util";
import { OPEN_STAGES, type Move, type Workspace } from "@/lib/domain/types";
import { todayISO } from "@/lib/domain/ids";
import { askedToBeDeleted } from "@/lib/hub/records";
import { guessCompanyName } from "./classify";
import {
  AGENDA_DAYS,
  CALENDAR_MOVE_RULE,
  FUTURE_DAYS,
  PAST_DAYS,
  type AgendaItem,
  type CalendarDigest,
  type FeedStats,
  type Guest,
  type ReviewCompany,
  type StoredEvent,
} from "./types";

const DAY = 86_400_000;

export type Policy = "apply" | "review" | "skip";

/** What was last sent to the workspace for one booking (an occurrence with one company). */
export interface SentEntry {
  /** Start and status, so only a move or a cancellation is sent again. */
  fp: string;
  start: string;
  /** Linked to a meeting already on the deal, without sending anything. */
  linked?: boolean;
}

export interface Lists {
  ignored: string[];
  accepted: string[];
}

export const bookingId = (eventId: string, domain: string) => `${eventId}#${domain}`;
export const refKey = (id: string) => `booking:calendar:${id}`;

export function startOfLocalDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function syncWindow(now: number): { from: number; to: number } {
  const today = startOfLocalDay(now);
  return { from: today - PAST_DAYS * DAY, to: today + (FUTURE_DAYS + 1) * DAY - 1 };
}

const isOpenDeal = (ws: Workspace, domain: string) => {
  const id = ws.accounts[domain]?.dealId;
  const deal = id ? ws.deals[id] : undefined;
  return !!deal && OPEN_STAGES.includes(deal.stage);
};

export function policyFor(ws: Workspace, domain: string, startMs: number, now: number, lists: Lists): Policy {
  if (lists.ignored.includes(domain)) return "skip";
  const acc = ws.accounts[domain];
  if (acc?.status === "disqualified") return "skip";
  if (lists.accepted.includes(domain)) return "apply";
  if (acc?.dealId && ws.deals[acc.dealId]) return "apply";
  if (acc && acc.status !== "customer" && startMs >= startOfLocalDay(now)) return "apply";
  return "review";
}

/** The guests a booking carries: the company's own first (the booking path takes the first company guest), then everyone else outside. */
export function bookingGuests(ev: StoredEvent, domain: string): Guest[] {
  const mine = ev.companies.find((c) => c.domain === domain)?.guests ?? [];
  const others = ev.companies.filter((c) => c.domain !== domain).flatMap((c) => c.guests);
  return [...mine, ...ev.personal, ...others];
}

/** The payload the booking path reads for source "calendar" (parseCalendar in src/lib/hub/inbound.ts). */
export interface BookingPayload {
  id: string;
  action: "created" | "canceled";
  title: string;
  startsAt?: string;
  attendees: Guest[];
}

export interface Plan {
  bookings: BookingPayload[];
  /** Booking id → meeting id: a meeting already on the deal that day, which this occurrence is. */
  links: Record<string, string>;
  /** The sent ledger once this plan has gone through. */
  sent: Record<string, SentEntry>;
  added: number;
  moved: number;
  cancelled: number;
}

/** A meeting on the company's deal on the same local day that nothing else claims: the one the founder logged by hand. */
function sameDay(ws: Workspace, domain: string, startIso: string, taken: Set<string>): string | undefined {
  const dealId = ws.accounts[domain]?.dealId;
  const deal = dealId ? ws.deals[dealId] : undefined;
  if (!deal) return undefined;
  const day = localDate(startIso);
  const t = Date.parse(startIso);
  return deal.meetingIds
    .map((id) => ws.meetings[id])
    .filter((m) => !!m && !taken.has(m.id) && localDate(m.startsAt) === day)
    .sort((a, b) => Math.abs(Date.parse(a!.startsAt) - t) - Math.abs(Date.parse(b!.startsAt) - t))[0]?.id;
}

export function planSync({
  ws,
  events,
  sent,
  lists,
  complete,
  now,
  refs,
  onlyDomain,
}: {
  ws: Workspace;
  events: StoredEvent[];
  sent: Record<string, SentEntry>;
  lists: Lists;
  /** The feed ended properly: something missing from it was deleted, not cut off. */
  complete: boolean;
  now: number;
  /** Booking id → meeting id, from the hub's ledger. */
  refs: Record<string, string>;
  /** Track: only this company's meetings, all of them. */
  onlyDomain?: string;
}): Plan {
  const next: Record<string, SentEntry> = { ...sent };
  const bookings: BookingPayload[] = [];
  const links: Record<string, string> = {};
  const taken = new Set(Object.values(refs));
  const present = new Set<string>();
  let added = 0;
  let moved = 0;
  let cancelled = 0;
  if (isConsumer(ws)) return { bookings, links, sent: next, added, moved, cancelled };

  for (const ev of events) {
    for (const c of ev.companies) {
      if (onlyDomain && c.domain !== onlyDomain) continue;
      const id = bookingId(ev.id, c.domain);
      if (ev.status === "cancelled") {
        if (sent[id] && !sent[id].linked && refs[id]) {
          bookings.push({ id, action: "canceled", title: ev.title, attendees: [] });
          cancelled++;
        }
        delete next[id];
        continue;
      }
      present.add(id);
      const startMs = Date.parse(ev.start);
      if (!onlyDomain && policyFor(ws, c.domain, startMs, now, lists) !== "apply") continue;
      const fp = `${ev.start}|${ev.status}`;
      const prev = sent[id];
      if (prev && prev.fp === fp && (prev.linked || refs[id])) continue;
      if (!prev && !refs[id]) {
        const twin = sameDay(ws, c.domain, ev.start, taken);
        if (twin) {
          links[id] = twin;
          taken.add(twin);
          // A call already logged that day: link it, leave it as it is.
          if (startMs < now) {
            next[id] = { fp, start: ev.start, linked: true };
            continue;
          }
        }
      }
      // Someone who asked to be deleted isn't brought back by an invite; a meeting with only them isn't added.
      const attendees = bookingGuests(ev, c.domain).filter((g) => !askedToBeDeleted(ws, g.email));
      if (!attendees.some((g) => g.email?.endsWith(`@${c.domain}`))) continue;
      bookings.push({ id, action: "created", title: ev.title || "Meeting", startsAt: ev.start, attendees });
      if (prev || refs[id] || links[id]) moved += prev && prev.start !== ev.start ? 1 : 0;
      else added++;
      next[id] = { fp, start: ev.start };
    }
  }

  // Gone from a complete feed: an upcoming meeting was deleted; a past one only aged out or was cleaned up.
  if (complete && !onlyDomain) {
    for (const [id, entry] of Object.entries(sent)) {
      if (present.has(id) || !(id in next)) continue;
      if (Date.parse(entry.start) > now && !entry.linked && refs[id]) {
        bookings.push({ id, action: "canceled", title: "", attendees: [] });
        cancelled++;
      }
      delete next[id];
    }
  }
  return { bookings, links, sent: next, added, moved, cancelled };
}

/* ───────────── What the connection shows ───────────── */

const OURS = (ws: Workspace) => [ws.company?.name, ws.sender?.company].filter((x): x is string => !!x);

function companyName(ws: Workspace, domain: string, events: StoredEvent[]): string {
  return ws.accounts[domain]?.name ?? guessCompanyName(domain, events.map((e) => e.title), OURS(ws));
}

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

export function digestNotes(stats: FeedStats | undefined, consumer: boolean): string[] {
  const notes: string[] = [];
  if (!stats) return notes;
  const s = stats.skipped;
  if (s.rule) notes.push(`${plural(s.rule, "repeating event uses", "repeating events use")} a rule I can't expand exactly yet, so ${s.rule === 1 ? "it's" : "they're"} left out.`);
  if (s.time_zone) notes.push(`${plural(s.time_zone, "event uses", "events use")} a time zone I couldn't identify, so ${s.time_zone === 1 ? "it's" : "they're"} left out.`);
  if (s.range) notes.push(`${plural(s.range, "series was", "series were")} changed for "this and following events" in a way I don't expand, so ${s.range === 1 ? "it's" : "they're"} left out.`);
  if (s.too_long) notes.push(`${plural(s.too_long, "series repeats", "series repeat")} too far back to expand, so ${s.too_long === 1 ? "it's" : "they're"} left out.`);
  if (!stats.complete) notes.push("Your calendar file was cut off, so I didn't treat anything missing from it as cancelled.");
  if (stats.busyOnly) notes.push("This address only shows busy times. Paste the private (secret) iCal address so I can see titles and guests.");
  else if (stats.total > 0 && stats.withGuests === 0) notes.push("None of these events list guests. Outlook's published calendars leave them out, so I can only match a meeting by its organizer.");
  if (consumer) notes.push("You sell to consumers, so meetings are read but not added to deals.");
  return notes;
}

export function buildDigest({
  ws,
  events,
  stats,
  lists,
  refs,
  now,
}: {
  ws: Workspace;
  events: StoredEvent[];
  stats?: FeedStats;
  lists: Lists;
  refs: Record<string, string>;
  now: number;
}): Pick<CalendarDigest, "window" | "upcoming" | "past" | "hidden" | "notes" | "review" | "agenda" | "consumer"> {
  const { from, to } = syncWindow(now);
  const consumer = isConsumer(ws);
  const live = events.filter((e) => e.status !== "cancelled" && Date.parse(e.start) >= from && Date.parse(e.start) <= to);
  const upcoming = live.filter((e) => Date.parse(e.start) >= now);
  const past = live.filter((e) => Date.parse(e.start) < now);
  const meetingOf = (e: StoredEvent): string | undefined => {
    for (const c of e.companies) {
      const id = refs[bookingId(e.id, c.domain)];
      if (id && ws.meetings[id]) return id;
    }
    return undefined;
  };

  const newDomains = new Set<string>();
  for (const e of upcoming) for (const c of e.companies) if (!ws.accounts[c.domain] && !lists.ignored.includes(c.domain)) newDomains.add(c.domain);

  // Companies waiting for the founder: Track or Ignore.
  const byDomain = new Map<string, StoredEvent[]>();
  for (const e of live) {
    for (const c of e.companies) {
      if (policyFor(ws, c.domain, Date.parse(e.start), now, lists) !== "review" || meetingOf(e)) continue;
      byDomain.set(c.domain, [...(byDomain.get(c.domain) ?? []), e]);
    }
  }
  const review: ReviewCompany[] = [...byDomain.entries()].map(([domain, evs]) => {
    const sorted = [...evs].sort((a, b) => a.start.localeCompare(b.start));
    const next = sorted.find((e) => Date.parse(e.start) >= now);
    const last = [...sorted].reverse().find((e) => Date.parse(e.start) < now);
    const seen = new Set<string>();
    const guests: Guest[] = [];
    for (const e of sorted) {
      for (const g of e.companies.find((c) => c.domain === domain)?.guests ?? []) {
        const k = g.email ?? g.name ?? "";
        if (!k || seen.has(k)) continue;
        seen.add(k);
        guests.push(g);
      }
    }
    const acc = ws.accounts[domain];
    return {
      domain,
      name: companyName(ws, domain, evs),
      status: !acc ? ("new" as const) : acc.status === "customer" ? ("customer" as const) : ("known" as const),
      ...(next ? { next: { id: next.id, title: next.title, start: next.start } } : {}),
      ...(last ? { last: { id: last.id, title: last.title, start: last.start } } : {}),
      meetings: evs.length,
      guests: guests.slice(0, 6),
    };
  });
  review.sort((a, b) => (a.next && b.next ? a.next.start.localeCompare(b.next.start) : a.next ? -1 : b.next ? 1 : (b.last?.start ?? "").localeCompare(a.last?.start ?? "")));

  const agendaUntil = startOfLocalDay(now) + (AGENDA_DAYS + 1) * DAY;
  const agenda: AgendaItem[] = upcoming
    .filter((e) => Date.parse(e.start) < agendaUntil)
    .map((e) => {
      const primary = e.companies[0];
      const meetingId = meetingOf(e);
      const policy = primary ? policyFor(ws, primary.domain, Date.parse(e.start), now, lists) : null;
      const kind: AgendaItem["kind"] = !primary ? "personal" : meetingId || (policy === "apply" && !consumer) ? "pipeline" : policy === "skip" ? "ignored" : "review";
      return {
        id: e.id,
        title: e.title,
        start: e.start,
        ...(e.end ? { end: e.end } : {}),
        kind,
        ...(primary ? { domain: primary.domain, company: companyName(ws, primary.domain, [e]) } : {}),
        ...(meetingId ? { meetingId } : {}),
        guests: [...(primary?.guests ?? []), ...e.personal].slice(0, 5),
        ...(e.conference ? { conference: e.conference } : {}),
      };
    })
    .sort((a, b) => a.start.localeCompare(b.start));

  return {
    window: { pastDays: PAST_DAYS, futureDays: FUTURE_DAYS },
    ...(consumer ? { consumer: true } : {}),
    upcoming: {
      total: upcoming.length,
      pipeline: upcoming.filter((e) => e.companies.some((c) => isOpenDeal(ws, c.domain))).length,
      newCompanies: newDomains.size,
      personal: upcoming.filter((e) => !e.companies.length).length,
    },
    past: { total: past.length, onDeals: past.filter((e) => !!meetingOf(e)).length },
    hidden: stats?.hidden ?? { internal: 0, solo: 0, allDay: 0, declined: 0 },
    notes: digestNotes(stats, consumer),
    review,
    agenda,
  };
}

/* ───────────── Today: meetings with companies that aren't tracked yet ───────────── */

/** FNV-1a, for short stable move ids. */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(36);
}

const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

export type CalendarMove = Pick<Move, "id" | "kind" | "title" | "why" | "minutes" | "priority" | "rule" | "href" | "dueOn">;

/**
 * A meeting today or tomorrow with a company that isn't tracked: a card on Today, so it can be tracked and
 * prepped before the call. Upcoming meetings with tracked companies need no card here: they're meetings
 * on a deal, and Today's own prep card covers them.
 */
/** The Today card for one meeting with one company. */
export const calendarMoveId = (domain: string, eventId: string) => `mv_cal_${hash(`${domain}|${eventId}`)}`;

export function newCompanyMoves(review: ReviewCompany[], now: number): CalendarMove[] {
  const today = todayISO(new Date(now));
  const until = startOfLocalDay(now) + 2 * DAY;
  const out: CalendarMove[] = [];
  for (const r of review) {
    if (!r.next) continue;
    const t = Date.parse(r.next.start);
    if (t < now || t >= until) continue;
    const when = localDate(r.next.start) === today ? `today at ${clock(r.next.start)}` : `tomorrow at ${clock(r.next.start)}`;
    const who = r.guests.map((g) => g.name ?? g.email).filter(Boolean).slice(0, 2).join(" and ");
    out.push({
      id: calendarMoveId(r.domain, r.next.id),
      kind: "meeting_prep",
      title: `Track ${r.name} before your call ${when}`,
      why: `${r.status === "new" ? "New company on your calendar" : "On your calendar, not in your pipeline"} · ${r.next.title || "Meeting"}${who ? ` with ${who}` : ""} · Track it and I'll prep the brief`,
      minutes: 2,
      priority: 89,
      rule: CALENDAR_MOVE_RULE,
      href: `/integrations?calendar=review#calendar`,
      dueOn: today,
    });
  }
  return out;
}

/** Puts the wanted cards on the workspace and settles the ones that no longer apply. In place; true when anything changed. */
export function applyCalendarMoves(ws: Workspace, wanted: CalendarMove[], now: number): boolean {
  const at = new Date(now).toISOString();
  const today = todayISO(new Date(now));
  const ids = new Set(wanted.map((m) => m.id));
  let changed = false;
  for (const m of Object.values(ws.moves)) {
    if (m.rule !== CALENDAR_MOVE_RULE || ids.has(m.id) || m.status !== "open") continue;
    Object.assign(m, { status: "done", autoDone: true });
    changed = true;
  }
  for (const w of wanted) {
    const prev = ws.moves[w.id];
    if (!prev) {
      ws.moves[w.id] = { ...w, createdAt: at, evidenceIds: [], status: "open" };
      changed = true;
      continue;
    }
    // The founder's own decision (done, skipped, snoozed) stands; a card the clock expired comes back.
    const reopen = prev.status === "done" && prev.autoDone;
    if (prev.status !== "open" && !reopen) continue;
    if (prev.title !== w.title || prev.why !== w.why || prev.dueOn !== today || reopen) {
      Object.assign(prev, { title: w.title, why: w.why, dueOn: today, status: "open" });
      delete prev.autoDone;
      changed = true;
    }
  }
  return changed;
}
