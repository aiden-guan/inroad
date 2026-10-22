/**
 * Deal rules shared by the company sheet (client) and the prep/debrief workflows (server).
 * Pure functions only: stages, exit criteria, the qualification score, contact-path order.
 * Code decides these things; the model only suggests.
 */
import { daysBetween } from "@/lib/domain/ids";
import type {
  Account,
  ContactPath,
  Deal,
  Field,
  Jurisdiction,
  MeetingBrief,
  MutualActionPlan,
  Qualification,
  QualificationCard,
  Stage,
} from "@/lib/domain/types";

export const BOARD_STAGES: Stage[] = ["talking", "qualified", "pilot", "proposal", "won"];
export const STAGE_RANK: Record<Stage, number> = { talking: 0, qualified: 1, pilot: 2, proposal: 3, won: 4, lost: 5, nurture: 5 };

export const LOSS_REASONS: { value: NonNullable<Deal["lossReason"]>; label: string }[] = [
  { value: "no_pain", label: "No real pain" },
  { value: "no_budget", label: "No budget" },
  { value: "timing", label: "Bad timing" },
  { value: "competitor", label: "Chose a competitor" },
  { value: "build", label: "Building it themselves" },
  { value: "price", label: "Price" },
  { value: "product_gap", label: "Product gap" },
  { value: "went_dark", label: "Went dark" },
  { value: "not_icp", label: "Not a fit" },
];

/** A new deal at Talking: a deal starts at the first real conversation. Caller supplies id and time. */
export function newDeal(account: Account, id: string, at: string): Deal {
  return {
    id,
    accountDomain: account.domain,
    name: account.name,
    stage: "talking",
    stageHistory: [{ stage: "talking", at }],
    source: account.source === "founder_network" ? "network" : account.source === "referral" ? "referral" : account.source === "integration" ? "inbound" : "signal_cold",
    contacts: [],
    meetingIds: [],
    createdAt: at,
    updatedAt: at,
    lastActivityAt: at,
  };
}

/** A close date moved later: one push. Setting it the first time, or pulling it in, isn't. */
export function closeDatePushed(prev: string | undefined, next: string | undefined): boolean {
  return !!prev && !!next && next > prev;
}

/** Pilot to paid, read in code: how far the end date is, whether the ROI review is booked, and plan steps gone overdue. */
export interface PilotWatch {
  /** Days until `pilot.endsOn` (negative once it has passed); undefined without an end date. */
  endsIn?: number;
  roiBooked: boolean;
  /** Mutual action plan steps not done whose due date has passed, oldest first. */
  overdue: MutualActionPlan["milestones"];
}

export function pilotWatch(deal: Deal, today: string): PilotWatch {
  const endsOn = deal.pilot?.endsOn;
  return {
    endsIn: endsOn ? daysBetween(today, endsOn) : undefined,
    roiBooked: !!deal.checklist?.["pilot.roi"],
    overdue: (deal.map?.milestones ?? []).filter((m) => m.status !== "done" && m.due < today).sort((a, b) => a.due.localeCompare(b.due)),
  };
}

/* ─────────────────────────────── Qualification ─────────────────────────────── */

export const SCORED_FIELDS = ["pain", "spend", "criticalEvent", "champion", "economicBuyer", "fit"] as const;
export type ScoredField = (typeof SCORED_FIELDS)[number];
export type CardField = ScoredField | "decisionProcess";

export const FIELD_META: Record<CardField, { label: string; question: string; rubric?: [string, string, string] }> = {
  pain: { label: "Pain", question: "What hurts, in their words, and what it costs.", rubric: ["Vague", "Clear, not urgent", "Quantified and urgent"] },
  spend: { label: "Spend", question: "Money or headcount on this today.", rubric: ["None", "Some", "Significant"] },
  criticalEvent: { label: "Critical event", question: "A date it must be fixed by, and what happens if they miss it.", rubric: ["None", "Soft date", "Hard date with consequence"] },
  champion: { label: "Champion", question: "Feels the pain and has influence. Tested with a real ask.", rubric: ["None", "Coach", "Tested champion"] },
  economicBuyer: { label: "Economic buyer", question: "Who owns the budget, and have they engaged.", rubric: ["Unknown", "Identified", "Engaged"] },
  fit: { label: "Fit", question: "How well they match your ICP.", rubric: ["Poor", "Partial", "Strong"] },
  decisionProcess: { label: "Decision & paper process", question: "Criteria, steps between yes and signature, budget source, alternatives." },
};

