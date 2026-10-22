import "server-only";
import { createHash } from "node:crypto";
import { activitySourceFor, inboundSourceName } from "@/lib/connectors/catalog";
import { applyAction } from "@/lib/domain/actions";
import { newId, nowISO, todayISO } from "@/lib/domain/ids";
import type { Account, Activity, ActivityKind, Deal, Meeting, Person, Workspace } from "@/lib/domain/types";
import { mutateWorkspace, readWorkspace } from "@/lib/store/workspace";
import { emitHubEvent } from "./events";
import { accountData, activityData, personData } from "./payloads";
import { askedToBeDeleted, companyDomainOf, ensureAccount, ensurePerson, findPerson, normalizeDomain, normalizeEmail } from "./records";
import { mutateHub, readHub } from "./store";
import type { InboundCounts, InboundLogEntry } from "./types";

/**
 * Inbound webhooks: other tools push accounts, people, activities and bookings into Inroad.
 *
 * Everything here is deterministic code: an alias table maps field names, vendor reply labels
 * (Instantly, Smartlead, lemlist) set sentiment, so triage costs zero tokens.
 *
 * Everything pushed in is untrusted data. It is stored and shown, and it can create a move for
 * the founder, but it never sends anything, never writes to a CRM and never fires an outbound
 * webhook. The only thing it may trigger is a Slack alert to the founder's own channel.
 */

type Sentiment = NonNullable<Activity["sentiment"]>;

interface InAccount {
  domain: string;
  name?: string;
  city?: string;
}
interface InPerson {
  email?: string;
  name?: string;
  title?: string;
  domain?: string;
  linkedinUrl?: string;
  location?: string;
}
interface InActivity {
  externalId?: string;
  kind: ActivityKind;
  /** A vendor label for the latest reply (e.g. Instantly `lead_interested`), not a new message. */
  labelOnly?: boolean;
  email?: string;
  name?: string;
  domain?: string;
  at?: string;
  summary?: string;
  body?: string;
  sentiment?: Sentiment;
  label?: string;
  channel?: Activity["channel"];
}
interface InBooking {
  externalId: string;
  /** For reschedules: the booking being replaced. */
  replaces?: string;
  action: "created" | "canceled" | "rescheduled";
  title: string;
  startsAt?: string;
  attendees: { email?: string; name?: string }[];
}
interface Normalized {
  accounts: InAccount[];
  people: InPerson[];
  activities: InActivity[];
  bookings: InBooking[];
  unmapped: Set<string>;
  ignored: number;
}

const MAX_ROWS = 500;

/* ───────────── Field aliases ───────────── */

const ALIASES = {
  domain: ["domain", "companydomain", "website", "companywebsite", "websiteurl", "companyurl", "organizationdomain", "primarydomain"],
  company: ["company", "companyname", "organization", "organizationname", "account", "accountname", "employer"],
  email: ["email", "workemail", "emailaddress", "businessemail", "leademail", "personemail", "contactemail", "toemail"],
  first: ["firstname", "first", "givenname"],
  last: ["lastname", "last", "surname", "familyname"],
  name: ["name", "fullname", "personname", "contactname", "leadname"],
  title: ["title", "jobtitle", "position", "role", "headline"],
  linkedin: ["linkedin", "linkedinurl", "linkedinprofile", "linkedinprofileurl", "personlinkedinurl", "profileurl"],
  location: ["location", "city", "personcity", "personlocation", "companycity", "hqcity"],
} as const;
const KNOWN_KEYS = new Set<string>(Object.values(ALIASES).flat());
// Hosts that are profiles, job boards or articles about a company, never the company's own site.
const NOT_COMPANY_HOST =
  /(^|\.)(linkedin\.com|x\.com|twitter\.com|github\.com|crunchbase\.com|greenhouse\.io|lever\.co|ashbyhq\.com|wellfound\.com|angel\.co|ycombinator\.com|facebook\.com|instagram\.com|youtube\.com|medium\.com|substack\.com|google\.com)$/;
// Envelope and bookkeeping keys that aren't data the founder needs to map.
const IGNORED_KEYS = new Set(["id", "externalid", "type", "event", "eventtype", "data", "timestamp", "createdat", "updatedat", "source", "secret", "custom", "accounts", "people", "activities"]);

const k = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const isObj = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : undefined);

function indexRow(row: Record<string, unknown>): Map<string, unknown> {
  const m = new Map<string, unknown>();
  for (const [key, v] of Object.entries(row)) m.set(k(key), v);
  return m;
}

function pick(row: Map<string, unknown>, field: keyof typeof ALIASES): string | undefined {
  for (const alias of ALIASES[field]) {
    const v = str(row.get(alias));
    if (v) return v.slice(0, 300);
  }
  return undefined;
}

function isoOr(v: unknown, fallback: string): string {
  if (typeof v === "number") return new Date(v > 1e12 ? v : v * 1000).toISOString();
  const s = str(v);
  if (!s) return fallback;
  const t = Date.parse(s);
  return Number.isNaN(t) ? fallback : new Date(t).toISOString();
}

