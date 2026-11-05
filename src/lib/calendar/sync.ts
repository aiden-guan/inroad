import "server-only";
import { createHash } from "node:crypto";
import { isConsumer } from "@/lib/consumer/market";
import { applyAction } from "@/lib/domain/actions";
import { nowISO } from "@/lib/domain/ids";
import type { Workspace } from "@/lib/domain/types";
import { receivePolled } from "@/lib/hub/inbound";
import { ensureAccount, normalizeDomain } from "@/lib/hub/records";
import { mutateHub, readHub, type HubState } from "@/lib/hub/store";
import { sampleCalendar } from "@/lib/sample/calendar";
import { getSecret, mutateWorkspace, readWorkspace, setSecrets } from "@/lib/store/workspace";
import { normalizeAddress, sourceOf } from "./address";
import { guessCompanyName } from "./classify";
import { fetchFeed, type FeedErrorCode } from "./fetch";
import { applyCalendarMoves, buildDigest, calendarMoveId, newCompanyMoves, planSync, syncWindow, type Plan } from "./plan";
import { readFeed } from "./read";
import { mutateCalendarStore, readCalendarStore } from "./store";
import { CALENDAR_MOVE_RULE, type CalendarDigest, type StoredEvent } from "./types";

/**
 * The calendar connection, end to end. Every 15 minutes while Inroad is open (src/lib/hub/poll.ts), and
 * right after connecting: read the feed through the SSRF guard, decide in code (src/lib/calendar/plan.ts),
 * and hand the meetings that belong on deals to the same booking path Calendly and Cal.com use, so a
 * meeting, its people and its deal are made, moved and cancelled the same way. Zero tokens.
 */

const SECRET = "url";
const POLL_EVERY_MS = 15 * 60_000;
const OPEN_MOVES = (ws: Workspace) => Object.values(ws.moves).filter((m) => m.rule === CALENDAR_MOVE_RULE);

export type SyncResult = { ok: true; changed: boolean; summary?: string } | { ok: false; code: FeedErrorCode; message: string };

const PREFIX = "booking:calendar:";

/** Booking id → meeting id, from the hub's ledger. */
function refsFrom(refs: HubState["refs"]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(refs)) if (k.startsWith(PREFIX)) out[k.slice(PREFIX.length)] = v.id;
  return out;
}

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

/** Links first (meetings already on the deal), then the bookings, through the booking path. True when the workspace changed. */
async function send(plan: Plan): Promise<boolean> {
  if (!plan.bookings.length && !Object.keys(plan.links).length) return false;
  const at = nowISO();
  await mutateHub((h) => {
    for (const [id, meetingId] of Object.entries(plan.links)) h.refs[`${PREFIX}${id}`] = { id: meetingId, at };
    // The plan already knows what changed. The booking path's own dedupe would hide a meeting moved back to a time it had before.
    for (const b of plan.bookings) delete h.seen[`${PREFIX}${b.id}:${b.action}:${b.startsAt ?? ""}`];
  });
  let changed = Object.keys(plan.links).length > 0;
  for (let i = 0; i < plan.bookings.length; i += 400) {
    const chunk = plan.bookings.slice(i, i + 400);
    const key = `cal:${createHash("sha256").update(JSON.stringify(chunk)).digest("hex").slice(0, 24)}`;
    if (await receivePolled("calendar", chunk, key)) changed = true;
  }
  return changed;
}

function summaryOf(plan: Plan, newCompanies: number): string | undefined {
  const parts: string[] = [];
  if (plan.added) parts.push(`${plural(plan.added, "meeting")} added to deals`);
  if (plan.moved) parts.push(`${plural(plan.moved, "meeting")} moved`);
  if (plan.cancelled) parts.push(`${plural(plan.cancelled, "meeting")} cancelled`);
  if (newCompanies) parts.push(`${plural(newCompanies, "new company", "new companies")} to review`);
  return parts.length ? parts.join(" · ") : undefined;
}

/** The poll ledger's line for the calendar, so the poller's 15-minute cadence counts manual reads too. */
async function notePoll(result: SyncResult) {
  const at = nowISO();
  await mutateHub((h) => {
    const prev = h.poll?.calendar ?? { cursor: {} };
    h.poll = {
      ...h.poll,
      calendar: result.ok
        ? { cursor: {}, lastAt: at, ...(result.summary ? { lastSummary: result.summary } : prev.lastSummary ? { lastSummary: prev.lastSummary } : {}) }
        : { ...prev, lastAt: at, lastError: result.message, nextAt: new Date(Date.now() + (result.code === "auth" ? 30 : 5) * 60_000).toISOString() },
    };
  });
}