const QUAL_KEY: Record<ScoredField, keyof Omit<Qualification, "total" | "qualified">> = {
  pain: "pain",
  spend: "spend",
  criticalEvent: "criticalEvent",
  champion: "champion",
  economicBuyer: "economicBuyer",
  fit: "icpFit",
};

export function scoreOf(q: Qualification | undefined, field: ScoredField): 0 | 1 | 2 {
  return q ? q[QUAL_KEY[field]] : 0;
}

export function emptyField(): Field {
  return { value: null, quotes: [], status: "not_covered" };
}

export function emptyCard(): QualificationCard {
  return {
    pain: emptyField(),
    spend: emptyField(),
    criticalEvent: emptyField(),
    champion: { ...emptyField(), championStatus: "none" },
    economicBuyer: emptyField(),
    fit: emptyField(),
    decisionProcess: emptyField(),
  };
}

export function hasDatedNextStep(nextStep: Deal["nextStep"] | { date?: string } | null | undefined, today: string): boolean {
  return !!nextStep?.date && nextStep.date >= today;
}

/** Qualified = total ≥ 8 of 12 AND a dated next step. */
export function computeQualification(scores: Record<ScoredField, 0 | 1 | 2>, datedNextStep: boolean): Qualification {
  const total = SCORED_FIELDS.reduce((n, f) => n + scores[f], 0);
  return {
    pain: scores.pain,
    spend: scores.spend,
    criticalEvent: scores.criticalEvent,
    champion: scores.champion,
    economicBuyer: scores.economicBuyer,
    icpFit: scores.fit,
    total,
    qualified: total >= 8 && datedNextStep,
  };
}

export function scoresFrom(q: Qualification | undefined): Record<ScoredField, 0 | 1 | 2> {
  return {
    pain: q?.pain ?? 0,
    spend: q?.spend ?? 0,
    criticalEvent: q?.criticalEvent ?? 0,
    champion: q?.champion ?? 0,
    economicBuyer: q?.economicBuyer ?? 0,
    fit: q?.icpFit ?? 0,
  };
}

/**
 * Keeps a field's score honest with what was captured: nothing captured scores 0; a tested
 * champion is the only 2; a critical event needs a date and a consequence to score 2.
 */
export function clampScore(field: ScoredField, card: QualificationCard, score: 0 | 1 | 2): 0 | 1 | 2 {
  const f = card[field];
  if (f.status === "not_covered" || !f.value) return 0;
  if (field === "champion") {
    const status = card.champion.championStatus ?? "none";
    if (status === "none") return 0;
    if (status !== "tested") return Math.min(score, 1) as 0 | 1;
  }
  if (field === "economicBuyer" && score === 2 && !card.economicBuyer.engaged) return 1;
  if (field === "criticalEvent" && score === 2 && !(card.criticalEvent.date && card.criticalEvent.consequence)) return 1;
  if (f.status === "partial") return Math.min(score, 1) as 0 | 1;
  return score;
}

/* ─────────────────────────────── Exit criteria ─────────────────────────────── */

export interface Criterion {
  key: string;
  label: string;
  met: boolean;
  /** Ticked by the founder rather than derived from data. */
  manual: boolean;
  /** How to make it true, shown when it isn't. */
  hint?: string;
}