/** A flat row (Clay, Zapier, CSV-like) → an account and/or a person. */
function fromRow(raw: Record<string, unknown>, n: Normalized) {
  const row = indexRow(raw);
  const email = normalizeEmail(pick(row, "email"));
  const first = pick(row, "first");
  const last = pick(row, "last");
  const title = pick(row, "title");
  const linkedinRaw = pick(row, "linkedin");
  const personLinkedin = linkedinRaw && /linkedin\.com\/in\//i.test(linkedinRaw) ? linkedinRaw : undefined;
  const isPerson = Boolean(email || first || last || title || personLinkedin);
  const nameField = pick(row, "name");
  const company = pick(row, "company");
  let domain = normalizeDomain(pick(row, "domain"));
  if (domain && NOT_COMPANY_HOST.test(domain)) domain = null;
  domain ??= companyDomainOf(email);
  // A generic `url` is often a job post, profile or article, so it's the last resort for the domain.
  const urlHost = normalizeDomain(str(row.get("url")));
  const usedUrl = !domain && Boolean(urlHost) && !NOT_COMPANY_HOST.test(urlHost!);
  if (usedUrl) domain = urlHost;
  const location = pick(row, "location");

  if (domain) n.accounts.push({ domain, name: company ?? (isPerson ? undefined : nameField), city: isPerson ? undefined : location });
  if (isPerson) {
    n.people.push({ email: email ?? undefined, name: [first, last].filter(Boolean).join(" ") || nameField, title, domain: domain ?? undefined, linkedinUrl: personLinkedin, location });
  }
  for (const key of row.keys()) if (!KNOWN_KEYS.has(key) && !IGNORED_KEYS.has(key) && !(key === "url" && usedUrl)) n.unmapped.add(key);
}

/* ───────────── Activities and labels ───────────── */

const KIND: Record<string, ActivityKind> = {
  reply: "reply_received",
  replyreceived: "reply_received",
  replied: "reply_received",
  emailreplied: "reply_received",
  emailreply: "reply_received",
  sent: "touch_sent",
  emailsent: "touch_sent",
  email: "touch_sent",
  touch: "touch_sent",
  touchsent: "touch_sent",
  meeting: "meeting_held",
  meetingheld: "meeting_held",
  call: "meeting_held",
  linkedin: "linkedin_dm",
  linkedindm: "linkedin_dm",
  linkedinmessage: "linkedin_dm",
  linkedinconnect: "linkedin_connect",
  connectionrequest: "linkedin_connect",
  bounce: "bounce",
  bounced: "bounce",
  emailbounced: "bounce",
  unsubscribe: "unsubscribe",
  unsubscribed: "unsubscribe",
  note: "note",
};

/** Vendor reply labels → sentiment. Instantly, Smartlead and lemlist all label replies for free. */
const SENTIMENT: Record<string, Sentiment> = {
  interested: "positive",
  positive: "positive",
  leadinterested: "positive",
  meetingrequest: "positive",
  meetingbooked: "positive",
  leadmeetingbooked: "positive",
  informationrequest: "positive",
  emailsinterested: "positive",
  hot: "positive",
  notinterested: "negative",
  negative: "negative",
  leadnotinterested: "negative",
  emailsnotinterested: "negative",
  outofoffice: "ooo",
  ooo: "ooo",
  leadoutofoffice: "ooo",
  autoreply: "ooo",
  unsubscribe: "unsubscribe",
  unsubscribed: "unsubscribe",
  donotcontact: "unsubscribe",
  leadunsubscribed: "unsubscribe",
  referral: "referral",
  referred: "referral",
  wrongperson: "neutral",
  leadwrongperson: "neutral",
  neutral: "neutral",
};

const LABEL: Record<Sentiment, string> = {
  positive: "Interested",
  referral: "Referral",
  neutral: "Replied",
  negative: "Not interested",
  ooo: "Out of office",
  unsubscribe: "Unsubscribe",
};

function sentimentOf(label: string | undefined): Sentiment | undefined {
  return label ? SENTIMENT[k(label)] : undefined;
}

function genericActivity(o: Record<string, unknown>, fallbackAt: string): InActivity {
  const row = indexRow(o);
  const type = str(o.type ?? o.kind ?? o.event ?? o.event_type) ?? "note";
  const email = normalizeEmail(str(o.person_email) ?? str(o.lead_email) ?? pick(row, "email"));
  const label = str(o.sentiment ?? o.label ?? o.category);
  return {
    externalId: str(o.external_id ?? o.id ?? o.message_id),
    kind: KIND[k(type)] ?? "note",
    email: email ?? undefined,
    name: pick(row, "name"),
    domain: normalizeDomain(str(o.company_domain) ?? str(o.domain)) ?? companyDomainOf(email) ?? undefined,
    at: isoOr(o.occurred_at ?? o.at ?? o.timestamp ?? o.date, fallbackAt),
    summary: str(o.summary ?? o.subject)?.slice(0, 200),
    body: str(o.body ?? o.text ?? o.reply_text ?? o.message)?.slice(0, 4000),
    sentiment: sentimentOf(label),
    label,
    channel: /linkedin/i.test(type) ? "linkedin" : undefined,
  };
}

/* ───────────── Per-source parsers ───────────── */

