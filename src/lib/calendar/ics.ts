/**
 * An iCalendar (RFC 5545) reader for calendar feeds: Google's secret iCal address, Outlook's published ICS,
 * iCloud and Fastmail links. Pure code, zero tokens.
 *
 *  - Lines are unfolded, then split into name, parameters (quoted values, RFC 6868 caret escapes) and value.
 *  - VEVENTs keep their own properties; a VALARM's DESCRIPTION or ATTENDEE never leaks into its event.
 *  - DTSTART/DTEND/DURATION with TZID (IANA, Windows and Outlook names, or the feed's VTIMEZONE), UTC,
 *    floating times (read in the feed's X-WR-TIMEZONE, else this machine's zone) and all-day dates.
 *  - Recurrence: DAILY and WEEKLY with INTERVAL, BYDAY, COUNT, UNTIL and WKST; MONTHLY by month day or by
 *    (nth) weekday; YEARLY on a date; BYMONTH as a filter; EXDATE and RDATE; RECURRENCE-ID overrides,
 *    including cancelled ones. Anything else (BYSETPOS, BYWEEKNO, RANGE=THISANDFUTURE, a zone that can't
 *    be resolved) skips the whole series and is counted, never guessed.
 *  - ATTENDEE and ORGANIZER email and CN, PARTSTAT, ROLE and CUTYPE; STATUS; SEQUENCE; UID.
 */
import { normalizeEmail } from "@/lib/hub/records";
import { daysInMonth, localZone, nthWeekday, resolveZone, UTC, utcToWall, wallToUtc, type Observance, type VTimezone, type Wall, type Zone } from "./tz";

/* ───────────── Lines ───────────── */

export interface IcsProperty {
  name: string;
  params: Record<string, string>;
  value: string;
}

/** Splits a feed into logical lines: CRLF, LF or CR endings; a line starting with a space or tab continues the one before. */
export function unfold(text: string): string[] {
  const out: string[] = [];
  for (const line of text.replace(/^﻿/, "").split(/\r\n|\n|\r/)) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && out.length) out[out.length - 1] += line.slice(1);
    else if (line.length) out.push(line);
  }
  return out;
}

