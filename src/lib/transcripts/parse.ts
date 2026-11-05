/**
 * Call transcripts from the tools founders already use, read in code (zero tokens): WebVTT from Zoom and
 * Microsoft Teams, SRT, Zoom's saved .txt, Google Meet's transcript doc, and the plain-text exports of
 * Fathom, Granola and Otter, plus any "Name: text" transcript. Speakers, timestamps, the call's date and
 * title, talk share and question counts come out of it; the debrief reads one clean line per turn.
 *
 * Text without speaker labels or timestamps is treated as the founder's notes, so nothing in it is ever
 * presented as the buyer's words.
 */

export type TranscriptFormat = "zoom_vtt" | "teams_vtt" | "vtt" | "srt" | "zoom_txt" | "meet" | "fathom" | "otter" | "granola" | "speaker_text" | "notes";

export const FORMAT_LABEL: Record<TranscriptFormat, string> = {
  zoom_vtt: "Zoom transcript (.vtt)",
  teams_vtt: "Microsoft Teams transcript (.vtt)",
  vtt: "WebVTT transcript",
  srt: "Subtitles (.srt)",
  zoom_txt: "Zoom transcript (.txt)",
  meet: "Google Meet transcript",
  fathom: "Fathom transcript",
  otter: "Otter transcript",
  granola: "Granola transcript",
  speaker_text: "Speaker-labeled transcript",
  notes: "Notes, no speaker labels",
};

export interface Segment {
  /** Seconds from the start of the call. */
  start?: number;
  end?: number;
  speaker?: string;
  text: string;
}

export interface Turn {
  start?: number;
  speaker?: string;
  text: string;
}

export interface SpeakerStat {
  /** As the transcript labels them, without a company in brackets. */
  name: string;
  /** "Maren Holt (Tidewell)" in Fathom and Teams labels. */
  company?: string;
  words: number;
  turns: number;
  /** Sentences ending in a question mark. */
  questions: number;
  /** Share of all words spoken, 0–1. */
  share: number;
  /** "Speaker 1", "Them", "Unknown Speaker": a label to rename. */
  generic: boolean;
  /** Matches the founder's name, or Granola's "Me". */
  founder: boolean;
}

export interface When {
  /** Local calendar date, YYYY-MM-DD. */
  date: string;
  /** Local clock time, HH:MM, when known. */
  time?: string;
  /** The exact moment, when the source gives a zone (Zoom's GMT file names, Meet's GMT offset). */
  iso?: string;
  from: "file name" | "transcript";
}

export interface ParsedTranscript {
  format: TranscriptFormat;
  formatLabel: string;
  /** Speaker labels or timestamps: quotes from it are verbatim. */
  isTranscript: boolean;
  title?: string;
  when?: When;
  durationSec?: number;
  /** Names a header lists (Meet's Attendees, Otter's SPEAKERS), in case they never spoke. */
  listed: string[];
  speakers: SpeakerStat[];
  turns: Turn[];
  words: number;
  /** What the debrief reads: one line per turn, "[mm:ss] Name: text". */
  text: string;
  warnings: string[];
}

/** The debrief takes at most this much text. */
export const MAX_TEXT = 200_000;

/* ───────────── Small readers ───────────── */

const decode = (s: string) =>
  s
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&");

const clean = (s: string) => decode(s).replace(/\s+/g, " ").trim();
const wordsIn = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);

/** "01:02:03.456", "02:03,456", "1:02:03", "12:34" → seconds. */
export function seconds(stamp: string): number | null {
  const m = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?$/.exec(stamp.trim());
  if (!m) return null;
  const [h, mi, s, frac] = [Number(m[1] ?? 0), Number(m[2]), Number(m[3]), m[4] ? Number(m[4].padEnd(3, "0")) / 1000 : 0];
  if (mi > 59 && m[1] !== undefined) return null;
  if (s > 59) return null;
  return h * 3600 + mi * 60 + s + frac;
}

export function clock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