function emptyNorm(): Normalized {
  return { accounts: [], people: [], activities: [], bookings: [], unmapped: new Set(), ignored: 0 };
}

function parseGeneric(payload: unknown, at: string): Normalized {
  const n = emptyNorm();
  const items = (Array.isArray(payload) ? payload : [payload]).slice(0, MAX_ROWS);
  for (const item of items) {
    if (!isObj(item)) continue;
    if (Array.isArray(item.accounts) || Array.isArray(item.people) || Array.isArray(item.activities)) {
      for (const a of (Array.isArray(item.accounts) ? item.accounts : []).slice(0, MAX_ROWS)) if (isObj(a)) fromRow(a, n);
      for (const p of (Array.isArray(item.people) ? item.people : []).slice(0, MAX_ROWS)) if (isObj(p)) fromRow(p, n);
      for (const x of (Array.isArray(item.activities) ? item.activities : []).slice(0, MAX_ROWS)) if (isObj(x)) n.activities.push(genericActivity(x, at));
      continue;
    }
    // Envelope: { type: "lead.upsert" | "reply.received" | …, data: {…} }
    if (typeof item.type === "string" && isObj(item.data)) {
      if (/reply|activity|touch|email|meeting|linkedin|bounce|unsub|note/i.test(item.type) && !/lead|account|company|person|contact/i.test(item.type)) {
        n.activities.push(genericActivity({ type: item.type.split(".").pop(), ...item.data }, at));
      } else fromRow(item.data, n);
      continue;
    }
    fromRow(item, n);
  }
  return n;
}

function parseInstantly(payload: unknown, at: string): Normalized {
  const n = emptyNorm();
  for (const item of (Array.isArray(payload) ? payload : [payload]).slice(0, MAX_ROWS)) {
    if (!isObj(item)) continue;
    const ev = k(str(item.event_type) ?? "");
    const email = normalizeEmail(item.lead_email ?? item.email) ?? undefined;
    const base = {
      externalId: str(item.email_id ?? item.id) ?? (email ? `${ev}:${email}:${str(item.timestamp) ?? ""}` : undefined),
      email,
      name: [str(item.first_name ?? item.firstName), str(item.last_name ?? item.lastName)].filter(Boolean).join(" ") || undefined,
      domain: normalizeDomain(str(item.website) ?? str(item.company_domain)) ?? companyDomainOf(email) ?? undefined,
      at: isoOr(item.timestamp, at),
    };
    if (ev === "replyreceived") n.activities.push({ ...base, kind: "reply_received", body: str(item.reply_text ?? item.reply_text_snippet)?.slice(0, 4000), summary: str(item.reply_subject) });
    else if (ev === "emailbounced") n.activities.push({ ...base, kind: "bounce" });
    else if (ev === "leadunsubscribed") n.activities.push({ ...base, kind: "unsubscribe" });
    else if (sentimentOf(ev)) n.activities.push({ ...base, kind: "reply_received", labelOnly: true, sentiment: sentimentOf(ev), label: ev === "leadmeetingbooked" ? "Meeting booked" : undefined });
    else n.ignored++;
  }
  return n;
}

function parseSmartlead(payload: unknown, at: string): Normalized {
  const n = emptyNorm();
  for (const item of (Array.isArray(payload) ? payload : [payload]).slice(0, MAX_ROWS)) {
    if (!isObj(item)) continue;
    const ev = k(str(item.event_type ?? item.type) ?? "");
    const lead = isObj(item.lead) ? item.lead : {};
    const email = normalizeEmail(item.lead_email ?? item.sl_lead_email ?? item.to_email ?? lead.email) ?? undefined;
    const category = isObj(item.lead_category) ? str(item.lead_category.new_name) : str(item.lead_category ?? item.category_name ?? item.new_category);
    const reply = isObj(item.reply_message) ? str(item.reply_message.text) : str(item.reply_message ?? item.reply_body);
    const base = {
      externalId: str(item.message_id ?? item.stats_id ?? item.id) ?? (email ? `${ev}:${email}:${str(item.event_timestamp ?? item.time_replied) ?? ""}` : undefined),
      email,
      name: [str(lead.first_name), str(lead.last_name)].filter(Boolean).join(" ") || undefined,
      domain: companyDomainOf(email) ?? undefined,
      at: isoOr(item.event_timestamp ?? item.time_replied ?? item.timestamp, at),
    };
    if (ev === "emailreply" || ev === "emailreplied") n.activities.push({ ...base, kind: "reply_received", body: reply?.slice(0, 4000), sentiment: sentimentOf(category), label: category });
    else if (ev === "leadcategoryupdated" && sentimentOf(category)) n.activities.push({ ...base, kind: "reply_received", labelOnly: true, sentiment: sentimentOf(category), label: category });
    else if (ev === "emailbounced" || ev === "emailbounce") n.activities.push({ ...base, kind: "bounce" });
    else if (ev === "leadunsubscribed" || ev === "emailunsubscribed") n.activities.push({ ...base, kind: "unsubscribe" });
    else n.ignored++;
  }
  return n;
}

