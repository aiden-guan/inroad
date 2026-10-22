/**
 * Playbook logic that code can do without a model: provenance, plan math, price anchors, bet
 * progress, asset checks and the Markdown export. Pure and isomorphic — the asset workflow imports
 * it on the server, the Playbook imports it in the browser.
 */
import { addDays, daysBetween } from "@/lib/domain/ids";
import type {
  Asset,
  ChannelPlan,
  CommercialDefault,
  Competitor,
  Deal,
  DetectionMethod,
  Foundation,
  ICP,
  MessagingTree,
  Motion,
  ObjectionCard,
  PersonaRole,
  Positioning,
  SignalType,
  ValueTheme,
  Workspace,
} from "@/lib/domain/types";
import { introAsksTarget, isColdFirstTouch } from "@/lib/moves/scoreboard";

/* ───────────────────────────── Navigation ───────────────────────────── */

export const SECTIONS = [
  {
    id: "who",
    label: "Who",
    children: [
      { id: "icp", label: "Segment bet" },
      { id: "criteria", label: "Criteria" },
      { id: "anti-icp", label: "Not a fit" },
      { id: "personas", label: "Personas" },
    ],
  },
  {
    id: "why",
    label: "Why us",
    children: [
      { id: "positioning", label: "Positioning" },
      { id: "messaging", label: "Messaging" },
      { id: "claims", label: "Claims" },
      { id: "competitors", label: "Competitors" },
    ],
  },
  {
    id: "how",
    label: "How we sell",
    children: [
      { id: "plan", label: "Plan" },
      { id: "motions", label: "Channels" },
      { id: "commercial", label: "Pricing & terms" },
      { id: "objections", label: "Objections" },
      { id: "assets", label: "Assets" },
      { id: "design-partners", label: "Design partners" },
    ],
  },
  {
    id: "voice",
    label: "Voice",
    children: [
      { id: "voice-card", label: "How you write" },
      { id: "povs", label: "Points of view" },
    ],
  },
  {
    id: "journal",
    label: "Journal",
    children: [
      { id: "questions", label: "Questions" },
      { id: "reviews", label: "Reviews" },
      { id: "bets", label: "Segment bets" },
    ],
  },
] as const;

export type SectionId = (typeof SECTIONS)[number]["id"];
export const SECTION_IDS: SectionId[] = SECTIONS.map((s) => s.id);

/* ───────────────────────────── Labels ───────────────────────────── */

export const ROLE_LABELS: Record<PersonaRole, string> = {
  champion: "Champion",
  economic_buyer: "Economic buyer",
  technical_approver: "Technical approver",
  user: "User",
  blocker: "Blocker",
};

export const MOTION_LABELS: Record<Motion, string> = {
  warm_network: "Warm network and users",
  signal_cold: "Signal-based cold email",
  investor_intros: "Investor and advisor intros",
  communities: "Communities",
  founder_content: "Founder content",
  exec_dinners: "Roundtables and dinners",
  design_partner_program: "Design-partner program",
  launches: "Launches",
};

export const SIGNAL_LABELS: Record<SignalType, string> = {
  champion_job_change: "Champion changed jobs",
  first_hire: "First hire for the role",
  jd_names_pain: "Job post names the pain",
  new_leader: "New leader",
  funding: "Raised a round",
  stack_change: "Stack change",
  launch: "Launch",
  compliance_deadline: "Compliance deadline",
  persona_post: "Persona posted about it",
  community_request: "Asked for help in a community",
  public_pain: "Public complaint",
  filing: "Filing",
  hiring: "Hiring",
  sensitive: "Sensitive",
};

export const DETECTION_LABELS: Record<DetectionMethod, string> = {
  job_posts: "job posts",
  form_d: "Form D filings",
  press: "press",
  site: "their site",
  yc_directory: "YC directory",
  github: "GitHub",
  dns: "DNS",
  hn: "Hacker News",
  founder_knowledge: "you",
};

export const CATEGORY_STYLES: Record<Positioning["category"]["style"], { label: string; hint: string }> = {
  head_to_head: { label: "Head to head", hint: "An existing category you can win outright." },
  big_fish_small_pond: { label: "Big fish, small pond", hint: "Win a subsegment of an existing category." },
  new_game: { label: "New game", hint: "Only if no category explains you and you can afford to educate the market." },
};

export const ALT_KIND_LABELS: Record<Positioning["alternatives"][number]["kind"], string> = {
  status_quo: "Status quo",
  in_house: "Build in-house",
  hire: "Hire someone",
  competitor: "Competitor",
};

export const OBJECTION_CATEGORIES: Record<ObjectionCard["category"], string> = {
  timing: "Timing",
  budget: "Budget",
  status_quo: "Status quo",
  build: "Build",
  competitor: "Competitor",
  startup_risk: "Startup risk",
  security: "Security",
  priority: "Priority",
  info_request: "Send info",
  team: "Team",
};