async function noteError(message: string, code: FeedErrorCode) {
  const at = nowISO();
  await mutateCalendarStore((s) => {
    s.lastError = { at, message };
  });
  // An address that stopped working needs the founder; an outage doesn't.
  if (code === "auth" || code === "validation") {
    await mutateWorkspace((ws) => {
      const st = ws.integrations.calendar;
      if (st) st.lastError = { at, message };
    });
  }
}

/** The feed's text → the workspace. Exported for tests; the poller and Connect read the feed first. */
export async function applyFeed(text: string): Promise<SyncResult> {
  const now = Date.now();
  const store = readCalendarStore();
  const knownEvents = new Set(Object.keys(store.sent).map((id) => id.slice(0, id.lastIndexOf("#"))));
  let read: ReturnType<typeof readFeed>;
  try {
    read = readFeed(text, { ws: readWorkspace(), now, known: (id) => knownEvents.has(id) });
  } catch {
    const message = "That address didn't return a calendar file. Copy the private iCal (ICS) address and try again.";
    await noteError(message, "auth");
    return { ok: false, code: "auth", message };
  }
  // A different calendar than last time: forget what was sent for the old one. Its meetings stay on the deals.
  const sent = store.name && read.name && store.name !== read.name ? {} : store.sent;
  const lists = { ignored: store.ignored, accepted: store.accepted };
  const plan = planSync({ ws: readWorkspace(), events: read.events, sent, lists, complete: read.stats.complete, now, refs: refsFrom(readHub().refs) });
  const sentChanged = await send(plan);
  const at = nowISO();
  await mutateCalendarStore((s) => {
    s.events = read.events;
    s.stats = read.stats;
    s.sent = plan.sent;
    s.lastSyncAt = at;
    if (read.name) s.name = read.name;
    delete s.lastError;
  });

  const ws = readWorkspace();
  const digest = buildDigest({ ws, events: read.events, stats: read.stats, lists, refs: refsFrom(readHub().refs), now });
  const wanted = isConsumer(ws) ? [] : newCompanyMoves(digest.review, now);
  // Only write the workspace when something on it changes: every write makes every open tab refresh.
  const probe = { moves: structuredClone(ws.moves) } as Workspace;
  const movesChange = applyCalendarMoves(probe, wanted, now);
  const st = ws.integrations.calendar;
  const labelChange = !!read.name && st?.config.accountLabel !== read.name;
  let changed = sentChanged;
  if (movesChange || st?.lastError || labelChange) {
    await mutateWorkspace((w) => {
      applyCalendarMoves(w, wanted, now);
      const s = w.integrations.calendar;
      if (s) {
        delete s.lastError;
        s.lastSyncAt = at;
        if (read.name) s.config.accountLabel = read.name;
      }
    });
    changed = true;
  }
  return { ok: true, changed, summary: summaryOf(plan, digest.review.filter((r) => r.status === "new").length) };
}

async function readAndApply(): Promise<SyncResult> {
  const ws = readWorkspace();
  if (ws.sample || !ws.integrations.calendar?.enabled) return { ok: true, changed: false };
  const url = getSecret("calendar", SECRET);
  if (!url) {
    const message = "The calendar address is missing. Paste it again.";
    await noteError(message, "auth");
    return { ok: false, code: "auth", message };
  }
  const r = await fetchFeed(url);
  if (!r.ok) {
    await noteError(r.message, r.code);
    return r;
  }
  return applyFeed(r.text);
}

/** One read at a time, shared by the poller and the Sync button (and across route bundles in dev). */
export function syncCalendar(): Promise<SyncResult> {
  const g = globalThis as unknown as { __inroadCalendarSync?: Promise<SyncResult> | null };
  g.__inroadCalendarSync ??= readAndApply().finally(() => {
    g.__inroadCalendarSync = null;
  });
  return g.__inroadCalendarSync;
}

/** Sync now, from the Integrations page: also writes the poll ledger, so the poller waits its 15 minutes. */
export async function syncCalendarNow(): Promise<SyncResult> {
  const r = await syncCalendar();
  await notePoll(r);
  return r;
}

export type ConnectResult = { ok: true; summary?: string } | { ok: false; message: string };