function parseLemlist(payload: unknown, at: string): Normalized {
  const n = emptyNorm();
  for (const item of (Array.isArray(payload) ? payload : [payload]).slice(0, MAX_ROWS)) {
    if (!isObj(item)) continue;
    const ev = k(str(item.type) ?? "");
    const email = normalizeEmail(item.leadEmail ?? item.email ?? (isObj(item.lead) ? item.lead.email : undefined)) ?? undefined;
    const base = {
      externalId: str(item._id ?? item.id) ?? (email ? `${ev}:${email}:${str(item.createdAt) ?? ""}` : undefined),
      email,
      name: [str(item.leadFirstName ?? item.firstName), str(item.leadLastName ?? item.lastName)].filter(Boolean).join(" ") || undefined,
      domain: normalizeDomain(str(item.companyDomain)) ?? companyDomainOf(email) ?? undefined,
      at: isoOr(item.createdAt ?? item.date, at),
    };
    if (ev === "emailsreplied" || ev === "linkedinreplied")
      n.activities.push({ ...base, kind: "reply_received", body: str(item.text ?? item.message ?? item.reply)?.slice(0, 4000), channel: ev === "linkedinreplied" ? "linkedin" : undefined });
    else if (ev === "emailsinterested" || ev === "emailsnotinterested") n.activities.push({ ...base, kind: "reply_received", labelOnly: true, sentiment: sentimentOf(ev) });
    else if (ev === "emailsbounced") n.activities.push({ ...base, kind: "bounce" });
    else if (/unsubscribed$/.test(ev)) n.activities.push({ ...base, kind: "unsubscribe" });
    else n.ignored++;
  }
  return n;
}

function parseCalendly(payload: unknown): Normalized {
  const n = emptyNorm();
  for (const item of (Array.isArray(payload) ? payload : [payload]).slice(0, 50)) {
    if (!isObj(item) || !isObj(item.payload)) continue;
    const p = item.payload;
    const ev = str(item.event);
    const sched = isObj(p.scheduled_event) ? p.scheduled_event : {};
    const id = str(sched.uri ?? p.event ?? p.uri);
    if (!id) continue;
    const attendee = { email: normalizeEmail(p.email) ?? undefined, name: str(p.name) };
    // The new invitee of a reschedule points at the old one (…/scheduled_events/{uuid}/invitees/{uuid}).
    const replaces = str(p.old_invitee)?.replace(/\/invitees\/[^/]+\/?$/, "");
    if (ev === "invitee.created")
      n.bookings.push({
        externalId: id,
        ...(replaces ? { replaces, action: "rescheduled" as const } : { action: "created" as const }),
        title: str(sched.name) ?? "Call",
        startsAt: str(sched.start_time),
        attendees: [attendee],
      });
    // A Calendly reschedule cancels the old event (rescheduled: true) and creates a new one.
    else if (ev === "invitee.canceled" && p.rescheduled !== true) n.bookings.push({ externalId: id, action: "canceled", title: str(sched.name) ?? "Call", attendees: [attendee] });
    else n.ignored++;
  }
  return n;
}

function parseCalcom(payload: unknown): Normalized {
  const n = emptyNorm();
  for (const item of (Array.isArray(payload) ? payload : [payload]).slice(0, 50)) {
    if (!isObj(item)) continue;
    const trig = str(item.triggerEvent);
    const p = isObj(item.payload) ? item.payload : item;
    const id = str(p.uid ?? p.bookingId);
    if (!id) continue;
    const attendees = (Array.isArray(p.attendees) ? p.attendees : []).filter(isObj).map((a) => ({ email: normalizeEmail(a.email) ?? undefined, name: str(a.name) }));
    const title = str(p.title ?? p.eventTitle) ?? "Call";
    if (trig === "BOOKING_CREATED") n.bookings.push({ externalId: id, action: "created", title, startsAt: str(p.startTime), attendees });
    else if (trig === "BOOKING_CANCELLED") n.bookings.push({ externalId: id, action: "canceled", title, attendees });
    else if (trig === "BOOKING_RESCHEDULED") n.bookings.push({ externalId: id, replaces: str(p.rescheduleUid ?? p.fromReschedule), action: "rescheduled", title, startsAt: str(p.startTime), attendees });
    else n.ignored++;
  }
  return n;
}

export function parseInbound(source: string, payload: unknown, at = nowISO()): Normalized {
  switch (source) {
    case "instantly":
      return parseInstantly(payload, at);
    case "smartlead":
      return parseSmartlead(payload, at);
    case "lemlist":
      return parseLemlist(payload, at);
    case "calendly":
      return parseCalendly(payload);
    case "calcom":
      return parseCalcom(payload);
    default:
      return parseGeneric(payload, at);
  }
}

/* ───────────── Applying to the workspace ───────────── */

const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 32);
const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function latestTouch(ws: Workspace, personId: string) {
  for (let i = ws.activities.length - 1; i >= 0; i--) {
    const a = ws.activities[i];
    if (a.personId === personId && a.kind === "touch_sent") return a;
  }
  return undefined;
}