export const STRUCTURE_LABELS: Record<CommercialDefault["structure"], { label: string; hint: string }> = {
  paid_pilot: { label: "Paid pilot", hint: "The product works; the buyer needs proof on their data." },
  paid_design_partner: { label: "Paid design partner", hint: "Pre-launch or v0. 10–20% upfront, 2–6 months." },
  annual_with_opt_out: { label: "Annual with opt-out", hint: "Once you have 2+ references. 30- or 60-day opt-out." },
};

export type AssetKind = Asset["kind"];

/** `noun` carries its article: "Drafting a one-pager", "Drafting design-partner terms". */
export const ASSET_KINDS: Record<AssetKind, { label: string; noun: string; description: string }> = {
  one_pager: { label: "One-pager", noun: "a one-pager", description: "The problem in your buyer's words, three outcomes, and how a pilot works." },
  demo_script: { label: "Demo script", noun: "a demo script", description: "Two minutes, with the buyer as the protagonist and their data on screen." },
  security: { label: "Security posture", noun: "a security page", description: "Only what you've confirmed. Everything else reads “Ask us”." },
  design_partner_terms: { label: "Design-partner terms", noun: "design-partner terms", description: "Paid, time-boxed, with a written conversion date and price." },
  pilot_proposal: { label: "Pilot proposal", noun: "a pilot proposal", description: "One page and an order form, built from a deal's qualification card." },
  insight: { label: "Insight memo", noun: "an insight memo", description: "What you learned from 10+ calls, anonymized. Good to offer instead of a meeting." },
  case_study: { label: "Case study", noun: "a case study", description: "Built only from approved customer claims." },
  other: { label: "Document", noun: "a document", description: "Anything else you send buyers." },
};

export const MIN_INSIGHT_CALLS = 10;

/** Hard requirements per kind, checked in code before any tokens are spent (and shown as the reason a button is off). */
export function assetGate(ws: Workspace, a: { kind: AssetKind; dealId?: string }): string | null {
  if (!ws.foundation) return "Your playbook isn't written yet. Finish the first read of your site, then draft documents from it.";
  if (a.kind === "pilot_proposal") {
    if (!a.dealId) return "Pick the deal this pilot proposal is for.";
    if (!ws.deals[a.dealId]) return "That deal no longer exists.";
  }
  if (a.kind === "insight") {
    const n = debriefCount(ws);
    if (n < MIN_INSIGHT_CALLS) return `An insight memo needs at least ${MIN_INSIGHT_CALLS} debriefed calls, so every pattern is real. You have ${n}.`;
  }
  if (a.kind === "case_study" && !ws.claims.some((c) => c.approved && (c.kind === "customer" || c.kind === "metric"))) {
    return "A case study needs an approved customer or metric claim first. Approve one under Why us → Claims.";
  }
  return null;
}

/** Kinds the founder can create from the New menu, in the order a founder usually needs them. */
export const CREATABLE_KINDS: AssetKind[] = ["one_pager", "pilot_proposal", "demo_script", "security", "design_partner_terms", "insight", "case_study"];

export const BAND_LABELS: Record<NonNullable<ICP["employeeBand"]>, string> = {
  lt50: "Under 50",
  "50_300": "50–300",
  gt300: "300+",
  mixed: "Mixed",
};

/* ───────────────────────────── Small helpers ───────────────────────────── */