/** What must be true for a deal to be at `stage` (SPEC W8 stage exit criteria). */
export function stageCriteria(stage: Stage, deal: Deal, today: string): Criterion[] {
  const card = deal.card;
  const q = deal.qualification;
  const check = (key: string) => !!deal.checklist?.[key];
  switch (stage) {
    case "talking":
      return [{ key: "talking.meeting", label: "Meeting booked or held", met: deal.meetingIds.length > 0, manual: false, hint: "Add the meeting below." }];
    case "qualified":
      return [
        {
          key: "qualified.pain",
          label: "Pain and impact captured",
          met: !!card && card.pain.status === "captured" && (!!card.pain.impact || (q?.pain ?? 0) === 2),
          manual: false,
          hint: "Quantify what it costs them.",
        },
        { key: "qualified.event", label: "Critical event captured", met: !!card && card.criticalEvent.status !== "not_covered" && !!card.criticalEvent.value, manual: false, hint: "Ask what date it has to be fixed by." },
        {
          key: "qualified.champion",
          label: "Champion identified",
          met: !!card && (card.champion.championStatus === "untested" || card.champion.championStatus === "tested"),
          manual: false,
          hint: "Find who feels the pain and has influence.",
        },
        { key: "qualified.score", label: "Score 8 of 12 or more", met: (q?.total ?? 0) >= 8, manual: false, hint: `Now ${q?.total ?? 0} of 12.` },
        { key: "qualified.nextStep", label: "Dated next step", met: hasDatedNextStep(deal.nextStep, today), manual: false, hint: "Book it before you hang up." },
      ];
    case "pilot":
      return [
        { key: "pilot.criteria", label: "Success criteria agreed in writing", met: !!deal.pilot?.criteria && check("pilot.criteria"), manual: true, hint: "Write them below, then get a yes in writing." },
        { key: "pilot.fee", label: "Fee agreed (or design-partner terms signed)", met: (deal.pilot?.paid && (deal.pilot.feeUsd ?? 0) > 0) || check("pilot.fee"), manual: true },
        { key: "pilot.roi", label: "ROI review meeting booked", met: check("pilot.roi"), manual: true, hint: "Book it at kickoff." },
      ];
    case "proposal":
      return [
        { key: "proposal.sent", label: "Proposal or order form sent", met: check("proposal.sent"), manual: true },
        { key: "proposal.eb", label: "Economic buyer engaged", met: !!card?.economicBuyer.engaged || (q?.economicBuyer ?? 0) === 2, manual: false, hint: "Get the budget owner into a call." },
        { key: "proposal.map", label: "Mutual action plan agreed", met: !!deal.map?.milestones.length && check("proposal.map"), manual: true, hint: "Review the plan with them." },
      ];
    case "won":
      return [{ key: "won.signed", label: "Signed or paid", met: check("won.signed"), manual: true }];
    case "lost":
      return [{ key: "lost.reason", label: "Reason recorded", met: !!deal.lossReason, manual: false }];
    case "nurture":
      return [{ key: "nurture.date", label: "Re-engage date set", met: !!deal.nurtureUntil, manual: false }];
  }
}

export function missingCriteria(stage: Stage, deal: Deal, today: string): Criterion[] {
  return stageCriteria(stage, deal, today).filter((c) => !c.met);
}

export function nextStage(stage: Stage): Stage | null {
  const i = BOARD_STAGES.indexOf(stage);
  return i >= 0 && i < BOARD_STAGES.length - 1 ? BOARD_STAGES[i + 1] : null;
}

/* ─────────────────────────────── People & paths ─────────────────────────────── */

/** Someone who knows the founder beats any address; a guessed address is the last resort before LinkedIn. */
export const PATH_RANK: Record<ContactPath["kind"], number> = {
  warm_intro: 0,
  published_email: 1,
  role_inbox: 2,
  integration: 3,
  pattern_guess: 4,
  linkedin: 5,
};

export function rankPaths(paths: ContactPath[]): ContactPath[] {
  return [...paths].sort((a, b) => PATH_RANK[a.kind] - PATH_RANK[b.kind] || Number(b.verified) - Number(a.verified));
}

export const PATH_LABEL: Record<ContactPath["kind"], string> = {
  warm_intro: "Warm path",
  published_email: "Published email",
  role_inbox: "Role inbox",
  integration: "From your tools",
  pattern_guess: "Guessed email · unverified",
  linkedin: "LinkedIn",
};

const EU = /\b(germany|deutschland|france|spain|españa|italy|italia|netherlands|holland|belgium|ireland|sweden|denmark|finland|norway|poland|portugal|austria|czech|estonia|latvia|lithuania|greece|hungary|romania|bulgaria|croatia|slovakia|slovenia|luxembourg|malta|cyprus|berlin|munich|paris|madrid|barcelona|amsterdam|dublin|stockholm|copenhagen|helsinki|lisbon|vienna|warsaw|prague|milan|rome|brussels|zurich|switzerland|eu)\b/i;
const UK = /\b(uk|united kingdom|england|scotland|wales|london|manchester|edinburgh|bristol|cambridge, uk|oxford)\b/i;
const CA = /\b(canada|toronto|vancouver|montreal|ottawa|calgary|waterloo|ontario|quebec|british columbia)\b/i;
const US = /\b(usa|u\.s\.|united states|new york|nyc|san francisco|bay area|seattle|austin|boston|chicago|los angeles|denver|miami|atlanta|palo alto|mountain view|menlo park|brooklyn|remote \(us\))\b/i;
const US_STATE = /\b[A-Z][a-z]+,\s(CA|NY|TX|WA|MA|IL|CO|FL|GA|NC|VA|OR|UT|AZ|PA|NJ|MN|OH|MI|DC)\b/;

