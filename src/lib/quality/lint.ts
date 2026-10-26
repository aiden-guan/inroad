import type { DraftFrame, LintCode, LintResult } from "@/lib/domain/types";
import { convergence, sentences, stripGreeting, type RecentDraft } from "./similarity";

/**
 * Deterministic outbound lint. Frame-aware, no model calls; the compose workflow runs it after
 * every generation and the editor runs it on every keystroke. Errors make the one-line check
 * red; warnings only show in the details.
 */

export interface LintInput {
  subject: string | null;
  body: string;
  frame: DraftFrame;
  step: number; // 1 = first touch
  kind: "email" | "linkedin_note" | "linkedin_dm" | "recap" | "invite" | "intro_wrapper" | "intro_forwardable" | "post";
  /** Words the founder's ICP legitimately uses ("platform team"), exempt from hype rules. */
  allowWords?: string[];
  /** Numbers/claims that are sourced (from evidence quotes or approved claims). */
  sourcedText?: string;
  /** Set when the draft offers a resource. */
  assetId?: string;
  /** "reply" = same thread as an earlier email, where "Re:" is honest. Defaults to new for step 1. */
  thread?: "new" | "reply";
  /** Last touch of a sequence (≤45 words). Defaults to step ≥ 3. */
  final?: boolean;
  /** Cold first touches must rest on a founder POV or an approved credential. */
  requirePov?: boolean;
  povId?: string | null;
  credentialId?: string | null;
  /** Each personalized span with the text of the evidence it cites (null when the id didn't resolve). */
  spans?: { text: string; support: string | null }[];
  /** Names that may appear in a span without being in its quote (the account, the person, us). */
  knownNames?: string[];
  /** Recent cold drafts, for skeleton diversity and near-duplicates. */
  recent?: RecentDraft[];
}

type Severity = "error" | "warn";
type Violation = LintResult["violations"][number];

export const LIMITS = {
  cold1: { min: 40, max: 90, hard: 100 },
  shortQuestion: { min: 12, max: 60, hard: 75 },
  followUp: { min: 25, max: 60, hard: 70 },
  final: { min: 0, max: 45, hard: 55 },
  reply: { min: 0, max: 90, hard: 120 },
  subjectWords: { min: 1, max: 5 },
  liNoteChars: 200,
  liDmChars: 300,
  recap: 180,
  invite: 120,
  intro: { wrapper: 60, forwardable: 120 },
  post: { min: 120, max: 250 },
  fkEmail: 8,
  fkPost: 9,
  questionMarks: 2,
  emDash: 1,
} as const;

const WARN_ONLY: LintCode[] = ["LEN_UNDER", "SUBJECT_WORDS", "FK_GRADE", "ALL_CAPS", "EM_DASH"];

/** Frames where "I'm building…" is the point (advice asks, intros, replies). */
const FRAME_EXEMPT: Partial<Record<DraftFrame, LintCode[]>> = {
  founder_card: ["I_OPENER", "YOU_RATIO"],
  referral: ["I_OPENER", "YOU_RATIO"],
  intro: ["I_OPENER", "YOU_RATIO"],
  reply: ["I_OPENER", "YOU_RATIO"],
  recap: ["I_OPENER", "YOU_RATIO"],
};