export function words(text: string | undefined | null): number {
  return (text ?? "").trim().split(/\s+/).filter(Boolean).length;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function pct(n: number): string {
  const v = n * 100;
  return `${Number.isInteger(v) ? v : v.toFixed(1)}%`;
}

export function usdRange([lo, hi]: [number, number]): string {
  const k = (n: number) => (n >= 1000 ? `$${Number((n / 1000).toFixed(1))}K` : `$${n}`);
  return `${k(lo)}–${k(hi).replace("$", "")}`;
}

/** Foundation sections can be partially written while the first-run bet streams in. */
export function parts(f: Foundation) {
  const positioning: Positioning = {
    alternatives: f.positioning?.alternatives ?? [],
    differentiators: f.positioning?.differentiators ?? [],
    valueThemes: f.positioning?.valueThemes ?? [],
    bestFit: f.positioning?.bestFit ?? [],
    category: f.positioning?.category ?? { name: "", style: "head_to_head", why: "" },
  };
  const icp: ICP = {
    hypothesis: f.icp?.hypothesis ?? { companyGroup: "", role: "", obstacle: "", cause: "", improvement: "", sentence: "" },
    primarySegment: f.icp?.primarySegment ?? "",
    testSlices: f.icp?.testSlices ?? [],
    criteria: f.icp?.criteria ?? [],
    antiIcp: f.icp?.antiIcp ?? [],
    triggers: f.icp?.triggers ?? [],
    segmentLockedAt: f.icp?.segmentLockedAt,
    employeeBand: f.icp?.employeeBand,
    betHistory: f.icp?.betHistory ?? [],
  };
  const messaging: MessagingTree = {
    oneLiner: f.messaging?.oneLiner ?? "",
    themes: f.messaging?.themes ?? [],
    byPersona: f.messaging?.byPersona ?? [],
    bySignal: f.messaging?.bySignal ?? [],
    customerWords: f.messaging?.customerWords ?? [],
    bannedWords: f.messaging?.bannedWords ?? [],
  };
  const channelPlan: ChannelPlan | null = f.channelPlan?.motions?.length ? f.channelPlan : null;
  const commercial: CommercialDefault = {
    structure: f.commercial?.structure ?? "paid_pilot",
    terms: f.commercial?.terms ?? "",
    priceAnchor: f.commercial?.priceAnchor ?? "",
    discountRule: f.commercial?.discountRule ?? "",
    daysToFirstValue: f.commercial?.daysToFirstValue,
  };
  const competitors: Competitor[] = f.competitors ?? [];
  return { positioning, icp, messaging, channelPlan, commercial, competitors, personas: f.personas ?? [], founderQuestions: f.founderQuestions ?? [] };
}

/** "{group} where {role} struggles with {obstacle} because {cause}; we deliver {improvement}." */
export function hypothesisSentence(h: ICP["hypothesis"]): string {
  const slot = (s: string) => s.trim().replace(/[.;]+$/, "");
  return `${slot(h.companyGroup)} where ${slot(h.role)} struggles with ${slot(h.obstacle)} because ${slot(h.cause)}; we deliver ${slot(h.improvement)}.`;
}

/* ───────────────────────────── Provenance ───────────────────────────── */

function debriefed(ws: Workspace) {
  return Object.values(ws.meetings)
    .filter((m) => m.debrief)
    .map((m) => ({ meeting: m, debrief: m.debrief!, deal: ws.deals[m.dealId] as Deal | undefined }));
}

export function debriefCount(ws: Workspace): number {
  return debriefed(ws).length;
}

export interface Provenance {
  site: boolean;
  answers: number;
  confirming: number;
  /** "From your site + 2 answers · 0 conversations confirm this" */
  label: string;
  isBet: boolean;
}

/**
 * Bets stay bets until calls confirm them. A call confirms the ICP when the debrief scored fit 2/2,
 * the value story when it scored pain 2/2, and a persona when someone in that role was on the deal.
 */
export function provenance(ws: Workspace, scope: "who" | "why" | "how" | { role: PersonaRole }): Provenance {
  const calls = debriefed(ws);
  let confirming = 0;
  if (scope === "who") confirming = calls.filter((c) => c.debrief.qualification.icpFit === 2).length;
  else if (scope === "why") confirming = calls.filter((c) => c.debrief.qualification.pain === 2).length;
  else if (scope === "how") confirming = calls.filter((c) => c.debrief.qualification.total >= 8).length;
  else {
    const role = scope.role;
    confirming = calls.filter(
      (c) => c.debrief.committeeUpdates.some((u) => u.role === role) || c.deal?.contacts.some((x) => x.role === role),
    ).length;
  }
  const site = !!ws.company;
  const answers = (ws.foundation?.founderQuestions ?? []).filter((q) => q.answer).length;
  const from = [site ? "your site" : null, answers ? plural(answers, "answer") : null].filter(Boolean).join(" + ");
  const label =
    confirming > 0
      ? `${from ? `From ${from} · ` : ""}Confirmed in ${plural(confirming, "call")}`
      : `${from ? `From ${from} · ` : ""}0 conversations confirm this`;
  return { site, answers, confirming, label, isBet: confirming === 0 };
}

/* ───────────────────────────── Plan math ───────────────────────────── */

/** Replace a default with the founder's own rate only once there are 20 data points. */
export const OBSERVED_MIN_N = 20;

export const PLAN_DEFAULTS = { introAsksPerWeek: 4, introToMeeting: 0.35, communityPerWeek: 0 } as const;

export interface Rate {
  value: number;
  source: "default" | "observed";
  n: number;
}

export interface PlanMath {
  weeksLeft: number;
  byDate: string;
  target: number;
  targetLabel: string;
  cold: { perWeek: number; rate: Rate; meetings: number };
  intro: { perWeek: number; rate: Rate; meetings: number };
  community: { perWeek: number; meetings: number };
  meetingsPerWeek: number;
  discoveryToQualified: Rate;
  qualifiedToPaid: Rate;
  paidSoFar: number;
  /** Paid so far + what the weekly capacity produces by the date. */
  projected: number;
  gap: number;
  levers: { introAsksPerWeek: number | null; byDate: string | null };
  conversationsPerWeek: number;
  warm: { atIcp: number; buyerTitles: number; weeksOfAsks: number | null } | null;
}

function rate(defaultValue: number, hits: number, n: number): Rate {
  return n >= OBSERVED_MIN_N ? { value: hits / n, source: "observed", n } : { value: defaultValue, source: "default", n };
}

function reached(deal: Deal, stages: Deal["stage"][]): boolean {
  return stages.includes(deal.stage) || deal.stageHistory.some((h) => stages.includes(h.stage));
}

export function isPaid(deal: Deal): boolean {
  return deal.stage === "won" || deal.pilot?.paid === true;
}

/**
 * The goal is an output of capacity, not a wish:
 *   meetings/week = cold × cold-meeting rate + intro asks × intro-to-meeting rate + community conversations
 *   paid = paid so far + meetings/week × weeks left × discovery→qualified × qualified→paid
 * Levers never include more cold volume than the cap.
 */
export function planMath(ws: Workspace, today: string): PlanMath {
  const deals = Object.values(ws.deals);
  const coldN = ws.activities.filter((a) => isColdFirstTouch(ws, a)).length;
  const coldMeetings = deals.filter((d) => d.source === "signal_cold").length;
  const introN = ws.activities.filter((a) => a.kind === "intro_requested").length;
  const introMeetings = deals.filter((d) => d.source === "warm_intro" || d.source === "investor_intro").length;
  const qualifiedDeals = deals.filter((d) => reached(d, ["qualified", "pilot", "proposal", "won"]));
  const paidDeals = deals.filter(isPaid);

  const coldRate = rate(ws.goal.meetingRate, coldMeetings, coldN);
  const introRate = rate(PLAN_DEFAULTS.introToMeeting, introMeetings, introN);
  const d2q = rate(ws.goal.discoveryToQualified, qualifiedDeals.length, deals.length);
  const q2p = rate(ws.goal.winRate, paidDeals.filter((d) => reached(d, ["qualified", "pilot", "proposal", "won"])).length, qualifiedDeals.length);

  const coldPerWeek = ws.caps.firstTouchesPerWeek;
  // The same number Today chases: the founder's setting, else the bet's channel plan, else the default.
  const introPerWeek = introAsksTarget(ws);
  const communityPerWeek = ws.goal.communityPerWeek ?? PLAN_DEFAULTS.communityPerWeek;
  const cold = { perWeek: coldPerWeek, rate: coldRate, meetings: coldPerWeek * coldRate.value };
  const intro = { perWeek: introPerWeek, rate: introRate, meetings: introPerWeek * introRate.value };
  const community = { perWeek: communityPerWeek, meetings: communityPerWeek };
  const meetingsPerWeek = cold.meetings + intro.meetings + community.meetings;

  const weeksLeft = Math.max(0, Math.ceil(daysBetween(today, ws.goal.byDate) / 7));
  const yieldPerMeeting = d2q.value * q2p.value;
  const projected = paidDeals.length + meetingsPerWeek * weeksLeft * yieldPerMeeting;
  const gap = Math.max(0, ws.goal.target - projected);

  let introLever: number | null = null;
  let dateLever: string | null = null;
  if (gap > 0.05 && yieldPerMeeting > 0) {
    if (weeksLeft > 0 && introRate.value > 0) {
      const extraMeetings = gap / (weeksLeft * yieldPerMeeting);
      const asks = introPerWeek + Math.ceil(extraMeetings / introRate.value);
      if (asks <= 20) introLever = asks;
    }
    if (meetingsPerWeek > 0) {
      const extraWeeks = Math.ceil(gap / (meetingsPerWeek * yieldPerMeeting));
      if (extraWeeks <= 52) dateLever = addDays(weeksLeft > 0 ? ws.goal.byDate : today, extraWeeks * 7);
    }
  }

  const net = ws.network;
  const warm = net ? { atIcp: net.atIcpCompanies, buyerTitles: net.buyerTitles, weeksOfAsks: introPerWeek > 0 ? Math.floor(net.atIcpCompanies / introPerWeek) : null } : null;

  return {
    weeksLeft,
    byDate: ws.goal.byDate,
    target: ws.goal.target,
    targetLabel: ws.goal.targetLabel,
    cold,
    intro,
    community,
    meetingsPerWeek,
    discoveryToQualified: d2q,
    qualifiedToPaid: q2p,
    paidSoFar: paidDeals.length,
    projected,
    gap,
    levers: { introAsksPerWeek: introLever, byDate: dateLever },
    conversationsPerWeek: Math.max(1, Math.ceil(meetingsPerWeek)),
    warm,
  };
}

/* ───────────────────────────── Pricing ───────────────────────────── */

/** Inroad starting heuristics by the buyer's size. Not sourced; the quote log replaces them after 5 quotes. */
export const PRICE_BANDS: Record<"lt50" | "50_300" | "gt300", { annual: [number, number]; pilot: [number, number]; note?: string }> = {
  lt50: { annual: [5_000, 25_000], pilot: [1_000, 5_000] },
  "50_300": { annual: [15_000, 60_000], pilot: [5_000, 15_000] },
  gt300: { annual: [50_000, 150_000], pilot: [10_000, 30_000], note: "Enterprise first deals usually start at $75–150K. Avoid $10K “feedback” deals: they make the next $100K deal hard to justify." },
};

export const QUOTES_TO_REPLACE = 5;

export function priceBand(ws: Workspace): { band: "lt50" | "50_300" | "gt300"; assumed: boolean } {
  const b = ws.foundation?.icp?.employeeBand;
  if (b && b !== "mixed") return { band: b, assumed: false };
  return { band: "50_300", assumed: true };
}

export function quoteLog(ws: Workspace) {
  const quotes = Object.values(ws.deals)
    .flatMap((d) => (d.priceQuotes ?? []).map((q) => ({ ...q, deal: d.name, dealId: d.id })))
    .sort((a, b) => b.at.localeCompare(a.at));
  const amounts = quotes.map((q) => q.amountUsd).sort((a, b) => a - b);
  const median = amounts.length ? amounts[Math.floor((amounts.length - 1) / 2)] : null;
  return {
    quotes,
    median,
    min: amounts[0] ?? null,
    max: amounts[amounts.length - 1] ?? null,
    accepted: quotes.filter((q) => q.outcome === "accepted").length,
    pushback: quotes.filter((q) => q.outcome === "pushback").length,
    lost: quotes.filter((q) => q.outcome === "lost").length,
    replacesHeuristic: quotes.length >= QUOTES_TO_REPLACE,
  };
}

/** Pilot length = max(14, 2 × days to first value), capped at 45. */
export function pilotDays(c: Pick<CommercialDefault, "daysToFirstValue"> | undefined): number {
  const d = c?.daysToFirstValue;
  if (!d || d <= 0) return 14;
  return Math.min(45, Math.max(14, Math.round(2 * d)));
}

/* ───────────────────────────── Segment bet ───────────────────────────── */

export const BET_TOUCHES = 25;

export function betProgress(ws: Workspace, since: string | undefined) {
  if (!since) return null;
  const touches = ws.activities.filter((a) => a.at >= since && isColdFirstTouch(ws, a)).length;
  const positiveReplies = ws.activities.filter((a) => a.at >= since && a.kind === "reply_received" && a.sentiment === "positive").length;
  const meetings = Object.values(ws.deals).filter((d) => d.createdAt >= since).length;
  return { touches, positiveReplies, meetings, due: touches >= BET_TOUCHES };
}

/* ───────────────────────────── Next action ───────────────────────────── */

export interface NextAction {
  text: string;
  cta: string;
  anchor: string;
}

/** The single most useful thing the founder can do on this page right now, or nothing. */
export function nextAction(ws: Workspace): NextAction | null {
  const f = ws.foundation;
  if (!f) return null;
  const p = parts(f);
  const open = p.founderQuestions.filter((q) => !q.answer);
  if (open.length) return { text: `${open.length === 1 ? "One answer" : `${open.length} answers`} from you would change this bet more than anything I can read.`, cta: open.length === 1 ? "Answer it" : "Answer them", anchor: "questions" };
  const draftClaims = ws.claims.filter((c) => !c.approved);
  if (draftClaims.length) return { text: `${plural(draftClaims.length, "claim")} about ${ws.company?.name ?? "you"} ${draftClaims.length === 1 ? "is" : "are"} waiting. Until you approve them, I write outreach without them.`, cta: "Review claims", anchor: "claims" };
  const progress = betProgress(ws, p.icp.segmentLockedAt);
  if (progress?.due) return { text: `Your segment bet reached ${BET_TOUCHES} touches. Time to decide: keep it, adjust it or switch.`, cta: "Decide", anchor: "icp" };
  if (!p.icp.segmentLockedAt && p.icp.primarySegment) return { text: "Bet on one segment for the next 25 touches, so the replies tell you something.", cta: "Lock the bet", anchor: "icp" };
  if (!ws.povs.length) return { text: "Every cold email needs a point of view only you have. Add your first one.", cta: "Add a point of view", anchor: "povs" };
  const draftObjections = ws.objections.filter((o) => !o.approved);
  if (draftObjections.length) return { text: `${plural(draftObjections.length, "objection response")} ${draftObjections.length === 1 ? "needs" : "need"} your eye before I use ${draftObjections.length === 1 ? "it" : "them"} in call prep.`, cta: "Review", anchor: "objections" };
  if (!ws.assets.some((a) => a.approved)) return { text: "Your emails can offer a one-pager once you have an approved one.", cta: "Make a one-pager", anchor: "assets" };
  return null;
}

/* ───────────────────────────── Proof ───────────────────────────── */

/**
 * Proof status is computed, not trusted from the stored flag: a link to a claim counts only while
 * that claim is approved, so withdrawing or removing it un-proves the theme (and re-approving restores it).
 */
export function proofCounts(ws: Pick<Workspace, "claims">, p: ValueTheme["proof"][number]): boolean {
  return !p.claimId || ws.claims.some((c) => c.id === p.claimId && c.approved);
}

export function themeNeedsProof(ws: Pick<Workspace, "claims">, t: Pick<ValueTheme, "needsProof" | "proof">): boolean {
  return t.needsProof || !t.proof.some((p) => proofCounts(ws, p));
}

/* ───────────────────────────── Asset checks ───────────────────────────── */

export const PLACEHOLDER = /\[\[([^\]\n]{1,80})\]\]/g;

