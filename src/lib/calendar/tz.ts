/**
 * Time zones for calendar feeds, in code and with no library: IANA names through Intl, the Windows names
 * Outlook and Exchange write (CLDR's windowsZones mapping for the common zones), Outlook's display names
 * ("(UTC-05:00) Eastern Time (US & Canada)"), Mozilla-style prefixed ids, and, when a feed defines its own
 * zone, the VTIMEZONE's yearly rules. A zone that can't be resolved returns null and the caller skips
 * the event rather than guessing an offset.
 */

/** A wall-clock moment, as written in the feed. Month is 1–12. */
export interface Wall {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  s: number;
}

/** One STANDARD or DAYLIGHT block of a VTIMEZONE. Offsets are minutes east of UTC. */
export interface Observance {
  start: Wall;
  from: number;
  to: number;
  /** FREQ=YEARLY rule: the month and either the nth weekday (n<0 counts from the end) or a day of the month. */
  yearly?: { month: number; weekday?: { n: number; wd: number }; monthDay?: number; untilMs?: number };
  /** Extra onsets (RDATE), as wall times in the `from` offset. */
  dates: Wall[];
}

export type Zone = { kind: "utc" } | { kind: "iana"; name: string } | { kind: "fixed"; minutes: number } | { kind: "rules"; observances: Observance[] };

/** What a feed's own VTIMEZONE says, keyed by its TZID. */
export interface VTimezone {
  tzid: string;
  /** Google and Thunderbird name the real zone here. */
  location?: string;
  observances: Observance[];
}

export const UTC: Zone = { kind: "utc" };

/* ───────────── IANA through Intl ───────────── */

const formatters = new Map<string, Intl.DateTimeFormat | null>();

function formatter(name: string): Intl.DateTimeFormat | null {
  if (formatters.has(name)) return formatters.get(name)!;
  let f: Intl.DateTimeFormat | null = null;
  try {
    f = new Intl.DateTimeFormat("en-US", { timeZone: name, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    f = null;
  }
  formatters.set(name, f);
  return f;
}

export function isIanaZone(name: string): boolean {
  return !!name && formatter(name) !== null;
}

/** Minutes east of UTC in an IANA zone at a UTC instant. */
function ianaOffset(utcMs: number, name: string): number {
  const f = formatter(name);
  if (!f) return 0;
  const parts = f.formatToParts(new Date(utcMs));
  const get = (t: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const hour = get("hour") % 24;
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), hour, get("minute"), get("second"));
  return Math.round((asUtc - Math.floor(utcMs / 1000) * 1000) / 60_000);
}

/* ───────────── VTIMEZONE rules ───────────── */

const wallMs = (w: Wall) => Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s);