const GENERIC = /^(speaker|participant|unknown speaker|unknown|guest|attendee|caller|interviewer|interviewee|them|other|you)(\s*[#]?\d+)?$/i;
// Labels that start note lines, not speakers ("Next steps: …").
const NOT_A_SPEAKER = new Set(
  "agenda note notes summary action items action item next steps next step attendees attendee date time subject title topic decision decisions owner pricing price budget q a question answer re fwd to from cc bcc url link location when where why what who how goal goals context background outcome outcomes follow up follow-up todo to do tasks task recap transcript meeting call keywords speakers participants".split(" "),
);

/** Splits "Maren Holt (Tidewell)" into the name and the company. */
function splitLabel(label: string): { name: string; company?: string } {
  const m = /^(.*?)\s*\(([^)]{1,60})\)\s*$/.exec(label.trim());
  if (m && m[1] && !/^\d/.test(m[2])) return { name: m[1].trim(), company: m[2].trim() };
  return { name: label.trim() };
}

function plausibleSpeaker(label: string): boolean {
  const name = splitLabel(label).name.replace(/^\*+|\*+$/g, "").trim();
  if (!name || name.length > 48) return false;
  if (GENERIC.test(name) || /^me$/i.test(name)) return true;
  if (NOT_A_SPEAKER.has(name.toLowerCase())) return false;
  const words = name.split(/\s+/);
  if (words.length > 5) return false;
  if (/[?!;=<>{}[\]|@#$%^&*+\\/]/.test(name) || /https?:/i.test(name)) return false;
  // Names start with a capital letter (any script), or are a single all-caps label like "PRIYA".
  return words.every((w) => /^[\p{Lu}\p{Lt}]/u.test(w) || /^(de|da|van|von|der|del|la|le|bin|al|du|di|dos|das|y|e)$/i.test(w) || /^[\p{Lo}]/u.test(w));
}

/* ───────────── Dates and titles ───────────── */

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const pad2 = (n: number) => String(n).padStart(2, "0");
const ymd = (y: number, mo: number, d: number) => `${y}-${pad2(mo)}-${pad2(d)}`;
const validDate = (y: number, mo: number, d: number) => y >= 2000 && y <= 2100 && mo >= 1 && mo <= 12 && d >= 1 && d <= new Date(Date.UTC(y, mo, 0)).getUTCDate();

function localParts(ms: number): { date: string; time: string } {
  const d = new Date(ms);
  return { date: ymd(d.getFullYear(), d.getMonth() + 1, d.getDate()), time: `${pad2(d.getHours())}:${pad2(d.getMinutes())}` };
}

/** A date without a year: the most recent one that isn't more than a week ahead. */
function inferYear(mo: number, d: number, now: Date): number {
  const y = now.getFullYear();
  const candidate = new Date(y, mo - 1, d).getTime();
  return candidate - now.getTime() > 7 * 86_400_000 ? y - 1 : y;
}

function to24(h: number, ampm?: string): number {
  if (!ampm) return h;
  const pm = /p/i.test(ampm);
  return h === 12 ? (pm ? 12 : 0) : pm ? h + 12 : h;
}

/** Finds when a call happened in a file name or a header line. */
export function findWhen(text: string, from: When["from"], now: Date): When | undefined {
  // Zoom cloud recordings: GMT20261019-220112_Recording.transcript.vtt (UTC).
  let m = /GMT(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/.exec(text);
  if (m) {
    const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
    if (validDate(y, mo, d) && h < 24 && mi < 60) {
      const ms = Date.UTC(y, mo - 1, d, h, mi, s);
      return { ...localParts(ms), iso: new Date(ms).toISOString(), from };
    }
  }
  // Google Meet: "(2026-10-19 15:00 GMT-07:00)".
  m = /(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})\s*(?:GMT|UTC)\s*([+-])(\d{1,2})(?::?(\d{2}))?/.exec(text);
  if (m) {
    const [y, mo, d, h, mi] = m.slice(1, 6).map(Number);
    const sign = m[6] === "-" ? -1 : 1;
    const offset = sign * (Number(m[7]) * 60 + Number(m[8] ?? 0));
    if (validDate(y, mo, d) && h < 24 && mi < 60) {
      const ms = Date.UTC(y, mo - 1, d, h, mi) - offset * 60_000;
      return { ...localParts(ms), iso: new Date(ms).toISOString(), from };
    }
  }
  // 2026-10-19, 2026_10_19, 2026.10.19, with an optional time ("15.00.12", "15:00", "1500").
  m = /(20\d{2})[-_.](\d{2})[-_.](\d{2})(?:[ T_]+(\d{1,2})[.:h-]?(\d{2})(?:[.:-]?(\d{2}))?(?!\d))?/.exec(text);
  if (m) {
    const [y, mo, d] = m.slice(1, 4).map(Number);
    if (validDate(y, mo, d)) {
      const h = m[4] !== undefined ? Number(m[4]) : null;
      const mi = m[5] !== undefined ? Number(m[5]) : null;
      return { date: ymd(y, mo, d), ...(h !== null && mi !== null && h < 24 && mi < 60 ? { time: `${pad2(h)}:${pad2(mi)}` } : {}), from };
    }
  }
  // Month names: "Mon, Oct 19, 2026 3:00PM", "October 19, 2026", "19 Oct 2026", "October 19".
  const time = /\b(\d{1,2}):(\d{2})\s*([ap]\.?m\.?)\b/i.exec(text) ?? /\b(\d{1,2}):(\d{2})\b(?!\s*(?:-->|,\d))/.exec(text);
  const withTime = (date: string): When => {
    if (!time) return { date, from };
    const h = to24(Number(time[1]), time[3]);
    const mi = Number(time[2]);
    return h < 24 && mi < 60 ? { date, time: `${pad2(h)}:${pad2(mi)}`, from } : { date, from };
  };
  const monthIdx = (s: string) => MONTHS.indexOf(s.slice(0, 3).toLowerCase()) + 1;
  m = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(20\d{2}))?\b/i.exec(text);
  if (m) {
    const mo = monthIdx(m[1]);
    const d = Number(m[2]);
    const y = m[3] ? Number(m[3]) : inferYear(mo, d, now);
    if (validDate(y, mo, d)) return withTime(ymd(y, mo, d));
  }
  m = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?,?\s+(20\d{2})\b/i.exec(text);
  if (m) {
    const mo = monthIdx(m[2]);
    const [d, y] = [Number(m[1]), Number(m[3])];
    if (validDate(y, mo, d)) return withTime(ymd(y, mo, d));
  }
  // Compact: 20261019.
  m = /(?<!\d)(20\d{2})(\d{2})(\d{2})(?!\d)/.exec(text);
  if (m) {
    const [y, mo, d] = m.slice(1).map(Number);
    if (validDate(y, mo, d)) return { date: ymd(y, mo, d), from };
  }
  return undefined;
}

const GENERIC_TITLE = /^(zoom meeting|meeting|recording|audio transcript|transcript|call|untitled|new recording|meeting recording|.*'s zoom meeting|.*'s personal meeting room)$/i;

function titleFromName(fileName: string): string | undefined {
  const base = fileName
    .replace(/\.(transcript\.)?(vtt|srt|txt|md|markdown|text)$/i, "")
    .replace(/GMT\d{8}-\d{6}_?/i, "")
    .replace(/(20\d{2})[-_.](\d{2})[-_.](\d{2})([ T_]+\d{1,2}[.:h-]?\d{2}([.:-]?\d{2})?)?/g, "")
    .replace(/_Recording|Recording_?|[_]+/gi, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s\-–—:]+|[\s\-–—:]+$/g, "")
    .trim();
  return base && !GENERIC_TITLE.test(base) && base.length <= 120 ? base : undefined;
}

function cleanTitle(line: string): string | undefined {
  const t = line
    .replace(/^#+\s*/, "")
    .replace(/^\*+|\*+$/g, "")
    .replace(/\s*[-–—]\s*(transcript|recording|meeting notes|notes)\s*$/i, "")
    .replace(/\s*[-–—]\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(,?\s+20\d{2})?\s*$/i, "")
    .replace(/\s*\((20\d{2})-\d{2}-\d{2}[^)]*\)\s*$/, "")
    .trim();
  // A sentence is the start of someone's notes, not a title.
  if (!t || t.length > 100 || /[.!?]$/.test(t) || t.split(/\s+/).length > 12 || GENERIC_TITLE.test(t)) return undefined;
  return t;
}

/* ───────────── Format readers ───────────── */

interface Read {
  format: TranscriptFormat;
  segments: Segment[];
  /** Lines before the transcript proper (titles, dates, headers). */
  header: string[];
  listed?: string[];
  /** Zoom's .txt stamps are clock times; the first one is when the call started. */
  startClock?: string;
  durationSec?: number;
}

const ARROW = /^((?:\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{1,3})\s*-->\s*((?:\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{1,3})/;

function readCues(lines: string[], format: "vtt" | "srt"): Read {
  const segments: Segment[] = [];
  let teams = false;
  let zoomish = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = ARROW.exec(lines[i].trim());
    if (!m) continue;
    const start = seconds(m[1]);
    const end = seconds(m[2]);
    const body: string[] = [];
    while (i + 1 < lines.length && lines[i + 1].trim() !== "" && !ARROW.test(lines[i + 1].trim())) body.push(lines[++i]);
    // A cue id between cues ("12", or Teams' "uuid/12-0") sits on the line before the next arrow: drop it.
    if (body.length > 1 && i + 1 < lines.length && ARROW.test(lines[i + 1]?.trim() ?? "")) body.pop();
    let raw = body.join(" ");
    let speaker: string | undefined;
    const voice = /<v(?:\.[\w.-]+)?\s+([^>]+)>/i.exec(raw);
    if (voice) {
      speaker = voice[1].trim();
      teams = true;
    }
    raw = raw.replace(/<\d{1,2}:\d{2}(?::\d{2})?[.,]\d{3}>/g, "").replace(/<\/?[a-z][^>]*>/gi, "");
    let text = clean(raw);
    if (!speaker) {
      const label = /^([^:]{1,60}):\s+(.+)$/.exec(text);
      if (label && plausibleSpeaker(label[1])) {
        speaker = label[1].trim();
        text = label[2].trim();
        zoomish++;
      } else {
        const bracket = /^\[([^\]]{1,60})\]\s*(.+)$/.exec(text);
        if (bracket && plausibleSpeaker(bracket[1])) {
          speaker = bracket[1].trim();
          text = bracket[2].trim();
        }
      }
    }
    if (!text) continue;
    segments.push({ ...(start !== null ? { start } : {}), ...(end !== null ? { end } : {}), ...(speaker ? { speaker } : {}), text });
  }
  const fmt: TranscriptFormat = format === "srt" ? "srt" : teams ? "teams_vtt" : zoomish ? "zoom_vtt" : "vtt";
  return { format: fmt, segments, header: [], durationSec: segments.at(-1)?.end ?? segments.at(-1)?.start };
}

/** Fathom: "0:12 - Maren Holt (Tidewell)" then the words, indented, until the next stamp. */
const FATHOM_HEAD = /^@?((?:\d{1,2}:)?\d{1,2}:\d{2})\s+-\s+(.{1,80})$/;
/** Otter: "Maren Holt  0:12" then the words. */
const OTTER_HEAD = /^(.{1,60}?)\s{2,}((?:\d{1,2}:)?\d{1,2}:\d{2})\s*$/;
/** Zoom's saved .txt: "[Maren Holt] 15:01:12" then the words. */
const ZOOM_TXT_HEAD = /^\[([^\]]{1,60})\]\s+(\d{1,2}:\d{2}:\d{2})\s*$/;