/** Checks the pasted address with one read, keeps it in secrets.json (never the workspace), then backfills. */
export async function connectCalendar(raw: string): Promise<ConnectResult> {
  if (readWorkspace().sample) return { ok: false, message: "This is the sample workspace. Start with your own company before connecting your calendar." };
  const check = normalizeAddress(raw);
  if (!check.ok) return check;
  const r = await fetchFeed(check.url);
  if (!r.ok) return { ok: false, message: r.message };
  let name: string | undefined;
  try {
    name = readFeed(r.text, { ws: readWorkspace(), now: Date.now() }).name;
  } catch {
    return { ok: false, message: "That address didn't return a calendar file. Copy the private iCal (ICS) address and try again." };
  }
  const source = sourceOf(check.url, name);
  const previous = getSecret("calendar", SECRET);
  setSecrets("calendar", { [SECRET]: check.url });
  try {
    await mutateWorkspace((ws) => {
      const prev = ws.integrations.calendar;
      ws.integrations.calendar = {
        id: "calendar",
        enabled: true,
        connectedAt: nowISO(),
        config: { ...(prev?.config ?? {}), accountLabel: name ?? source.label, provider: source.provider, host: source.host },
        stats: prev?.stats ?? { pushed: 0, pulled: 0 },
      };
    });
  } catch (err) {
    setSecrets("calendar", { [SECRET]: previous ?? null });
    throw err;
  }
  const result = await applyFeed(r.text);
  await notePoll(result);
  return result.ok ? { ok: true, summary: result.summary } : { ok: false, message: result.message };
}

/** Forgets the address and what was read. Meetings already on deals stay; Track and Ignore decisions are kept for a reconnect. */
export async function disconnectCalendar(): Promise<void> {
  setSecrets("calendar", { [SECRET]: null });
  await mutateWorkspace((ws) => {
    const st = ws.integrations.calendar;
    if (st) {
      st.enabled = false;
      delete st.connectedAt;
      delete st.lastError;
    }
    applyCalendarMoves(ws, [], Date.now());
  });
  await mutateCalendarStore((s) => {
    s.events = [];
    s.sent = {};
    delete s.stats;
    delete s.lastSyncAt;
    delete s.lastError;
  });
  await mutateHub((h) => {
    if (h.poll?.calendar) delete h.poll.calendar;
  });
}

/* ───────────── Track and Ignore ───────────── */

function eventsFor(ws: Workspace): StoredEvent[] {
  return ws.sample ? sampleCalendar(new Date()).events : readCalendarStore().events;
}

export type TrackResult = { ok: true; name: string; domain: string; meetings: number; meetingIds: Record<string, string> } | { ok: false; message: string };

/**
 * The founder says a company on the calendar is a sales conversation: it's added (or tracked), and every one
 * of its meetings in the window goes on its deal through the booking path, which starts the deal at Talking.
 */
export async function trackCompany(raw: string): Promise<TrackResult> {
  const domain = normalizeDomain(raw);
  if (!domain) return { ok: false, message: "That isn't a company domain." };
  const ws = readWorkspace();
  if (isConsumer(ws)) return { ok: false, message: "You sell to consumers, so meetings aren't added to deals." };
  const now = Date.now();
  const { from, to } = syncWindow(now);
  const theirs = eventsFor(ws).filter((e) => e.status !== "cancelled" && Date.parse(e.start) >= from && Date.parse(e.start) <= to && e.companies.some((c) => c.domain === domain));
  if (!theirs.length) return { ok: false, message: `I can't find a meeting with ${domain} on your calendar anymore.` };
  if (ws.accounts[domain]?.status === "disqualified") return { ok: false, message: `${ws.accounts[domain].name} is disqualified. Restore it on Companies first.` };
  const name = ws.accounts[domain]?.name ?? guessCompanyName(domain, theirs.map((e) => e.title), [ws.company?.name, ws.sender?.company].filter((x): x is string => !!x));
  const at = nowISO();
  await mutateWorkspace((w) => {
    ensureAccount(w, { domain, name }, { source: "integration", sourceDetail: "Calendar", at, tag: "via:calendar" });
    if (!w.accounts[domain].watch) applyAction(w, { type: "account.track", domain, watch: true });
    // The Today card for this company has done its job.
    const ids = new Set(theirs.map((e) => calendarMoveId(domain, e.id)));
    for (const m of OPEN_MOVES(w)) if (ids.has(m.id) && m.status === "open") Object.assign(m, { status: "done", autoDone: true });
  });
  const store = readCalendarStore();
  const plan = planSync({ ws: readWorkspace(), events: theirs, sent: ws.sample ? {} : store.sent, lists: { ignored: [], accepted: [domain] }, complete: false, now, refs: refsFrom(readHub().refs), onlyDomain: domain });
  await send(plan);
  if (!ws.sample) {
    await mutateCalendarStore((s) => {
      s.accepted = [...new Set([...s.accepted, domain])];
      s.ignored = s.ignored.filter((d) => d !== domain);
      for (const [id, entry] of Object.entries(plan.sent)) if (id.endsWith(`#${domain}`)) s.sent[id] = entry;
    });
  }
  const refs = refsFrom(readHub().refs);
  const after = readWorkspace();
  const meetingIds: Record<string, string> = {};
  for (const e of theirs) {
    const id = refs[`${e.id}#${domain}`];
    if (id && after.meetings[id]) meetingIds[e.id] = id;
  }
  return { ok: true, name: after.accounts[domain]?.name ?? name, domain, meetings: Object.keys(meetingIds).length, meetingIds };
}

