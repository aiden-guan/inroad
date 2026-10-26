import type { StudioAudience, StudioFormatId, StudioLint, StudioLintCode } from "@/lib/domain/types";
import { fkGrade, normNumber } from "@/lib/quality/lint";
import { maskEntities, sentences } from "@/lib/quality/similarity";
import { FORMATS, PLATFORM_BANS, countWords, listItems, measure, type FormatSpec, type Limit, type PartSpec } from "./formats";

/**
 * Deterministic lint for marketing copy: no model calls, fast enough for every keystroke, the same
 * in the browser, the Studio workflow and the agent API (`check_copy`).
 *
 * Two jobs:
 *  1. Fit: every part inside its platform limits and rules (formats.ts).
 *  2. Sound human and stay honest: AI tells, empty hype, unsourced numbers and superlatives.
 *
 * The tell rules and their weights come from docs/research/10-marketing-copy.md ("A linter should
 * score density, not single words"): Wikipedia's "Signs of AI writing", Kobak et al. 2025 excess-vocabulary data, the
 * Washington Post's 2025 analysis of ChatGPT output, and practitioner lists (labeled as opinion).
 * Weights: BLOCK never ships; HIGH fails on one hit; MEDIUM warns (fails in a headline, title or
 * button); LOW only counts toward density. Tells co-occur, so density fails too: 6+ weighted hits
 * per 100 words in long copy, 3+ in a short line. Wikipedia's caution applies: no single sign
 * proves anything, so the word lists are reviewed, not trusted forever (Kobak's July 2025 update
 * shows "delves" falling from about 39x to 8x).
 */

export interface StudioLintInput {
  format: StudioFormatId;
  parts: Record<string, string>;
  audience?: StudioAudience;
  /** Text every specific may come from (receipts). Undefined skips the sourcing checks. */
  sourced?: string;
  /** Exempt vocabulary that also counts as concrete: product name, customer words, ICP terms. */
  allowWords?: string[];
  /** Competitors by name: comparative claims need substantiation. */
  competitors?: string[];
  neverSay?: string[];
  /** The other options in the same set, so two options don't share a shape. */
  siblings?: Record<string, string>[];
}

type Weight = 1 | 2 | 3 | 9;
type Violation = StudioLint["violations"][number];

interface Tell {
  re: RegExp;
  code: StudioLintCode;
  weight: Weight;
  label: string;
  fix: string;
  /** "start": the part's first sentence only. "line": each line on its own (anchored patterns). */
  scope?: "start" | "line";
  /** MEDIUM tells that fail in a headline, title or button (the research's "HIGH in headlines and overlays"). */
  headline?: boolean;
}

const W = { LOW: 1, MEDIUM: 2, HIGH: 3, BLOCK: 9 } as const;

/* ───────────── Rules (each group cites its source) ───────────── */

// 1. Chatbot residue and placeholders: BLOCK. Wikipedia "Communication intended for the user".
const RESIDUE: Tell[] = [
  {
    re: /\b(I hope this helps|Certainly!|Of course!|Great question|You'?re absolutely right|Is there anything else|Here(?:'s| is) (?:a|an|the) (?:revised|updated|polished) (?:version|draft))/i,
    code: "AI_TELL",
    weight: W.BLOCK,
    label: "chatbot leftover",
    fix: "Delete it; it's the assistant talking, not you.",
  },
  {
    re: /\b(as an AI( language model)?|as a large language model|as of my last (knowledge|training) update|based on (the )?available information|in the (provided|available) (sources|context))\b/i,
    code: "AI_TELL",
    weight: W.BLOCK,
    label: "chatbot leftover",
    fix: "Delete it.",
  },
];
const PLACEHOLDER = /\[\[[^\]]{1,80}\]\]|\[(?:Your|Company|Brand|Product|Name|Insert|Describe|Add)[^\]]{0,60}\]|\{\{[^}]+\}\}|\b20\d\dX{2}\b|\bTBD\b|\bXX+\b|lorem ipsum/i;