function readBlocks(lines: string[], head: RegExp, format: TranscriptFormat, order: "stamp-first" | "name-first"): Read {
  const segments: Segment[] = [];
  const header: string[] = [];
  let cur: Segment | null = null;
  let startClock: string | undefined;
  for (const line of lines) {
    const m = head.exec(line.trim());
    if (m) {
      const [stamp, label] = order === "stamp-first" ? [m[1], m[2]] : [m[2], m[1]];
      if (format === "zoom_txt" && !startClock) startClock = stamp;
      let start = seconds(stamp);
      if (format === "zoom_txt" && start !== null && startClock) start = Math.max(0, start - (seconds(startClock) ?? 0));
      cur = { ...(start !== null ? { start } : {}), speaker: label.trim(), text: "" };
      segments.push(cur);
      continue;
    }
    if (!cur) {
      if (line.trim()) header.push(line.trim());
      continue;
    }
    if (line.trim()) cur.text = cur.text ? `${cur.text} ${clean(line)}` : clean(line);
  }
  return { format, segments: segments.filter((s) => s.text), header, ...(startClock ? { startClock } : {}) };
}

/** "Name: text" lines, with optional stamps; Meet's standalone "00:05:00" lines move the clock. */
const LINE_FORMS: RegExp[] = [
  // [00:01:23] Name: text · (00:01) Name: text · 00:01:23 Name: text · 00:01:23 - Name: text
  /^[[(]?((?:\d{1,2}:)?\d{1,2}:\d{2})[\])]?\s*[-–]?\s*([^:]{1,60}?):\s+(.+)$/,
  // Name (00:01:23): text · Name [00:01]: text · **Name** (00:01): text
  /^\**([^:*()[\]]{1,60}?)\**\s*[[(]((?:\d{1,2}:)?\d{1,2}:\d{2})[\])]\s*:?\s+(.+)$/,
  // **Name:** text · **Name**: text · - Name: text · Name: text
  /^(?:[-*•]\s+)?\**([^:*]{1,60}?)\**\s*:\**\s+(.+)$/,
];