export function daysInMonth(y: number, mo: number): number {
  return new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

/** Day of the month of the nth weekday (wd 0 = Sunday) in a month; n < 0 counts from the end. Null when it doesn't exist. */
export function nthWeekday(y: number, mo: number, n: number, wd: number): number | null {
  const dim = daysInMonth(y, mo);
  if (n > 0) {
    const firstWd = new Date(Date.UTC(y, mo - 1, 1)).getUTCDay();
    const day = 1 + ((wd - firstWd + 7) % 7) + (n - 1) * 7;
    return day <= dim ? day : null;
  }
  const lastWd = new Date(Date.UTC(y, mo - 1, dim)).getUTCDay();
  const day = dim - ((lastWd - wd + 7) % 7) + (n + 1) * 7;
  return day >= 1 ? day : null;
}

/** Every onset (UTC ms) of an observance in a given year. */
function onsets(o: Observance, year: number): { at: number; to: number }[] {
  const out: { at: number; to: number }[] = [];
  const startAt = wallMs(o.start) - o.from * 60_000;
  if (o.yearly) {
    if (year >= o.start.y) {
      const day = o.yearly.weekday ? nthWeekday(year, o.yearly.month, o.yearly.weekday.n, o.yearly.weekday.wd) : (o.yearly.monthDay ?? null);
      if (day) {
        const at = Date.UTC(year, o.yearly.month - 1, day, o.start.h, o.start.mi, o.start.s) - o.from * 60_000;
        if (at >= startAt && (o.yearly.untilMs === undefined || at <= o.yearly.untilMs)) out.push({ at, to: o.to });
      }
    }
  } else if (o.start.y === year) out.push({ at: startAt, to: o.to });
  for (const r of o.dates) if (r.y === year) out.push({ at: wallMs(r) - o.from * 60_000, to: o.to });
  return out;
}

function rulesOffset(utcMs: number, observances: Observance[]): number {
  const year = new Date(utcMs).getUTCFullYear();
  let best: { at: number; to: number } | null = null;
  for (const o of observances) {
    for (const y of [year - 1, year, year + 1]) {
      for (const x of onsets(o, y)) if (x.at <= utcMs && (!best || x.at > best.at)) best = x;
    }
  }
  if (best) return best.to;
  // Before the first onset on file: the earliest block's starting offset.
  const earliest = [...observances].sort((a, b) => wallMs(a.start) - wallMs(b.start))[0];
  return earliest ? earliest.from : 0;
}

/* ───────────── Converting ───────────── */

export function offsetAt(utcMs: number, zone: Zone): number {
  switch (zone.kind) {
    case "utc":
      return 0;
    case "fixed":
      return zone.minutes;
    case "iana":
      return ianaOffset(utcMs, zone.name);
    case "rules":
      return rulesOffset(utcMs, zone.observances);
  }
}

/** A wall-clock time in a zone → UTC ms. A time skipped by a DST change lands an hour later, as calendar apps show it. */
export function wallToUtc(w: Wall, zone: Zone): number {
  const local = wallMs(w);
  if (zone.kind === "utc") return local;
  if (zone.kind === "fixed") return local - zone.minutes * 60_000;
  const first = offsetAt(local, zone);
  let utc = local - first * 60_000;
  const second = offsetAt(utc, zone);
  if (second !== first) {
    const retry = local - second * 60_000;
    // Keep whichever reading agrees with itself; in a DST gap neither does, so take the later offset's.
    utc = offsetAt(retry, zone) === second ? retry : utc;
  }
  return utc;
}

/** UTC ms → the wall clock in a zone. */
export function utcToWall(utcMs: number, zone: Zone): Wall {
  const d = new Date(utcMs + offsetAt(utcMs, zone) * 60_000);
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds() };
}

/* ───────────── Resolving a TZID ───────────── */