function latestReply(ws: Workspace, personId: string, withinDays: number) {
  const since = Date.now() - withinDays * 86_400_000;
  for (let i = ws.activities.length - 1; i >= 0; i--) {
    const a = ws.activities[i];
    if (a.personId === personId && a.kind === "reply_received" && Date.parse(a.at) >= since) return a;
  }
  return undefined;
}

function upsertReplyMove(ws: Workspace, person: Person, account: Account | undefined, activity: Activity, via: string) {
  const s = activity.sentiment;
  const open = Object.values(ws.moves).find((m) => m.status === "open" && m.kind === "reply" && m.ref?.kind === "person" && m.ref.id === person.id);
  if (s === "negative" || s === "ooo" || s === "unsubscribe") {
    if (open && open.rule === "inbound.reply") {
      open.status = "done";
    }
    return;
  }
  const why = `${LABEL[s ?? "neutral"]} · via ${via}`;
  if (open) {
    open.why = why;
    open.receivedAt = activity.at;
    open.activityId = activity.id;
    return;
  }
  const id = newId("mov");
  ws.moves[id] = {
    id,
    createdAt: nowISO(),
    dueOn: todayISO(),
    kind: "reply",
    title: `Reply to ${firstName(person.name)} at ${account?.name ?? person.accountDomain}`,
    why,
    minutes: 5,
    ref: { kind: "person", id: person.id },
    evidenceIds: [],
    priority: 100,
    rule: "inbound.reply",
    status: "open",
    receivedAt: activity.at,
    activityId: activity.id,
    href: `/companies?c=${encodeURIComponent(person.accountDomain)}`,
  };
}

function suppress(ws: Workspace, email: string, reason: "unsubscribe" | "bounce", at: string) {
  if (ws.suppression.some((s) => s.email?.toLowerCase() === email)) return;
  ws.suppression.push({ id: newId("sup"), email, reason, at });
}

