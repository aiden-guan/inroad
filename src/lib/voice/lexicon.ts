import type { ObjectionCard } from "@/lib/domain/types";
import type { AlternativeKind, ThemeKind } from "./types";

/**
 * The code half of clustering: what B2B buyers say, as patterns. Objections follow the ObjectionCard categories
 * (so a theme lines up with the answer on file), buying-process facts and the common shapes of pain and wanted
 * outcomes are generic, and the company's own words (competitors, alternatives, objection cards) come from the
 * playbook at run time. Anything that matches none of these is clustered by similarity instead.
 */

export interface ThemeSeed {
  key: string;
  kind: ThemeKind;
  label: string;
  patterns: RegExp[];
  /** Objections: the ObjectionCard category whose answer applies. */
  category?: ObjectionCard["category"];
  /** Not counted when one of these seeds also matched (a review that "takes two weeks" is process, not pain). */
  unless?: string[];
}

const NUM = String.raw`(?:\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|a|an|half a|about a)`;

export const THEME_SEEDS: ThemeSeed[] = [
  /* ─────────── Objections (ObjectionCard categories) ─────────── */
  {
    key: "objection:build",
    kind: "objection",
    label: "We'd build it ourselves",
    category: "build",
    patterns: [
      /\b(build|built|building|extend|extending|write|writing)\b[^.?!]{0,40}\b(ourselves|in[- ]house|internally|our own|in dbt|dbt models?|a script|scripts?)\b/i,
      /\bin[- ]house\b|\bhomegrown\b|\bhome[- ]grown\b/i,
      /\b(our|the|my) (data|eng|engineering|dev|analytics) team\b[^.?!]{0,30}\b(can|could|will|would|offered|wants?)\b/i,
      /\b(analyst|engineer)s? (could|can|would|will) (just )?(build|write|do) (this|it)\b|\b(analyst|engineer|team)s?\b[^.?!]{0,15}\bjust (build|write|do) (this|it)\b/i,
      /\bdbt models?\b/i,
    ],
  },
  {
    key: "objection:security",
    kind: "objection",
    label: "Worried about giving a vendor our data",
    category: "security",
    patterns: [
      /\b(can't|cannot|won't|wouldn't|not (comfortable|allowed)|nervous|worried|risky|concern(ed)?)\b[^.?!]{0,50}\b(data|access|vendor|startup|warehouse)\b/i,
      /\b(send|share|give|hand)\b[^.?!]{0,25}\b(billing|customer|financial|our|usage) data\b/i,
      /\bbefore (any|a|the) vendor\b|\bbefore (anyone|we) (touch|touches|connect)/i,
    ],
  },
  {
    key: "objection:price",
    kind: "objection",
    label: "It costs more than we planned",
    category: "budget",
    patterns: [
      /\b(too )?(expensive|pricey)\b|\bover (our |the )?budget\b|\bmore than (i|we) (planned|budgeted|expected)\b/i,
      /\b(cheaper|quoted (us )?less|lower price|discount)\b|\bcan't justify\b|\b(cost|costs|price) too much\b/i,
    ],
  },
  {
    key: "objection:timing",
    kind: "objection",
    label: "Not now",
    category: "timing",
    patterns: [
      /\bnot (a )?(priority|now|right now|this (quarter|year))\b|\bnext (fiscal )?(year|quarter)\b|\bfiscal year\b/i,
      /\b(frozen|freeze|froze)\b|\bcircle back\b|\brevisit\b|\bbad time\b|\btoo busy\b|\bafter (the )?(holidays|audit|raise)\b/i,
    ],
  },
  {
    key: "objection:status_quo",
    kind: "objection",
    label: "What we have works",
    category: "status_quo",
    patterns: [/\b(works|working) (fine|well|for now|today)\b|\bgood enough\b|\bwe('re| are) (fine|ok|okay)\b|\bhandles it\b|\bit's fine\b|\bwe manage\b/i],
  },
  {
    // Also joined by every quote that names a vendor (themes.ts), so "we looked at Meterbook" counts here.
    key: "objection:competitor",
    kind: "objection",
    label: "Another tool should cover it",
    category: "competitor",
    patterns: [/\balready (does|covers|handles)\b|\b(covers|does|handles) (this|it) already\b|\bsupposed to (cover|do|handle)\b/i, /\b[Cc](an't|ouldn't) [A-Z][A-Za-z0-9]+ (do|cover|handle)\b/],
  },
  {
    key: "objection:startup_risk",
    kind: "objection",
    label: "You're a young company",
    category: "startup_risk",
    patterns: [/\b(seed[- ]stage|startup|small (company|vendor))\b|\b(still )?be around\b|\bhow many customers\b|\breferences?\b/i],
  },
  {
    key: "objection:info",
    kind: "objection",
    label: "Send me some info",
    category: "info_request",
    patterns: [/\bsend (me |us )?(some |more )?(info|information|details|a deck|materials|something)\b|\btake a look\b/i],
  },
  {
    key: "objection:owner",
    kind: "objection",
    label: "Nobody here would own it",
    category: "team",
    patterns: [
      /\b(nobody|no one|no-one)\b[^.?!]{0,25}\b(own|owns|run|runs|sign|signs)\b|\bone person\b|\b(didn't|don't|doesn't) know who\b/i,
      /\b(not sure|unclear) who (would )?(own|sign|run)s?\b|\bwho would (own|sign|run)\b/i,
    ],
  },

  /* ─────────── Buying process ─────────── */
  {
    key: "process:security",
    kind: "process",
    label: "Security review",
    patterns: [/\bsecurity (review|questionnaire|team|answers|packet)\b|\bsecurity\b[^.?!]{0,20}\breview\b|\bquestionnaire\b|\bsoc ?2\b|\binfosec\b|\bpen ?test\b|\bvendor (risk|review|assessment)\b|\bdpa\b|\bgdpr\b|\beu data\b/i],
  },
  {
    key: "process:legal",
    kind: "process",
    label: "Legal and contract review",
    patterns: [/\blegal\b|\bcounsel\b|\blawyers?\b|\bredlines?\b|\bmsa\b|\border form\b|\b(our|their) paper\b|\bcontract review\b/i],
  },
  {
    key: "process:procurement",
    kind: "process",
    label: "Procurement",
    patterns: [/\bprocurement\b|\bpurchase order\b|\bvendor (onboarding|setup)\b|\bsupplier\b/i],
  },
  {
    key: "process:approval",
    kind: "process",
    label: "Who signs, from which budget",
    patterns: [
      /\b(my|her|his|their) (budget|call|decision)\b|\bsign[- ]off\b|\bwho (would |will )?signs?\b|\bdecision[- ]maker\b|\bbudget (owner|holder)\b/i,
      /\b(approve|approves|approval)\b|\bout of the [a-z ]{3,30} budget\b|\b(i|she|he|they) signs?\b|\b(i'll|i will|she'll|he'll|they'll) sign\b/i,
    ],
  },
  {
    key: "process:deadline",
    kind: "process",
    label: "A date that forces the decision",
    patterns: [
      /\bbefore the audit\b|\bfirst (financial statement )?audit\b|\baudit (starts|is coming|next)\b|\bquarter[- ]end\b|\byear[- ]end\b|\btrue[- ]ups?\b/i,
      /\brenewal\b|\bdeadline\b|\bgo[- ]live\b|\bby (the end of )?(q[1-4]|january|february|march|april|may|june|july|august|september|october|november|december)\b/i,
    ],
  },
  {
    key: "process:pilot",
    kind: "process",
    label: "Pilot and success criteria",
    patterns: [/\bpilot\b|\bproof of concept\b|\bpoc\b|\btrial\b|\bsuccess criteria\b|\bif it hits\b|\bboth numbers\b/i],
  },
  {
    key: "process:access",
    kind: "process",
    label: "Data access and setup",
    patterns: [/\bread[- ]only\b|\b(warehouse|database|billing|data) access\b|\bcredentials\b|\bpipelines?\b|\baccess to (our|the) (warehouse|data)\b|\bconnect (to )?(our|the|anything)\b/i],
  },

  /* ─────────── Pains ─────────── */
  {
    key: "pain:time",
    kind: "pain",
    label: "It takes days every cycle",
    patterns: [
      new RegExp(String.raw`\b${NUM}\s+(full |whole )?(days?|weeks?)\b`, "i"),
      // Hours and minutes are a pain only when something takes them ("builds take 40 minutes").
      new RegExp(String.raw`\b(takes?|took|spend|spent|eats?|lose|losing|wait|waiting)\b[^.?!]{0,30}\b${NUM}\s+(hours?|minutes?)\b`, "i"),
      /\btakes? (us )?(forever|ages)\b|\bslowest part\b|\beats (the|our|my)\b/i,
    ],
    // A review that "takes two weeks" is process, and "in a day, instead of four days" is the outcome they want.
    unless: ["process:security", "process:legal", "process:procurement", "process:deadline", "outcome:speed", "outcome:time_back"],
  },
  {
    key: "pain:unexplained",
    kind: "pain",
    label: "Numbers nobody can explain",
    patterns: [
      /\b(can't|cannot|couldn't|could not|nobody can|no one can|unable to)\s+(explain|trust|trace|find|show)\b|\bunexplained\b|\bwe can't explain\b/i,
      /\bvariances?\b|\bdiscrepanc(y|ies)\b|\badjustments?\b|\bdoesn't add up\b|\bwrong numbers?\b|\bexplains? why\b/i,
    ],
  },
  {
    key: "pain:mismatch",
    kind: "pain",
    label: "The systems never agree",
    patterns: [/\b(never|doesn't|don't|didn't|won't|rarely|not)\s+(match|matches|tie|ties|line up|agree|add up)\b|\bmismatch(es|ed)?\b|\bout of sync\b|\bdrift(s|ed)?\b/i],
  },
  {
    key: "pain:manual",
    kind: "pain",
    label: "Spreadsheets and manual work",
    patterns: [/\bspreadsheets?\b|\bexcel\b|\bgoogle sheets?\b|\bworkbooks?\b|\bvlookups?\b|\bby hand\b|\bmanual(ly)?\b|\bcopy[- ]paste\b|\brebuild(s|ing)?\b|\bthe sheet\b|\bexports?\b/i],
  },
  {
    key: "pain:headcount",
    kind: "pain",
    label: "Hiring to keep up",
    patterns: [/\bhir(e|es|ed|ing)\b|\bheadcount\b|\banother (person|accountant|analyst|engineer|head)\b|\bcontractors?\b|\bbackfill\b/i],
  },
  {
    key: "pain:audit",
    kind: "pain",
    label: "Explaining it to the auditor",
    patterns: [
      /\b(explain|explaining|show|prove|trace|walk)\b[^.?!]{0,40}\baudit(or|ors|s)?\b/i,
      /\baudit(or|ors)\b[^.?!]{0,30}\b(will|would|always|keep|keeps|kept|going to)\s+(ask|want|question)/i,
    ],
  },
  {
    key: "pain:leakage",
    kind: "pain",
    label: "Money billed wrong or not at all",
    patterns: [
      /\bleak(age|ing|s)?\b|\bunbilled\b|\bunder[- ]?bill(ed|ing)?\b|\bover[- ]?bill(ed|ing)?\b|\bdisput(e|ed|es)\b|\bwrite[- ]offs?\b|\brefunds?\b|\bbilled (late|never)\b/i,
      /\bnever (reached|reaches|made it onto|made it into|got onto|hit) (an? |the )?invoices?\b/i,
    ],
  },

  /* ─────────── Wanted outcomes ─────────── */
  {
    key: "outcome:speed",
    kind: "outcome",
    label: "Done in hours, not days",
    patterns: [
      /\b(in|within|under)\s+(a|one|an|\d+)\s+(day|hour|hours|days)\b|\bsame[- ]day\b|\bin hours\b|\bhours instead of\b/i,
      new RegExp(String.raw`\b${NUM}\s+hours?\b[^.?!]{0,40}\binstead of\b`, "i"),
    ],
  },
  {
    key: "outcome:accuracy",
    kind: "outcome",
    label: "Numbers they can trust",
    patterns: [/\b(under|below|less than)\s+(half a|a half|\d+(\.\d+)?)\s*(%|percent|point)|\btrust the (number|numbers|close)\b|\bno surprises\b|\bexplain every\b/i],
  },
  {
    key: "outcome:trail",
    kind: "outcome",
    label: "A trail the auditor accepts",
    patterns: [/\btrail\b|\btrace (every|each|back)\b|\bline[- ]level\b|\baudit[- ]ready\b|\bstopped asking\b/i],
  },
  {
    key: "outcome:no_hire",
    kind: "outcome",
    label: "No extra hire",
    patterns: [/\bsaves? (us )?(that|a|the|another)? ?hire\b|\binstead of (a|another) hire\b|\bwithout (hiring|a hire)\b|\bavoid (hiring|a hire)\b/i],
  },
  {
    key: "outcome:time_back",
    kind: "outcome",
    label: "Time back",
    patterns: [/\b(get|give|gives|got)\b[^.?!]{0,25}\b(week|day|days|time|hours)\b[^.?!]{0,10}\bback\b|\bfree(s)? up\b/i],
  },
];

export const SEED_BY_KEY = new Map(THEME_SEEDS.map((s) => [s.key, s]));

/** Any of these reads as a concern: what makes a quote an objection when no category pattern says so. */
export const CONCERN = /\b(but|however|can't|cannot|won't|wouldn't|worried|concern|not sure|too (much|expensive|early)|already|why would|why wouldn't|instead)\b/i;
/** Any of these reads as a wanted outcome. */
export const WANT = /\b(if (it|we|i|you) (could|can|hits?|saves?)|i want|we want|wants|wish|would love|the goal|need it to|instead of)\b/i;

/* ─────────── Alternatives that aren't a named vendor ─────────── */

export interface AlternativeSeed {
  key: string;
  name: string;
  kind: AlternativeKind;
  patterns: RegExp[];
  category: ObjectionCard["category"];
  /** Words in a playbook alternative's name that mean it's this one ("In-house dbt or SQL scripts" → in_house). */
  alias: RegExp;
}

export const ALTERNATIVE_SEEDS: AlternativeSeed[] = [
  {
    key: "alt:spreadsheets",
    name: "Spreadsheets",
    kind: "status_quo",
    category: "status_quo",
    patterns: [/\bspreadsheets?\b|\bexcel\b|\bgoogle sheets?\b|\bworkbooks?\b|\bvlookups?\b|\b(the|a) sheet\b/i],
    alias: /spreadsheet|excel|sheets?|vlookup|csv/i,
  },
  {
    key: "alt:in_house",
    name: "Build it in-house",
    kind: "in_house",
    category: "build",
    patterns: SEED_BY_KEY.get("objection:build")!.patterns,
    alias: /in[- ]house|internal|dbt|sql|script|build/i,
  },
  {
    key: "alt:hire",
    name: "Hire someone",
    kind: "hire",
    category: "team",
    patterns: SEED_BY_KEY.get("pain:headcount")!.patterns,
    alias: /hire|headcount|accountant|analyst|person|contractor/i,
  },
  {
    key: "alt:nothing",
    name: "Do nothing",
    kind: "nothing",
    category: "timing",
    patterns: [...SEED_BY_KEY.get("objection:timing")!.patterns, ...SEED_BY_KEY.get("objection:info")!.patterns],
    alias: /nothing|status quo|wait|later/i,
  },
];

/** A frame word in either case at the start of a sentence: "looked at" or "Looked at". */
const either = (frames: string[]) => frames.map((f) => `[${f[0].toUpperCase()}${f[0]}]${f.slice(1)}`).join("|");
const NAME = String.raw`([A-Z][A-Za-z0-9]{2,}(?:\s[A-Z][A-Za-z0-9]+)?)`;

/**
 * Tool names buyers bring up that the playbook doesn't know: "NetSuite already does this", "we looked at Orb",
 * "can't NetSuite do this?". Capitalized names in those frames only, so ordinary words and people are left alone.
 */
export const NAMED_TOOL = [
  new RegExp(String.raw`\b${NAME}(?:'s(?: [a-z]+){0,3})?\s+(?:already (?:does|covers|handles)|was supposed to|is supposed to|covers (?:this|it)\b|does this\b|handles this\b)`, "g"),
  new RegExp(String.raw`\b(?:${either(["looked at", "evaluated", "evaluating", "trialed", "switched to", "switching to", "moving to", "migrating to", "bundled with", "already use", "already pay for"])})\s+${NAME}`, "g"),
  new RegExp(String.raw`\b(?:${either(["can't", "couldn't", "wouldn't", "doesn't"])})\s+${NAME}\s+(?:do|cover|handle)\b`, "g"),
];

/** Capitalized words that are never a tool, whatever frame they sit in. */
export const NOT_A_TOOL = new Set(
  "I We You They He She It Our Their The This That Honestly Yes No Okay Ok Well So And But Then Monday Tuesday Wednesday Thursday Friday Saturday Sunday January February March April May June July August September October November December Q1 Q2 Q3 Q4 CEO CFO VP CTO COO".split(" "),
);