/** Case-insensitive; any hit fails. The label is what the founder sees. */
export const BANNED: { re: RegExp; label: string }[] = [
  { re: /hope (this|you)('re| are)? ?(email )?(finds you|doing well|well)/i, label: "hope this finds you well" },
  { re: /\bi came across\b/i, label: "I came across" },
  { re: /\bi noticed( that)?\b/i, label: "I noticed" },
  { re: /\b(i wanted to|i'm) reach(ing)? out\b|\breaching out (because|to)\b/i, label: "reaching out" },
  { re: /\bmy name is\b/i, label: "my name is" },
  { re: /\bi know you'?re busy\b/i, label: "I know you're busy" },
  { re: /\bquick question\b/i, label: "quick question" },
  { re: /\bare you the right person\b/i, label: "are you the right person" },
  { re: /\bpick your brain\b/i, label: "pick your brain" },
  { re: /\bjust (following up|checking in)\b/i, label: "just following up" },
  { re: /\bcircling back\b/i, label: "circling back" },
  { re: /\btouching base\b/i, label: "touching base" },
  { re: /\bbump(ing)? (this|it)\b/i, label: "bumping this" },
  { re: /\bfloating this\b/i, label: "floating this" },
  { re: /\bas (we )?discussed\b/i, label: "as discussed" },
  { re: /\bany thoughts\?/i, label: "any thoughts?" },
  { re: /in today'?s (fast-paced|ever-evolving|rapidly)/i, label: "in today's fast-paced…" },
  // 2025–26 template tells: every AI SDR writes these now.
  { re: /\bworth a (look|chat|conversation|quick)\b/i, label: "worth a look/chat" },
  { re: /\bopen to (a |learning|exploring|chatting)/i, label: "open to a chat" },
  { re: /\bcurious (if|whether|how)\b/i, label: "curious if/how" },
  { re: /\b(teams|companies|folks|leaders) like yours\b/i, label: "teams like yours" },
  { re: /\b(usually|typically|often) (that|this) means\b/i, label: "usually that means" },
  { re: /\bmight be off base\b|\bno worries if not\b/i, label: "might be off base / no worries if not" },
  { re: /\bthe (usual|real) (blocker|problem|issue) isn'?t .{1,40}, it'?s\b/i, label: "the real problem isn't X, it's Y" },
  { re: /\bi put together\b/i, label: "I put together" },
  { re: /\bhope (this|it) helps\b/i, label: "hope this helps" },
];

/** Allowed only when the draft points at a real asset. */
const BANNED_UNLESS_ASSET = /\b(quick|short) (teardown|breakdown)\b/i;
/** First line only: the most common AI-SDR openers. */
const BANNED_LINE1 = /^(saw|noticed|looks like|congrats)\b/i;
const CONGRATS_RAISE = /^\s*congrat(s|ulations) on (the|your) (raise|funding|round|series)/i;
const NOT_JUST_BUT = [/\bnot (just|only) [^.?!]{1,40}, but\b/i, /\bit'?s not [^.?!]{1,40}, it'?s\b/i];

const HYPE =
  /\b(game-?changer|game-?changing|revolutioni[sz]\w*|cutting-?edge|seamless(ly)?|leverag(e|es|ed|ing)|synerg\w*|unlock(s|ed|ing)?|empower\w*|streamlin\w*|robust|best-in-class|world-class|innovative|next[- ]level|supercharg\w*|10x|transformative|elevat(e|es|ed|ing)|ai-powered|state-of-the-art|disrupt\w*)\b/i;
/** "first platform hire" passes; "our platform" doesn't. */
const PLATFORM = /\bplatforms?\b(?!\s+(team|teams|engineer(s|ing)?|eng|lead|leads|hire|hires|org|role|roles|group))/i;
const SOLUTION = /\bsolutions?\b(?!\s+(engineer|architect|consultant)s?\b)/i;
const AI_VOCAB =
  /\b(delve|delving|landscape|additionally|boasts?|crucial|pivotal|intricate|interplay|meticulous(ly)?|underscores?|tapestry|testament|vibrant|foster(s|ing)?|showcas(e|es|ing)|multifaceted|stands as|serves as|aligns? with|highlighting|deep dive|navigate the|realm|paramount|holistic)\b/i;

const CLAIM_NUMBER =
  /(\$\s?\d[\d,.]*\s?(k|m|b|mm|million|billion|thousand)?\b|\b\d[\d,.]*\s?(%|percent\b|x\b|×)|\b\d[\d,.]*\+?\s+(customers|clients|teams|companies|users|engineers|people|accounts|deals|calls|interviews|hours|days|weeks|months|founders|leaders|logos)\b)/gi;
const CALENDAR = /(calendly\.com|cal\.com\/|savvycal\.com|chilipiper|meetings\.hubspot\.com|calendar\.app\.google|zcal\.co|tidycal\.com|calendar\.google\.com\/calendar\/appointments|youcanbook\.me|doodle\.com)/i;
const LINK = /https?:\/\/\S+|\bwww\.\S+/gi;
const PLACEHOLDER = /\{[^}\n]{0,40}\}?|\{\{|\[(first|last|full)?\s?name\]|\[(company|title|role|insert)[^\]]*\]|<\s*(first ?name|company)\s*>|\bTBD\b|\bXX+\b/i;
const FAKE_REPLY = /^\s*(re|fwd?|fw)\s*:/i;
const EXCLAIM = /!/;
const EMOJI = new RegExp("\\p{Extended_Pictographic}", "u");
const RESOURCE =
  /\b(one-?pager|one pager|demo|memo|breakdown|teardown|deck|terms|case study|benchmark|write-?up|checklist|template|playbook|guide|report|whitepaper|pdf|slides|video|loom|recording)\b/i;
const OFFER = /\b(want|send|share|happy to|can send|shall i|should i|mind if i|attach(ed)?|here'?s|interested in|useful|helpful)\b/i;
const ASK_CUE = /\b(let me know|reply (with|if)|grab (a|some) time|book (a|some) time|hop on|jump on|set up (a|some) (call|time)|schedule (a|some))\b/i;
const ACRONYMS = new Set(
  "GDPR HIPAA CCPA FINRA FEDRAMP NIST DORA SAML OAUTH NVIDIA SAAS HTTP HTTPS JSON YAML CUDA SCIM EMEA APAC LATAM NYSE CISO DKIM DMARC IMAP SMTP RBAC CICD SOC2 TODO ASAP AWS GCP".split(" "),
);
const YOU = /\b(you|your|yours|you're|you've|you'll|you'd|yourself|yourselves)\b/gi;
const IWE = /\b(i|me|my|mine|i'm|i've|i'll|i'd|we|us|our|ours|we're|we've|we'll|we'd)\b/gi;
const STARTERS = new Set(
  "the a an your you their they its it this that these those in on at since when after before last next i we our my his her and but so if as for with from to of".split(" "),
);
const MONTHS = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*$/i;

const PRIORITY: LintCode[] = [
  "PLACEHOLDER",
  "FAKE_REPLY_SUBJECT",
  "SPAN_UNSUPPORTED",
  "NUMBER_UNSOURCED",
  "CLAIM_UNAPPROVED",
  "POV_MISSING",
  "ASSET_MISSING",
  "BANNED_PHRASE",
  "CONGRATS_OPENER",
  "NOT_JUST_BUT",
  "NEAR_DUPLICATE",
  "SKELETON_REPEAT",
  "LI_CHARS",
  "LEN_OVER",
  "MULTI_CTA",
  "CALENDAR_LINK",
  "LINK_T1",
  "I_OPENER",
  "YOU_RATIO",
  "HYPE_WORD",
  "AI_VOCAB",
  "EXCLAMATION",
  "EMOJI",
  "LEN_UNDER",
  "FK_GRADE",
  "SUBJECT_WORDS",
  "EM_DASH",
  "ALL_CAPS",
];

/** True when lint would flag this word as hype or AI vocabulary (used to build the ICP allowlist). */
export function isFlaggedTerm(word: string): boolean {
  return HYPE.test(word) || AI_VOCAB.test(word) || PLATFORM.test(word) || SOLUTION.test(word);
}

/** Smart quotes → straight, so patterns match what people actually type. */
function norm(text: string): string {
  return text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Replaces allowlisted vocabulary with a neutral token before hype/AI-vocab/grade checks. */
function maskAllowed(text: string, allow: string[] | undefined): string {
  if (!allow?.length) return text;
  const phrases = [...new Set(allow.map((w) => w.trim()).filter((w) => w.length > 2))].sort((a, b) => b.length - a.length);
  let out = text;
  for (const p of phrases) out = out.replace(new RegExp(`\\b${escapeRe(p)}\\b`, "gi"), "term");
  return out;
}

export function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

function syllables(word: string): number {
  let w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  if (w.length <= 3) return 1;
  w = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "");
  const groups = w.match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

/** Flesch–Kincaid grade. Numbers, URLs, acronyms and allowlisted terms don't count against it. */
export function fkGrade(text: string): number {
  const sents = sentences(text);
  if (!sents.length) return 0;
  const words = text
    .replace(LINK, " ")
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}'-]/gu, ""))
    .filter((w) => w && w !== "term" && !/^[A-Z0-9]{2,}$/.test(w));
  if (!words.length) return 0;
  const syl = words.reduce((s, w) => s + syllables(w), 0);
  const grade = 0.39 * (words.length / sents.length) + 11.8 * (syl / words.length) - 15.59;
  return Math.max(0, Math.round(grade * 10) / 10);
}

/** Lowercase, no spaces/commas, units folded ("$12 million" → "$12m", "40 percent" → "40%"). */
export function normNumber(text: string): string {
  return text
    .toLowerCase()
    .replace(/\bmillion\b/g, "m")
    .replace(/\bbillion\b/g, "b")
    .replace(/\bthousand\b/g, "k")
    .replace(/\bmm\b/g, "m")
    .replace(/\s?percent\b|\s?per cent\b/g, "%")
    .replace(/×/g, "x")
    .replace(/,/g, "")
    .replace(/\s+/g, "");
}

function firstLine(body: string): string {
  return stripGreeting(norm(body)).split("\n")[0]?.trim() ?? "";
}

function properNouns(span: string): string[] {
  const out: string[] = [];
  for (const raw of span.split(/\s+/)) {
    const w = raw.replace(/^[^\p{L}\p{N}$]+|[^\p{L}\p{N}%]+$/gu, "").replace(/'s$/i, "");
    if (!w) continue;
    if (/\d/.test(w)) out.push(w);
    else if (/^\p{Lu}/u.test(w) && !STARTERS.has(w.toLowerCase()) && !MONTHS.test(w)) out.push(w);
  }
  return out;
}

/** Word limits for a draft of this kind, frame and step (null for LinkedIn, which counts characters). */
export function limitsFor(input: Pick<LintInput, "kind" | "frame" | "step" | "final">): { min: number; max: number; hard: number } | null {
  switch (input.kind) {
    case "email": {
      if (input.frame === "reply") return LIMITS.reply;
      const final = input.final ?? (input.step >= 3 || input.frame === "permission_to_close");
      if (final) return LIMITS.final;
      if (input.step === 1) return input.frame === "mouse_trap" ? LIMITS.shortQuestion : LIMITS.cold1;
      return LIMITS.followUp;
    }
    case "intro_wrapper":
      return { min: 0, max: LIMITS.intro.wrapper, hard: LIMITS.intro.wrapper + 10 };
    case "intro_forwardable":
      return { min: 40, max: LIMITS.intro.forwardable, hard: LIMITS.intro.forwardable + 10 };
    case "recap":
      return { min: 0, max: LIMITS.recap, hard: LIMITS.recap + 20 };
    case "invite":
      return { min: 0, max: LIMITS.invite, hard: LIMITS.invite + 15 };
    case "post":
      return { min: LIMITS.post.min, max: LIMITS.post.max, hard: LIMITS.post.max + 30 };
    default:
      return null;
  }
}

export function lintDraft(input: LintInput): LintResult {
  const body = norm(input.body ?? "");
  const subject = input.subject === null ? null : norm(input.subject ?? "");
  const all = subject ? `${subject}\n${body}` : body;
  const masked = maskAllowed(all, input.allowWords);
  const exempt = new Set(FRAME_EXEMPT[input.frame] ?? []);
  const isLinkedIn = input.kind === "linkedin_note" || input.kind === "linkedin_dm";
  const thread = input.thread ?? (input.step > 1 ? "reply" : "new");
  const out: Violation[] = [];
  const add = (code: LintCode, detail: string, severity?: Severity) => {
    if (exempt.has(code)) return;
    out.push({ code, detail, severity: severity ?? (WARN_ONLY.includes(code) ? "warn" : "error") });
  };

  const words = countWords(body);
  const youCount = (body.match(YOU) ?? []).length;
  const iWeCount = (body.match(IWE) ?? []).filter((m) => m !== "US").length;
  const questionMarks = (body.match(/\?/g) ?? []).length;
  const links = (body.match(LINK) ?? []).length;
  const fk = fkGrade(maskAllowed(body, input.allowWords));

  // Length
  const lim = limitsFor(input);
  if (lim) {
    if (words > lim.hard) add("LEN_OVER", `${words} words. Cut to ${lim.max} or fewer.`);
    else if (words > lim.max) add("LEN_OVER", `${words} words. Aim for ${lim.max} or fewer.`, "warn");
    else if (lim.min && words > 0 && words < lim.min) add("LEN_UNDER", `${words} words. Touches like this land best at ${lim.min}–${lim.max}.`);
  }
  if (input.kind === "linkedin_note" && body.length > LIMITS.liNoteChars) add("LI_CHARS", `${body.length} characters. LinkedIn notes allow ${LIMITS.liNoteChars}.`);
  if (input.kind === "linkedin_dm" && body.length > LIMITS.liDmChars) add("LI_CHARS", `${body.length} characters. Keep the message under ${LIMITS.liDmChars}.`);

  // Subject
  if (subject !== null && subject.trim() && !isLinkedIn) {
    if (FAKE_REPLY.test(subject) && thread === "new") add("FAKE_REPLY_SUBJECT", `“${(subject.match(FAKE_REPLY)?.[0] ?? "Re:").trim()}” on a new thread misleads the reader and is a CAN-SPAM risk.`);
    const sw = countWords(subject.replace(FAKE_REPLY, ""));
    if (sw > LIMITS.subjectWords.max) add("SUBJECT_WORDS", `Subject is ${sw} words. 1–5 reads like an internal email.`);
  }

  // Template tells
  const line1 = firstLine(body);
  if (CONGRATS_RAISE.test(line1)) add("CONGRATS_OPENER", "Opening on the raise is what every vendor sends. Lead with what the money is for.");
  else if (BANNED_LINE1.test(line1)) add("BANNED_PHRASE", `Line 1 opens with “${line1.split(/\s+/).slice(0, 2).join(" ")}”, the most common AI-SDR opener. State the fact directly.`);
  for (const b of BANNED) {
    if (b.re.test(all)) {
      add("BANNED_PHRASE", `“${b.label}” is a template tell. Say it plainly.`);
      break;
    }
  }
  if (!input.assetId && BANNED_UNLESS_ASSET.test(all)) add("BANNED_PHRASE", "A “quick teardown” offer needs a real asset behind it.");
  for (const re of NOT_JUST_BUT) {
    if (re.test(all)) {
      add("NOT_JUST_BUT", "“Not just X, but Y” is a template structure. Make the point once.");
      break;
    }
  }
  const hype = masked.match(HYPE)?.[0] ?? masked.match(PLATFORM)?.[0] ?? masked.match(SOLUTION)?.[0];
  if (hype) add("HYPE_WORD", `“${hype}” reads as marketing. Use the plain word.`);
  const ai = masked.match(AI_VOCAB)?.[0];
  if (ai) add("AI_VOCAB", `“${ai}” reads as AI-written.`);

  // Reader focus
  if (/^i\b|^i'(m|ve|d|ll)\b/i.test(line1)) add("I_OPENER", "Line 1 starts with “I”. Open with them.");
  if (!isLinkedIn || input.kind === "linkedin_dm") {
    if (iWeCount > youCount && words >= 15) add("YOU_RATIO", `More I/we (${iWeCount}) than you/your (${youCount}). Make it about them.`);
  }

  // Asks
  const sents = sentences(body);
  // A closing P.S. may carry a second, lower-stakes question ("If this isn't yours, who owns it?").
  const main = body.replace(/(^|\n)\s*p\.?\s?s\.?\s[^\n]*\s*$/i, "");
  const asks = sentences(main).filter((s) => s.endsWith("?") || ASK_CUE.test(s)).length;
  if (questionMarks > LIMITS.questionMarks) add("MULTI_CTA", `${questionMarks} questions. Ask one thing.`);
  else if (asks > 1) add("MULTI_CTA", `${asks} asks. Keep the one that's easiest to answer.`);

  // Links
  const calendar = CALENDAR.test(body);
  if (calendar && input.frame !== "reply") {
    add("CALENDAR_LINK", "No calendar link before they've replied.", input.step === 1 || isLinkedIn ? "error" : "warn");
  }
  if (links > 0 && input.frame !== "reply" && (isLinkedIn || (input.kind === "email" && input.step === 1))) {
    if (!calendar) add("LINK_T1", isLinkedIn ? "No links in a LinkedIn note or first message." : "No links in a first touch. They hurt delivery and read as marketing.");
  } else if (links > 1 && input.frame !== "reply") {
    add("LINK_T1", `${links} links. One at most after the first touch.`, "warn");
  }

  // Formatting
  const ph = all.match(PLACEHOLDER)?.[0];
  if (ph) add("PLACEHOLDER", `Unfilled placeholder: “${ph.slice(0, 24)}”.`);
  if (EXCLAIM.test(all)) add("EXCLAMATION", "Drop the exclamation mark.");
  if (EMOJI.test(all)) add("EMOJI", "Drop the emoji.");
  const shout = (all.match(/\b[A-Z]{4,}\b/g) ?? []).find((w) => !ACRONYMS.has(w) && !(input.allowWords ?? []).some((a) => a.toUpperCase() === w));
  if (shout) add("ALL_CAPS", `“${shout}” in capitals reads as shouting.`);
  const dashes = (body.match(/—|\s--\s/g) ?? []).length;
  if (dashes > LIMITS.emDash) add("EM_DASH", `${dashes} em dashes. One at most.`);
  const fkLimit = input.kind === "post" ? LIMITS.fkPost : LIMITS.fkEmail;
  if (words >= 25 && fk > fkLimit) add("FK_GRADE", `Reads at grade ${Math.round(fk)}. Shorter sentences help (aim for ${fkLimit} or under).`);

  // Proof
  if (input.sourcedText !== undefined) {
    const sourced = normNumber(input.sourcedText);
    const seen = new Set<string>();
    for (const m of body.matchAll(CLAIM_NUMBER)) {
      // "checking back in 6 months", "every 2 weeks", "3 days ago": scheduling, not a claim.
      if (/\b(days|weeks|months)\b/i.test(m[0])) {
        const at = m.index ?? 0;
        const before = body.slice(Math.max(0, at - 15), at);
        const after = body.slice(at + m[0].length, at + m[0].length + 10);
        if (/\b(in|within|every|after|next)\s*$/i.test(before) || /^\s*(ago|from now)\b/i.test(after)) continue;
      }
      const n = normNumber(m[0]);
      if (seen.has(n)) continue;
      seen.add(n);
      if (!sourced.includes(n)) {
        add("NUMBER_UNSOURCED", `“${m[0].trim()}” isn't in any source, approved claim or point of view.`);
        break;
      }
    }
  }
  for (const s of sents) {
    const plain = s.replace(/\bin terms of\b/gi, "");
    if (RESOURCE.test(plain) && OFFER.test(plain) && !input.assetId) {
      const what = plain.match(RESOURCE)?.[0] ?? "a resource";
      add("ASSET_MISSING", `Offers ${/^[aeiou]/i.test(what) ? "an" : "a"} ${what.toLowerCase()} but no asset is attached. Pick one or drop the offer.`);
      break;
    }
  }
  if (input.requirePov && !input.povId && !input.credentialId) add("POV_MISSING", "No point of view. A cold note needs one of yours, or a credential.");
  if (input.spans?.length) {
    const bodyNorm = body.toLowerCase().replace(/\s+/g, " ");
    const known = (input.knownNames ?? []).flatMap((n) => n.toLowerCase().split(/\s+/));
    for (const span of input.spans) {
      const text = norm(span.text).trim();
      if (!text || !bodyNorm.includes(text.toLowerCase().replace(/\s+/g, " "))) continue;
      if (span.support === null) {
        add("SPAN_UNSUPPORTED", `“${text.slice(0, 48)}” cites a source I can't find.`);
        break;
      }
      const support = norm(span.support).toLowerCase();
      const supportNum = normNumber(span.support);
      const missing = properNouns(text).find((t) => {
        const tl = t.toLowerCase();
        if (known.includes(tl)) return false;
        return /\d/.test(t) ? !supportNum.includes(normNumber(t)) : !support.includes(tl);
      });
      if (missing) {
        add("SPAN_UNSUPPORTED", `“${missing}” isn't in the source for “${text.slice(0, 40)}${text.length > 40 ? "…" : ""}”.`);
        break;
      }
    }
  }
  if (input.recent?.length && input.kind === "email" && input.step === 1) {
    for (const issue of convergence(body, input.recent)) add(issue.code, issue.detail);
  }

  const violations = sortViolations(out);
  return {
    passed: !violations.some((v) => v.severity === "error"),
    violations,
    stats: { words, fkGrade: fk, you: youCount, iWe: iWeCount, questionMarks, links },
  };
}

export function sortViolations(list: Violation[]): Violation[] {
  const rank = (v: Violation) => (v.severity === "error" ? 0 : 100) + Math.max(0, PRIORITY.indexOf(v.code));
  return [...list].sort((a, b) => rank(a) - rank(b));
}

/** The single worst issue, or null when nothing fails. Warnings never block "Ready". */
export function worstIssue(lint: LintResult): Violation | null {
  return lint.violations.find((v) => v.severity === "error") ?? null;
}

/** Combine several lint results (e.g. a LinkedIn note and its follow-up message). */
export function mergeLint(results: LintResult[]): LintResult {
  const violations = sortViolations(results.flatMap((r) => r.violations));
  const first = results[0];
  return {
    passed: violations.every((v) => v.severity !== "error"),
    violations,
    stats: first?.stats ?? { words: 0, fkGrade: 0, you: 0, iWe: 0, questionMarks: 0, links: 0 },
  };
}

/** Human-readable list for prompts, so the model and the linter agree on what fails. */
export const BANNED_FOR_PROMPT = [
  ...BANNED.map((b) => b.label),
  "line 1 starting with Saw / Noticed / Looks like / Congrats",
  "quick teardown / short breakdown (unless an asset id is set)",
  "not just X, but Y",
  "it's not X, it's Y",
];
export const HYPE_FOR_PROMPT =
  "game-changer, revolutionize, cutting-edge, seamless, leverage, synergy, unlock, empower, streamline, robust, best-in-class, world-class, innovative, next level, supercharge, 10x, transformative, elevate, AI-powered, state-of-the-art, disrupt, platform (except as a team/role/hire), solution (except solutions engineer)";
export const AI_VOCAB_FOR_PROMPT =
  "delve, landscape, additionally, boasts, crucial, pivotal, intricate, interplay, meticulous, underscore, tapestry, testament, vibrant, foster, showcase, multifaceted, stands as, serves as, align with, highlighting, deep dive, realm, paramount, holistic";
