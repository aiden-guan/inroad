import type { VoiceCard, VoiceTraits, Workspace } from "@/lib/domain/types";

/**
 * The voice card learns from how the founder actually writes (SPEC §6 VoiceCard, W5 edits, W6 skips), in code and
 * at zero tokens: sentence length, contractions, greeting, subject case, the words they add and cut when editing a
 * draft, formality and punctuation. Extraction runs after every 3rd sample and every 20 edits, and lands as a
 * suggestion the founder accepts or edits in Playbook → Voice; drafts only ever use the accepted traits. Pure: the
 * reducer runs it on both sides.
 */

export const EXTRACT_EVERY_EDITS = 20;
export const EXTRACT_EVERY_SAMPLES = 3;
const EDITS_KEPT = 20;
const TONE_OFF_KEPT = 10;

const STOP = new Set(
  "a about also an and any are as at be been but by can could did do does for from had has have he her his how i if in into is it its just like me more most my no not of on only or other our out over so some than that the their them then there they this to too up us very was we were what when which who why will with would you your yours i'm i've i'd i'll it's that's we're we've you're you've don't can't won't isn't aren't didn't doesn't".split(" "),
);

const words = (s: string) => s.match(/[A-Za-z][A-Za-z'’-]*/g) ?? [];
const lower = (s: string) => s.toLowerCase().replace(/’/g, "'");

/**
 * Lowercased content words, without names: a capitalized word mid-sentence is about the recipient or their company,
 * not the founder's voice. Sentence-initial words count.
 */
function plainWords(s: string): Set<string> {
  const out = new Set<string>();
  for (const m of s.matchAll(/[A-Za-z][A-Za-z'’-]*/g)) {
    const w = m[0];
    const before = s.slice(0, m.index).trimEnd();
    const sentenceStart = !before || /[.!?:\n]$/.test(before) || /\n\s*$/.test(s.slice(0, m.index));
    if (/^[A-Z]/.test(w) && !sentenceStart) continue;
    const l = lower(w);
    if (l.length > 2 && !STOP.has(l)) out.add(l);
  }
  return out;
}

/** Word-level edit distance between what was drafted and what went out, 0 (untouched) to 1 (rewritten). */
export function editDistance(before: string, after: string): number {
  const a = words(lower(before));
  const b = words(lower(after));
  if (!a.length && !b.length) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return Math.round((prev[b.length] / Math.max(a.length, b.length)) * 100) / 100;
}

const GREETING = [
  { re: /^\s*(hi|hello)\s+[A-Z][\w'-]*\s*[,—-]/i, value: "hi_first_name" as const },
  { re: /^\s*hey\s+[A-Z][\w'-]*\s*[,—-]/i, value: "hey_first_name" as const },
  { re: /^\s*[A-Z][a-z'-]+\s*,/, value: "first_name" as const },
];

/**
 * A sign-off on the message's last line: short, no sentence punctuation, and either a dash and a name ("— Priya"),
 * or a closing word and a name ("Thanks, Priya"). A last line that's a sentence isn't one.
 */
const CLOSER = /^(best|thanks|thank you|cheers|regards|kind regards|warmly|talk soon|all the best)\b/i;
export function signOffOf(text: string): string | undefined {
  const lines = text.replace(/\r/g, "").split("\n").map((l) => l.trim()).filter(Boolean);
  const last = lines.at(-1);
  if (!last || lines.length < 2 || /[.?!:;]$/.test(last) || words(last).length > 4 || last.length > 40) return undefined;
  if (/^[—–-]{1,2}\s*\S/.test(last) || (CLOSER.test(last) && /,\s*\S/.test(last))) return last;
  return undefined;
}

/** The message without a "Subject:" line, a greeting line or a sign-off, for counting sentences. */
function bodyOf(text: string): { subject?: string; greeting?: VoiceTraits["greeting"]; body: string; signOff?: string } {
  const signOff = signOffOf(text);
  let lines = text.replace(/\r/g, "").split("\n");
  // The sign-off isn't a sentence, and its dash isn't a punctuation habit.
  if (signOff) {
    const i = lines.map((l) => l.trim()).lastIndexOf(signOff);
    if (i !== -1) lines = lines.slice(0, i);
  }
  let subject: string | undefined;
  if (/^\s*subject:/i.test(lines[0] ?? "")) {
    subject = lines[0].replace(/^\s*subject:\s*/i, "").trim();
    lines = lines.slice(1);
  }
  while (lines.length && !lines[0].trim()) lines.shift();
  const firstLine = lines[0] ?? "";
  const greeting = GREETING.find((g) => g.re.test(firstLine))?.value ?? (firstLine.trim() ? "none" : undefined);
  // A greeting on its own line ("Hi Dana,") isn't a sentence; one that runs into the text ("Dana, your post…") is.
  if (greeting && greeting !== "none" && /,\s*$/.test(firstLine.trim())) lines = lines.slice(1);
  return { subject, greeting, body: lines.join("\n"), signOff };
}

function sentenceLengths(body: string): number[] {
  return body
    .split(/(?<=[.!?])\s+|\n{2,}/)
    .map((s) => words(s).length)
    .filter((n) => n >= 3);
}

function subjectCase(subject: string): VoiceTraits["subjectStyle"] | undefined {
  const w = words(subject);
  if (!w.length) return undefined;
  if (subject === subject.toLowerCase()) return "lowercase";
  if (w.length >= 2 && w.filter((x) => x.length > 3).every((x) => /^[A-Z]/.test(x))) return "title";
  return "sentence";
}

function majority<T>(values: (T | undefined)[]): T | undefined {
  const counts = new Map<T, number>();
  for (const v of values) if (v !== undefined) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

/** Words that appear on one side of the edits and not the other, at least twice across edits. */
function wordShift(edits: NonNullable<VoiceCard["edits"]>): { added: string[]; removed: string[] } {
  const added = new Map<string, number>();
  const removed = new Map<string, number>();
  for (const e of edits) {
    const before = plainWords(e.before);
    const after = plainWords(e.after);
    for (const w of after) if (!before.has(w)) added.set(w, (added.get(w) ?? 0) + 1);
    for (const w of before) if (!after.has(w)) removed.set(w, (removed.get(w) ?? 0) + 1);
  }
  const top = (m: Map<string, number>) =>
    [...m.entries()]
      .filter(([, n]) => n >= 2)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 8)
      .map(([w]) => w);
  return { added: top(added), removed: top(removed) };
}

const CONTRACTION = /\b\w+(n't|'re|'ll|'ve|'m|'d)\b|\b(it|that|there|here|what|who|let)'s\b/i;

/** Traits from the founder's own text: samples first, then what they sent after editing a draft. */
export function extractTraits(input: { samples: VoiceCard["samples"]; edits: NonNullable<VoiceCard["edits"]>; toneOff: string[] }): VoiceTraits {
  const raw = [...input.samples.map((s) => s.text), ...input.edits.map((e) => e.after)].map((t) => t.replace(/’/g, "'"));
  const parsed = raw.map(bodyOf);
  // Everything below reads the founder's words: subject, greeting and body, without the sign-off line.
  const texts = parsed.map((p) => [p.subject && `Subject: ${p.subject}`, p.body].filter(Boolean).join("\n\n"));
  const lengths = parsed.flatMap((p) => sentenceLengths(p.body));
  const subjects = [...parsed.map((p) => p.subject), ...input.edits.map((e) => e.subjectAfter ?? undefined)].filter((s): s is string => !!s);
  const emails = [...input.samples.filter((s) => s.kind === "email").map((s) => bodyOf(s.text)), ...input.edits.map((e) => bodyOf(e.after))];
  const withContractions = texts.filter((t) => CONTRACTION.test(t)).length;
  const { added, removed } = wordShift(input.edits);
  // Words common in drafts they skipped as "tone off" and absent from anything they wrote themselves.
  const theirs = new Set(texts.flatMap((t) => words(t).map(lower)));
  const offCounts = new Map<string, number>();
  for (const t of input.toneOff) for (const w of plainWords(t)) if (w.length > 3 && !theirs.has(w)) offCounts.set(w, (offCounts.get(w) ?? 0) + 1);
  const offWords = [...offCounts.entries()].filter(([, n]) => n >= 2).map(([w]) => w);

  const avg = lengths.length ? Math.round(lengths.reduce((s, n) => s + n, 0) / lengths.length) : undefined;
  const contractions = texts.length ? withContractions * 2 >= texts.length : undefined;
  const greeting = majority(emails.map((e) => e.greeting));
  const all = texts.join("\n");
  const formal = /\b(dear|regards|sincerely|kindly|please find)\b/i.test(all);
  let formality = 3 - (contractions ? 1 : 0) + (formal ? 1 : 0) + (avg !== undefined && avg > 20 ? 1 : 0) - (greeting === "hey_first_name" || greeting === "none" ? 0.5 : 0);
  formality = Math.min(5, Math.max(1, Math.round(formality)));

  const habits: string[] = [];
  if (texts.length) {
    if (/—|\s--\s/.test(all)) habits.push("Uses em dashes");
    if (/;/.test(all)) habits.push("Uses semicolons");
    if (/\([^)]+\)/.test(all)) habits.push("Uses parentheses");
    if (!/!/.test(all)) habits.push("No exclamation marks");
    const endsOnQuestion = emails.filter((e) => /\?\s*$/.test(e.body.trim())).length;
    if (emails.length && endsOnQuestion * 2 >= emails.length) habits.push("Ends on a question");
  }

  // The same sign-off on at least two of their own messages.
  const signOffs = parsed.map((p) => p.signOff).filter((x): x is string => !!x);
  const signOff = majority(signOffs);

  const traits: VoiceTraits = {
    avgSentenceWords: avg,
    contractions,
    greeting,
    subjectStyle: majority(subjects.map(subjectCase)),
    usesWords: added,
    avoidsWords: [...new Set([...removed, ...offWords])].slice(0, 10),
    formality: texts.length ? (formality as VoiceTraits["formality"]) : undefined,
    punctuationHabits: habits,
    signOff: signOff && signOffs.filter((x) => x === signOff).length >= 2 ? signOff : undefined,
  };
  for (const k of Object.keys(traits) as (keyof VoiceTraits)[]) if (traits[k] === undefined) delete traits[k];
  return traits;
}

function basis(v: VoiceCard): string {
  const parts = [`${v.samples.length} sample${v.samples.length === 1 ? "" : "s"}`];
  if (v.edits?.length) parts.push(`${v.edits.length} edit${v.edits.length === 1 ? "" : "s"} to drafts`);
  if (v.toneOff?.length) parts.push(`${v.toneOff.length} draft${v.toneOff.length === 1 ? "" : "s"} you skipped as tone off`);
  return parts.join(", ");
}

const same = (a: VoiceTraits | undefined, b: VoiceTraits | undefined) => JSON.stringify(a ?? {}) === JSON.stringify(b ?? {});

/** Re-reads everything the card holds; suggests the result unless it matches what the founder already accepted. */
export function extractVoice(v: VoiceCard, at: string): void {
  if (!v.samples.length && !v.edits?.length) return;
  const traits = extractTraits({ samples: v.samples, edits: v.edits ?? [], toneOff: (v.toneOff ?? []).map((t) => t.text) });
  // The sign-off lives on the card itself; one it already uses isn't news.
  if (traits.signOff && traits.signOff === v.signOff.trim()) delete traits.signOff;
  v.editsSinceExtract = 0;
  v.samplesSinceExtract = 0;
  if (same(traits, v.traits)) {
    delete v.suggested;
    return;
  }
  v.suggested = { ...traits, at, basis: basis(v) };
}

export function emptyVoice(at: string): VoiceCard {
  return { samples: [], summary: "", signOff: "", updatedAt: at };
}

/** An approved draft the founder edited: keep the diff, and re-read the voice every 20 edits. */
export function learnFromEdit(ws: Workspace, e: { before: string; after: string; subjectBefore?: string | null; subjectAfter?: string | null; distance: number }, at: string): void {
  if (e.distance <= 0) return;
  const v = (ws.voice ??= emptyVoice(at));
  v.edits = [...(v.edits ?? []), { at, before: e.before.slice(0, 1500), after: e.after.slice(0, 1500), subjectBefore: e.subjectBefore ?? null, subjectAfter: e.subjectAfter ?? null, distance: e.distance }].slice(-EDITS_KEPT);
  v.editsSinceExtract = (v.editsSinceExtract ?? 0) + 1;
  if (v.editsSinceExtract >= EXTRACT_EVERY_EDITS) extractVoice(v, at);
}

/** A sample the founder pasted: re-read the voice on every 3rd. */
export function learnFromSample(v: VoiceCard, at: string): void {
  v.samplesSinceExtract = (v.samplesSinceExtract ?? 0) + 1;
  if (v.samplesSinceExtract >= EXTRACT_EVERY_SAMPLES) extractVoice(v, at);
}

/** A draft skipped as "tone off": kept as an example of what not to write. */
export function noteToneOff(ws: Workspace, text: string, at: string, moveId?: string): void {
  const v = (ws.voice ??= emptyVoice(at));
  v.toneOff = [...(v.toneOff ?? []).filter((t) => !moveId || t.moveId !== moveId), { at, text: text.slice(0, 1500), ...(moveId ? { moveId } : {}) }].slice(-TONE_OFF_KEPT);
}

const GREETING_TEXT: Record<NonNullable<VoiceTraits["greeting"]>, string> = {
  none: "no greeting, straight into the first line",
  first_name: 'the first name and a comma ("Dana,")',
  hi_first_name: '"Hi" and the first name ("Hi Dana,")',
  hey_first_name: '"Hey" and the first name ("Hey Dana,")',
};
const SUBJECT_TEXT: Record<NonNullable<VoiceTraits["subjectStyle"]>, string> = { lowercase: "all lowercase", sentence: "sentence case", title: "Title Case" };

/** Traits as lines: about "they" for the drafting prompt, or "you" when shown to the founder. */
export function traitLines(t: VoiceTraits | undefined, to: "they" | "you" = "they"): string[] {
  if (!t) return [];
  const you = to === "you";
  return [
    t.avgSentenceWords !== undefined && `${you ? "Your sentences" : "Sentences"} average about ${t.avgSentenceWords} words.`,
    t.contractions !== undefined && (t.contractions ? `${you ? "You use" : "Uses"} contractions (it's, we're, don't).` : `${you ? "You avoid" : "Avoids"} contractions.`),
    t.greeting && `${you ? "You open" : "Opens"} with ${GREETING_TEXT[t.greeting]}.`,
    t.subjectStyle && `Subject lines in ${SUBJECT_TEXT[t.subjectStyle]}.`,
    t.usesWords?.length && `Words ${to} add when editing: ${t.usesWords.join(", ")}.`,
    t.avoidsWords?.length && `Words ${to} cut from drafts (never use): ${t.avoidsWords.join(", ")}.`,
    t.formality !== undefined && `Formality ${t.formality} of 5.`,
    t.punctuationHabits?.length && `${t.punctuationHabits.join(". ")}.`,
    t.signOff && `${you ? "You sign" : "Signs"} off with “${t.signOff}”.`,
  ].filter((x): x is string => typeof x === "string");
}