// 2–3. Negative parallelism and outlines of negatives: HIGH. Wikipedia; WaPo/Boston Globe 2025 (6% of chats).
const PARALLEL: Tell[] = [
  { re: /\bnot\s+(?:just|only|merely|simply)\b[^.!?]{1,80}?\bbut(?:\s+also)?\b/i, code: "NEGATIVE_PARALLEL", weight: W.HIGH, label: "“not just X, but Y”", fix: "Make the point once, directly." },
  {
    re: /\b(?:it'?s|this is|that'?s|it is)\s+not\s+(?:just\s+|only\s+|merely\s+)?(?:about\s+)?[^.;!?]{1,60}[;,—–]\s*(?:it'?s|this is|it is)\b/i,
    code: "NEGATIVE_PARALLEL",
    weight: W.HIGH,
    label: "“it's not X, it's Y”",
    fix: "Say what it is. Mention X only if the reader really believes it.",
  },
  { re: /\b(?:it|this)\s+(?:is|was)n'?t\s+(?:just\s+)?(?:about\s+)?[^.!?]{1,60}[.!]\s+(?:it|this)\s+(?:is|was)\b/i, code: "NEGATIVE_PARALLEL", weight: W.HIGH, label: "“It isn't X. It's Y.”", fix: "Say what it is." },
  { re: /\bit'?s\s+not\s+[^.!?]{1,60}[.!]\s+it'?s\b/i, code: "NEGATIVE_PARALLEL", weight: W.HIGH, label: "“It's not X. It's Y.”", fix: "Say what it is." },
  { re: /(?:\bNo\s+[^.!?\n]{1,40}[.!?]\s*){2,}/, code: "NEGATIVE_PARALLEL", weight: W.HIGH, label: "“No X. No Y.” run", fix: "One concrete sentence beats a run of “No …”." },
  { re: /(?:\bNot\s+[^.!?\n]{1,40}[.!?]\s*){2,}/, code: "NEGATIVE_PARALLEL", weight: W.HIGH, label: "“Not X. Not Y.” run", fix: "One concrete sentence beats a run of “Not …”." },
  { re: /\bno\s+\w+(?:\s+\w+)?,\s+no\s+\w+(?:\s+\w+)?,\s+(?:just|only)\b/i, code: "NEGATIVE_PARALLEL", weight: W.HIGH, label: "“no X, no Y, just Z”", fix: "Name the one thing instead." },
  { re: /\b[a-z]+\.\s[a-z]+\.\s[a-z]+\.(?=\s|$)/, code: "NEGATIVE_PARALLEL", weight: W.HIGH, label: "“every. single. day.”", fix: "Write the sentence." },
];

// 4. Staged openers and dramatic closers (social): HIGH. Practitioner list (humanizer skill), labeled opinion.
const OPENERS: Tell[] = [
  {
    re: /^(?:Here'?s the thing|The thing is|Let'?s be honest|Real talk|Honestly\?|Look,|Let'?s dive in|Let'?s break (?:it|this) down|Without further ado|Buckle up|Picture this)\b/i,
    code: "AI_TELL",
    weight: W.HIGH,
    label: "staged opener",
    fix: "Start with the fact, the moment or the number.",
    scope: "start",
  },
  {
    re: /^(?:Imagine (?:a world|if)|Ever wondered|Are you (?:struggling|tired) (?:with|of)|Tired of)\b/i,
    code: "RHETORICAL_OPENER",
    weight: W.HIGH,
    label: "rhetorical opener",
    fix: "Show the situation instead of asking the reader to imagine it.",
    scope: "start",
  },
];
const CLOSERS: Tell = {
  re: /^(?:Let that sink in|Read that again|Full stop|Period|That'?s (?:it|the (?:real )?(?:win|secret|point|difference))|And that changes everything|This is the way|The lesson\?|The result\?|Here'?s why(?: it matters)?)[.!:?]?\s*$/i,
  code: "AI_TELL",
  weight: W.HIGH,
  label: "dramatic one-line closer",
  fix: "End on the last real point.",
  scope: "line",
};

// 5. Marketing clichés: HIGH, or MEDIUM (which fails in headlines). GPTZero (107x for "in today's fast-paced"), Kobak ratios, practitioner lists.
const CLICHES: Tell[] = [
  { re: /\bin today'?s (?:fast[- ]paced|ever[- ]changing|digital|competitive)\b[^.]{0,20}\b(?:world|landscape|age|era)\b/i, code: "AI_TELL", weight: W.HIGH, label: "“in today's fast-paced world”", fix: "Cut it and start with the point." },
  { re: /\bin the (?:ever[- ])?evolving (?:world|landscape|realm) of\b/i, code: "AI_TELL", weight: W.HIGH, label: "“in the ever-evolving world of”", fix: "Cut it." },
  { re: /\bunlock(?:ing)? (?:the )?(?:full )?(?:power|potential|secrets?) of\b/i, code: "AI_TELL", weight: W.HIGH, label: "“unlock the power of”", fix: "Say what the reader can now do." },
  { re: /\bharness(?:ing)? the power of\b/i, code: "AI_TELL", weight: W.HIGH, label: "“harness the power of”", fix: "Say what it does." },
  { re: /\btake (?:your|it) [^.]{0,30}to the next level\b/i, code: "AI_TELL", weight: W.HIGH, label: "“to the next level”", fix: "Name the level: a number, a result." },
  { re: /\bsay goodbye to\b[^.]{0,60}\b(?:hello to|and hello)\b/i, code: "AI_TELL", weight: W.HIGH, label: "“say goodbye to X, hello to Y”", fix: "Show the before and after concretely." },
  { re: /\b(?:supercharge|turbocharge|skyrocket|revolutioni[sz]e|elevate|transform|empower)\s+your\b/i, code: "HYPE_WORD", weight: W.MEDIUM, headline: true, label: "“supercharge/transform your …”", fix: "Say what changes, with a number or an example." },
  { re: /\bgame[- ]chang(?:er|ing)\b/i, code: "HYPE_WORD", weight: W.MEDIUM, headline: true, label: "“game-changer”", fix: "Say what changed." },
  { re: /\blook no further\b/i, code: "AI_TELL", weight: W.MEDIUM, headline: true, label: "“look no further”", fix: "Cut it." },
  { re: /\bwhether you'?re an? [^,.]{1,40},? or an? \b/i, code: "AI_TELL", weight: W.MEDIUM, headline: true, label: "“whether you're a X or a Y”", fix: "Pick the one reader this is for." },
  {
    re: /\b(?:seamless(?:ly)?|cutting[- ]edge|state[- ]of[- ]the[- ]art|best[- ]in[- ]class|world[- ]class|next[- ]gen(?:eration)?|all[- ]in[- ]one|one[- ]stop[- ]shop|robust|holistic|innovative|unparalleled|groundbreaking|transformative|revolutionary|synergy)\b/i,
    code: "HYPE_WORD",
    weight: W.MEDIUM, headline: true,
    label: "hype word",
    fix: "Replace it with the specific thing it stands for.",
  },
  { re: /\b(?:embark on|navigate|navigating) (?:a|the|your) (?:journey|complexit(?:y|ies)|landscape)\b/i, code: "AI_TELL", weight: W.MEDIUM, headline: true, label: "“navigate the complexities”", fix: "Name the actual problem." },
  { re: /\bthe future of [^.]{1,40} is (?:here|now)\b/i, code: "AI_TELL", weight: W.MEDIUM, headline: true, label: "“the future of X is here”", fix: "Say what exists today." },
  { re: /\b(?:I'?m|we'?re|I am|we are) (?:so )?(?:thrilled|excited|delighted|humbled|honou?red|proud) to (?:announce|share|introduce)\b/i, code: "ANNOUNCE_OPENER", weight: W.MEDIUM, headline: true, label: "“thrilled to announce”", fix: "Lead with what's new and who it's for." },
];

// 6. Inflated significance: HIGH. Wikipedia "Undue emphasis on symbolism, legacy, and importance".
const INFLATED: Tell[] = [
  {
    re: /\b(?:stands?|serves?) as (?:a|an) (?:testament|reminder|beacon|symbol|cornerstone)\b|\bplays? an? (?:vital|significant|crucial|pivotal|key|critical) role\b|\b(?:underscores?|highlights?|reflects?) (?:its|the|their) (?:importance|significance|commitment)\b/i,
    code: "AI_TELL",
    weight: W.HIGH,
    label: "inflated significance",
    fix: "State the fact without telling the reader it matters.",
  },
  {
    re: /\b(?:indelible|lasting|enduring) (?:mark|legacy|impact)\b|\bkey turning point\b|\bdeeply rooted\b|\breflects? (?:a )?broader\b|\bmarking a (?:pivotal|significant|new) (?:moment|milestone|chapter)\b|\bsetting the stage for\b|\bpaving the way for\b/i,
    code: "AI_TELL",
    weight: W.HIGH,
    label: "inflated significance",
    fix: "State the fact without telling the reader it matters.",
  },
];

// 7. Superficial "-ing" riders: MEDIUM. Wikipedia "Superficial analyses"; Reinhart et al., PNAS 2025 (2–5x human rate).
const RIDERS: Tell = {
  re: /,\s+(?:highlighting|underscoring|emphasizing|showcasing|reflecting|ensuring|fostering|cultivating|contributing to|solidifying|cementing|reinforcing|paving the way)\b[^.!?]*[.!?]?/i,
  code: "AI_TELL",
  weight: W.MEDIUM,
  label: "“…, highlighting …” rider",
  fix: "End the sentence; make the second point its own sentence or cut it.",
};

// 8. AI vocabulary. Tier A (Kobak excess ratio about 5–28x) is HIGH in copy under 150 words; tier B is MEDIUM.
const VOCAB_A = /\b(delv(?:e|es|ed|ing)|underscor(?:e|es|ed|ing)|showcas(?:e|es|ed|ing)|meticulous(?:ly)?|intricate|intricacies|realm|tapestry|testament|commendable|garner(?:s|ed|ing)?|multifaceted|interplay|shed(?:s|ding)? light on)\b/gi;
const VOCAB_B =
  /\b(crucial|pivotal|vital|enhance[sd]?|enhancing|foster(?:s|ed|ing)?|leverag(?:e|es|ed|ing)|streamlin(?:e|es|ed|ing)|notably|nuanced|vibrant|enduring|landscape|aligns? with|underpin(?:s|ned)?|additionally|insights|comprehensive|valuable|elevat(?:e|es|ed|ing)|harness(?:es|ed|ing)?|unlock(?:s|ed|ing)?)\b/gi;

// 9. Brochure language: MEDIUM. Wikipedia "Promotional and advertisement-like language".
const BROCHURE: Tell = {
  re: /\b(?:nestled|in the heart of|boasts? an?|breathtaking|stunning|must[- ]visit|continues to captivate|renowned|diverse array|rich (?:heritage|history|tapestry|culture))\b/i,
  code: "AI_TELL",
  weight: W.MEDIUM,
  label: "brochure language",
  fix: "Describe it plainly.",
};

// 10. Vague attribution: MEDIUM. Wikipedia "Vague attributions of opinion".
const VAGUE_ATTRIBUTION: Tell = {
  re: /\b(?:experts?|studies|research|industry (?:reports|leaders|experts)|observers|critics|many (?:people|users|teams))\s+(?:say|show|suggest|agree|believe|argue|have (?:cited|noted|shown))\b/i,
  code: "AI_TELL",
  weight: W.MEDIUM,
  label: "vague attribution",
  fix: "Name the source or drop the claim.",
};

// 11. Didactic disclaimers and stock closers. Wikipedia "Didactic, editorializing disclaimers" and "Summaries and conclusions".
const DIDACTIC: Tell[] = [
  { re: /\bit'?s (?:important|crucial|critical|essential|worth) (?:to note|to remember|noting|to consider|mentioning)\b/i, code: "AI_TELL", weight: W.MEDIUM, label: "“it's important to note”", fix: "Just say it." },
  { re: /^(?:In (?:summary|conclusion|short)|Overall|Ultimately|At the end of the day),/i, code: "AI_TELL", weight: W.MEDIUM, label: "summary opener", fix: "Cut the summary; end on the point.", scope: "line" },
  {
    re: /\b(?:the future (?:looks|is) bright|exciting times (?:lie )?ahead|the possibilities are endless|this is just the beginning|a step in the right direction)\b/i,
    code: "AI_TELL",
    weight: W.HIGH,
    label: "stock closer",
    fix: "End on something specific: a date, a number, a question.",
  },
];

// 12. False ranges. Wikipedia "False ranges".
const RANGES: Tell[] = [
  { re: /\bfrom [^,.;]{2,40} to [^,.;]{2,40},\s*(?:and\s+)?from\b/i, code: "AI_TELL", weight: W.HIGH, label: "chained “from X to Y”", fix: "Pick the one case that matters." },
  { re: /\bfrom (?:startups|small businesses|beginners|solopreneurs|individuals) to (?:enterprises?|large enterprises|Fortune 500|experts|pros|global brands)\b/i, code: "AI_TELL", weight: W.MEDIUM, label: "“from startups to enterprises”", fix: "Say what size it's really for." },
];

// 14. Formatting. Wikipedia "Em dashes", "Inline-header lists", "Emojis"; WaPo 2025 (em dash in >50% of mid-2025 responses).
const BOLD_HEADER = /^\s*(?:[-*•–]|\d+[.)])\s*\*\*[^*]{1,40}(?:\*\*\s*:|:\*\*)/m;
const EMOJI_BULLET = /^\s*\p{Extended_Pictographic}️?\s*(?:\*\*)?\p{Lu}/mu;
const LINE_EMOJI = /^\s*(?:✅|🚀|💡|🔥|👇|🧵|✨|📈|🎯|🧠)/gmu;
const ARROW_BULLET = /^\s*(?:→|➡️|👉)/gmu;

// 15. Social structure: MEDIUM. Practitioner and vendor sources (low confidence), humanizer.
const BAIT: Tell = {
  re: /(?:What do you think\?|Thoughts\?|Agree\?|Let me know in the comments|Drop (?:a|your) [^.]{1,30} below|Repost if|♻️)\s*$/i,
  code: "AI_TELL",
  weight: W.MEDIUM,
  label: "engagement bait",
  fix: "Ask a real question you want answered, or end without one.",
  // Per line: bait usually sits just above a row of hashtags.
  scope: "line",
};
const LISTICLE: Tell = { re: /^(?:Here are (?:my )?(?:top )?\d+|\d+ (?:lessons|things|ways|tips) I)\b/i, code: "AI_TELL", weight: W.MEDIUM, label: "listicle frame", fix: "Lead with the one lesson that matters most.", scope: "start" };

// 16. "AI-powered" as the benefit: MEDIUM. Cicek et al. 2024 (saying "artificial intelligence" lowered purchase intent).
const AI_BENEFIT = /\b(?:AI[- ]powered|powered by AI|AI[- ]driven|artificial intelligence)\b/i;

// Unsourced specifics. Numbers next to claim words must appear in a receipt (same normalization as outreach lint).
const CLAIM_NUMBER =
  /(\$\s?\d[\d,.]*\s?(?:k|m|b|mm|million|billion|thousand)?\b|\b\d[\d,.]*\s?(?:%|percent\b|x\b|×)|\b\d[\d,.]*\s+times\b|\b\d[\d,.]*\+?\s+(?:customers|clients|teams|companies|businesses|users|people|founders|engineers|developers|accounts|downloads|installs|sign-?ups|members|subscribers|hours|minutes|words|reviews|stars|countries|cities|languages|spots|seats)\b)/gi;
// Superlatives and "first/only" claims need substantiation (FTC; DoNotPay's "world's first robot lawyer" case, January 2025).
const SUPERLATIVE =
  /\b(#\s?1\b|number one|no\.\s?1\b|(?:the|our) (?:best|fastest|cheapest|easiest|leading|largest|biggest|most (?:popular|trusted|accurate|advanced|secure|powerful|loved))\b|world'?s (?:first|best|fastest|only|leading|largest|most \w+)\b|the (?:first|only) (?:\w+ )?(?:app|tool|platform|product|company|startup|service|way|one) (?:that|to|for|built)\b|industry[- ]leading|market[- ]leading|unbeatable|(?:is|are) unmatched|unmatched (?:quality|performance|speed|accuracy|precision|reliability|value|security|support)|guaranteed?)/gi;
const URGENCY = /\b(limited time|act now|hurry|don'?t miss (?:out)?|last chance|while (?:supplies|spots) last|spots are filling|before it'?s too late|expires? soon)\b/i;
// Visual direction: house heuristic, from the image rule "show the product doing the thing".
const VISUAL_CLICHE =
  /\b(robots?|humanoid|glowing brain|brain made of|circuit board|neon|hologra\w*|futuristic|rockets?|light ?bulbs?|handshakes?|stock photo|diverse team|smiling at (?:a |their )?laptops?|abstract (?:network|nodes|shapes)|digital (?:waves|particles)|matrix code)\b/i;

/* ───────────── Concreteness ───────────── */

/** Words that sound like value but carry none on their own (house list, aligned with Packard & Berger on concreteness). */
const VAGUE_WORDS =
  /\b(productivity|efficien(?:t|cy)|workflows?|solutions?|potential|success(?:ful)?|growth|innovation|experiences?|journey|results|outcomes|performance|smarter|better|easier|powerful|effortless(?:ly)?|intuitive|flexible|scalable|next level|value|impact|game|future|possibilities|seamless)\b/gi;
const NUMBER_WORDS = /\b(one|two|three|four|five|six|seven|eight|nine|ten|twelve|twenty|hundred|thousand|million|billion|half|twice|double|triple)\b/i;
const STARTERS = new Set(
  "the a an your you their they its it this that these those in on at since when after before last next i we our my his her and but so if as for with from to of no not don't don’t what why how who".split(" "),
);

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Smart quotes → straight, so patterns match what people type. */
function norm(text: string): string {
  return text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
}

/** Quoted words are someone else's (a customer, a testimonial): exempt from the word lists. */
function maskQuotes(text: string): string {
  return text.replace(/"[^"\n]{1,200}"/g, (m) => " ".repeat(m.length));
}

function maskAllowed(text: string, allow: string[]): string {
  let out = text;
  for (const p of [...new Set(allow.map((w) => w.trim()).filter((w) => w.length > 2))].sort((a, b) => b.length - a.length)) {
    out = out.replace(new RegExp(`\\b${escapeRe(p)}\\b`, "gi"), "term");
  }
  return out;
}

/** Counts concrete markers: numbers, proper nouns, quotes, and the founder's own vocabulary. */
export function concreteness(text: string, allow: string[] = []): { concrete: number; vague: number } {
  const t = norm(text);
  let concrete = (t.match(/\d/g) ? (t.match(/\d[\d,.]*/g) ?? []).length : 0) + (NUMBER_WORDS.test(t) ? 1 : 0) + (t.match(/"[^"\n]{2,200}"/g) ?? []).length;
  for (const s of sentences(t)) {
    const words = s.split(/\s+/);
    words.forEach((raw, i) => {
      const w = raw.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "");
      if (i > 0 && /^\p{Lu}/u.test(w) && w !== "I" && !STARTERS.has(w.toLowerCase())) concrete += 1;
    });
  }
  for (const a of allow) if (a.trim().length > 2 && new RegExp(`\\b${escapeRe(a.trim())}\\b`, "i").test(t)) concrete += 1;
  const vague = (t.match(VAGUE_WORDS) ?? []).length;
  return { concrete, vague };
}

/** Coefficient of variation of sentence length (words). Under 0.35 across 5+ sentences reads as machine rhythm. */
export function rhythm(text: string): number | null {
  const lens = sentences(text).map(countWords).filter((n) => n > 0);
  if (lens.length < 5) return null;
  const mean = lens.reduce((a, b) => a + b, 0) / lens.length;
  const sd = Math.sqrt(lens.reduce((a, b) => a + (b - mean) ** 2, 0) / lens.length);
  return mean ? sd / mean : null;
}

/* ───────────── Lint ───────────── */

const SHORT_ROLES = new Set(["hook", "title", "cta"]);

function limitWord(l: Limit): string {
  return l.unit === "words" ? "words" : l.unit === "weighted" ? "characters (X counts links as 23)" : "characters";
}

function limitLabel(l: Limit): string {
  return l.kind === "hard" ? "the platform limit" : l.kind === "recommended" ? "the platform's recommendation" : l.kind === "observed" ? "where it usually gets cut off" : "what works best";
}

function checkLimit(add: (v: Violation) => void, part: PartSpec | null, label: string, text: string, l: Limit) {
  const n = measure(text, l.unit);
  const key = part?.key ?? null;
  if (l.max !== undefined && n > l.max) {
    add({ code: "OVER_LIMIT", part: key, severity: l.kind === "hard" ? "error" : "warn", detail: `${label}: ${n} ${limitWord(l)}, over ${limitLabel(l)} of ${l.max}.` });
  } else if (l.min !== undefined && n > 0 && n < l.min) {
    add({ code: "UNDER_MIN", part: key, severity: l.kind === "hard" ? "error" : "warn", detail: `${label}: ${n} ${limitWord(l)}; ${l.min} or more reads better.` });
  }
}

function tellsIn(text: string, rules: Tell[]): { tell: Tell; match: string }[] {
  const out: { tell: Tell; match: string }[] = [];
  const first = sentences(text)[0] ?? "";
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  for (const tell of rules) {
    if (tell.scope === "start") {
      const m = first.match(tell.re);
      if (m) out.push({ tell, match: m[0] });
    } else if (tell.scope === "line") {
      for (const line of lines) {
        const m = line.match(tell.re);
        if (m) {
          out.push({ tell, match: m[0] });
          break;
        }
      }
    } else {
      const m = text.match(tell.re);
      if (m) out.push({ tell, match: m[0] });
    }
  }
  return out;
}

function clip(s: string, n = 40): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

/** Lints one option of a format. Pure. */
export function lintStudio(input: StudioLintInput): StudioLint {
  const spec: FormatSpec = FORMATS[input.format];
  const allow = [...(input.allowWords ?? [])];
  const out: Violation[] = [];
  const seen = new Set<string>();
  const add = (v: Violation) => {
    const k = `${v.code}|${v.part}|${v.detail}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push(v);
  };
  const texts: string[] = [];
  const bodyTexts: string[] = [];

  for (const part of spec.parts) {
    const raw = norm(input.parts[part.key] ?? "").trim();
    if (!raw) {
      if (!part.optional) add({ code: "PART_MISSING", part: part.key, severity: "error", detail: `${part.label} is empty.` });
      continue;
    }
    texts.push(raw);
    if (part.role === "body") bodyTexts.push(raw);

    // Fit
    if (part.prefix && !raw.startsWith(part.prefix.trim())) add({ code: "PLATFORM_RULE", part: part.key, severity: "error", detail: `${part.label} must start with “${part.prefix.trim()}”.` });
    if (part.list) {
      const items = listItems(part, raw);
      if (items.length < part.list.min) add({ code: "UNDER_MIN", part: part.key, severity: "error", detail: `${part.label}: ${items.length} of at least ${part.list.min}.` });
      if (items.length > part.list.max) add({ code: "OVER_LIMIT", part: part.key, severity: "error", detail: `${part.label}: ${items.length}, more than ${part.list.max}.` });
      items.forEach((item, i) => {
        for (const l of part.limits) checkLimit(add, part, `${part.label} ${i + 1}`, item, l);
      });
    } else {
      for (const l of part.limits) checkLimit(add, part, part.label, raw, l);
    }

    // Placeholders and chatbot residue
    const ph = raw.match(PLACEHOLDER)?.[0];
    if (ph) add({ code: "PLACEHOLDER", part: part.key, severity: "error", detail: `${part.label}: fill in “${clip(ph, 30)}” before this goes out.` });

    if (part.role === "visual") {
      const v = raw.match(VISUAL_CLICHE)?.[0];
      if (v) add({ code: "VISUAL_CLICHE", part: part.key, severity: "warn", detail: `“${v}” is the stock image everyone uses. Show the product doing the thing, or the real moment.` });
      continue;
    }

    // Tells run on text with quotes and the founder's vocabulary masked (they're someone else's words, or theirs).
    const masked = maskAllowed(maskQuotes(raw), allow);
    const words = Math.max(1, countWords(raw));
    let density = 0;
    const densityHits: string[] = [];
    let failed = false;
    const hit = (code: StudioLintCode, weight: Weight, label: string, fix: string, match: string, headline = false) => {
      if (weight === W.BLOCK || weight === W.HIGH || (weight === W.MEDIUM && headline && SHORT_ROLES.has(part.role))) {
        failed = true;
        add({ code, part: part.key, severity: "error", detail: `${part.label}: ${label} (“${clip(match)}”). ${fix}` });
        return;
      }
      density += weight;
      densityHits.push(label);
      if (weight === W.MEDIUM) add({ code, part: part.key, severity: "warn", detail: `${part.label}: ${label} (“${clip(match)}”). ${fix}` });
    };

    for (const { tell, match } of tellsIn(masked, [...RESIDUE, ...PARALLEL, ...OPENERS, CLOSERS, ...CLICHES, ...INFLATED, RIDERS, BROCHURE, VAGUE_ATTRIBUTION, ...DIDACTIC, ...RANGES, BAIT, LISTICLE])) {
      hit(tell.code, tell.weight, tell.label, tell.fix, match, tell.headline);
    }

    // AI vocabulary, counted per distinct word.
    const tierA = [...new Set((masked.match(VOCAB_A) ?? []).map((w) => w.toLowerCase()))];
    for (const w of tierA) hit("AI_VOCAB", words < 150 ? W.HIGH : W.MEDIUM, "AI vocabulary", "Use the plain word.", w);
    const tierB = [...new Set((masked.match(VOCAB_B) ?? []).map((w) => w.toLowerCase()))];
    const tierBHigh = tierB.length >= 2 && (tierB.length / words) * 100 >= 2;
    for (const w of tierB) hit("AI_VOCAB", tierBHigh ? W.HIGH : W.MEDIUM, "AI vocabulary", "Use the plain word.", w);

    // Rule of three: a triad in a headline, or 2+ per 150 words in body copy; three-fragment slogans.
    const triads = masked.match(/\b[\p{L}-]+,\s+[\p{L}-]+,?\s+and\s+[\p{L}-]+\b/giu) ?? [];
    if (triads.length && SHORT_ROLES.has(part.role)) hit("TRIPLET", W.MEDIUM, "three-item list", "Keep the one that matters most.", triads[0] ?? "");
    else if ((triads.length / words) * 150 >= 2) hit("TRIPLET", W.MEDIUM, "stacked three-item lists", "Write threes only when there are three things.", triads[0] ?? "");
    else if (triads.length) {
      density += W.LOW;
      densityHits.push("three-item list");
    }
    const slogan = masked.trim().match(/^\p{Lu}\p{L}+\.\s+\p{Lu}\p{L}+\.\s+\p{Lu}\p{L}+\.$/u);
    if (slogan && concreteness(raw, allow).concrete === 0) hit("TRIPLET", W.MEDIUM, "“Fast. Simple. Secure.” slogan", "Add the concrete thing it's fast at.", slogan[0]);

    // Dashes: LOW alone; MEDIUM when dense; fails in a short line.
    const dashes = (raw.match(/—|–|\s--\s/g) ?? []).length;
    if (dashes) {
      if (SHORT_ROLES.has(part.role) && words < 20) hit("EM_DASH", W.HIGH, "dash in a short line", "Use a period or a comma.", "—");
      else if (dashes > Math.max(1, words / 80) || raw.split(/\n\s*\n/).some((p) => (p.match(/—|–/g) ?? []).length >= 2)) hit("EM_DASH", W.MEDIUM, `${dashes} dashes`, "Use periods and commas; keep one dash at most.", "—");
      else {
        density += W.LOW;
        densityHits.push("dash");
      }
    }

    // Formatting tells
    if (BOLD_HEADER.test(raw)) hit("AI_TELL", W.MEDIUM, "bold label bullets", "Write it as sentences.", raw.match(BOLD_HEADER)![0]);
    if (EMOJI_BULLET.test(raw)) hit("EMOJI", W.MEDIUM, "emoji bullets", "Drop the emoji bullets.", raw.match(EMOJI_BULLET)![0]);
    const lineEmoji = (raw.match(LINE_EMOJI) ?? []).length + (raw.match(ARROW_BULLET) ?? []).length;
    if (lineEmoji) {
      density += lineEmoji * W.LOW;
      densityHits.push("emoji or arrow at line start");
    }
    const hashtags = (raw.match(/(^|\s)#[\p{L}\d_]+/gu) ?? []).length;
    if (hashtags > 2) add({ code: "HASHTAGS", part: part.key, severity: "warn", detail: `${part.label}: ${hashtags} hashtags. Two at most, at the end.` });
    else if (hashtags && SHORT_ROLES.has(part.role)) add({ code: "HASHTAGS", part: part.key, severity: "warn", detail: `${part.label}: hashtags belong at the end, not in the hook.` });
    const bangs = (raw.match(/!/g) ?? []).length;
    if (bangs > 1 || (bangs && SHORT_ROLES.has(part.role))) add({ code: "EXCLAMATION", part: part.key, severity: "warn", detail: `${part.label}: let the words carry the energy, not the exclamation marks.` });
    // Capitals the founder's own material uses (VLOOKUP, a product code) are names, not shouting.
    const shout = (raw.match(/\b[A-Z]{4,}\b/g) ?? []).find(
      (w) => !allow.some((a) => a.toUpperCase() === w) && !(input.sourced ?? "").includes(w) && !/^(HTTP|HTTPS|JSON|YAML|HIPAA|GDPR|SAML|OAUTH|NASA|NYSE|ASAP|SOC2|CI\/CD)$/.test(w),
    );
    if (shout) add({ code: "ALL_CAPS", part: part.key, severity: input.format === "show_hn" && part.key === "title" ? "error" : "warn", detail: `${part.label}: “${shout}” in capitals reads as shouting.` });

    // Social structure
    if (part.role === "body" || part.role === "list") {
      const paras = raw.split(/\n+/).map((p) => p.trim()).filter(Boolean);
      const single = paras.filter((p) => sentences(p).length <= 1).length;
      if (paras.length >= 6 && single / paras.length > 0.7) hit("BROETRY", W.MEDIUM, "one sentence per line", "Write paragraphs of 1–3 sentences.", paras[0]);
      const cv = rhythm(raw);
      if (cv !== null && cv < 0.35) add({ code: "MONOTONE", part: part.key, severity: "warn", detail: `${part.label}: every sentence is about the same length. Mix short ones with longer ones.` });
      if (words >= 30) {
        const grade = fkGrade(maskAllowed(raw, allow));
        if (grade > 9) add({ code: "FK_GRADE", part: part.key, severity: "warn", detail: `${part.label} reads at grade ${Math.round(grade)}. Shorter sentences and plainer words (aim for 9 or under).` });
      }
    }

    // "AI-powered" as the benefit
    if (SHORT_ROLES.has(part.role) && input.audience !== "developer" && AI_BENEFIT.test(masked)) {
      hit("AI_TELL", W.MEDIUM, "“AI-powered” as the benefit", "Lead with what the reader gets; buyers trust “AI” less as a selling point.", masked.match(AI_BENEFIT)![0]);
    }

    // Specificity floor: a hook made of value words with nothing concrete.
    const { concrete, vague } = concreteness(raw, allow);
    if (SHORT_ROLES.has(part.role) && part.role !== "cta" && vague > 0 && concrete === 0) {
      add({ code: "VAGUE", part: part.key, severity: "error", detail: `${part.label}: “${clip(raw.match(VAGUE_WORDS)?.[0] ?? raw, 24)}” with nothing concrete. Add a number, a name, an object or the customer's own words.` });
    } else if (part.role === "body" && words >= 40 && concrete < Math.floor(words / 40)) {
      add({ code: "VAGUE", part: part.key, severity: "warn", detail: `${part.label}: few specifics for its length. One number, name or real detail per 40 words or so.` });
    }

    // Density: tells come in clusters.
    const threshold = SHORT_ROLES.has(part.role) || words < 20 ? 3 : (6 * words) / 100;
    if (!failed && density >= Math.max(3, threshold)) {
      add({ code: "AI_TELL", part: part.key, severity: "error", detail: `${part.label} reads as machine-written: ${[...new Set(densityHits)].slice(0, 3).join(", ")}. Rewrite those spots with specifics.` });
    }

    // Platform rules
    for (const ban of PLATFORM_BANS[input.format] ?? []) {
      if ((!ban.part || ban.part === part.key) && ban.re.test(raw)) add({ code: "PLATFORM_RULE", part: part.key, severity: "error", detail: ban.detail });
    }
  }

  if (spec.total) {
    const whole = spec.parts.map((p) => norm(input.parts[p.key] ?? "").trim()).filter(Boolean).join("\n\n");
    checkLimit(add, null, "The whole post", whole, spec.total);
  }

  // Honesty: numbers, superlatives, competitors, urgency, the founder's never-say list.
  const all = texts.join("\n");
  if (input.sourced !== undefined) {
    const sourced = normNumber(input.sourced);
    const sourcedWords = norm(input.sourced).toLowerCase();
    for (const m of all.matchAll(CLAIM_NUMBER)) {
      if (!sourced.includes(normNumber(m[0]))) {
        add({ code: "NUMBER_UNSOURCED", part: null, severity: "error", detail: `“${m[0].trim()}” isn't in your claims or material. Add where it comes from, or cut it.` });
        break;
      }
      // "Up to" and "on average" are different claims needing different evidence (Ramp's own pages drift between them).
      const at = m.index ?? 0;
      const near = all.slice(Math.max(0, at - 30), at + m[0].length + 30).toLowerCase();
      const qualifier = /\b(up to|as much as)\s*$/.test(all.slice(Math.max(0, at - 14), at).toLowerCase()) ? "up to" : /\b(on )?average\b/.test(near) ? "average" : null;
      if (qualifier && !sourcedWords.includes(qualifier)) {
        add({ code: "NUMBER_UNSOURCED", part: null, severity: "error", detail: `“${qualifier} ${m[0].trim()}” claims more than your source says; “up to” and “on average” need different evidence. Use the source's own wording.` });
        break;
      }
    }
    for (const m of all.matchAll(SUPERLATIVE)) {
      const core = m[0].toLowerCase().replace(/^(the|our)\s+/, "").replace(/\s+(that|to|for|built)$/, "");
      const key = core.match(/(#\s?1|number one|no\.\s?1|first|only|best|fastest|cheapest|easiest|leading|largest|biggest|most \w+|unbeatable|unmatched|guarantee)/)?.[0] ?? core;
      if (!sourcedWords.includes(key.replace(/\s+/g, " "))) {
        add({ code: "SUPERLATIVE_UNSOURCED", part: null, severity: "error", detail: `“${m[0].trim()}” is a claim you'd have to prove (the FTC fined DoNotPay over “world's first robot lawyer”). Add the proof to your material, or say what's specifically true.` });
        break;
      }
    }
  }
  for (const name of input.competitors ?? []) {
    if (name.trim().length > 1 && new RegExp(`\\b${escapeRe(name.trim())}\\b`, "i").test(all)) {
      add({ code: "COMPETITOR_CLAIM", part: null, severity: "warn", detail: `Names ${name}. Anything said about them must be true, current and checkable (FTC comparative-advertising policy). Date it.` });
      break;
    }
  }
  const urgent = all.match(URGENCY)?.[0];
  if (urgent) add({ code: "FAKE_URGENCY", part: null, severity: "warn", detail: `“${urgent}”: only if there's a real deadline. Name the date instead.` });
  for (const w of input.neverSay ?? []) {
    if (w.trim().length > 1 && new RegExp(`\\b${escapeRe(w.trim())}\\b`, "i").test(all)) {
      add({ code: "NEVER_SAY", part: null, severity: "error", detail: `“${w.trim()}” is on your never-say list.` });
      break;
    }
  }

  // Two options in one set with the same opening shape defeat the point of options.
  if (input.siblings?.length) {
    const hook = spec.parts.find((p) => SHORT_ROLES.has(p.role) || p.role === "list");
    if (hook) {
      const mine = skeleton(input.parts[hook.key] ?? "");
      if (mine && input.siblings.some((s) => skeleton(s[hook.key] ?? "") === mine)) {
        add({ code: "SAME_SHAPE", part: hook.key, severity: "warn", detail: `${hook.label} opens the same way as another option. Try a different move.` });
      }
    }
  }

  const { concrete, vague } = concreteness(all, allow);
  const body = bodyTexts.join("\n") || all;
  const violations = sortStudio(out);
  return {
    passed: !violations.some((v) => v.severity === "error"),
    violations,
    stats: { words: countWords(all), grade: countWords(body) >= 30 ? fkGrade(maskAllowed(body, allow)) : 0, concrete, vague },
  };
}

function skeleton(text: string): string {
  const first = sentences(norm(text))[0] ?? "";
  const tokens = maskEntities(first).slice(0, 4);
  return tokens.length >= 3 ? tokens.join(" ") : "";
}

const ORDER: StudioLintCode[] = [
  "PLACEHOLDER",
  "PART_MISSING",
  "PLATFORM_RULE",
  "NUMBER_UNSOURCED",
  "SUPERLATIVE_UNSOURCED",
  "NEVER_SAY",
  "OVER_LIMIT",
  "AI_TELL",
  "NEGATIVE_PARALLEL",
  "RHETORICAL_OPENER",
  "ANNOUNCE_OPENER",
  "VAGUE",
  "HYPE_WORD",
  "AI_VOCAB",
  "TRIPLET",
  "EM_DASH",
  "BROETRY",
  "EMOJI",
  "UNDER_MIN",
  "COMPETITOR_CLAIM",
  "FAKE_URGENCY",
  "SAME_SHAPE",
  "VISUAL_CLICHE",
  "MONOTONE",
  "FK_GRADE",
  "HASHTAGS",
  "EXCLAMATION",
  "ALL_CAPS",
];

export function sortStudio(list: Violation[]): Violation[] {
  const rank = (v: Violation) => (v.severity === "error" ? 0 : 100) + Math.max(0, ORDER.indexOf(v.code));
  return [...list].sort((a, b) => rank(a) - rank(b));
}

export function worstStudio(lint: StudioLint): Violation | null {
  return lint.violations.find((v) => v.severity === "error") ?? null;
}

/** For the writer's prompt, so the model and the linter agree on what fails. */
export const STUDIO_TELLS_FOR_PROMPT = [
  "“not just X, but Y”, “it's not X, it's Y”, runs of “No X. No Y.”, “no X, no Y, just Z”",
  "staged openers (Here's the thing, Let's be honest, Picture this, Buckle up, Let's dive in) and rhetorical ones (Imagine a world, Ever wondered, Tired of…?)",
  "dramatic one-line closers (Let that sink in, Read that again, Full stop, That's it, And that changes everything, The result?)",
  "in today's fast-paced world, in the ever-evolving landscape of, unlock the power/potential of, harness the power of, take your X to the next level, say goodbye to X and hello to Y, look no further, whether you're a X or a Y, the future of X is here, navigate the complexities",
  "supercharge/transform/elevate/empower your, game-changer, seamless, cutting-edge, state-of-the-art, best-in-class, world-class, next-gen, all-in-one, one-stop shop, robust, holistic, innovative, unparalleled, groundbreaking, transformative, revolutionary, synergy",
  "I'm/we're thrilled/excited/proud/humbled to announce",
  "stands as a testament, plays a pivotal role, paving the way for, setting the stage for, marking a new chapter, the future looks bright, the possibilities are endless, this is just the beginning",
  "“…, highlighting/showcasing/underscoring/fostering …” riders; experts say / studies show without a source; it's important to note; In conclusion/Overall/Ultimately",
  "delve, underscore, showcase, meticulous, intricate, realm, tapestry, testament, commendable, garner, multifaceted, interplay, shed light on; and crucial, pivotal, vital, enhance, foster, leverage, streamline, notably, nuanced, vibrant, landscape, align with, underpin, additionally, insights, comprehensive, valuable, elevate, harness, unlock",
  "from startups to enterprises; three-item lists unless there are really three things; “Fast. Simple. Secure.” slogans",
  "dashes in headlines (use periods and commas), bold label bullets, emoji bullets, one sentence per line, engagement bait (Thoughts? Agree? Drop a comment below), “Here are 5 lessons…”",
  "“AI-powered” as the headline benefit",
  "numbers, “#1/the best/the fastest/the first/the only/world's first” and guarantees without a receipt; fake urgency (limited time, act now, don't miss out)",
];