function readLines(lines: string[]): Read {
  const segments: Segment[] = [];
  const header: string[] = [];
  let clockAt: number | undefined;
  let labeled = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const alone = /^[[(]?((?:\d{1,2}:)?\d{1,2}:\d{2})[\])]?$/.exec(line);
    if (alone) {
      const s = seconds(alone[1]);
      if (s !== null) clockAt = s;
      continue;
    }
    let seg: Segment | null = null;
    let m = LINE_FORMS[0].exec(line);
    if (m && plausibleSpeaker(m[2])) seg = { start: seconds(m[1]) ?? undefined, speaker: m[2].trim(), text: clean(m[3]) };
    if (!seg && (m = LINE_FORMS[1].exec(line)) && plausibleSpeaker(m[1])) seg = { start: seconds(m[2]) ?? undefined, speaker: m[1].trim(), text: clean(m[3]) };
    if (!seg && (m = LINE_FORMS[2].exec(line)) && plausibleSpeaker(m[1])) seg = { ...(clockAt !== undefined ? { start: clockAt } : {}), speaker: m[1].trim(), text: clean(m[2]) };
    if (seg) {
      if (seg.start === undefined) delete seg.start;
      segments.push(seg);
      labeled++;
      continue;
    }
    if (!segments.length) header.push(line);
    else {
      // A line without a label continues the speaker before it.
      const last = segments[segments.length - 1];
      last.text = `${last.text} ${clean(line)}`;
    }
  }
  const speakers = new Set(segments.map((s) => (s.speaker ?? "").toLowerCase()));
  const granola = [...speakers].every((s) => s === "me" || s === "them") && speakers.size > 0;
  const meet = header.some((h) => /^transcript$/i.test(h)) || header.some((h) => /^attendees$/i.test(h));
  // A couple of "Agenda:" style lines aren't a transcript: it needs several labeled turns, or two voices.
  const isTranscript = labeled >= 4 && (speakers.size >= 2 || labeled >= 8);
  return { format: !isTranscript ? "notes" : granola ? "granola" : meet ? "meet" : "speaker_text", segments: isTranscript ? segments : [], header };
}