/** CLDR windowsZones, territory 001, for the zones calendars actually use. */
const WINDOWS: Record<string, string> = {
  "dateline standard time": "Etc/GMT+12",
  "utc-11": "Etc/GMT+11",
  "aleutian standard time": "America/Adak",
  "hawaiian standard time": "Pacific/Honolulu",
  "marquesas standard time": "Pacific/Marquesas",
  "alaskan standard time": "America/Anchorage",
  "utc-09": "Etc/GMT+9",
  "pacific standard time (mexico)": "America/Tijuana",
  "utc-08": "Etc/GMT+8",
  "pacific standard time": "America/Los_Angeles",
  "us mountain standard time": "America/Phoenix",
  "mountain standard time (mexico)": "America/Mazatlan",
  "mountain standard time": "America/Denver",
  "yukon standard time": "America/Whitehorse",
  "central america standard time": "America/Guatemala",
  "central standard time": "America/Chicago",
  "easter island standard time": "Pacific/Easter",
  "central standard time (mexico)": "America/Mexico_City",
  "canada central standard time": "America/Regina",
  "sa pacific standard time": "America/Bogota",
  "eastern standard time (mexico)": "America/Cancun",
  "eastern standard time": "America/New_York",
  "haiti standard time": "America/Port-au-Prince",
  "cuba standard time": "America/Havana",
  "us eastern standard time": "America/Indiana/Indianapolis",
  "turks and caicos standard time": "America/Grand_Turk",
  "paraguay standard time": "America/Asuncion",
  "atlantic standard time": "America/Halifax",
  "venezuela standard time": "America/Caracas",
  "central brazilian standard time": "America/Cuiaba",
  "sa western standard time": "America/La_Paz",
  "pacific sa standard time": "America/Santiago",
  "newfoundland standard time": "America/St_Johns",
  "tocantins standard time": "America/Araguaina",
  "e. south america standard time": "America/Sao_Paulo",
  "sa eastern standard time": "America/Cayenne",
  "argentina standard time": "America/Argentina/Buenos_Aires",
  "greenland standard time": "America/Godthab",
  "montevideo standard time": "America/Montevideo",
  "magallanes standard time": "America/Punta_Arenas",
  "saint pierre standard time": "America/Miquelon",
  "bahia standard time": "America/Bahia",
  "utc-02": "Etc/GMT+2",
  "mid-atlantic standard time": "Etc/GMT+2",
  "azores standard time": "Atlantic/Azores",
  "cape verde standard time": "Atlantic/Cape_Verde",
  utc: "UTC",
  "coordinated universal time": "UTC",
  "gmt standard time": "Europe/London",
  "greenwich standard time": "Atlantic/Reykjavik",
  "sao tome standard time": "Africa/Sao_Tome",
  "morocco standard time": "Africa/Casablanca",
  "w. europe standard time": "Europe/Berlin",
  "central europe standard time": "Europe/Budapest",
  "romance standard time": "Europe/Paris",
  "central european standard time": "Europe/Warsaw",
  "w. central africa standard time": "Africa/Lagos",
  "jordan standard time": "Asia/Amman",
  "gtb standard time": "Europe/Bucharest",
  "middle east standard time": "Asia/Beirut",
  "egypt standard time": "Africa/Cairo",
  "e. europe standard time": "Europe/Chisinau",
  "syria standard time": "Asia/Damascus",
  "west bank standard time": "Asia/Hebron",
  "south africa standard time": "Africa/Johannesburg",
  "fle standard time": "Europe/Kiev",
  "israel standard time": "Asia/Jerusalem",
  "south sudan standard time": "Africa/Juba",
  "kaliningrad standard time": "Europe/Kaliningrad",
  "sudan standard time": "Africa/Khartoum",
  "libya standard time": "Africa/Tripoli",
  "namibia standard time": "Africa/Windhoek",
  "arabic standard time": "Asia/Baghdad",
  "turkey standard time": "Europe/Istanbul",
  "arab standard time": "Asia/Riyadh",
  "belarus standard time": "Europe/Minsk",
  "russian standard time": "Europe/Moscow",
  "e. africa standard time": "Africa/Nairobi",
  "volgograd standard time": "Europe/Volgograd",
  "iran standard time": "Asia/Tehran",
  "arabian standard time": "Asia/Dubai",
  "astrakhan standard time": "Europe/Astrakhan",
  "azerbaijan standard time": "Asia/Baku",
  "russia time zone 3": "Europe/Samara",
  "mauritius standard time": "Indian/Mauritius",
  "saratov standard time": "Europe/Saratov",
  "georgian standard time": "Asia/Tbilisi",
  "caucasus standard time": "Asia/Yerevan",
  "afghanistan standard time": "Asia/Kabul",
  "west asia standard time": "Asia/Tashkent",
  "ekaterinburg standard time": "Asia/Yekaterinburg",
  "pakistan standard time": "Asia/Karachi",
  "qyzylorda standard time": "Asia/Qyzylorda",
  "india standard time": "Asia/Kolkata",
  "sri lanka standard time": "Asia/Colombo",
  "nepal standard time": "Asia/Kathmandu",
  "central asia standard time": "Asia/Almaty",
  "bangladesh standard time": "Asia/Dhaka",
  "omsk standard time": "Asia/Omsk",
  "myanmar standard time": "Asia/Rangoon",
  "se asia standard time": "Asia/Bangkok",
  "altai standard time": "Asia/Barnaul",
  "w. mongolia standard time": "Asia/Hovd",
  "north asia standard time": "Asia/Krasnoyarsk",
  "n. central asia standard time": "Asia/Novosibirsk",
  "tomsk standard time": "Asia/Tomsk",
  "china standard time": "Asia/Shanghai",
  "north asia east standard time": "Asia/Irkutsk",
  "singapore standard time": "Asia/Singapore",
  "w. australia standard time": "Australia/Perth",
  "taipei standard time": "Asia/Taipei",
  "ulaanbaatar standard time": "Asia/Ulaanbaatar",
  "aus central w. standard time": "Australia/Eucla",
  "transbaikal standard time": "Asia/Chita",
  "tokyo standard time": "Asia/Tokyo",
  "north korea standard time": "Asia/Pyongyang",
  "korea standard time": "Asia/Seoul",
  "yakutsk standard time": "Asia/Yakutsk",
  "cen. australia standard time": "Australia/Adelaide",
  "aus central standard time": "Australia/Darwin",
  "e. australia standard time": "Australia/Brisbane",
  "aus eastern standard time": "Australia/Sydney",
  "west pacific standard time": "Pacific/Port_Moresby",
  "tasmania standard time": "Australia/Hobart",
  "vladivostok standard time": "Asia/Vladivostok",
  "lord howe standard time": "Australia/Lord_Howe",
  "bougainville standard time": "Pacific/Bougainville",
  "russia time zone 10": "Asia/Srednekolymsk",
  "magadan standard time": "Asia/Magadan",
  "norfolk standard time": "Pacific/Norfolk",
  "sakhalin standard time": "Asia/Sakhalin",
  "central pacific standard time": "Pacific/Guadalcanal",
  "russia time zone 11": "Asia/Kamchatka",
  "new zealand standard time": "Pacific/Auckland",
  "utc+12": "Etc/GMT-12",
  "fiji standard time": "Pacific/Fiji",
  "chatham islands standard time": "Pacific/Chatham",
  "utc+13": "Etc/GMT-13",
  "tonga standard time": "Pacific/Tongatapu",
  "samoa standard time": "Pacific/Apia",
  "line islands standard time": "Pacific/Kiritimati",
};