function meetingTime(iso: string) {
  return new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

interface ApplyResult {
  counts: InboundCounts;
  /** Non-reply activities by kind, for the one-line summary. */
  kinds: Partial<Record<ActivityKind, number>>;
  canceled: number;
  alerts: { activity: Activity }[];
  replies: number;
  labels: Sentiment[];
}

interface Ledger {
  /** Idempotency keys → when first seen. */
  seen: Record<string, string>;
  /** Booking external id → our meeting id. */
  refs: Record<string, { id: string; at: string }>;
}

function applyNormalized(ws: Workspace, source: string, n: Normalized, ledger: Ledger, at: string, polled = false): ApplyResult {
  const seen = ledger.seen;
  const via = inboundSourceName(source);
  const counts: InboundCounts = { accounts: 0, people: 0, activities: 0, meetings: 0, skipped: 0 };
  const alerts: { activity: Activity }[] = [];
  const labels: Sentiment[] = [];
  const kinds: Partial<Record<ActivityKind, number>> = {};
  let canceled = 0;
  let replies = 0;
  const meta = { source: "integration" as const, sourceDetail: `${via} ${polled ? "sync" : "webhook"}`, at, tag: `via:${source}` };
  const markSeen = (key: string) => {
    seen[key] = at;
  };

  for (const a of n.accounts) {
    if (ensureAccount(ws, a, meta).created) counts.accounts++;
  }

  for (const p of n.people) {
    const domain = p.domain ?? companyDomainOf(p.email);
    // Someone who asked to be deleted isn't brought back by a sync; only their address is kept, on the suppression list.
    if (!domain || askedToBeDeleted(ws, p.email)) {
      counts.skipped++;
      continue;
    }
    if (ensureAccount(ws, { domain }, meta).created) counts.accounts++;
    if (ensurePerson(ws, { domain, email: p.email, name: p.name, title: p.title, linkedinUrl: p.linkedinUrl, location: p.location }, { via, source: "integration" }).created) counts.people++;
  }

  for (const x of n.activities) {
    const key = `act:${source}:${x.externalId ?? hash(`${x.kind}|${x.email}|${x.at}|${(x.body ?? x.summary ?? "").slice(0, 200)}|${x.labelOnly ? x.sentiment : ""}`)}`;
    if (seen[key]) {
      counts.skipped++;
      continue;
    }
    let person = findPerson(ws, { email: x.email, name: x.name, domain: x.domain });
    if (!person && askedToBeDeleted(ws, x.email)) {
      // Their sequencer still reports on them (a late unsubscribe, a bounce): nothing to keep.
      markSeen(key);
      counts.skipped++;
      continue;
    }
    const domain = person?.accountDomain ?? x.domain ?? companyDomainOf(x.email);
    if (!person && domain && (x.email || x.name)) {
      if (ensureAccount(ws, { domain }, meta).created) counts.accounts++;
      const made = ensurePerson(ws, { domain, email: x.email, name: x.name }, { via, source: "integration" });
      person = made.person;
      if (made.created) counts.people++;
    }
    if (!person && !domain) {
      counts.skipped++;
      continue;
    }
    markSeen(key);
    const account = domain ? ws.accounts[domain] : undefined;
    const who = person?.name ?? x.email ?? domain ?? "someone";

    // A label for a reply we already have: update it instead of logging a second reply.
    if (x.labelOnly && person) {
      const prior = latestReply(ws, person.id, 7);
      if (prior) {
        prior.sentiment = x.sentiment ?? prior.sentiment;
        prior.summary = `${x.label ?? LABEL[prior.sentiment ?? "neutral"]} reply from ${who} via ${via}`;
        upsertReplyMove(ws, person, account, prior, via);
        if (prior.sentiment === "positive" || prior.sentiment === "referral") alerts.push({ activity: prior });
        if (x.sentiment) labels.push(x.sentiment);
        continue;
      }
    }

    const activity: Activity = {
      id: newId("act"),
      at: x.at ?? at,
      kind: x.kind,
      ...(person ? { personId: person.id } : {}),
      ...(domain ? { accountDomain: domain } : {}),
      ...(account?.dealId ? { dealId: account.dealId } : {}),
      channel: x.channel ?? (x.kind === "linkedin_dm" || x.kind === "linkedin_connect" ? "linkedin" : x.kind === "note" ? "integration" : "email"),
      summary: "",
      ...(x.body ? { body: x.body } : {}),
      ...(x.sentiment ? { sentiment: x.sentiment } : {}),
      source: activitySourceFor(source),
    };

    switch (x.kind) {
      case "reply_received":
        activity.summary = `${x.label ?? LABEL[x.sentiment ?? "neutral"]} reply from ${who} via ${via}`;
        replies++;
        if (x.sentiment) labels.push(x.sentiment);
        break;
      case "touch_sent":
        activity.summary = x.summary ? `${clip(x.summary, 120)} · to ${who} via ${via}` : `Email to ${who} via ${via}`;
        break;
      case "bounce":
        activity.summary = `Email to ${x.email ?? who} bounced (${via})`;
        break;
      case "unsubscribe":
        activity.summary = `${who} unsubscribed (${via})`;
        break;
      case "meeting_held":
        activity.summary = x.summary ? `${clip(x.summary, 140)} (${via})` : `Meeting with ${who} (${via})`;
        break;
      case "linkedin_dm":
      case "linkedin_connect":
        activity.summary = x.summary ? `${clip(x.summary, 140)} (${via})` : `LinkedIn ${x.kind === "linkedin_dm" ? "message" : "connection"} with ${who} (${via})`;
        break;
      default:
        activity.summary = x.summary ? `${clip(x.summary, 160)} (${via})` : `Note from ${via} about ${who}`;
    }

    // The reducer cancels the rest of that person's sequence on a reply and bumps the deal.
    applyAction(ws, { type: "activity.log", activity });
    counts.activities++;
    if (x.kind !== "reply_received") kinds[x.kind] = (kinds[x.kind] ?? 0) + 1;

    if (person) {
      const touch = latestTouch(ws, person.id);
      if (x.kind === "reply_received") {
        if (touch && !touch.outcome) Object.assign(touch, { outcome: "replied", outcomeAt: activity.at });
        if (x.sentiment === "unsubscribe" && person.email) {
          person.doNotContact = true;
          suppress(ws, person.email, "unsubscribe", activity.at);
        }
        upsertReplyMove(ws, person, account, activity, via);
        if (activity.sentiment === "positive" || activity.sentiment === "referral") alerts.push({ activity });
      }
      if (x.kind === "bounce") {
        if (touch && !touch.outcome) Object.assign(touch, { outcome: "bounced", outcomeAt: activity.at });
        for (const c of person.contactPaths) if (x.email && c.value.toLowerCase() === x.email) c.bounced = true;
        if (x.email) suppress(ws, x.email, "bounce", activity.at);
      }
      if (x.kind === "unsubscribe") {
        person.doNotContact = true;
        if (person.email) suppress(ws, person.email, "unsubscribe", activity.at);
        for (const pkg of Object.values(ws.outreach)) {
          if (pkg.personId !== person.id) continue;
          for (const s of pkg.steps) if (s.status === "draft") s.status = "skipped";
        }
      }
    }
  }

  for (const b of n.bookings) {
    const key = `booking:${source}:${b.externalId}:${b.action}:${b.startsAt ?? ""}`;
    if (seen[key]) {
      counts.skipped++;
      continue;
    }
    markSeen(key);
    const founderEmails = new Set([ws.founder.email, ws.sender?.email].filter(Boolean).map((e) => e!.toLowerCase()));
    const guests = b.attendees.filter((a) => !a.email || !founderEmails.has(a.email));
    const guest = guests.find((a) => companyDomainOf(a.email)) ?? guests[0];
    const domain = companyDomainOf(guest?.email);
    const refK = (id: string) => `booking:${source}:${id}`;
    const existingMeetingId = ledger.refs[refK(b.replaces ?? b.externalId)]?.id;
    const existing = existingMeetingId ? ws.meetings[existingMeetingId] : undefined;

    if (b.action === "canceled") {
      if (!existing) {
        counts.skipped++;
        continue;
      }
      for (const m of Object.values(ws.moves)) {
        if (m.status === "open" && m.ref?.kind === "meeting" && m.ref.id === existing.id) Object.assign(m, { status: "skipped", skipReason: "already_handled" });
      }
      const deal = ws.deals[existing.dealId];
      if (!existing.brief && !existing.notesRaw && !existing.debrief) {
        delete ws.meetings[existing.id];
        if (deal) deal.meetingIds = deal.meetingIds.filter((id) => id !== existing.id);
      } else existing.title = `Canceled: ${existing.title.replace(/^Canceled: /, "")}`;
      ws.activities.push({ id: newId("act"), at, kind: "note", accountDomain: deal?.accountDomain, dealId: deal?.id, channel: "integration", summary: `${existing.title} was canceled in ${via}`, source: "webhook_in" });
      canceled++;
      continue;
    }

    const startsAt = b.startsAt ? isoOr(b.startsAt, at) : undefined;
    if (!startsAt) {
      counts.skipped++;
      continue;
    }

    if (existing) {
      existing.startsAt = startsAt;
      ledger.refs[refK(b.externalId)] = { id: existing.id, at };
      for (const m of Object.values(ws.moves)) {
        if (m.status === "open" && m.ref?.kind === "meeting" && m.ref.id === existing.id) {
          m.dueOn = todayISO(new Date(startsAt));
          m.why = `Moved to ${meetingTime(startsAt)} · via ${via}`;
        }
      }
      counts.meetings++;
      continue;
    }

    if (!domain || !guest) {
      // Personal email: no company to hang a deal on, but the founder still needs to prepare.
      const id = newId("mov");
      ws.moves[id] = {
        id,
        createdAt: at,
        dueOn: todayISO(new Date(startsAt)),
        kind: "meeting_prep",
        title: `Prep for your call with ${guest?.name ?? guest?.email ?? "a new contact"} at ${meetingTime(startsAt)}`,
        why: `${b.title} · booked via ${via} with a personal email, so I couldn't match a company`,
        minutes: 10,
        evidenceIds: [],
        priority: 90,
        rule: "inbound.booking",
        status: "open",
      };
      counts.skipped++;
      continue;
    }

    const { account, created: accCreated } = ensureAccount(ws, { domain }, meta);
    if (accCreated) counts.accounts++;
    const { person, created: perCreated } = ensurePerson(ws, { domain, email: guest.email, name: guest.name }, { via, source: "integration" });
    if (perCreated) counts.people++;

    let deal: Deal | undefined = account.dealId ? ws.deals[account.dealId] : undefined;
    if (!deal) {
      // A booked call is the first real conversation, which is when a deal starts. Its stage is never changed here.
      deal = {
        id: newId("deal"),
        accountDomain: domain,
        name: account.name,
        stage: "talking",
        stageHistory: [{ stage: "talking", at }],
        source: "inbound",
        contacts: [{ personId: person.id }],
        meetingIds: [],
        notes: `Started from a ${via} booking.`,
        createdAt: at,
        updatedAt: at,
        lastActivityAt: at,
      };
      applyAction(ws, { type: "deal.create", deal });
    } else if (!deal.contacts.some((c) => c.personId === person.id)) deal.contacts.push({ personId: person.id });

    const meeting: Meeting = { id: newId("mtg"), dealId: deal.id, title: b.title, startsAt, attendees: [{ personId: person.id, name: person.name, ...(person.title ? { title: person.title } : {}) }] };
    applyAction(ws, { type: "meeting.upsert", meeting });
    ledger.refs[refK(b.externalId)] = { id: meeting.id, at };
    counts.meetings++;
    // No prep card here: on the meeting day the moves engine adds one that shows the brief and expires after the call.
    ws.activities.push({ id: newId("act"), at, kind: "note", personId: person.id, accountDomain: domain, dealId: deal.id, channel: "integration", summary: `${person.name} booked “${clip(b.title, 80)}” for ${meetingTime(startsAt)} via ${via}`, source: "webhook_in" });
  }

  return { counts, alerts, replies, labels, kinds, canceled };
}

const KIND_WORDS: Partial<Record<ActivityKind, [string, string]>> = {
  touch_sent: ["email sent", "emails sent"],
  bounce: ["bounce", "bounces"],
  unsubscribe: ["unsubscribe", "unsubscribes"],
  meeting_held: ["meeting", "meetings"],
  linkedin_dm: ["LinkedIn message", "LinkedIn messages"],
  linkedin_connect: ["LinkedIn connection", "LinkedIn connections"],
  note: ["note", "notes"],
};

function summarize(r: ApplyResult, ignored: number): string {
  const { counts, replies, labels, kinds, canceled } = r;
  const parts: string[] = [];
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const labelText = [...new Set(labels.map((l) => LABEL[l].toLowerCase()))].join(", ");
  if (replies) parts.push(`${plural(replies, "reply", "replies")}${labelText ? ` · ${labelText}` : ""}`);
  else if (labels.length) parts.push(`Reply marked ${labelText}`);
  if (counts.meetings) parts.push(plural(counts.meetings, "booking", "bookings"));
  if (canceled) parts.push(plural(canceled, "booking canceled", "bookings canceled"));
  for (const [kind, n] of Object.entries(kinds) as [ActivityKind, number][]) {
    const words = KIND_WORDS[kind];
    if (words && n) parts.push(plural(n, words[0], words[1]));
  }
  if (counts.accounts) parts.push(plural(counts.accounts, "new company", "new companies"));
  if (counts.people) parts.push(plural(counts.people, "new person", "new people"));
  if (!parts.length && counts.skipped) parts.push(`${plural(counts.skipped, "item", "items")} already here or missing an email or domain`);
  if (!parts.length && ignored) parts.push(`${plural(ignored, "event", "events")} I don't track`);
  if (!parts.length) parts.push("Nothing I could use");
  return parts.join(" · ");
}

// One inbound delivery at a time, so two retries of the same event can't both pass the dedupe check.
let queue: Promise<unknown> = Promise.resolve();

interface ReceiveOptions {
  /** Items read by polling the tool's API (src/lib/hub/poll.ts) instead of a POST to the hook URL. */
  via?: "poll";
}

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn);
  queue = run.catch(() => undefined);
  return run;
}