/** `[[pilot fee]]` markers the founder still has to fill. */
export function placeholders(body: string): string[] {
  const out = new Set<string>();
  for (const m of body.matchAll(PLACEHOLDER)) out.add(m[1].trim());
  return [...out];
}

/** Numbers that read as claims: money, percentages, multiples and counts of things. */
const CLAIM_NUMBER =
  /(\$\s?\d[\d,.]*\s?[kmb]?\b|\b\d[\d,.]*\s?(?:%|x\b|×)|\b\d[\d,.]*\+?\s+(?:customers|clients|teams|companies|users|engineers|people|accounts|deals|calls|interviews|hours|days|weeks|months)\b)/gi;

type Unit = "money" | "percent" | "multiple" | "count";
/** A count must be stated with its noun in a source: "40 hours" needs "40 hours", not just any 40. */
const proofKey = (value: number, noun: string) => `${value} ${noun.toLowerCase().replace(/s$/, "")}`;

function toValue(raw: string, suffix?: string): number {
  const n = Number(raw.replace(/,/g, ""));
  const s = (suffix ?? "").toLowerCase();
  return s === "k" ? n * 1_000 : s === "m" ? n * 1_000_000 : s === "b" ? n * 1_000_000_000 : n;
}

/**
 * Every number in the sources, keyed by unit, so "40 hours" can't vouch for "40%". Percents of
 * something ("10–20% of contract value") are kept apart: a pricing rule never vouches for an outcome.
 */
