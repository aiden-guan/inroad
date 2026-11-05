import { addBusinessDays, addDays, daysBetween, todayISO } from "@/lib/domain/ids";
import type { Activity, ISODate, OutreachPackage, ReplyIntent, Workspace } from "@/lib/domain/types";

/**
 * Reading a reply in code, before any model sees it (zero tokens). Code only answers when a phrase decides it,
 * and says which phrase ("why" on hover); otherwise the reply stays unread until drafting reads it properly.
 * Dates (back from leave, check back in January) are parsed here too, so a keypress can act on them.
 */

/** Who made the read: the founder (a correction), the model (while drafting), code, or the sequencer's label. */
export type ReadBy = "founder" | "model" | "code" | "vendor";

export interface IntentRead {
  /** Null: nobody can tell yet. Drafting reads it. */
  intent: ReplyIntent | null;
  by: ReadBy | null;
  /** The sentence that decided a code read. */
  cue?: string;
  /** Vendor reads: the sequencer's label, when the activity came from one. */
  source?: string;
}

export const INTENT_LABEL: Record<ReplyIntent, string> = {
  positive: "Interested",
  info_request: "Question",
  referral: "Referral",
  not_now: "Not now",
  objection: "Objection",
  negative: "Not interested",
  unsubscribe: "Stop",
  ooo: "Out of office",
};

export const INTENTS: ReplyIntent[] = ["positive", "info_request", "objection", "referral", "not_now", "negative", "ooo", "unsubscribe"];

const words = (t: string) => t.split(/\s+/).filter(Boolean).length;