/** RFC 6868: ^n newline, ^' double quote, ^^ caret. */
const caret = (v: string) => v.replace(/\^(n|N|'|\^)/g, (_, c: string) => (c === "n" || c === "N" ? "\n" : c === "'" ? '"' : "^"));

/** One content line → name, parameters and raw value. Null for a line that isn't one. */
export function parseLine(line: string): IcsProperty | null {
  let i = 0;
  while (i < line.length && line[i] !== ";" && line[i] !== ":") i++;
  const name = line.slice(0, i).trim().toUpperCase();
  if (!name || i >= line.length) return null;
  const params: Record<string, string> = {};
  while (line[i] === ";") {
    i++;
    let j = i;
    while (j < line.length && line[j] !== "=" && line[j] !== ";" && line[j] !== ":") j++;
    const pname = line.slice(i, j).trim().toUpperCase();
    i = j;
    const values: string[] = [];
    if (line[i] === "=") {
      i++;
      for (;;) {
        if (line[i] === '"') {
          const end = line.indexOf('"', i + 1);
          if (end === -1) {
            values.push(line.slice(i + 1));
            i = line.length;
            break;
          }
          values.push(line.slice(i + 1, end));
          i = end + 1;
        } else {
          let k = i;
          while (k < line.length && line[k] !== "," && line[k] !== ";" && line[k] !== ":") k++;
          values.push(line.slice(i, k));
          i = k;
        }
        if (line[i] === ",") {
          i++;
          continue;
        }
        break;
      }
    }
    if (pname) params[pname] = values.map(caret).join(",");
  }
  if (line[i] !== ":") return null;
  return { name, params, value: line.slice(i + 1) };
}

/** TEXT values: \n, \, \; and \\ escapes. */
export function unescapeText(v: string): string {
  return v.replace(/\\([\\;,nN])/g, (_, c: string) => (c === "n" || c === "N" ? "\n" : c));
}

/* ───────────── Components ───────────── */

interface Component {
  name: string;
  props: IcsProperty[];
  children: Component[];
}

// Never kept: inline attachments and HTML bodies can be megabytes each, and nothing here reads them.
const DROPPED = new Set(["ATTACH", "X-ALT-DESC", "X-MICROSOFT-CDO-ALT-DESC"]);
const MAX_VALUE = 4000;

function tree(lines: string[]): { roots: Component[]; complete: boolean } {
  const roots: Component[] = [];
  const stack: Component[] = [];
  let complete = false;
  for (const line of lines) {
    const p = parseLine(line);
    if (!p) continue;
    if (p.name === "BEGIN") {
      const c: Component = { name: p.value.trim().toUpperCase(), props: [], children: [] };
      (stack.length ? stack[stack.length - 1].children : roots).push(c);
      stack.push(c);
    } else if (p.name === "END") {
      const name = p.value.trim().toUpperCase();
      for (let k = stack.length - 1; k >= 0; k--) {
        if (stack[k].name !== name) continue;
        stack.length = k;
        if (name === "VCALENDAR") complete = true;
        break;
      }
    } else if (stack.length && !DROPPED.has(p.name)) {
      stack[stack.length - 1].props.push(p.value.length > MAX_VALUE ? { ...p, value: p.value.slice(0, MAX_VALUE) } : p);
    }
  }
  return { roots, complete };
}

const prop = (c: Component, name: string) => c.props.find((p) => p.name === name);
const props = (c: Component, name: string) => c.props.filter((p) => p.name === name);

/* ───────────── Dates ───────────── */

export type DateValue =
  | { allDay: true; y: number; mo: number; d: number }
  /** `zone` null: the TZID couldn't be resolved. */
  | { allDay: false; wall: Wall; zone: Zone | null; floating: boolean };

const DATE_RE = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/i;

function parseOne(raw: string, tzid: string | undefined, valueDate: boolean, ctx: ZoneContext): DateValue | null {
  const m = DATE_RE.exec(raw.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null;
  if (!m[4] || valueDate) return { allDay: true, y, mo, d };
  const wall: Wall = { y, mo, d, h: Number(m[4]), mi: Number(m[5]), s: Number(m[6] ?? 0) };
  if (wall.h > 23 || wall.mi > 59 || wall.s > 60) return null;
  if (m[7]) return { allDay: false, wall, zone: UTC, floating: false };
  if (tzid) return { allDay: false, wall, zone: ctx.zone(tzid), floating: false };
  return { allDay: false, wall, zone: ctx.floating, floating: true };
}

function parseDates(p: IcsProperty | undefined, ctx: ZoneContext): DateValue[] {
  if (!p) return [];
  const valueDate = p.params.VALUE?.toUpperCase() === "DATE";
  if (p.params.VALUE?.toUpperCase() === "PERIOD") return [];
  return p.value
    .split(",")
    .map((v) => parseOne(v, p.params.TZID, valueDate, ctx))
    .filter((v): v is DateValue => v !== null);
}

/** UTC ms for a date value. All-day dates are midnight in the zone floating times use. Null when the zone is unknown. */
export function instantOf(v: DateValue, floating: Zone): number | null {
  if (v.allDay) return wallToUtc({ y: v.y, mo: v.mo, d: v.d, h: 0, mi: 0, s: 0 }, floating);
  return v.zone ? wallToUtc(v.wall, v.zone) : null;
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");
const dateKey = (y: number, mo: number, d: number) => `${y}${pad(mo)}${pad(d)}`;
/** A compact, sortable key for an occurrence's original start: "20261105T150000Z" or "20261105" for all-day. */
const instantKey = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** "PT1H30M", "P1D", "P1W" → ms. Null when it doesn't parse. */
export function parseDuration(v: string): number | null {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i.exec(v.trim());
  if (!m || v.trim().length < 3) return null;
  const [, sign, w, d, h, mi, s] = m;
  const ms = ((Number(w ?? 0) * 7 + Number(d ?? 0)) * 86_400 + Number(h ?? 0) * 3600 + Number(mi ?? 0) * 60 + Number(s ?? 0)) * 1000;
  return sign === "-" ? -ms : ms;
}

/* ───────────── Zones in this feed ───────────── */

interface ZoneContext {
  zone(tzid: string): Zone | null;
  floating: Zone;
}

function wallOf(v: string): Wall | null {
  const m = DATE_RE.exec(v.trim());
  if (!m) return null;
  return { y: Number(m[1]), mo: Number(m[2]), d: Number(m[3]), h: Number(m[4] ?? 0), mi: Number(m[5] ?? 0), s: Number(m[6] ?? 0) };
}

/** "-0500" / "+0530" → minutes east of UTC. */
function offsetMinutes(v: string | undefined): number | null {
  const m = /^([+-])(\d{2})(\d{2})(\d{2})?$/.exec((v ?? "").trim());
  if (!m) return null;
  const mins = Number(m[2]) * 60 + Number(m[3]);
  return m[1] === "-" ? -mins : mins;
}

const WEEKDAYS: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

function observance(c: Component): Observance | null {
  const start = wallOf(prop(c, "DTSTART")?.value ?? "");
  const from = offsetMinutes(prop(c, "TZOFFSETFROM")?.value);
  const to = offsetMinutes(prop(c, "TZOFFSETTO")?.value);
  if (!start || from === null || to === null) return null;
  const o: Observance = { start, from, to, dates: [] };
  const rule = prop(c, "RRULE")?.value;
  if (rule) {
    const parts = ruleParts(rule);
    if (parts.FREQ !== "YEARLY" || !parts.BYMONTH) return null;
    const month = Number(parts.BYMONTH.split(",")[0]);
    const byday = parts.BYDAY ? /^([+-]?\d)?(SU|MO|TU|WE|TH|FR|SA)$/.exec(parts.BYDAY.split(",")[0]) : null;
    let untilMs: number | undefined;
    if (parts.UNTIL) {
      const u = wallOf(parts.UNTIL);
      if (u) untilMs = Date.UTC(u.y, u.mo - 1, u.d, u.h, u.mi, u.s);
    }
    if (byday) o.yearly = { month, weekday: { n: Number(byday[1] ?? 1), wd: WEEKDAYS[byday[2]] }, untilMs };
    else if (parts.BYMONTHDAY) o.yearly = { month, monthDay: Number(parts.BYMONTHDAY.split(",")[0]), untilMs };
    else return null;
  }
  for (const r of props(c, "RDATE")) for (const v of r.value.split(",")) {
    const w = wallOf(v);
    if (w) o.dates.push(w);
  }
  return o;
}

function vtimezones(cal: Component): Map<string, VTimezone> {
  const out = new Map<string, VTimezone>();
  for (const c of cal.children) {
    if (c.name !== "VTIMEZONE") continue;
    const tzid = prop(c, "TZID")?.value.trim();
    if (!tzid) continue;
    const observances = c.children.filter((x) => x.name === "STANDARD" || x.name === "DAYLIGHT").map(observance);
    // A block whose rule we can't read would give wrong offsets for part of the year: drop the zone instead.
    if (observances.some((o) => o === null)) continue;
    const vt: VTimezone = { tzid, location: prop(c, "X-LIC-LOCATION")?.value.trim(), observances: observances as Observance[] };
    out.set(tzid, vt);
    out.set(tzid.toLowerCase(), vt);
  }
  return out;
}

/* ───────────── Events ───────────── */

export interface Party {
  email?: string;
  name?: string;
  /** NEEDS-ACTION, ACCEPTED, DECLINED, TENTATIVE, DELEGATED. */
  partstat?: string;
  role?: string;
  /** INDIVIDUAL, GROUP, RESOURCE, ROOM. */
  cutype?: string;
}

export type EventStatus = "confirmed" | "tentative" | "cancelled";

export interface RawEvent {
  uid: string;
  start: DateValue | null;
  end?: DateValue;
  durationMs?: number;
  recurrenceId?: DateValue;
  /** RANGE=THISANDFUTURE on the RECURRENCE-ID: not expanded. */
  rangeFuture?: boolean;
  rrule?: string;
  rdates: DateValue[];
  exdates: DateValue[];
  title: string;
  description?: string;
  location?: string;
  url?: string;
  status: EventStatus;
  sequence: number;
  /** LAST-MODIFIED or DTSTAMP, to pick between two copies with the same SEQUENCE. */
  modifiedMs: number;
  organizer?: Party;
  attendees: Party[];
  conference?: string;
}

function party(p: IcsProperty): Party | null {
  const fromValue = normalizeEmail(p.value.replace(/^mailto:/i, ""));
  const email = fromValue ?? normalizeEmail(p.params.EMAIL) ?? undefined;
  const cn = p.params.CN?.trim();
  // Google writes the address as the CN when it has no name.
  const name = cn && !normalizeEmail(cn) ? cn : undefined;
  if (!email && !name) return null;
  return {
    ...(email ? { email } : {}),
    ...(name ? { name } : {}),
    ...(p.params.PARTSTAT ? { partstat: p.params.PARTSTAT.toUpperCase() } : {}),
    ...(p.params.ROLE ? { role: p.params.ROLE.toUpperCase() } : {}),
    ...(p.params.CUTYPE ? { cutype: p.params.CUTYPE.toUpperCase() } : {}),
  };
}

function stamp(c: Component): number {
  for (const name of ["LAST-MODIFIED", "DTSTAMP", "CREATED"]) {
    const w = wallOf(prop(c, name)?.value ?? "");
    if (w) return Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s);
  }
  return 0;
}

function toEvent(c: Component, ctx: ZoneContext): RawEvent | null {
  const uid = prop(c, "UID")?.value.trim();
  if (!uid) return null;
  const startProp = prop(c, "DTSTART");
  const start = parseDates(startProp, ctx)[0] ?? null;
  const endProp = prop(c, "DTEND");
  const end = parseDates(endProp, ctx)[0];
  const duration = prop(c, "DURATION");
  const rid = prop(c, "RECURRENCE-ID");
  const status = (prop(c, "STATUS")?.value ?? "").trim().toUpperCase();
  const text = (name: string) => {
    const v = prop(c, name)?.value;
    return v === undefined ? undefined : unescapeText(v).trim() || undefined;
  };
  const conference = prop(c, "X-GOOGLE-CONFERENCE")?.value ?? undefined;
  return {
    uid,
    start,
    ...(end ? { end } : {}),
    ...(duration && parseDuration(duration.value) !== null ? { durationMs: parseDuration(duration.value)! } : {}),
    ...(rid ? { recurrenceId: parseDates(rid, ctx)[0], rangeFuture: rid.params.RANGE?.toUpperCase() === "THISANDFUTURE" } : {}),
    ...(prop(c, "RRULE") ? { rrule: prop(c, "RRULE")!.value.trim() } : {}),
    rdates: props(c, "RDATE").flatMap((p) => parseDates(p, ctx)),
    exdates: props(c, "EXDATE").flatMap((p) => parseDates(p, ctx)),
    title: text("SUMMARY") ?? "",
    description: text("DESCRIPTION"),
    location: text("LOCATION"),
    url: prop(c, "URL")?.value.trim() || undefined,
    status: status === "CANCELLED" ? "cancelled" : status === "TENTATIVE" ? "tentative" : "confirmed",
    sequence: Number(prop(c, "SEQUENCE")?.value) || 0,
    modifiedMs: stamp(c),
    organizer: (prop(c, "ORGANIZER") && party(prop(c, "ORGANIZER")!)) || undefined,
    attendees: props(c, "ATTENDEE")
      .map(party)
      .filter((p): p is Party => p !== null),
    ...(conference ? { conference } : {}),
  };
}

export interface ParsedFeed {
  /** X-WR-CALNAME: often the owner's address for a primary Google calendar. */
  name?: string;
  /** X-WR-TIMEZONE, when it names a zone we know. */
  timezone?: string;
  prodId?: string;
  /** The feed ended with END:VCALENDAR. A cut-off file is never used to decide that a meeting was deleted. */
  complete: boolean;
  events: RawEvent[];
  /** The zone floating times are read in. */
  floating: Zone;
}

/** Reads a feed. Throws only for something that isn't a calendar at all. */
export function parseFeed(text: string, { defaultZone }: { defaultZone?: Zone } = {}): ParsedFeed {
  const { roots, complete } = tree(unfold(text));
  const cal = roots.find((c) => c.name === "VCALENDAR");
  if (!cal) throw new Error("not_ics");
  const zones = vtimezones(cal);
  const calTz = prop(cal, "X-WR-TIMEZONE")?.value.trim();
  const calZone = calTz ? resolveZone(calTz, zones) : null;
  const floating = calZone ?? defaultZone ?? localZone();
  const cache = new Map<string, Zone | null>();
  const ctx: ZoneContext = {
    floating,
    zone(tzid) {
      if (!cache.has(tzid)) cache.set(tzid, resolveZone(tzid, zones));
      return cache.get(tzid)!;
    },
  };
  const events: RawEvent[] = [];
  for (const c of cal.children) {
    if (c.name !== "VEVENT") continue;
    const e = toEvent(c, ctx);
    if (e) events.push(e);
  }
  const name = prop(cal, "X-WR-CALNAME")?.value;
  return {
    ...(name ? { name: unescapeText(name).trim() } : {}),
    ...(calZone && calTz ? { timezone: calTz } : {}),
    prodId: prop(cal, "PRODID")?.value.trim(),
    complete,
    events,
    floating,
  };
}

/* ───────────── Recurrence ───────────── */

function ruleParts(rule: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of rule.replace(/^RRULE:/i, "").split(";")) {
    const [k, ...v] = part.split("=");
    if (k && v.length) out[k.trim().toUpperCase()] = v.join("=").trim().toUpperCase();
  }
  return out;
}

interface Rule {
  freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  interval: number;
  count?: number;
  until?: DateValue;
  byday?: { n?: number; wd: number }[];
  bymonthday?: number[];
  bymonth?: number[];
  wkst: number;
}

const UNSUPPORTED = ["BYSETPOS", "BYWEEKNO", "BYYEARDAY", "BYHOUR", "BYMINUTE", "BYSECOND"];

/** A rule we can expand exactly, or null. */
function parseRule(rule: string, ctx: ZoneContext): Rule | null {
  const p = ruleParts(rule);
  const freq = p.FREQ;
  if (freq !== "DAILY" && freq !== "WEEKLY" && freq !== "MONTHLY" && freq !== "YEARLY") return null;
  if (UNSUPPORTED.some((k) => k in p)) return null;
  const interval = p.INTERVAL ? Number(p.INTERVAL) : 1;
  if (!Number.isInteger(interval) || interval < 1 || interval > 1000) return null;
  const count = p.COUNT ? Number(p.COUNT) : undefined;
  if (count !== undefined && (!Number.isInteger(count) || count < 1)) return null;
  let byday: Rule["byday"];
  if (p.BYDAY) {
    byday = [];
    for (const token of p.BYDAY.split(",")) {
      const m = /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/.exec(token.trim());
      if (!m) return null;
      const n = m[1] ? Number(m[1]) : undefined;
      // An ordinal ("2TU") only means something by month or by year.
      if (n !== undefined && (freq === "DAILY" || freq === "WEEKLY" || n === 0 || Math.abs(n) > 5)) return null;
      byday.push({ n, wd: WEEKDAYS[m[2]] });
    }
    if (freq === "YEARLY") return null;
  }
  const nums = (v: string | undefined, min: number, max: number) => {
    if (!v) return undefined;
    const out = v.split(",").map(Number);
    return out.every((n) => Number.isInteger(n) && n !== 0 && Math.abs(n) >= min && Math.abs(n) <= max) ? out : null;
  };
  const bymonthday = nums(p.BYMONTHDAY, 1, 31);
  const bymonth = nums(p.BYMONTH, 1, 12);
  if (bymonthday === null || bymonth === null || bymonth?.some((m) => m < 0)) return null;
  if (freq === "YEARLY" && bymonthday?.some((d) => d < 0)) return null;
  if (bymonthday && byday?.some((b) => b.n !== undefined)) return null;
  let until: DateValue | undefined;
  if (p.UNTIL) {
    const u = parseOne(p.UNTIL, undefined, false, ctx);
    if (!u) return null;
    until = u;
  }
  return { freq, interval, count, until, byday, bymonthday, bymonth, wkst: p.WKST && p.WKST in WEEKDAYS ? WEEKDAYS[p.WKST] : 1 };
}

type Day = { y: number; mo: number; d: number };
const dayMs = (x: Day) => Date.UTC(x.y, x.mo - 1, x.d);
const fromMs = (ms: number): Day => {
  const t = new Date(ms);
  return { y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate() };
};
const addDaysTo = (x: Day, n: number) => fromMs(dayMs(x) + n * 86_400_000);
const weekday = (x: Day) => new Date(dayMs(x)).getUTCDay();

/**
 * Candidate dates after the first, in order. Each generator stops once it is two days past `stopMs`, so a
 * filter that never matches (BYMONTH=2;BYMONTHDAY=30) can't spin forever.
 */
function* candidates(r: Rule, first: Day, stopMs: number): Generator<Day> {
  const past = (x: Day) => dayMs(x) > stopMs + 2 * 86_400_000;
  const inMonths = (x: Day) => !r.bymonth || r.bymonth.includes(x.mo);
  const monthDayOk = (x: Day) => !r.bymonthday || r.bymonthday.some((n) => (n > 0 ? x.d === n : x.d === daysInMonth(x.y, x.mo) + n + 1));
  if (r.freq === "DAILY") {
    for (let k = 1; ; k++) {
      const x = addDaysTo(first, k * r.interval);
      if (past(x)) return;
      if (inMonths(x) && monthDayOk(x) && (!r.byday || r.byday.some((b) => b.wd === weekday(x)))) yield x;
    }
  }
  if (r.freq === "WEEKLY") {
    const offset = (wd: number) => (wd - r.wkst + 7) % 7;
    const weekStart = addDaysTo(first, -offset(weekday(first)));
    const days = (r.byday?.map((b) => b.wd) ?? [weekday(first)]).sort((a, b) => offset(a) - offset(b));
    for (let w = 0; ; w++) {
      const base = addDaysTo(weekStart, 7 * w * r.interval);
      if (past(base)) return;
      for (const wd of days) {
        const x = addDaysTo(base, offset(wd));
        if (dayMs(x) > dayMs(first) && inMonths(x)) yield x;
      }
    }
  }
  if (r.freq === "MONTHLY") {
    for (let k = 0; ; k++) {
      const total = first.mo - 1 + k * r.interval;
      const y = first.y + Math.floor(total / 12);
      const mo = (total % 12) + 1;
      if (past({ y, mo, d: 1 })) return;
      const dim = daysInMonth(y, mo);
      let days: number[];
      // BYMONTHDAY with BYDAY means both (Friday the 13th); parseRule only lets plain weekdays through for that.
      if (r.bymonthday)
        days = r.bymonthday
          .map((n) => (n > 0 ? n : dim + n + 1))
          .filter((d) => d >= 1 && d <= dim && (!r.byday || r.byday.some((b) => b.wd === new Date(Date.UTC(y, mo - 1, d)).getUTCDay())));
      else if (r.byday)
        days = r.byday.flatMap((b) => {
          if (b.n !== undefined) {
            const d = nthWeekday(y, mo, b.n, b.wd);
            return d ? [d] : [];
          }
          const all: number[] = [];
          for (let d = 1; d <= dim; d++) if (new Date(Date.UTC(y, mo - 1, d)).getUTCDay() === b.wd) all.push(d);
          return all;
        });
      else days = first.d <= dim ? [first.d] : [];
      for (const d of [...new Set(days)].sort((a, b) => a - b)) {
        const x = { y, mo, d };
        if (dayMs(x) > dayMs(first) && inMonths(x)) yield x;
      }
    }
  }
  if (r.freq === "YEARLY") {
    for (let k = 0; ; k++) {
      const y = first.y + k * r.interval;
      if (past({ y, mo: 1, d: 1 })) return;
      const months = r.bymonth ?? [first.mo];
      const days = r.bymonthday ?? [first.d];
      const list: Day[] = [];
      for (const mo of months) for (const d of days) if (d <= daysInMonth(y, mo)) list.push({ y, mo, d });
      for (const x of list.sort((a, b) => dayMs(a) - dayMs(b))) if (dayMs(x) > dayMs(first)) yield x;
    }
  }
}

/* ───────────── Expansion ───────────── */

export interface Occurrence {
  /** The UID for a single event; UID plus the original start for one occurrence of a series. */
  id: string;
  uid: string;
  recurring: boolean;
  title: string;
  /** UTC ms. All-day occurrences start at local midnight. */
  start: number;
  end?: number;
  allDay: boolean;
  status: EventStatus;
  sequence: number;
  organizer?: Party;
  attendees: Party[];
  location?: string;
  description?: string;
  url?: string;
  conference?: string;
}

export type SkipReason = "time_zone" | "rule" | "range" | "date" | "too_long";

export interface Expanded {
  occurrences: Occurrence[];
  /** Series or events left out, by why. */
  skipped: Partial<Record<SkipReason, number>>;
}

/** Most candidate dates walked for one series before giving up on it (a daily series since the 1990s). */
const MAX_STEPS = 60_000;

function best(events: RawEvent[]): RawEvent {
  return events.reduce((a, b) => (b.sequence > a.sequence || (b.sequence === a.sequence && b.modifiedMs > a.modifiedMs) ? b : a));
}

function keyOf(v: DateValue | undefined, floating: Zone): string | null {
  if (!v) return null;
  if (v.allDay) return dateKey(v.y, v.mo, v.d);
  const ms = instantOf(v, floating);
  return ms === null ? null : instantKey(ms);
}

function durationOf(e: RawEvent, floating: Zone): number | undefined {
  if (e.durationMs !== undefined) return e.durationMs;
  if (!e.start || !e.end) return e.start?.allDay ? 86_400_000 : undefined;
  const a = instantOf(e.start, floating);
  const b = instantOf(e.end, floating);
  return a !== null && b !== null && b >= a ? b - a : undefined;
}

function occurrence(e: RawEvent, id: string, start: number, floating: Zone, recurring: boolean, duration = durationOf(e, floating)): Occurrence {
  return {
    id,
    uid: e.uid,
    recurring,
    title: e.title,
    start,
    ...(duration !== undefined ? { end: start + duration } : {}),
    allDay: !!e.start?.allDay,
    status: e.status,
    sequence: e.sequence,
    ...(e.organizer ? { organizer: e.organizer } : {}),
    attendees: e.attendees,
    ...(e.location ? { location: e.location } : {}),
    ...(e.description ? { description: e.description } : {}),
    ...(e.url ? { url: e.url } : {}),
    ...(e.conference ? { conference: e.conference } : {}),
  };
}

/**
 * Every occurrence that starts in [from, to], plus every single (non-repeating) event wherever it falls,
 * so a meeting moved out of the window is still found. Cancelled occurrences are kept (flagged), because
 * a cancellation is news for a meeting already on a deal.
 */
export function expandFeed(feed: ParsedFeed, { from, to }: { from: number; to: number }): Expanded {
  const skipped: Expanded["skipped"] = {};
  const skip = (r: SkipReason) => {
    skipped[r] = (skipped[r] ?? 0) + 1;
  };
  const byUid = new Map<string, { masters: RawEvent[]; overrides: RawEvent[] }>();
  for (const e of feed.events) {
    const g = byUid.get(e.uid) ?? { masters: [], overrides: [] };
    (e.recurrenceId ? g.overrides : g.masters).push(e);
    byUid.set(e.uid, g);
  }
  const out: Occurrence[] = [];
  const inWindow = (ms: number) => ms >= from && ms <= to;
  const fl = feed.floating;

  for (const [uid, g] of byUid) {
    // Two copies of one override (an update sent twice): the higher SEQUENCE, then the later edit, wins.
    const overrides = new Map<string, RawEvent>();
    let rangeSkipped = false;
    for (const o of g.overrides) {
      if (o.rangeFuture) {
        rangeSkipped = true;
        continue;
      }
      const k = keyOf(o.recurrenceId, fl);
      if (!k) continue;
      const prev = overrides.get(k);
      overrides.set(k, prev ? best([prev, o]) : o);
    }
    if (rangeSkipped) {
      skip("range");
      continue;
    }
    const master = g.masters.length ? best(g.masters) : null;

    const fromOverride = (o: RawEvent, k: string): void => {
      if (!o.start) return;
      const start = instantOf(o.start, fl);
      if (start === null) return skip("time_zone");
      if (inWindow(start)) out.push(occurrence(o, `${uid}@${k}`, start, fl, true));
    };

    if (!master) {
      // Invited to one occurrence of someone else's series: only the override is in this feed.
      for (const [k, o] of overrides) fromOverride(o, k);
      continue;
    }
    if (!master.start) {
      skip("date");
      continue;
    }
    const first = instantOf(master.start, fl);
    if (first === null) {
      skip("time_zone");
      continue;
    }
    if (!master.rrule && !master.rdates.length) {
      out.push(occurrence(master, uid, first, fl, false));
      continue;
    }

    let rule: Rule | null = null;
    if (master.rrule) {
      rule = parseRule(master.rrule, { floating: fl, zone: () => null });
      if (!rule) {
        skip("rule");
        continue;
      }
    }

    const duration = durationOf(master, fl);
    const startVal = master.start;
    const starts: { ms: number; key: string }[] = [];
    const at = (x: Day): number | null =>
      startVal.allDay ? wallToUtc({ y: x.y, mo: x.mo, d: x.d, h: 0, mi: 0, s: 0 }, fl) : startVal.zone ? wallToUtc({ ...startVal.wall, y: x.y, mo: x.mo, d: x.d }, startVal.zone) : null;
    const keyFor = (x: Day, ms: number) => (startVal.allDay ? dateKey(x.y, x.mo, x.d) : instantKey(ms));

    const firstDay: Day = startVal.allDay ? { y: startVal.y, mo: startVal.mo, d: startVal.d } : { y: startVal.wall.y, mo: startVal.wall.mo, d: startVal.wall.d };
    starts.push({ ms: first, key: keyFor(firstDay, first) });

    if (rule) {
      const until = rule.until;
      const beyondUntil = (x: Day, ms: number): boolean => {
        if (!until) return false;
        if (until.allDay) return dayMs(x) > Date.UTC(until.y, until.mo - 1, until.d);
        // A floating or zoned UNTIL is compared on the wall clock; a UTC one as an instant.
        if (until.zone && until.zone.kind === "utc" && !until.floating) return ms > wallToUtc(until.wall, UTC);
        const wall = startVal.allDay ? { h: 0, mi: 0, s: 0 } : startVal.wall;
        return Date.UTC(x.y, x.mo - 1, x.d, wall.h, wall.mi, wall.s) > Date.UTC(until.wall.y, until.wall.mo - 1, until.wall.d, until.wall.h, until.wall.mi, until.wall.s);
      };
      let steps = 0;
      let made = 1;
      let tooLong = false;
      for (const x of candidates(rule, firstDay, to)) {
        if (++steps > MAX_STEPS) {
          tooLong = true;
          break;
        }
        if (rule.count !== undefined && made >= rule.count) break;
        const ms = at(x);
        if (ms === null) break;
        if (beyondUntil(x, ms)) break;
        if (ms > to) break;
        made++;
        starts.push({ ms, key: keyFor(x, ms) });
      }
      if (tooLong && !starts.some((s) => s.ms >= from)) {
        skip("too_long");
        continue;
      }
    }
    for (const r of master.rdates) {
      const ms = instantOf(r, fl);
      if (ms !== null) starts.push({ ms, key: r.allDay ? dateKey(r.y, r.mo, r.d) : instantKey(ms) });
    }

    // EXDATE: by instant, or by date when it's written as a date.
    const exInstants = new Set<string>();
    const exDates = new Set<string>();
    for (const x of master.exdates) {
      if (x.allDay) exDates.add(dateKey(x.y, x.mo, x.d));
      else {
        const ms = instantOf(x, fl);
        if (ms !== null) exInstants.add(instantKey(ms));
      }
    }
    const wallDateKey = (ms: number) => {
      if (startVal.allDay) return null;
      const w = utcToWall(ms, startVal.zone ?? fl);
      return dateKey(w.y, w.mo, w.d);
    };

    const seen = new Set<string>();
    for (const s of starts.sort((a, b) => a.ms - b.ms)) {
      if (seen.has(s.key)) continue;
      seen.add(s.key);
      if (exInstants.has(s.key) || exDates.has(s.key) || (exDates.size && exDates.has(wallDateKey(s.ms) ?? ""))) continue;
      const o = overrides.get(s.key);
      if (o) {
        overrides.delete(s.key);
        fromOverride(o, s.key);
        continue;
      }
      if (inWindow(s.ms)) out.push(occurrence(master, `${uid}@${s.key}`, s.ms, fl, true, duration));
    }
    // Overrides for occurrences the rule doesn't produce (moved in from outside the rule): kept as they are.
    for (const [k, o] of overrides) if (!exInstants.has(k) && !exDates.has(k)) fromOverride(o, k);
  }
  return { occurrences: out.sort((a, b) => a.start - b.start || a.id.localeCompare(b.id)), skipped };
}