/* ───────────── The transcript ───────────── */

/**
 * "Okay: so the thing is…" in a long captioned call reads like a speaker called Okay. A one-word label that
 * labels a single line, among speakers who talk throughout, goes back into the text.
 */
function dropStrayLabels(segments: Segment[]): Segment[] {
  if (segments.length < 20) return segments;
  const count = new Map<string, number>();
  for (const s of segments) if (s.speaker) count.set(s.speaker, (count.get(s.speaker) ?? 0) + 1);
  const steady = [...count.values()].filter((n) => n >= 3).length;
  if (steady < 2) return segments;
  let prev: string | undefined;
  return segments.map((s) => {
    if (s.speaker && count.get(s.speaker) === 1 && !/\s/.test(s.speaker.trim()) && !GENERIC.test(s.speaker)) {
      const folded: Segment = { ...s, text: `${s.speaker}: ${s.text}`, ...(prev ? { speaker: prev } : {}) };
      if (!prev) delete folded.speaker;
      return folded;
    }
    prev = s.speaker ?? prev;
    return s;
  });
}

function merge(segments: Segment[]): Turn[] {
  const turns: Turn[] = [];
  for (const s of segments) {
    const last = turns[turns.length - 1];
    if (last && s.speaker && last.speaker === s.speaker) last.text = `${last.text} ${s.text}`;
    else turns.push({ ...(s.start !== undefined ? { start: s.start } : {}), ...(s.speaker ? { speaker: s.speaker } : {}), text: s.text });
  }
  return turns;
}