// Mirrors the compose workflow's own code read (src/lib/workflows/compose.ts readInCode), so the chip and the draft agree.
const UNSUB =
  /\b(unsubscribe( me)?|remove me from (your|the|this) (list|mailing list|emails?|sequence|database)|take me off (your|the|this) (list|mailing list)|opt me out|stop (emailing|contacting|messaging) me|(do not|don'?t) (contact|email|message) me)\b|^\s*(stop|remove( me)?|unsubscribe)\.?\s*$/i;
const OOO =
  /\b(automatic reply|auto-?reply|autoreply|this is an automated (message|reply|response)|out of (the )?office|on (annual |parental |maternity |paternity |sick )?leave|on (vacation|holiday)|away from (my )?(desk|e-?mail|the office)|limited access to (my )?e-?mail|(respond|reply|get back to you) (when|upon|on) (my |I )?return)/i;
const LIVE_CUE = /\b(yes|yeah|sure|let'?s (talk|chat|meet)|interested|relevant|happy to (chat|talk|meet)|works for me)\b/i;
const REFERRAL =
  /\b(talk to|speak (to|with)|reach out to|get in touch with|loop(ing)? in|cc'?(ing|'?d)|copying in|introduc(e|ing) you to|connect(ing)? you (with|to)|point(ing)? you (to|toward)|forward(ed|ing)? (this|your (note|email|message)) to|(is|would be|'s) (the )?(right|best|better) (person|contact)|better (person|contact)|owns (this|that|the close)|handles (this|that))\b/i;
const NOT_NOW =
  /\b(not (right )?now|not the right time|not a priority( right now)?|bad timing|circle back|check back|follow up (in|after|next)|reach (back )?out (again )?(in|after|next)|revisit|reconnect (in|after|next)|next (quarter|year|month|fiscal year)|(in|after) q[1-4]|(in|after) (january|february|march|april|may|june|july|august|september|october|november|december)|after (the )?(holidays|new year|summer)|in a (few|couple( of)?) (weeks|months)|in (\d+|two|three|four|six) (weeks|months)|maybe later|down the (road|line)|budget (is )?(frozen|freeze)|(until|till) next (year|quarter|fiscal year))\b/i;
const NEGATIVE =
  /\b(not interested|no thanks|no,? thank you|not (a )?(good )?fit|not for us|(we'?re|we are) all set|(we'?ll|we will) pass|pass on this|please (don'?t|do not) follow up|not looking|not something we need)\b/i;
const OBJECTION =
  /\b(already (use|have|work with|pay for|built)|(we|our team) (built|build|wrote) (this|it|our own|something)|in-?house|homegrown|too (expensive|pricey)|no budget|(don'?t|do not) have (the )?budget|how (is|are) (this|you|it) different|why would (we|i)|what makes (you|this|it) different|(happy|fine) with (our|what we)|(our|the) (current|existing) (tool|process|setup|vendor)|can'?t give (a |an )?(startup|vendor) access)\b/i;
const INFO =
  /\b(how much|pricing|price|cost|send (me |over |us )?(more )?(info|information|details|a deck|the deck|a one-?pager|a case study|materials)|(more|some) (info|information|details)|do you (have|support|integrate|work with|offer)|does (it|this) (work|support|integrate|handle|cover)|can (it|you|this|the \w+) |how (does|do|would|long)|what (is|are|does|would)|is there (a|an)|security|soc ?2|gdpr|eu data|data residency|case stud(y|ies))\b/i;
const ASKS_INFO = /\bsend (me |over |us )?(more )?(info|information|details|a deck|the deck|a one-?pager|a case study|pricing)\b/i;
const POSITIVE =
  /\b(yes|yep|yeah|sure|absolutely|definitely|sounds (good|great|interesting|right)|(happy|glad|keen|open) to (chat|talk|meet|connect|learn more|hop on)|let'?s (talk|chat|meet|find (a )?time|set (it|something) up|do it|connect)|(i'?m|we'?re|i am|we are) (interested|keen|in)|would love to|works for me|(this|next) week works|book (a|some) time|send (me |over )?(a|an) (calendar )?invite|grab (a )?time|timely|good timing)\b/i;

/** The sentence a match sits in, for "why" on hover. */
function sentenceOf(text: string, m: RegExpExecArray | null): string | undefined {
  if (!m) return undefined;
  const start = Math.max(text.lastIndexOf(".", m.index), text.lastIndexOf("!", m.index), text.lastIndexOf("?", m.index - 1), text.lastIndexOf("\n", m.index)) + 1;
  const ends = [".", "!", "?", "\n"].map((c) => text.indexOf(c, m.index + m[0].length)).filter((i) => i >= 0);
  const end = ends.length ? Math.min(...ends) + 1 : text.length;
  const s = text.slice(start, end).replace(/\s+/g, " ").trim();
  return s.length > 160 ? `${s.slice(0, 159).trimEnd()}…` : s;
}

/**
 * The intent a phrase decides, or null when nothing does. Order matters: an opt-out or an auto-reply first, then a
 * referral (they named someone), then "later", "no", pushback, a question about the product, and a plain yes.
 */
export function readIntent(raw: string): { intent: ReplyIntent; cue?: string } | null {
  const text = raw.trim();
  if (!text) return null;
  const n = words(text);
  if (!text.includes("@") && n <= 25 && UNSUB.test(text)) return { intent: "unsubscribe", cue: sentenceOf(text, UNSUB.exec(text)) };
  if (n < 120 && OOO.test(text) && !LIVE_CUE.test(text)) return { intent: "ooo", cue: sentenceOf(text, OOO.exec(text)) };
  const checks: [ReplyIntent, RegExp, boolean][] = [
    ["referral", REFERRAL, true],
    ["not_now", NOT_NOW, true],
    ["negative", NEGATIVE, true],
    ["objection", OBJECTION, true],
    // A question about the product, or a plain "send me the deck".
    ["info_request", INFO, text.includes("?")],
    ["info_request", ASKS_INFO, true],
    ["positive", POSITIVE, true],
  ];
  for (const [intent, re, when] of checks) {
    if (!when) continue;
    const m = re.exec(text);
    if (m) return { intent, cue: sentenceOf(text, m) };
  }
  return null;
}

/** A sequencer's sentiment label, as an intent. Neutral says nothing. */
const FROM_SENTIMENT: Partial<Record<NonNullable<Activity["sentiment"]>, ReplyIntent>> = {
  positive: "positive",
  negative: "negative",
  referral: "referral",
  ooo: "ooo",
  unsubscribe: "unsubscribe",
};

/** The reply draft that answered this reply, which carries the model's read. */
export function replyPackageFor(ws: Workspace, reply: Activity): OutreachPackage | undefined {
  return Object.values(ws.outreach)
    .filter((p) => p.mode === "reply" && p.personId === reply.personId && !!p.reply && (p.reply.receivedAt === reply.at || (!!reply.body && p.reply.text === reply.body.slice(0, 4000))))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

/**
 * How a reply reads, best source first: the founder's correction, the model's read while drafting, a phrase code is
 * sure of, then the sequencer's label. A reply nobody can read yet is unread, never a guess.
 */
export function readOf(ws: Workspace, reply: Activity): IntentRead {
  if (reply.intent) return { intent: reply.intent, by: "founder" };
  const pkg = replyPackageFor(ws, reply);
  if (pkg?.reply) return { intent: pkg.reply.intent, by: "model" };
  const body = reply.body?.trim();
  const code = body ? readIntent(body) : null;
  if (code) return { intent: code.intent, by: "code", cue: code.cue };
  const vendor = reply.sentiment ? FROM_SENTIMENT[reply.sentiment] : undefined;
  if (vendor) return { intent: vendor, by: "vendor", source: typeof reply.source === "string" && reply.source !== "founder" && reply.source !== "ember" ? reply.source : undefined };
  return { intent: null, by: null };
}

/** An out-of-office reply: it shouldn't stop a sequence, only hold it. */
export function isAutoReply(ws: Workspace, a: Activity): boolean {
  if (a.kind !== "reply_received") return false;
  if (a.intent) return a.intent === "ooo";
  if (a.sentiment === "ooo") return true;
  return readOf(ws, a).intent === "ooo";
}

/* ───────────── Dates in their words ───────────── */

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MONTH_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?";
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const WEEKDAY_RE = "(sun|mon|tues?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?)(?:day)?";
const NUMBERS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, couple: 2, few: 3 };

const iso = (y: number, m: number, d: number) => todayISO(new Date(y, m, d));
const monthIndex = (s: string) => MONTHS.findIndex((m) => m.startsWith(s.toLowerCase().replace(/\.$/, "").slice(0, 3)));
const weekdayIndex = (s: string) => WEEKDAYS.findIndex((d) => d.startsWith(s.toLowerCase().slice(0, 3)));
const isWeekend = (date: ISODate) => [0, 6].includes(new Date(`${date}T12:00:00`).getDay());
/** The date itself when it's a weekday, else the Monday after. */
export function onBusinessDay(date: ISODate): ISODate {
  return isWeekend(date) ? addBusinessDays(date, 1) : date;
}

/** The first weekday of a month (January starts after New Year's Day). */
function firstBusinessDay(y: number, m: number): ISODate {
  return onBusinessDay(iso(y, m, m === 0 ? 2 : 1));
}

/** The next date after `base` (strictly) that falls on `weekday`. */
function nextWeekday(base: ISODate, weekday: number): ISODate {
  for (let i = 1; i <= 7; i++) {
    const d = addDays(base, i);
    if (new Date(`${d}T12:00:00`).getDay() === weekday) return d;
  }
  return addDays(base, 7);
}

/** A month and day, in the year that puts it on or after `base`. */
function upcoming(base: ISODate, month: number, day: number, year?: number): ISODate | null {
  if (month < 0 || day < 1 || day > 31) return null;
  const by = Number(base.slice(0, 4));
  if (year) return iso(year, month, day);
  const same = iso(by, month, day);
  return same >= base ? same : iso(by + 1, month, day);
}

/**
 * Every date mentioned, with where it sits in the text. Relative words ("Thursday", "next week") count from `base`
 * (the day it arrived) and rank below a written date ("November 2"), which says the same thing more exactly.
 */
function datesIn(text: string, base: ISODate): { at: number; date: ISODate; exact: boolean }[] {
  const out: { at: number; date: ISODate; exact: boolean }[] = [];
  let exact = true;
  const add = (at: number, date: ISODate | null) => date && out.push({ at, date, exact });
  const t = text.toLowerCase();
  for (const m of t.matchAll(/\b(20\d\d)-(\d\d)-(\d\d)\b/g)) add(m.index, iso(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  for (const m of t.matchAll(new RegExp(`\\b${MONTH_RE}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(20\\d\\d))?\\b`, "g"))) add(m.index, upcoming(base, monthIndex(m[1]), Number(m[2]), m[3] ? Number(m[3]) : undefined));
  for (const m of t.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_RE}(?:,?\\s+(20\\d\\d))?\\b`, "g"))) add(m.index, upcoming(base, monthIndex(m[2]), Number(m[1]), m[3] ? Number(m[3]) : undefined));
  for (const m of t.matchAll(/\b(\d{1,2})\/(\d{1,2})(?:\/(20\d\d|\d\d))?\b/g)) {
    const y = m[3] ? Number(m[3].length === 2 ? `20${m[3]}` : m[3]) : undefined;
    add(m.index, upcoming(base, Number(m[1]) - 1, Number(m[2]), y));
  }
  exact = false;
  for (const m of t.matchAll(new RegExp(`\\b(next\\s+)?${WEEKDAY_RE}\\b`, "g"))) {
    const wd = weekdayIndex(m[2]);
    if (wd < 0) continue;
    const d = nextWeekday(base, wd);
    // "next Monday" said on a Friday is three days away; said on a Monday it's a week.
    add(m.index, m[1] && daysBetween(base, d) < 3 && new Date(`${base}T12:00:00`).getDay() !== 5 ? addDays(d, 7) : d);
  }
  for (const m of t.matchAll(/\bthe (\d{1,2})(?:st|nd|rd|th)\b/g)) {
    const [y, mo] = base.split("-").map(Number);
    const day = Number(m[1]);
    const same = iso(y, mo - 1, day);
    add(m.index, same > base ? same : iso(y, mo, day));
  }
  for (const m of t.matchAll(/\btomorrow\b/g)) add(m.index, addDays(base, 1));
  for (const m of t.matchAll(/\bnext week\b/g)) add(m.index, nextWeekday(base, 1));
  for (const m of t.matchAll(/\bin (a|one|two|three|four|\d+) weeks?\b/g)) add(m.index, addDays(base, 7 * (NUMBERS[m[1]] ?? Number(m[1]))));
  return out.sort((a, b) => a.at - b.at);
}

/**
 * When an out-of-office says they're back: the date after "until", "back", "return" or "returning", else the first
 * date in the message. "Through Friday" means back the next working day. Null when it names no date.
 */
export function parseReturnDate(text: string, receivedAt: string): ISODate | null {
  const base = todayISO(new Date(receivedAt));
  const t = text.toLowerCase();
  const dates = datesIn(text, base).filter((d) => d.date > base);
  if (!dates.length) return null;
  const cue = /\b(until|till|back|return(ing)?|returns|resume|through|thru|in the office)\b/g;
  let best: { at: number; date: ISODate } | undefined;
  let through = false;
  for (const m of t.matchAll(cue)) {
    const near = dates.filter((d) => d.at >= m.index && d.at - m.index <= 40);
    const hit = near.find((d) => d.exact) ?? near[0];
    if (hit) {
      best = hit;
      through = /^(through|thru)$/.test(m[1]);
      break;
    }
  }
  const pick = best ?? dates[0];
  return through ? addBusinessDays(pick.date, 1) : pick.date;
}

/**
 * When a "not now" asks to be checked back: next quarter, a month, the new year, a few weeks. Null when they gave no
 * time, and the caller picks a default it says out loud.
 */
export function parseRevisit(text: string, receivedAt: string): ISODate | null {
  const base = todayISO(new Date(receivedAt));
  const [y, mo] = base.split("-").map(Number);
  const month = mo - 1;
  const t = text.toLowerCase();
  if (/\bnext quarter\b/.test(t)) {
    const q = Math.floor(month / 3) + 1;
    return q > 3 ? firstBusinessDay(y + 1, 0) : firstBusinessDay(y, q * 3);
  }
  const quarter = /\b(in|after|until|till)\s+q([1-4])\b/.exec(t);
  if (quarter) {
    const q = Number(quarter[2]) - 1 + (quarter[1] === "in" ? 0 : 1);
    const start = (q % 4) * 3;
    const yy = q > 3 ? y + 1 : start <= month ? y + 1 : y;
    return firstBusinessDay(yy, start);
  }
  if (/\b(next year|new year|next fiscal year|after the holidays)\b/.test(t)) return firstBusinessDay(month >= 9 || /\bnext\b/.test(t) ? y + 1 : y, 0);
  const named = new RegExp(`\\b(?:in|after|until|till|around|early|mid|late)\\s+${MONTH_RE}\\b`).exec(t);
  if (named) {
    let m = monthIndex(named[1]);
    if (/^after\b/.test(named[0])) m += 1;
    const yy = m % 12 <= month || m > 11 ? y + 1 : y;
    return firstBusinessDay(yy, m % 12);
  }
  if (/\bnext month\b/.test(t)) return month === 11 ? firstBusinessDay(y + 1, 0) : firstBusinessDay(y, month + 1);
  const span = /\bin (a|an|one|two|three|four|five|six|\d+|a few|a couple(?: of)?|few|couple(?: of)?) (weeks?|months?)\b/.exec(t);
  if (span) {
    const key = span[1].replace(/^a /, "").replace(/ of$/, "");
    const n = NUMBERS[key] ?? (Number(key) || 1);
    const d = span[2].startsWith("week") ? addDays(base, 7 * n) : todayISO(new Date(y, month + n, Number(base.slice(8, 10))));
    return onBusinessDay(d);
  }
  return null;
}

/* ───────────── Who they pointed you to ───────────── */

export interface Referral {
  name?: string;
  email?: string;
  title?: string;
}

const NAME = "([A-Z][a-z'’-]+(?:\\s+[A-Z][a-z'’-]+){0,2})";
const POINTERS = [
  new RegExp(`\\b(?:talk to|speak (?:to|with)|reach out to|get in touch with|loop(?:ing)? in|cc'?(?:ing|'?d)|copying in|introduce you to|connect you (?:with|to)|point you (?:to|toward)|forwarded (?:this|your (?:note|email|message)) to|contact)\\s+${NAME}`),
  new RegExp(`${NAME}\\s*(?:\\(|<)[^)>]*@[^)>]*(?:\\)|>)`),
  new RegExp(`${NAME},?\\s+(?:our|who|is|runs|owns|handles|leads)\\b`),
];
const NOT_NAMES = new Set(["I", "We", "Our", "The", "Thanks", "Thank", "Happy", "Hi", "Hello", "Best", "Cheers", "Sure", "Yes", "She", "He", "They", "Please", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]);

/**
 * The person a reply points to, read in code: their address (any address that isn't the sender's or yours) and a
 * name after "talk to", "loop in", "cc'ing", or before "(name@…)" or ", our …". `exclude` takes the sender's and the
 * founder's names and addresses.
 */
export function parseReferral(text: string, exclude: { names?: string[]; emails?: string[] } = {}): Referral | null {
  const skipEmails = new Set((exclude.emails ?? []).map((e) => e.toLowerCase()));
  const skipNames = new Set((exclude.names ?? []).flatMap((n) => [n.toLowerCase(), n.split(/\s+/)[0]?.toLowerCase()]).filter(Boolean));
  const email = (text.match(/[A-Z0-9._%+'-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []).map((e) => e.toLowerCase()).find((e) => !skipEmails.has(e));
  let name: string | undefined;
  let at = -1;
  for (const re of POINTERS) {
    for (const m of text.matchAll(new RegExp(re.source, "g"))) {
      const candidate = m[1].trim();
      const firstWord = candidate.split(/\s+/)[0];
      if (NOT_NAMES.has(firstWord) || skipNames.has(candidate.toLowerCase()) || skipNames.has(firstWord.toLowerCase())) continue;
      name = candidate;
      at = (m.index ?? 0) + m[0].indexOf(candidate) + candidate.length;
      break;
    }
    if (name) break;
  }
  if (!name && email) {
    // "nora.vance@…" → "Nora Vance" only when the address spells a first and last name.
    const local = email.split("@")[0];
    const parts = local.split(/[._-]/).filter((p) => /^[a-z]{2,}$/.test(p));
    if (parts.length === 2) name = parts.map((p) => p[0].toUpperCase() + p.slice(1)).join(" ");
  }
  if (!name && !email) return null;
  let title: string | undefined;
  if (at >= 0) {
    const rest = text.slice(at, at + 90);
    const m = /^,?\s*(?:\([^)]*\))?\s*,?\s*(?:our|the|who is our|who's our|she's our|he's our)\s+(?:new\s+)?([A-Z][A-Za-z&/ -]{2,60}?)(?=[,.;(\n]|\s+(?:and|who|is|at|now|since)\b|$)/.exec(rest);
    if (m) title = m[1].trim();
  }
  return { ...(name ? { name } : {}), ...(email ? { email } : {}), ...(title ? { title } : {}) };
}

/* ───────────── How soon to answer ───────────── */

/** Business days to answer, by intent: a yes or a question the same business day, pushback in one, a referral in two. */
export const REPLY_WITHIN: Partial<Record<ReplyIntent | "unread", number>> = { positive: 0, info_request: 0, unread: 0, objection: 1, referral: 2 };

/** Replies after this hour start their clock on the next working day. */
const DAY_ENDS_AT = 17;

/**
 * The day an answer is due, or null when none is owed (not now, no, stop, out of office). "Same business day" for a
 * reply that lands on a weekend or after 5pm means the next working day.
 */
export function replyBy(intent: ReplyIntent | null, receivedAt: string): ISODate | null {
  const within = REPLY_WITHIN[intent ?? "unread"];
  if (within === undefined) return null;
  const when = new Date(receivedAt);
  if (Number.isNaN(when.getTime())) return null;
  const day = todayISO(when);
  const start = isWeekend(day) || when.getHours() >= DAY_ENDS_AT ? addBusinessDays(day, 1) : day;
  return within ? addBusinessDays(start, within) : start;
}