function knownValues(text: string): Record<Exclude<Unit, "count">, Set<number>> & { share: Set<number>; proof: Set<string> } {
  const out = { money: new Set<number>(), percent: new Set<number>(), share: new Set<number>(), multiple: new Set<number>(), proof: new Set<string>() };
  for (const m of text.matchAll(/(\d[\d,.]*)\+?\s+(customers?|clients?|teams?|companies|company|users?|accounts?)\b/gi)) out.proof.add(proofKey(toValue(m[1]), m[2].replace(/ies$/i, "y")));
  // Both ends of a range count, and "30-day" vouches for "30 days".
  for (const m of text.matchAll(/(\d[\d,.]*)(?:\s*(?:[–-]|to|or)\s*(\d[\d,.]*))?\+?[\s-]+(engineers?|people|deals?|calls?|interviews?|hours?|days?|weeks?|months?)\b/gi)) {
    for (const v of [m[1], m[2]]) if (v) out.proof.add(proofKey(toValue(v), m[3]));
  }
  // Ranges share a unit: "$5–15K" is 5,000 to 15,000; "10–20%" is 10 and 20 percent.
  for (const m of text.matchAll(/\$\s?(\d[\d,.]*)\s*([kKmM])?\s*[–-]\s*\$?(\d[\d,.]*)\s*([kKmM])?/g)) {
    out.money.add(toValue(m[1], m[2] ?? m[4]));
    out.money.add(toValue(m[3], m[4]));
  }
  for (const m of text.matchAll(/\$\s?(\d[\d,.]*)\s*([kKmMbB])?(?![\w])/g)) out.money.add(toValue(m[1], m[2]));
  for (const m of text.matchAll(/(\d[\d,.]*)(?:\s*[–-]\s*(\d[\d,.]*))?\s*%(\s+of\b)?/g)) {
    for (const v of [m[1], m[2]]) if (v) (m[3] ? out.share : out.percent).add(toValue(v));
  }
  for (const m of text.matchAll(/(\d[\d,.]*)\s*(?:x\b|×)/gi)) out.multiple.add(toValue(m[1]));
  return out;
}