/** Not a sales meeting (an investor, a vendor, a friend): never ask about this domain again. `undo` asks again. */
export async function ignoreCompany(raw: string, undo = false): Promise<{ ok: true } | { ok: false; message: string }> {
  const domain = normalizeDomain(raw);
  if (!domain) return { ok: false, message: "That isn't a company domain." };
  const ws = readWorkspace();
  await mutateCalendarStore((s) => {
    const key = ws.sample ? "sampleIgnored" : "ignored";
    s[key] = undo ? s[key].filter((d) => d !== domain) : [...new Set([...s[key], domain])];
  });
  if (!undo) {
    const ids = new Set(eventsFor(ws).map((e) => calendarMoveId(domain, e.id)));
    if (OPEN_MOVES(ws).some((m) => ids.has(m.id) && m.status === "open")) {
      await mutateWorkspace((w) => {
        for (const m of OPEN_MOVES(w)) if (ids.has(m.id) && m.status === "open") Object.assign(m, { status: "done", autoDone: true });
      });
    }
  }
  return { ok: true };
}

/* ───────────── What the Integrations page shows ───────────── */

export function calendarDigest(): CalendarDigest {
  const ws = readWorkspace();
  const now = Date.now();
  const store = readCalendarStore();
  const hub = readHub();
  if (ws.sample) {
    const s = sampleCalendar(new Date(now));
    const refs = { ...s.refs, ...refsFrom(hub.refs) };
    return { state: "sample", source: s.source, lastSyncAt: s.stats.at, ...buildDigest({ ws, events: s.events, stats: s.stats, lists: { ignored: store.sampleIgnored, accepted: [] }, refs, now }) };
  }
  const st = ws.integrations.calendar;
  if (!st?.enabled) return { state: "off", ...buildDigest({ ws, events: [], lists: { ignored: [], accepted: [] }, refs: {}, now }) };
  const url = getSecret("calendar", SECRET);
  const poll = hub.poll?.calendar;
  const nextSyncAt = poll?.nextAt ?? (poll?.lastAt ? new Date(Date.parse(poll.lastAt) + POLL_EVERY_MS).toISOString() : undefined);
  return {
    state: "connected",
    ...(url ? { source: sourceOf(url, store.name) } : {}),
    ...(st.connectedAt ? { connectedAt: st.connectedAt } : {}),
    ...(store.lastSyncAt ? { lastSyncAt: store.lastSyncAt } : {}),
    ...((st.lastError?.message ?? store.lastError?.message) ? { lastError: st.lastError?.message ?? store.lastError?.message } : {}),
    ...(nextSyncAt ? { nextSyncAt } : {}),
    ...buildDigest({ ws, events: store.events, stats: store.stats, lists: { ignored: store.ignored, accepted: store.accepted }, refs: refsFrom(hub.refs), now }),
  };
}

/** Meetings on the calendar with companies that aren't tracked yet, for matching a transcript to its call. */
export function pendingCalendarMeetings(): { eventId: string; domain: string; company: string; title: string; start: string; guests: string[] }[] {
  const digest = calendarDigest();
  if (digest.state === "off") return [];
  const ws = readWorkspace();
  const events = eventsFor(ws);
  const review = new Map(digest.review.map((r) => [r.domain, r.name]));
  const out: ReturnType<typeof pendingCalendarMeetings> = [];
  for (const e of events) {
    if (e.status === "cancelled") continue;
    for (const c of e.companies) {
      const company = review.get(c.domain);
      if (!company) continue;
      out.push({ eventId: e.id, domain: c.domain, company, title: e.title, start: e.start, guests: c.guests.map((g) => g.name ?? g.email ?? "").filter(Boolean) });
    }
  }
  return out;
}