/** Outlook's display names, as some exports write them in TZID: "(UTC-05:00) Eastern Time (US & Canada)". */
const DISPLAY: [RegExp, string][] = [
  [/eastern time \(us/, "America/New_York"],
  [/central time \(us/, "America/Chicago"],
  [/mountain time \(us/, "America/Denver"],
  [/pacific time \(us/, "America/Los_Angeles"],
  [/\barizona\b/, "America/Phoenix"],
  [/\balaska\b/, "America/Anchorage"],
  [/\bhawaii\b/, "Pacific/Honolulu"],
  [/atlantic time \(canada/, "America/Halifax"],
  [/\bnewfoundland\b/, "America/St_Johns"],
  [/\bsaskatchewan\b/, "America/Regina"],
  [/indiana \(east/, "America/Indiana/Indianapolis"],
  [/guadalajara|mexico city|monterrey/, "America/Mexico_City"],
  [/bogota|lima|quito/, "America/Bogota"],
  [/\bbrasilia\b/, "America/Sao_Paulo"],
  [/buenos aires/, "America/Argentina/Buenos_Aires"],
  [/dublin|edinburgh|lisbon|london/, "Europe/London"],
  [/amsterdam|berlin|bern|rome|stockholm|vienna/, "Europe/Berlin"],
  [/brussels|copenhagen|madrid|paris/, "Europe/Paris"],
  [/belgrade|bratislava|budapest|ljubljana|prague/, "Europe/Budapest"],
  [/sarajevo|skopje|warsaw|zagreb/, "Europe/Warsaw"],
  [/athens|bucharest/, "Europe/Bucharest"],
  [/helsinki|kyiv|kiev|riga|sofia|tallinn|vilnius/, "Europe/Kiev"],
  [/\bistanbul\b/, "Europe/Istanbul"],
  [/moscow|st\. petersburg/, "Europe/Moscow"],
  [/\bjerusalem\b/, "Asia/Jerusalem"],
  [/\bcairo\b/, "Africa/Cairo"],
  [/harare|pretoria/, "Africa/Johannesburg"],
  [/\bnairobi\b/, "Africa/Nairobi"],
  [/abu dhabi|muscat/, "Asia/Dubai"],
  [/islamabad|karachi/, "Asia/Karachi"],
  [/chennai|kolkata|mumbai|new delhi/, "Asia/Kolkata"],
  [/\bdhaka\b/, "Asia/Dhaka"],
  [/bangkok|hanoi|jakarta/, "Asia/Bangkok"],
  [/beijing|chongqing|hong kong|urumqi/, "Asia/Shanghai"],
  [/kuala lumpur|singapore/, "Asia/Singapore"],
  [/\btaipei\b/, "Asia/Taipei"],
  [/\bperth\b/, "Australia/Perth"],
  [/osaka|sapporo|tokyo/, "Asia/Tokyo"],
  [/\bseoul\b/, "Asia/Seoul"],
  [/\badelaide\b/, "Australia/Adelaide"],
  [/\bdarwin\b/, "Australia/Darwin"],
  [/\bbrisbane\b/, "Australia/Brisbane"],
  [/canberra|melbourne|sydney/, "Australia/Sydney"],
  [/\bhobart\b/, "Australia/Hobart"],
  [/auckland|wellington/, "Pacific/Auckland"],
  [/coordinated universal time/, "UTC"],
];

function iana(name: string): Zone | null {
  if (/^(utc|gmt|z|etc\/utc|etc\/gmt|zulu|universal)$/i.test(name)) return UTC;
  return isIanaZone(name) ? { kind: "iana", name } : null;
}

/**
 * The zone a TZID names: an IANA name, a Windows name, an Outlook display name, a prefixed id
 * ("/mozilla.org/20070129_1/America/New_York"), or the feed's own VTIMEZONE (its X-LIC-LOCATION first,
 * then its rules). Null when none of these works.
 */
export function resolveZone(tzid: string | undefined, defined: Map<string, VTimezone> = new Map()): Zone | null {
  const raw = (tzid ?? "").trim().replace(/^"|"$/g, "");
  if (!raw) return null;
  const direct = iana(raw);
  if (direct) return direct;
  const lower = raw.toLowerCase();
  const win = WINDOWS[lower];
  if (win) return iana(win);
  // "/mozilla.org/20070129_1/America/New_York", "/citadel.org/20190914_1/Europe/Paris": the tail is the zone.
  if (raw.includes("/")) {
    const parts = raw.split("/").filter(Boolean);
    for (let i = 0; i < parts.length - 1; i++) {
      const z = iana(parts.slice(i).join("/"));
      if (z) return z;
    }
  }
  const display = DISPLAY.find(([re]) => re.test(lower));
  if (display) return iana(display[1]);
  const own = defined.get(raw) ?? defined.get(lower);
  if (own) {
    const named = own.location ? iana(own.location) : null;
    if (named) return named;
    if (own.observances.length === 1 && !own.observances[0].yearly) return { kind: "fixed", minutes: own.observances[0].to };
    if (own.observances.length) return { kind: "rules", observances: own.observances };
  }
  // "(UTC+05:30) …" with no region we know: a fixed offset is only right for a zone without DST, so it isn't used.
  return null;
}

/** The machine's own zone, for floating times in a feed that names none. */
export function localZone(): Zone {
  const name = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (name && iana(name)) || UTC;
}