function classify(token: string): { unit: Unit; value: number; noun?: string } {
  const money = token.match(/\$\s?(\d[\d,.]*)\s?([kmb])?/i);
  if (money) return { unit: "money", value: toValue(money[1], money[2]) };
  const n = toValue(token.match(/\d[\d,.]*/)![0]);
  if (/%/.test(token)) return { unit: "percent", value: n };
  if (/x\b|×/i.test(token)) return { unit: "multiple", value: n };
  return { unit: "count", value: n, noun: token.match(/([a-z]+)$/i)?.[1] };
}

/** Claim-like numbers in `body` that no approved, founder-written or code-computed source contains (same unit). */
export function unsourcedNumbers(body: string, sourced: string): string[] {
  const known = knownValues(sourced);
  const flagged = new Set<string>();
  const text = body.replace(PLACEHOLDER, " ");
  for (const m of text.matchAll(CLAIM_NUMBER)) {
    const token = m[0].trim();
    const { unit, value, noun } = classify(token);
    if (Number.isNaN(value)) continue;
    const isShare = unit === "percent" && /^\s+of\b/i.test(text.slice(m.index + m[0].length));
    const ok = noun
      ? known.proof.has(proofKey(value, noun.replace(/ies$/i, "y")))
      : isShare
        ? known.share.has(value) || known.percent.has(value)
        : unit !== "count" && known[unit].has(value);
    if (!ok) flagged.add(token);
  }
  return [...flagged];
}

/** Numbers code computed for documents: pilot length, price anchors, design-partner terms. */
export function computedNumbers(ws: Workspace): string {
  const c = ws.foundation ? parts(ws.foundation).commercial : undefined;
  const days = pilotDays(c);
  const { band } = priceBand(ws);
  const b = PRICE_BANDS[band];
  return [
    `Pilot length: ${days} days.`,
    `First annual contract anchor: $${b.annual[0].toLocaleString("en-US")}–$${b.annual[1].toLocaleString("en-US")} (${usdRange(b.annual)}).`,
    `Paid pilot anchor: $${b.pilot[0].toLocaleString("en-US")}–$${b.pilot[1].toLocaleString("en-US")} (${usdRange(b.pilot)}).`,
    "Design-partner fee: 10–20% of first-year contract value, upfront. Length: about 3 months, 2–6 months at most. 4–6 partners from about 40 candidates.",
    "Kickoff: 60–90 minutes. Standup: weekly, 30 minutes. First version in about 2 weeks.",
    "Free partners: only the first 1–2, capped at 60–90 days. Opt-out window: 30 or 60 days. Check-ins every 2–3 days.",
    "Pricing heuristic: 10–20% of quantified annual value.",
  ].join("\n");
}