/**
 * Handles one POST to /api/hooks/{source}/{secret}. Idempotent on the delivery id
 * (Idempotency-Key / webhook-id / body hash) and on each item's external id.
 */
export function receiveInbound(source: string, payload: unknown, deliveryKey: string): Promise<InboundLogEntry> {
  return enqueue(async () => (await receive(source, payload, deliveryKey, {}))!);
}

/**
 * The same path for a batch read by polling the tool's API. A reply seen by both a webhook and a
 * poll is recorded once (same external id). A poll that finds nothing new returns null and leaves
 * no log line, so the event list isn't buried under "already here".
 */
export function receivePolled(source: string, payload: unknown, deliveryKey: string): Promise<InboundLogEntry | null> {
  return enqueue(() => receive(source, payload, deliveryKey, { via: "poll" }));
}

async function receive(source: string, payload: unknown, deliveryKey: string, opts: ReceiveOptions): Promise<InboundLogEntry | null> {
  const polled = opts.via === "poll";
  const at = nowISO();
  const eventKey = `evt:${source}:${deliveryKey}`;
  const zero: InboundCounts = { accounts: 0, people: 0, activities: 0, meetings: 0, skipped: 0 };

  const hub = readHub();
  // A poll has no delivery id; its items dedupe on their own external ids.
  if (!polled && hub.seen[eventKey]) {
    const entry: InboundLogEntry = { id: newId("inb"), source, at, status: "duplicate", summary: "Already received; ignored", counts: zero };
    await mutateHub((h) => {
      h.inbound.unshift(entry);
    });
    return entry;
  }

  // "Send a test ping" from the card, or `curl -d '{"ping":true}'`: proves the URL works without creating records.
  if (isObj(payload) && payload.ping === true && Object.keys(payload).length === 1) {
    const entry: InboundLogEntry = { id: newId("inb"), source, at, status: "ok", summary: "Test ping received. The URL works.", counts: zero };
    await mutateHub((h) => {
      h.inbound.unshift(entry);
    });
    return entry;
  }

  const n = parseInbound(source, payload, at);
  // Sends, opens and clicks from a sequencer subscribed to everything: no workspace or hub write.
  if (n.ignored && !n.accounts.length && !n.people.length && !n.activities.length && !n.bookings.length && !n.unmapped.size) {
    return { id: newId("inb"), source, at, status: "ok", summary: `${n.ignored} event${n.ignored === 1 ? "" : "s"} I don't track`, counts: zero };
  }
  const ledger: Ledger = { seen: { ...hub.seen }, refs: {} };
  for (const [key, v] of Object.entries(hub.refs)) if (key.startsWith(`booking:${source}:`)) ledger.refs[key] = v;
  const { value: result } = await mutateWorkspace((ws) => applyNormalized(ws, source, n, ledger, at, polled));

  const nothing = !result.counts.accounts && !result.counts.people && !result.counts.activities && !result.counts.meetings && !result.labels.length && !result.canceled;
  if (polled && nothing) {
    await mutateHub((h) => {
      for (const [key, v] of Object.entries(ledger.seen)) h.seen[key] = v;
    });
    return null;
  }
  const unmapped = [...n.unmapped].slice(0, 12);
  const entry: InboundLogEntry = {
    id: newId("inb"),
    source,
    at,
    status: nothing && !result.counts.skipped && !n.ignored ? "unmapped" : "ok",
    summary: summarize(result, n.ignored),
    counts: result.counts,
    ...(unmapped.length ? { unmapped } : {}),
    ...(polled ? { via: "poll" as const } : {}),
  };
  await mutateHub((h) => {
    for (const [key, v] of Object.entries(ledger.seen)) h.seen[key] = v;
    for (const [key, v] of Object.entries(ledger.refs)) h.refs[key] = v;
    if (!polled) h.seen[eventKey] = at;
    h.inbound.unshift(entry);
  });

  // Notification only: the founder's own Slack, never webhooks or CRM writes.
  if (result.alerts.length) {
    const ws = readWorkspace();
    for (const { activity } of result.alerts.slice(0, 5)) {
      void emitHubEvent(
        "reply.logged",
        { activity: activityData(activity), person: personData(ws, activity.personId), account: accountData(ws, activity.accountDomain), __activity: activity, __via: inboundSourceName(source) },
        { origin: "inbound" },
      );
    }
  }
  return entry;
}