function render(turns: Turn[]): string {
  const timed = turns.some((t) => t.start !== undefined);
  return turns.map((t) => `${timed && t.start !== undefined ? `[${clock(t.start)}] ` : ""}${t.speaker ? `${t.speaker}: ` : ""}${t.text}`).join("\n");
}

const norm = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export function isFounderLabel(label: string, founderNames: string[]): boolean {
  const n = norm(label);
  if (n === "me") return true;
  return founderNames.some((f) => {
    const full = norm(f);
    if (!full) return false;
    return n === full || n === full.split(" ")[0] || (n.split(" ")[0] === full.split(" ")[0] && n.split(" ").length > 1 && full.split(" ").length > 1 && n.split(" ").at(-1) === full.split(" ").at(-1));
  });
}

function stats(turns: Turn[], founderNames: string[]): { speakers: SpeakerStat[]; words: number } {
  const by = new Map<string, SpeakerStat>();
  let words = 0;
  for (const t of turns) {
    const w = wordsIn(t.text);
    words += w;
    if (!t.speaker) continue;
    const { name, company } = splitLabel(t.speaker);
    const s = by.get(t.speaker) ?? { name, ...(company ? { company } : {}), words: 0, turns: 0, questions: 0, share: 0, generic: GENERIC.test(name), founder: isFounderLabel(name, founderNames) };
    s.words += w;
    s.turns += 1;
    s.questions += (t.text.match(/\?(\s|$)/g) ?? []).length;
    by.set(t.speaker, s);
  }
  const speakers = [...by.values()].map((s) => ({ ...s, share: words ? s.words / words : 0 })).sort((a, b) => b.words - a.words);
  return { speakers, words };
}

function finish(read: Read, opts: { fileName?: string; now: Date; founderNames: string[] }): ParsedTranscript {
  const turns = merge(dropStrayLabels(read.segments));
  const { speakers, words } = stats(turns, opts.founderNames);
  const isTranscript = read.format !== "notes" && (speakers.length > 0 || (turns.filter((t) => t.start !== undefined).length >= 6));
  const warnings: string[] = [];
  let text = isTranscript ? render(turns) : "";
  if (text.length > MAX_TEXT) {
    text = text.slice(0, text.lastIndexOf("\n", MAX_TEXT));
    warnings.push("This transcript is very long, so I'll read the first three hours or so.");
  }
  if (read.format === "granola") warnings.push("Granola labels speakers Me and Them. Name them below so each quote is attributed to the right person.");
  else if (speakers.some((s) => s.generic)) warnings.push("Some speakers aren't named. Name them below if you can.");

  const headerText = read.header.slice(0, 15).join("\n");
  const when = (opts.fileName ? findWhen(opts.fileName, "file name", opts.now) : undefined) ?? (headerText ? findWhen(headerText, "transcript", opts.now) : undefined);
  const whenWithClock = when && !when.time && read.startClock ? { ...when, time: read.startClock.slice(0, 5).padStart(5, "0") } : when;
  const headerTitle = read.header.map(cleanTitle).find((t) => !!t && !findWhen(t, "transcript", opts.now) && !/^(attendees|transcript|speakers|summary keywords|view recording)/i.test(t) && !/^---+$/.test(t));
  const title = headerTitle ?? (opts.fileName ? titleFromName(opts.fileName) : undefined);

  // Meet lists attendees under "Attendees"; Otter under "SPEAKERS".
  const listed: string[] = [];
  read.header.forEach((h, i) => {
    if (/^(attendees|speakers)$/i.test(h) && read.header[i + 1]) for (const n of read.header[i + 1].split(/,\s*/)) if (plausibleSpeaker(n)) listed.push(n.trim());
  });

  const lastStart = turns.reduce((m, t) => Math.max(m, t.start ?? 0), 0);
  const fathomMins = /(\d+)\s*mins?\b/i.exec(headerText)?.[1];
  const otterLen = /•\s*((?:\d{1,2}:)?\d{1,2}:\d{2})\s*$/m.exec(headerText)?.[1];
  const durationSec = read.durationSec ?? (otterLen ? (seconds(otterLen) ?? undefined) : fathomMins ? Number(fathomMins) * 60 : lastStart ? lastStart + 10 : undefined);

  return {
    format: read.format,
    formatLabel: FORMAT_LABEL[read.format],
    isTranscript,
    ...(title ? { title } : {}),
    ...(whenWithClock ? { when: whenWithClock } : {}),
    ...(durationSec ? { durationSec: Math.round(durationSec) } : {}),
    listed,
    speakers,
    turns,
    words,
    text,
    warnings,
  };
}