/** Everything a document may draw numbers from. */
export function sourcedText(ws: Workspace, dealId?: string): string {
  const parts_: string[] = [computedNumbers(ws)];
  for (const c of ws.claims) if (c.approved) parts_.push(c.text);
  for (const p of ws.povs) parts_.push(p.text, p.evidence);
  for (const p of ws.company?.proof ?? []) parts_.push(p.text);
  for (const q of ws.foundation?.founderQuestions ?? []) if (q.answer) parts_.push(q.answer);
  if (ws.company?.founderNote) parts_.push(ws.company.founderNote);
  if (ws.foundation) {
    // The playbook is the founder's own, editable record: numbers in it count as founder-provided.
    const f = parts(ws.foundation);
    parts_.push(f.commercial.terms, f.commercial.priceAnchor, f.commercial.discountRule, f.icp.hypothesis.sentence, f.messaging.oneLiner);
    parts_.push(...f.icp.criteria.map((c) => c.text), ...f.icp.antiIcp.map((a) => `${a.text} ${a.reason}`), ...f.positioning.bestFit);
    parts_.push(...f.positioning.valueThemes.flatMap((t) => [t.outcome, ...t.proof.filter((x) => proofCounts(ws, x)).map((x) => x.text)]));
  }
  parts_.push(`${debriefCount(ws)} calls`);
  const deal = dealId ? ws.deals[dealId] : undefined;
  if (deal) {
    const card = deal.card;
    if (card) {
      for (const f of [card.pain, card.spend, card.criticalEvent, card.champion, card.economicBuyer, card.fit, card.decisionProcess]) {
        if (f.value) parts_.push(f.value);
        parts_.push(...f.quotes);
      }
      if (card.pain.impact) parts_.push(card.pain.impact);
    }
    if (deal.pilot) parts_.push(deal.pilot.criteria, deal.pilot.feeUsd ? `$${deal.pilot.feeUsd}` : "");
    if (deal.amountUsd) parts_.push(`$${deal.amountUsd}`);
    for (const q of deal.priceQuotes ?? []) parts_.push(`$${q.amountUsd}`);
    for (const id of deal.meetingIds) {
      const d = ws.meetings[id]?.debrief;
      if (!d) continue;
      parts_.push(...d.quotes.map((q) => q.text));
      if (d.pilotCriteria) parts_.push(d.pilotCriteria);
      if (d.priceQuoted) parts_.push(`$${d.priceQuoted.amountUsd}`);
    }
  }
  return parts_.filter(Boolean).join("\n");
}

export interface AssetCheck {
  placeholders: string[];
  unsourced: string[];
  /** One line: "Ready to approve" or the single worst issue. */
  line: string;
  blocking: boolean;
}

export function checkAsset(ws: Workspace, asset: Pick<Asset, "body" | "dealId">): AssetCheck {
  const ph = placeholders(asset.body);
  const unsourced = unsourcedNumbers(asset.body, sourcedText(ws, asset.dealId));
  const blocking = ph.length > 0 || words(asset.body) < 20;
  const line =
    words(asset.body) < 20
      ? "Too short to send yet."
      : ph.length
        ? `Fill ${ph.length === 1 ? `“${ph[0]}”` : `${ph.length} gaps`} before you approve.`
        : unsourced.length
          ? `“${unsourced[0]}” has no approved source. Confirm it or remove it.`
          : "Ready to approve.";
  return { placeholders: ph, unsourced, line, blocking };
}

/* ───────────────────────────── Markdown export ───────────────────────────── */