/** Jurisdiction follows the person's stated location, else the company HQ, else "unknown". */
export function jurisdictionOf(location: string | null | undefined): Jurisdiction {
  if (!location) return "unknown";
  if (UK.test(location)) return "UK";
  if (CA.test(location)) return "CA";
  if (EU.test(location)) return "EU";
  if (US.test(location) || US_STATE.test(location)) return "US";
  return "other";
}

/* ─────────────────────────────── Meetings ─────────────────────────────── */

export type CallType = MeetingBrief["callType"];

export const CALL_TYPE_LABEL: Record<CallType, string> = {
  first_discovery: "First discovery",
  follow_up: "Follow-up",
  demo: "Demo",
  technical: "Technical",
  pilot_review: "Pilot review",
  negotiation: "Negotiation",
};

/** Call type from the invite title, the stage and whether a call has already happened. Code decides, not the model. */
export function detectCallType(title: string, stage: Stage, priorDebriefs: number): CallType {
  const t = title.toLowerCase();
  if (/\b(pricing|proposal|negotiat|contract|order form|terms|procurement)/.test(t) || stage === "proposal") return "negotiation";
  if (/\b(pilot|roi|check[- ]?in|kickoff|kick-off)\b/.test(t) && (stage === "pilot" || stage === "qualified")) return "pilot_review";
  if (/\b(security|technical|architecture|deep[- ]?dive|integration|engineering|it review)\b/.test(t)) return "technical";
  if (/\bdemo\b/.test(t)) return "demo";
  if (priorDebriefs === 0 && stage === "talking") return "first_discovery";
  if (stage === "pilot") return "pilot_review";
  return "follow_up";
}

/** Speaker labels or timestamps on several lines → a transcript; otherwise the founder's notes. */
export function looksLikeTranscript(text: string): boolean {
  const lines = text.split(/\n+/).filter((l) => l.trim());
  if (lines.length < 4) return false;
  const labelled = lines.filter((l) => /^\s*(\[?\(?\d{1,2}:\d{2}(:\d{2})?\]?\)?\s*[-–]?\s*)?[A-Z][\p{L}.'’ -]{0,40}(\s\(\d{1,2}:\d{2}(:\d{2})?\))?\s*:\s+\S/u.test(l));
  const stamped = lines.filter((l) => /^\s*\[?\d{1,2}:\d{2}(:\d{2})?\]?/.test(l));
  return labelled.length >= Math.min(6, Math.ceil(lines.length * 0.4)) || stamped.length >= Math.min(6, Math.ceil(lines.length * 0.4));
}

/* ─────────────────────────────── Text ─────────────────────────────── */

export const RECAP_CLOSE = "Did I miss or misstate anything?";

export function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

/** Plain text a founder can paste into a doc to review the plan with the buyer. */
export function mapToMarkdown(map: MutualActionPlan, account: string, company: string | undefined): string {
  const owner = (m: MutualActionPlan["milestones"][number]) =>
    m.ownerName ? `${m.ownerName} (${m.ownerSide === "seller" ? company ?? "us" : m.ownerSide === "buyer" ? account : "both"})` : m.ownerSide === "seller" ? company ?? "Us" : m.ownerSide === "buyer" ? account : "Both";
  const rows = map.milestones.map((m, i) => `| ${i + 1} | ${m.step.replace(/\|/g, "/")} | ${owner(m)} | ${m.due} | ${m.status === "done" ? "Done" : m.status === "blocked" ? "Blocked" : "To do"} |`);
  return [
    `# ${account} + ${company ?? "us"}: mutual action plan`,
    "",
    `Goal: ${map.goal}`,
    `Target date: ${map.targetDate}`,
    "",
    "| # | Milestone | Owner | Due | Status |",
    "|---|---|---|---|---|",
    ...rows,
    "",
    "Draft for us to review together. Edit anything that's wrong.",
  ].join("\n");
}