/**
 * Reads a transcript or notes. `founderNames` marks the founder's own turns (for talk share and questions);
 * `now` resolves dates written without a year.
 */
export function parseTranscript(raw: string, opts: { fileName?: string; now?: Date; founderNames?: string[] } = {}): ParsedTranscript {
  const now = opts.now ?? new Date();
  const founderNames = opts.founderNames ?? [];
  const text = raw.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const lines = text.split("\n");
  const firstReal = lines.find((l) => l.trim())?.trim() ?? "";
  const done = (read: Read) => finish(read, { fileName: opts.fileName, now, founderNames });

  if (/^WEBVTT/i.test(firstReal) || /\.vtt$/i.test(opts.fileName ?? "")) return done(readCues(lines, "vtt"));
  if (lines.some((l) => ARROW.test(l.trim()))) return done(readCues(lines, /,\d{3}\s*-->/.test(text) ? "srt" : "vtt"));
  const count = (re: RegExp) => lines.filter((l) => re.test(l.trim())).length;
  if (count(FATHOM_HEAD) >= 3) return done(readBlocks(lines, FATHOM_HEAD, "fathom", "stamp-first"));
  if (count(ZOOM_TXT_HEAD) >= 3) return done(readBlocks(lines, ZOOM_TXT_HEAD, "zoom_txt", "name-first"));
  if (count(OTTER_HEAD) >= 3 && lines.some((l) => OTTER_HEAD.exec(l.trim()) && plausibleSpeaker(OTTER_HEAD.exec(l.trim())![1]))) {
    const read = readBlocks(lines, OTTER_HEAD, "otter", "name-first");
    if (read.segments.every((s) => plausibleSpeaker(s.speaker ?? ""))) return done(read);
  }
  const read = readLines(lines);
  if (read.format === "notes") {
    const p = done(read);
    return { ...p, text: text.trim().slice(0, MAX_TEXT), words: wordsIn(text), warnings: ["No speaker labels, so I'll read this as your notes: nothing in it will be quoted as the buyer's words.", ...p.warnings] };
  }
  return done(read);
}

/** Renames speaker labels ("Them" → "Maren Holt") and rebuilds the text and the counts. */
export function renameSpeakers(p: ParsedTranscript, map: Record<string, string>, founderNames: string[] = []): ParsedTranscript {
  const named = Object.fromEntries(Object.entries(map).filter(([from, to]) => to.trim() && to.trim() !== from));
  if (!Object.keys(named).length || !p.isTranscript) return p;
  const turns = merge(p.turns.map((t) => ({ ...t, speaker: t.speaker && named[t.speaker] ? named[t.speaker].trim() : t.speaker })));
  const { speakers, words } = stats(turns, founderNames);
  const warnings = p.warnings.filter((w) => !/Granola labels|aren't named/.test(w));
  if (speakers.some((s) => s.generic)) warnings.push("Some speakers aren't named. Name them below if you can.");
  return { ...p, turns, speakers, words, text: render(turns).slice(0, MAX_TEXT), warnings };
}