/** The whole playbook as one Markdown doc: for a founding AE, a shared drive or another AI tool. Built in code. */
export function playbookMarkdown(ws: Workspace, today: string): string {
  const f = ws.foundation;
  const name = ws.company?.name ?? "Our company";
  const out: string[] = [`# ${name} go-to-market playbook`, "", `_Exported ${today}. Bets are labeled as bets. Only approved claims are facts._`, ""];
  if (!f) return out.concat("No playbook yet.").join("\n");
  const p = parts(f);
  const li = (items: string[]) => {
    const rows = items.filter(Boolean).map((x) => `- ${x}`);
    return rows.length ? rows : ["_None yet._"];
  };

  out.push("## Who we sell to", "", `**Segment bet:** ${p.icp.hypothesis.sentence || p.icp.primarySegment}`, "");
  if (p.icp.primarySegment) out.push(`Primary segment: ${p.icp.primarySegment}${p.icp.segmentLockedAt ? ` (locked ${p.icp.segmentLockedAt.slice(0, 10)})` : ""}`);
  if (p.icp.testSlices.length) out.push(`Test slices: ${p.icp.testSlices.join("; ")}`);
  if (p.icp.employeeBand) out.push(`Company size: ${BAND_LABELS[p.icp.employeeBand]} employees`);
  out.push("", "### Criteria", ...li(p.icp.criteria.map((c) => `${c.mustHave ? "**Must:** " : ""}${c.text} _(${c.status}; detect via ${DETECTION_LABELS[c.detection] ?? c.detection})_`)));
  out.push("", "### Not a fit", ...li(p.icp.antiIcp.map((a) => `${a.text}: ${a.reason}`)));
  if (p.icp.triggers.length) out.push("", "### Why-now signals", ...li(p.icp.triggers.map((t) => `${SIGNAL_LABELS[t.type] ?? t.type} (within ${t.windowDays} days): ${t.implication}`)));
  out.push("", "### Personas");
  if (!p.personas.length) out.push("_None yet._");
  for (const persona of p.personas) {
    out.push("", `#### ${ROLE_LABELS[persona.role]}: ${persona.titles.join(", ")}`, ...li([persona.line && `How to talk to them: ${persona.line}`, persona.kpis.length ? `Measured on: ${persona.kpis.join("; ")}` : "", persona.pains.length ? `Pains: ${persona.pains.join("; ")}` : "", persona.objections.length ? `Objections: ${persona.objections.join("; ")}` : "", persona.wateringHoles.length ? `Where they are: ${persona.wateringHoles.map((w) => w.name).join(", ")}` : ""]));
  }

  out.push("", "## Why us", "");
  if (p.messaging.oneLiner) out.push(`**One-liner:** ${p.messaging.oneLiner}`, "");
  if (p.positioning.category.name) out.push(`**Category:** ${p.positioning.category.name} (${CATEGORY_STYLES[p.positioning.category.style]?.label ?? p.positioning.category.style}). ${p.positioning.category.why}`, "");
  out.push("### What buyers do without us", ...li(p.positioning.alternatives.map((a) => `${a.name} (${ALT_KIND_LABELS[a.kind]}): ${a.whyChosenToday}`)));
  out.push("", "### Differentiators", ...li(p.positioning.differentiators.map((d) => `${d.capability}, vs ${d.vsAlternative} _(${d.status})_`)));
  out.push("", "### Value themes", ...li(p.positioning.valueThemes.map((t) => `**${t.theme}:** ${t.outcome}${themeNeedsProof(ws, t) ? " _(needs proof; never claimed in outreach)_" : ""}`)));
  const claims = ws.claims.filter((c) => c.approved);
  out.push("", "### Approved claims", ...li(claims.map((c) => `${c.text}${c.permission === "anonymized_only" ? " _(anonymized only)_" : ""}`)));
  if (p.competitors.length) {
    out.push("", "### Competitors");
    for (const c of p.competitors) out.push("", `#### ${c.name}`, ...li([`We win when: ${c.whenWeWin}`, `We lose when: ${c.whenWeLose}`, c.landmineQuestions.length ? `Ask: ${c.landmineQuestions.join(" / ")}` : ""]));
  }

  const plan = planMath(ws, today);
  out.push(
    "",
    "## How we sell",
    "",
    "### Plan",
    `At ${plan.cold.perWeek} cold emails and ${plan.intro.perWeek} intro asks a week, about ${plan.meetingsPerWeek.toFixed(1)} meetings a week. By ${plan.byDate}: about ${Math.round(plan.projected)} of ${plan.target} ${plan.targetLabel}.`,
  );
  if (p.channelPlan) out.push("", "### Channels, in order", ...p.channelPlan.motions.slice().sort((a, b) => a.rank - b.rank).map((m) => `${m.rank}. **${MOTION_LABELS[m.motion] ?? m.motion}** (${m.weeklyTarget}): ${m.why}`));
  out.push("", "### Pricing and terms", ...li([STRUCTURE_LABELS[p.commercial.structure].label, p.commercial.terms, p.commercial.priceAnchor, p.commercial.discountRule, `Pilot length: ${pilotDays(p.commercial)} days`]));
  const objections = ws.objections.filter((o) => o.approved);
  if (objections.length) {
    out.push("", "### Objections");
    for (const o of objections) out.push("", `**“${o.objection}”**`, ...li([`Ask: ${o.clarifyingQ}`, `Answer: ${o.response}`, o.walkAwayIf && `Walk away if: ${o.walkAwayIf}`]));
  }
  const assets = ws.assets.filter((a) => a.approved);
  if (assets.length) out.push("", "### Assets", ...li(assets.map((a) => `${a.title} (${ASSET_KINDS[a.kind].label})${a.url ? `: ${a.url}` : ""}`)));

  out.push("", "## Voice", "");
  if (ws.voice?.summary) out.push(ws.voice.summary, "");
  if (p.messaging.bannedWords.length) out.push(`Never write: ${p.messaging.bannedWords.join(", ")}`, "");
  if (ws.povs.length) out.push("### Points of view", ...li(ws.povs.map((v) => `${v.text} _(${v.evidence})_`)));
  return out.join("\n").replace(/\n{3,}/g, "\n\n") + "\n";
}
