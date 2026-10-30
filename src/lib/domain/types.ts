/**
 * Inroad domain model. Shared by server and client; plain data only (JSON-serializable).
 *
 * Storage: `.data/workspace.json` holds everything below in one `Workspace` document.
 * Run logs, Ask threads and imported LinkedIn connections live in their own files
 * (`runs.json`, `threads.json`, `connections.json`) because they are large and rarely read.
 */

import type { MetricProviderId, MetricSnapshot } from "@/lib/metrics/types";
import type { WaitlistTracking } from "@/lib/waitlist/types";

export type ID = string;
/** Local calendar date, `YYYY-MM-DD`. */
export type ISODate = string;
/** Full ISO timestamp. */
export type ISODateTime = string;

export type Confidence = "high" | "medium" | "low";
export type Jurisdiction = "US" | "EU" | "UK" | "CA" | "other" | "unknown";
export type EntityKind = "account" | "person" | "deal" | "meeting" | "event" | "guest" | "evidence" | "claim" | "objection" | "playbook" | "draft" | "studio";
export interface EntityRef {
  kind: EntityKind;
  id: string;
}

/* ─────────────────────────────── Evidence ─────────────────────────────── */

export type SourceType =
  | "first_party"
  | "filing"
  | "job_post"
  | "press"
  | "community"
  | "podcast"
  | "search_snippet"
  | "user_input"
  | "integration";

/** A sourced fact. Every claim Ember makes about a company or person points at one of these. */
export interface Evidence {
  id: ID;
  claim: string; // normalized fact, ≤200 chars
  quote: string; // verbatim, ≤300 chars
  url: string;
  host: string;
  sourceType: SourceType;
  publishedAt?: ISODate;
  retrievedAt: ISODateTime;
  confidence: Confidence;
  runId?: ID;
  flaggedWrong?: { at: ISODateTime; note?: string };
}

/* ─────────────────────────────── Market ─────────────────────────────── */

/** Who the company sells to. Unset (workspaces made before consumer mode) reads as "b2b": see `marketOf`. */
export type Market = "b2b" | "consumer";

/**
 * How a consumer company makes money and grows. It picks the channel plan, the retention benchmark and the pricing default.
 * app: consumer software (mobile or web), free or paid · dtc: physical products sold direct · marketplace: two sides
 * (buyers and sellers, hosts and guests) · social: the network is the product (social, community, user content) ·
 * prosumer: individuals paying for a tool they use for work or a serious hobby.
 */
export type ConsumerModel = "app" | "dtc" | "marketplace" | "social" | "prosumer";

/* ─────────────────────────────── Company & Playbook ─────────────────────────────── */

export interface LearningChip {
  key: "what" | "who" | "pricing" | "proof" | "alternatives" | "stage";
  label: string; // "What you do"
  text: string; // ≤90 chars
  evidenceIds: ID[];
  confidence: Confidence;
  corrected?: boolean;
  /** The founder said this is wrong. Kept (not deleted) so the model is told and can't add it back. */
  rejected?: boolean;
}

export interface CompanySnapshot {
  name: string;
  domain: string;
  plainOneLiner: string;
  whoItsFor: string;
  howYouCharge: { model: "seat" | "usage" | "flat" | "custom_quote" | "freemium" | "unknown"; isPublic: boolean; summary: string | null };
  proof: { kind: "metric" | "logo" | "quote" | "case_study" | "founder_credential"; text: string; evidenceId?: ID }[];
  alternatives: { name: string; kind: "competitor" | "status_quo" | "in_house" | "hire" }[];
  stage: "pre_launch" | "design_partners" | "early_revenue" | "scaling" | "unknown";
  messagingIssues: { issue: string; quote: string; fix: string }[];
  coverage: "good" | "thin";
  tech?: string[];
  chips: LearningChip[];
  founderNote?: string; // the optional sentence from onboarding
  /** From the founder's own MX records (onboarding); used for sender setup. */
  emailProvider?: "google" | "microsoft" | "other" | "none";
  /** Businesses or consumers. The founder's pick (onboarding, Settings) wins over what the site suggests. */
  market?: Market;
  consumerModel?: ConsumerModel;
  marketSource?: "founder" | "site";
  /** What on the site pointed at consumers ("App Store link", "Shopify cart"), found in code. */
  marketHints?: string[];
}

export interface ValueTheme {
  id: ID;
  theme: string;
  outcome: string;
  proof: { text: string; evidenceId?: ID; claimId?: ID }[];
  needsProof: boolean;
}

export interface Positioning {
  alternatives: { name: string; kind: "competitor" | "status_quo" | "in_house" | "hire"; whyChosenToday: string; domain?: string; sourceUrl?: string }[];
  differentiators: { capability: string; vsAlternative: string; status: "proven" | "claimed"; evidenceIds?: ID[] }[];
  valueThemes: ValueTheme[]; // 2–3
  bestFit: string[];
  category: { name: string; style: "head_to_head" | "big_fish_small_pond" | "new_game"; why: string };
  /** Set when the product looks undifferentiated against the alternatives (positioning can't fix that). */
  warning?: string;
}

export type DetectionMethod =
  | "job_posts"
  | "form_d"
  | "press"
  | "site"
  | "yc_directory"
  | "github"
  | "dns"
  | "hn"
  | "founder_knowledge"
  // Consumer audiences: where a trait shows up in public, or by asking users.
  | "app_reviews"
  | "community"
  | "social"
  | "search_trends"
  | "survey";

export type SignalType =
  | "champion_job_change"
  | "first_hire"
  | "jd_names_pain"
  | "new_leader"
  | "funding"
  | "stack_change"
  | "launch"
  | "compliance_deadline"
  | "persona_post"
  | "community_request"
  | "public_pain"
  | "filing"
  | "hiring"
  | "sensitive"
  // Consumer moments: what makes a person look for this now.
  | "life_event"
  | "seasonal"
  | "trend"
  | "competitor_gap";

export interface ICPCriterion {
  id: ID;
  text: string;
  /** demographic and behavioral describe consumer audiences; the rest describe companies. */
  kind: "firmographic" | "technographic" | "situational" | "demographic" | "behavioral";
  mustHave: boolean;
  detection: DetectionMethod;
  status: "validated" | "hypothesis";
  /** For hypotheses: how the next 25 touches or 5 calls would confirm it. */
  howToTest?: string;
}

export interface ICP {
  hypothesis: { companyGroup: string; role: string; obstacle: string; cause: string; improvement: string; sentence: string };
  primarySegment: string;
  testSlices: string[]; // ≤2
  criteria: ICPCriterion[];
  antiIcp: { text: string; reason: string }[];
  triggers: { type: SignalType; windowDays: number; implication: string }[];
  segmentLockedAt?: ISODateTime;
  /** Company size the founder sells to; drives the segment-aware price anchors. */
  employeeBand?: "lt50" | "50_300" | "gt300" | "mixed";
  /** Every segment bet, oldest first. The open one (no endedAt) matches `segmentLockedAt`. */
  betHistory?: SegmentBet[];
  /** What the first conversations would show if the bet is right / wrong. */
  confirmIf?: string;
  killIf?: string;
}

/** One segment bet: judged after 25 cold first touches on positive replies, not rates. */
export interface SegmentBet {
  segment: string;
  startedAt: ISODateTime;
  endedAt?: ISODateTime;
  verdict?: "keep" | "adjust" | "switch";
  touches?: number;
  positiveReplies?: number;
  meetings?: number;
}

/**
 * Business buying roles, then consumer ones: early_adopter (the first users who look for this), payer (pays for someone
 * else: a parent, a gift giver) and influencer (who shapes the choice: a creator, an expert, a friend group).
 */
export type PersonaRole = "economic_buyer" | "champion" | "technical_approver" | "user" | "blocker" | "early_adopter" | "payer" | "influencer";

export interface Persona {
  id: ID;
  role: PersonaRole;
  /** Job titles for businesses; for consumers, how the segment describes itself ("first-time parents"). */
  titles: string[];
  /** What they're measured on (businesses) or what they want to get done (consumers). */
  kpis: string[];
  pains: string[];
  triggers: string[];
  objections: string[];
  wateringHoles: { name: string; kind: "community" | "podcast" | "newsletter" | "conference" | "creator" | "social" | "forum"; url?: string }[];
  line: string; // ≤25 words, how to talk to this persona
}

export interface MessagingTree {
  oneLiner: string; // ≤25 words
  themes: { valueThemeId: ID; headline: string; vsAlternative: string }[];
  byPersona: { personaId: ID; line: string }[];
  bySignal: { signal: SignalType; implication: string }[];
  customerWords: { phrase: string; source: "call" | "site" | "job_post" | "review" | "community" | "founder" }[];
  bannedWords: string[];
  /** Consumer: first lines for short video and posts, each from a real pain, moment or customer word. */
  hooks?: string[];
}

export type Motion =
  | "warm_network"
  | "signal_cold"
  | "investor_intros"
  | "communities"
  | "founder_content"
  | "exec_dinners"
  | "design_partner_program"
  | "launches"
  // Consumer motions (see src/lib/consumer/plan.ts).
  | "hand_recruiting"
  | "user_conversations"
  | "short_video"
  | "creators"
  | "referral_loop"
  | "waitlist"
  | "app_store"
  | "seo"
  | "paid_social"
  | "press"
  | "ambassadors"
  | "supply_seeding"
  | "pop_ups";

export interface ChannelPlan {
  funnel: {
    qualifiedNeeded: number;
    discoveryCallsNeeded: number;
    coldContactsNeeded: number;
    perWeek: { conversations: number; firstTouches: number; introAsks: number; meetings: number };
    warning?: string;
    /** Consumer plans: retention-first math (active users needed ÷ the retention bar = signups needed). */
    consumer?: { signupsNeeded: number; signupsPerWeek: number; retentionTarget: number; weeks: number };
  };
  motions: { motion: Motion; rank: number; why: string; weeklyTarget: string; firstActions: string[] }[];
}

export interface CommercialDefault {
  /** The first three are business deals; the rest are how a consumer pays (see src/lib/consumer/plan.ts). */
  structure: "paid_pilot" | "paid_design_partner" | "annual_with_opt_out" | "free_trial" | "freemium" | "direct_purchase" | "take_rate";
  terms: string;
  priceAnchor: string;
  discountRule: string;
  /** Pilot length = max(14, 2 × this), capped at 45. */
  daysToFirstValue?: number;
}

export interface Competitor {
  name: string;
  domain?: string;
  positioningQuote?: string;
  whenWeWin: string;
  whenWeLose: string;
  landmineQuestions: string[];
  /** Where this competitor was seen (search result or page), when known. */
  sourceUrl?: string;
}

export interface FounderQuestion {
  id: ID;
  question: string;
  whyItMatters: string;
  affects: ("icp" | "positioning" | "pricing" | "channel_plan")[];
  answer?: string;
  answeredAt?: ISODateTime;
}

/** Where a playbook section's beliefs came from. Day one always says "0 conversations confirm this". */
export interface Provenance {
  siteSources: number;
  founderAnswers: number;
  conversationsConfirming: number;
  label: string; // "From your site + 2 answers · 0 conversations confirm this"
}

/** "growth" is written for consumer companies only. */
export type FoundationSection = "positioning" | "icp" | "personas" | "messaging" | "questions" | "growth";

/** One row of the first-run reading ledger: a page actually crawled, or a free lookup. */
export interface OnboardingLedgerRow {
  id: ID;
  kind: "page" | "check";
  label: string; // "Pricing", "DNS"
  detail: string; // "acme.com/pricing", "Google Workspace mail"
  url?: string;
  host?: string;
  ms?: number;
  at: ISODateTime;
}

/** Ember's model of the business: the Playbook surface. */
export interface Foundation {
  version: number;
  generatedAt: ISODateTime;
  positioning: Positioning;
  icp: ICP;
  personas: Persona[];
  messaging: MessagingTree;
  channelPlan: ChannelPlan;
  commercial: CommercialDefault;
  competitors: Competitor[];
  founderQuestions: FounderQuestion[];
  confidence: Confidence;
  provenance?: Partial<Record<FoundationSection, Provenance>>;
  /** When an accepted refresh change or a restore last changed the bet. */
  revisedAt?: ISODateTime;
  /** Consumer companies: how the product grows (Playbook → How we grow). */
  growth?: GrowthModel;
}

/* ─────────────────────────────── Consumer growth ─────────────────────────────── */

export type GrowthLoopKind = "viral" | "word_of_mouth" | "content" | "creator" | "community" | "paid" | "marketplace";
/** d30 = active 30 days after signup; w4 = active in week 4; m3_repeat = bought again within 90 days; m1_paid = still paying after one renewal. */
export type RetentionMetric = "d1" | "d30" | "w4" | "m3_repeat" | "m1_paid";

/** The consumer playbook's growth model. The strategist proposes the product-specific parts; code fills the benchmark. */
export interface GrowthModel {
  model: ConsumerModel;
  /** One number that counts delivered value ("weekly active families who log 3+ feeds"), with why. */
  northStar: { metric: string; why: string };
  /** The first moment a new user gets the value, within `withinDays` of signing up. */
  activation: { event: string; withinDays: number; status: "hypothesis" | "validated"; howToTest?: string };
  /** How often the need naturally comes up; sets which retention window matters. */
  cadence: "daily" | "weekly" | "monthly" | "occasional";
  /** Where new users should come from once retention holds. */
  primaryLoop: { kind: GrowthLoopKind; how: string };
  /** Code-filled from the benchmark table for this model and cadence (percent of a signup cohort). */
  retention: { metric: RetentionMetric; target: number; good: number; source: string };
  /** Where the first 100 users come from, by hand. Up to 3 lines. */
  firstHundred: string[];
}

/** One week of numbers the founder logs (or a connected tool fills). Counts are for the week starting `weekOf`. */
export interface GrowthWeek {
  weekOf: ISODate;
  /** New users (apps), first-time buyers (DTC), new buyers or sellers (marketplaces). */
  signups: number;
  /** Of this week's signups, how many reached the activation event. */
  activated?: number;
  /** Distinct users active this week (buyers this week for DTC). */
  active?: number;
  /** Percent (0–100) of the cohort that signed up four weeks earlier and was active this week. */
  retainedPct?: number;
  /** Paying customers or subscribers at week end. */
  paying?: number;
  newPaying?: number;
  churnedPaying?: number;
  revenueUsd?: number;
  /** Paid acquisition spend this week (ads, paid creators). */
  spendUsd?: number;
  /** Signups that came from an invite, a referral link or a friend. */
  referred?: number;
  /** Where most signups came from, in the founder's words ("TikTok", "r/running"). */
  topChannel?: string;
  note?: string;
  source: "founder" | IntegrationId;
  loggedAt: ISODateTime;
}

/**
 * Creators, communities, newsletters, podcasts, press and partner brands or companies: who a company reaches its users
 * or buyers through. Consumer companies call the list Creators; businesses call it Partners.
 */
export type PartnerKind = "creator" | "community" | "newsletter" | "podcast" | "press" | "brand";
export type PartnerStage = "shortlist" | "contacted" | "replied" | "agreed" | "live" | "done" | "passed";
export type PartnerPlatform = "tiktok" | "instagram" | "youtube" | "x" | "linkedin" | "reddit" | "discord" | "slack" | "facebook" | "substack" | "podcast" | "web" | "other";
export type PartnerOffer = "gifted" | "flat_fee" | "affiliate" | "hybrid" | "free_access" | "collab";

export interface PartnerOutreach {
  channel: "email" | "dm";
  subject: string | null;
  body: string;
  /** The one follow-up, sent about 5 days later if there's no answer. */
  followUp?: string;
  draftedAt: ISODateTime;
  lint?: LintResult;
  runId?: ID;
  sentOn?: ISODate;
  followedUpOn?: ISODate;
  edited?: boolean;
}

export interface Partner {
  id: ID;
  kind: PartnerKind;
  name: string;
  platform?: PartnerPlatform;
  handle?: string;
  url?: string;
  /** Who listens, in plain words ("new parents, mostly US"). */
  audience?: string;
  /** Founder-entered or from a creator tool; never estimated by the agent. */
  followers?: number;
  /** 0–1. Founder-entered or from a creator tool. */
  engagementRate?: number;
  /** Why their audience is ours, ≤160 chars. */
  fit: string;
  /** Where the agent saw it (a search result or a page read in a run). */
  sourceUrl?: string;
  source: "agent" | "founder" | "integration";
  stage: PartnerStage;
  stageHistory: { stage: PartnerStage; at: ISODateTime }[];
  offer?: { type: PartnerOffer; amountUsd?: number; commissionPct?: number; terms?: string };
  outreach?: PartnerOutreach;
  /** The creator brief (an Asset of kind creator_brief) once they agreed. */
  briefAssetId?: ID;
  /** Paid or gifted content needs a clear disclosure. The founder checks the live post and confirms it. */
  disclosure?: "confirmed" | "missing";
  /** A unique code or link, so results can be counted. */
  trackingCode?: string;
  results?: { at: ISODateTime; views?: number; clicks?: number; signups?: number; orders?: number; costUsd?: number; note?: string }[];
  notes?: string;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  runId?: ID;
}

/** One growth experiment. Code sizes it; below the sample it needs, it's a before/after read, not a test. */
export interface Experiment {
  id: ID;
  stage: "acquisition" | "activation" | "retention" | "referral" | "revenue";
  hypothesis: string;
  change: string;
  metric: string;
  ice?: { impact: number; confidence: number; ease: number };
  /** Current rate of the metric (0–1), used to size the test. */
  baseline?: number;
  /** Users per variant a readable A/B result needs (computed in code). */
  perArm?: number;
  startedOn?: ISODate;
  endsOn?: ISODate;
  status: "idea" | "running" | "won" | "lost" | "inconclusive";
  result?: string;
  /** The weekly review proposal it came from. */
  proposalId?: ID;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

/** An approved "about us" fact. Outbound copy may only use approved claims. */
export interface Claim {
  id: ID;
  text: string;
  kind: "metric" | "customer" | "logo" | "credential" | "capability" | "security";
  evidenceIds: ID[];
  approved: boolean;
  permission: "public" | "anonymized_only";
  createdAt: ISODateTime;
}

export interface ObjectionCard {
  id: ID;
  objection: string;
  category: "timing" | "budget" | "status_quo" | "build" | "competitor" | "startup_risk" | "security" | "priority" | "info_request" | "team";
  underlyingConcern: string;
  clarifyingQ: string;
  response: string;
  walkAwayIf: string;
  approved: boolean;
  timesHeard: number;
  lastHeard?: ISODate;
}

export interface VoiceCard {
  samples: { text: string; kind: "email" | "post" }[];
  summary: string; // "Short sentences, contractions, signs off '— P', never uses 'leverage'"
  signOff: string;
  updatedAt: ISODateTime;
  /** Traits the founder accepted (or edited). Drafts follow these; suggestions don't count until accepted. */
  traits?: VoiceTraits;
  /** What the last re-read found, waiting for the founder (SPEC §6: after every 3rd sample and every 20 edits). */
  suggested?: VoiceTraits & { at: ISODateTime; basis: string };
  /** The last 20 drafts the founder edited before sending: as drafted, as sent, and how far apart (0–1). */
  edits?: { at: ISODateTime; before: string; after: string; subjectBefore: string | null; subjectAfter: string | null; distance: number }[];
  editsSinceExtract?: number;
  samplesSinceExtract?: number;
  /** Drafts skipped as "tone off" (the last 10): examples of what not to write. */
  toneOff?: { at: ISODateTime; text: string; moveId?: ID }[];
  /** AI-written sales emails the founder received and pasted ("Show me what bad looks like"): drafts stay away from them. */
  badExamples?: { at: ISODateTime; text: string }[];
}

/** How the founder writes, read from their samples and edits in code (SPEC §6 VoiceCard). Unknown traits are left out. */
export interface VoiceTraits {
  avgSentenceWords?: number;
  contractions?: boolean;
  greeting?: "none" | "first_name" | "hi_first_name" | "hey_first_name";
  subjectStyle?: "lowercase" | "sentence" | "title";
  usesWords?: string[];
  avoidsWords?: string[];
  formality?: 1 | 2 | 3 | 4 | 5;
  punctuationHabits?: string[];
  /** A suggestion only: the sign-off on 2+ of their messages. Accepting it sets VoiceCard.signOff. */
  signOff?: string;
}

export interface SenderIdentity {
  name: string;
  title: string;
  company: string;
  email: string;
  postalAddress: string;
  sendingDomain?: string;
  domainHealth?: { spf: boolean; dkim: boolean | null; dmarc: string | null; mx: string; checkedAt: ISODateTime };
}

/**
 * The near-term goal is an output of capacity, not a wish: by default 5 paid pilots or design
 * partners in 12 weeks. The 20-customer arc stays as the long-term number.
 */
export interface Goal {
  target: number; // 5
  targetLabel: string; // "paid pilots or design partners"
  byDate: ISODate; // +12 weeks
  longArcCustomers: number; // 20
  winRate: number; // 0.25
  discoveryToQualified: number; // 0.5
  meetingRate: number; // 0.04
  conversationsPerWeek: number; // 10
  /** Plan inputs (Playbook → Plan). Intro asks and community conversations don't count against the cold cap. */
  introAsksPerWeek?: number; // 4
  communityPerWeek?: number; // 0
  /** Set when the founder picked `conversationsPerWeek` in Playbook → Plan; Today's target then uses it over the bet's channel plan. */
  conversationsChosenAt?: ISODateTime;
  /** What the target counts. Unset = won deals (business). Consumer: weekly active users or paying customers, from the growth log. */
  metric?: "deals" | "active_users" | "paying";
  /** Consumer: user conversations a week (interviews, onboarding calls, churn calls). */
  userTalksPerWeek?: number; // 5
}

export interface Caps {
  /** Applies to cold email first touches only; LinkedIn and intro asks don't count. */
  firstTouchesPerWeek: number; // 25
  firstTouchesPerDayMax: number; // 20
  contactsPerAccountPerWeek: number; // 2
  monthlyBudgetUsd: number; // AI spend ceiling; runs are blocked above it
}

/** A first-hand opinion only the founder has. Every cold draft must use one (or a credential). */
export interface PovItem {
  id: ID;
  text: string; // "Nobody budgets for X until Y breaks"
  evidence: string; // "From 30 calls with platform leads"
  createdAt: ISODateTime;
  uses: number;
}

/** Things a CTA can offer. A draft that offers a resource must point at one of these. */
export interface Asset {
  id: ID;
  kind:
    | "one_pager"
    | "demo_script"
    | "security"
    | "design_partner_terms"
    | "pilot_proposal"
    | "insight"
    | "case_study"
    | "other"
    // Founder content.
    | "post"
    | "community_answer"
    | "launch"
    // Consumer documents.
    | "creator_brief"
    | "launch_plan"
    | "referral_program"
    | "interview_guide";
  /** creator_brief: the partner it was written for. */
  partnerId?: ID;
  title: string;
  body: string; // markdown
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  /** Outreach may offer an asset only when this is true (the founder approved it in Playbook). */
  approved?: boolean;
  /** Where the founder hosts it (Notion, Docs), if anywhere. */
  url?: string;
  /** Pilot proposals: the deal it was written for. */
  dealId?: ID;
  /** Facts the founder still has to supply. Listed, never filled in by the agent. */
  gaps?: string[];
  claimIds?: ID[];
  povIds?: ID[];
  /** Groups the design-partner kit templates. */
  kit?: "design_partner";
  origin?: "agent" | "template" | "founder";
  runId?: ID;
  /** Founder content: the question it answers or the founder's note, kept so a fresh version has the same brief. */
  brief?: string;
}

/** People who can make introductions (investors, advisors, customers…). */
export interface Connector {
  id: ID;
  name: string;
  /** "connection": a LinkedIn connection asked through a path (a colleague inside, an alum), not someone the founder listed. */
  relationship: "investor" | "angel" | "advisor" | "customer" | "friend" | "ex_colleague" | "connection";
  linkedinUrl?: string;
  /** Pre-fills the To line when an ask or a thank-you opens in Gmail. */
  email?: string;
  /** Who they can reach, in the founder's words: companies, domains, roles, circles ("fintech CFOs", "stripe.com"). Matched in code. */
  reach?: string[];
  /** Where they work now, for "Ways in" (an advisor at a target counts as inside). */
  company?: string;
  notes?: string;
  lastAskedOn?: ISODate;
  introsMade: number;
  /** What the founder did for them: intros, favors. The ledger weighs asks against these. */
  gives?: { at: ISODate; what: string }[];
  /** The last target list sent for them to mark (one ask), and the rows they marked. Forwardables follow for those only. */
  list?: { sentOn: ISODate; domains: string[]; marked?: string[]; markedOn?: ISODate };
}

/* ─────────────────────────────── Intros ─────────────────────────────── */

/**
 * Double opt-in, end to end. Ask: a connector introduces the founder to someone (asked → the connector
 * checks with them → both said yes and the intro email exists → meeting → closed with a thank-you).
 * Give: the founder introduces two people, asking each side separately before anyone's details move.
 */
export type IntroStage = "asked" | "forwarded" | "introduced" | "meeting" | "done" | "declined" | "no_answer";

export interface IntroSide {
  personId?: ID;
  name: string;
  /** "Controller at Northwind" */
  title?: string;
  email?: string;
  /** Why this side would want to meet the other, in the founder's words (≤30 words). Goes into the opt-in note. */
  why: string;
  consent: "pending" | "yes" | "no";
  askedOn?: ISODate;
  nudgedOn?: ISODate;
}

export interface Intro {
  id: ID;
  kind: "ask" | "give";
  stage: IntroStage;
  /** Ask: who makes the intro. The name stays even if the connector is removed. */
  connectorId?: ID;
  connectorName?: string;
  /** Ask: who the founder wants to meet. */
  personId?: ID;
  accountDomain?: string;
  /** "Rafael Ortiz, VP Finance at Ashgrove", or the role when no one is named yet. */
  targetName: string;
  /** Give: the two people, each asked separately. */
  sides?: [IntroSide, IntroSide];
  /** The drafted ask (a warm_intro package), when it came from the composer. */
  packageId?: ID;
  askedOn: ISODate;
  /** One nudge per ask, ever: connectors are relationships, not a sequence. */
  nudgedOn?: ISODate;
  /** Ask: when the connector said the target is in and they're checking (stage forwarded). */
  forwardedOn?: ISODate;
  introducedOn?: ISODate;
  /** Ask: the founder answered the intro email (connector moved to BCC, times offered). */
  repliedOn?: ISODate;
  meetingOn?: ISODate;
  meetingId?: ID;
  /** Ask: the connector heard how it went. Give: the founder checked in on how it went. */
  thankedOn?: ISODate;
  outcome?: "useful" | "pilot" | "not_a_fit";
  declinedBy?: "connector" | "target" | "both";
  closedOn?: ISODate;
  note?: string;
  /** Undo support: the connector's last-asked date before this ask was marked sent. */
  priorAskedOn?: ISODate;
  history: { at: ISODateTime; stage: IntroStage; note?: string }[];
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

/* ─────────────────────────────── Accounts & people ─────────────────────────────── */

export type DiscoverySource =
  | "yc_directory"
  | "ats_search"
  | "hn_hiring"
  | "form_d"
  | "press"
  | "competitor_customers"
  | "community"
  | "founder_network"
  /** GitHub stargazers of the founder's repo (W2). */
  | "stargazers"
  | "referral"
  | "web_search"
  | "manual"
  | "csv_import"
  | "integration";

export interface Signal {
  id: ID;
  type: SignalType;
  headline: string; // ≤14 words
  date: ISODate;
  url: string;
  host: string;
  evidenceId?: ID;
  strength: 0 | 1 | 2 | 3;
  usableInOutreach: boolean;
  implication: string; // hypothesis, ≤25 words
}

export interface Angle {
  id: ID;
  title: string; // ≤8 words
  signal: string;
  interpretation: string;
  pressure: string;
  pov: string; // why the obvious fix fails
  povId?: ID; // the founder POV this angle rests on, when one fits
  proof: { claimId?: ID; credential?: string } | null;
  ask: string;
  evidenceIds: ID[];
  bestFor: PersonaRole;
  strength: 1 | 2 | 3 | 4 | 5;
}

export interface Dossier {
  generatedAt: ISODateTime;
  staleAfter: ISODate;
  runId?: ID;
  snapshot: {
    plainDescription: string;
    /** Evidence for `plainDescription` (ideally their own site). Older dossiers have none. */
    descriptionEvidenceIds?: ID[];
    stage: string;
    funding?: { round: string; amountUsd?: number; date: ISODate; useOfFunds?: string; evidenceId?: ID };
    headcount?: { value: string; method: "team_page" | "yc" | "jobs" | "press" | "form_d" | "estimate" };
    hq?: string;
    jurisdiction: Jurisdiction;
  };
  facts: { text: string; evidenceIds: ID[] }[]; // ≤8
  committee: { role: PersonaRole; likelyTitles: string[]; personIds: ID[] }[];
  painHypotheses: { pain: string; valueThemeId?: ID; evidenceIds: ID[]; confidence: Confidence }[];
  angles: Angle[];
  discoveryOpeners: { q: string; evidenceId?: ID }[];
  risks: string[];
  unknowns: string[];
  recommendation: { move: "warm_intro" | "cold_email" | "linkedin_first" | "reply_in_thread" | "watch" | "disqualify"; personId?: ID; why: string };
}

/** Free, zero-token enrichment gathered in code (crawl, job boards, news). */
export interface Enrichment {
  crawledAt: ISODateTime;
  title?: string;
  description?: string;
  tech: string[];
  socials: { linkedin?: string; x?: string; github?: string };
  jobBoard?: { provider: "greenhouse" | "lever" | "ashby" | "workable"; token: string };
  openRoles: number;
  rolesByTeam: { team: string; count: number; titles: string[] }[];
  news: { title: string; url: string; source: string; publishedAt?: string; signal: boolean }[];
}

export interface Account {
  domain: string; // primary key
  name: string;
  oneLiner?: string;
  status: "new" | "tracked" | "in_pipeline" | "customer" | "disqualified";
  source: DiscoverySource;
  sourceDetail?: string; // "HubSpot", "Clay webhook", "acme-targets.csv"
  addedAt: ISODateTime;
  fitScore: number; // 0–100
  tier: "A" | "B" | "C";
  criteria: { criterionId: ID; met: "true" | "false" | "unknown"; note?: string }[];
  signals: Signal[];
  whyNow: string | null;
  whyNowScore: number; // 0–4
  enrichment?: Enrichment;
  dossier?: Dossier;
  peopleIds: ID[];
  warmPathCount: number;
  dealId?: ID;
  watch: boolean;
  disqualified?: { reason: "not_icp" | "already_known" | "competitor" | "customer" | "too_small" | "too_big" | "other"; note?: string; at: ISODateTime };
  hqCity?: string;
  tags?: string[];
  /** Who to talk to first, as a title, until a dossier names a person. Set by discovery. */
  suggestedTitle?: string;
  /** Where discovery found it (YC profile, a competitor's customer page, a search result). */
  sourceUrl?: string;
  /** When it became a customer without a won deal (the founder named it, or a customers list). A won deal's date wins. */
  customerAt?: ISODateTime;
}

export interface ContactPath {
  kind: "warm_intro" | "published_email" | "role_inbox" | "pattern_guess" | "linkedin" | "integration";
  value: string;
  via?: string;
  sourceUrl?: string;
  verified: boolean;
  founderConfirmed: boolean;
  bounced?: boolean;
}

export interface Person {
  id: ID;
  accountDomain: string;
  name: string;
  title: string;
  role?: PersonaRole;
  email?: string;
  linkedinUrl?: string;
  location?: string;
  evidenceIds: ID[];
  lastSeen?: ISODate;
  confidence: Confidence;
  mayHaveLeft: boolean;
  contactPaths: ContactPath[];
  jurisdiction: Jurisdiction;
  doNotContact: boolean;
  champion?: "coach" | "untested" | "tested";
  /** How they know the founder (design partner, past user, ex-colleague…), from a tag or a signup/user import. */
  tags?: RelationshipTag[];
  notes?: string;
  source?: DiscoverySource;
  /** Apollo's id once the founder added this person from a people search, so the search can show who's on file. */
  apolloId?: string;
}

/* ─────────────────────────────── Outreach ─────────────────────────────── */

export type LintCode =
  | "LEN_OVER"
  | "LEN_UNDER"
  | "SUBJECT_WORDS"
  | "BANNED_PHRASE"
  | "HYPE_WORD"
  | "AI_VOCAB"
  | "I_OPENER"
  | "YOU_RATIO"
  | "MULTI_CTA"
  | "LINK_T1"
  | "CALENDAR_LINK"
  | "PLACEHOLDER"
  | "FAKE_REPLY_SUBJECT"
  | "EXCLAMATION"
  | "EMOJI"
  | "ALL_CAPS"
  | "EM_DASH"
  | "NUMBER_UNSOURCED"
  | "CONGRATS_OPENER"
  | "NOT_JUST_BUT"
  | "LI_CHARS"
  | "FK_GRADE"
  | "ASSET_MISSING"
  | "POV_MISSING"
  | "SPAN_UNSUPPORTED"
  | "CLAIM_UNAPPROVED"
  | "SKELETON_REPEAT"
  | "NEAR_DUPLICATE"
  // Consumer marketing rules (src/lib/consumer/compliance.ts).
  | "DISCLOSURE_MISSING"
  | "REVIEW_INCENTIVE"
  | "FAKE_SOCIAL_PROOF"
  | "HEALTH_CLAIM"
  | "EARNINGS_CLAIM"
  | "GUARANTEE_CLAIM"
  | "FREE_TERMS"
  | "FALSE_URGENCY"
  | "ENV_CLAIM"
  | "SCRIPTED_OPINION"
  | "OFFER_MISSING";

export interface LintResult {
  passed: boolean;
  violations: { code: LintCode; detail: string; severity: "error" | "warn" }[];
  stats: { words: number; fkGrade: number; you: number; iWe: number; questionMarks: number; links: number };
}

export type DraftFrame =
  | "founder_card"
  | "4t"
  | "problem_prompter"
  | "mouse_trap"
  | "observation_problem_proof"
  | "referral"
  | "permission_to_close"
  | "reply"
  | "intro"
  | "recap"
  | "invite";

export interface DraftStep {
  step: number; // 1-based
  /** Each personalized phrase and the evidence it rests on; rendered as margin notes. */
  personalizedSpans: { text: string; evidenceId: ID }[];
  povId?: ID;
  assetId?: ID;
  sendOn: ISODate;
  thread: "new" | "reply";
  subject: string | null;
  body: string; // without footer
  frame: DraftFrame;
  evidenceIds: ID[];
  claimIds: ID[];
  lint: LintResult;
  status: "draft" | "approved" | "sent" | "skipped" | "cancelled_by_reply";
  sentAt?: ISODateTime;
  edited?: boolean;
  /** The dossier angle this step was written from (alternates carry their own). */
  angleId?: ID;
  /** An approved claim of kind "credential", used when no POV fits. */
  credentialClaimId?: ID;
  /** Hidden critic verdict. Telemetry only; never shown to the founder. */
  critic?: DraftCritic;
  /** The text as drafted, kept on the first edit so the send can be compared to it (voice learning, edit distance). */
  original?: { subject: string | null; body: string };
  /** The why-now signal type this step rests on (from its angle's evidence), stamped at draft time for the reviews. */
  signalType?: SignalType;
  /** The message-bet arm this draft was written for (cold first touches while a bet runs). */
  bet?: BetArm;
}

/** One arm of a running message bet: the proposal id that started it, and which side this draft or send is on. */
export interface BetArm {
  id: ID;
  arm: "control" | "variant";
}

/**
 * What one message bet varies (SPEC §6 MessageBet.variable). Writing variables steer the draft; targeting
 * variables (persona, signal, channel) are matched from the send's tags, since they're about who and why, not words.
 */
export type BetDimension = "angle" | "frame" | "subject_style" | "cta" | "pov" | "persona" | "signal" | "channel";

/** How a sent touch was written, so the learning reviews compare real sends (SPEC §6 Activity.tags). */
export interface TouchTags {
  frame?: DraftFrame;
  povId?: ID;
  credentialClaimId?: ID;
  persona?: PersonaRole;
  /** Does the subject name the trigger (their news), the problem, or neither. */
  subjectStyle?: "trigger" | "problem" | "other";
  bet?: BetArm;
}

/** Blind pairwise critic (Haiku): would a busy buyer reply, versus a reference email that got replies? */
export interface DraftCritic {
  wouldReply: boolean;
  preferredOverReference: boolean;
  povObvious: boolean;
  fatal: string[];
  rewrite: string;
  unsupportedSpans: string[];
  referenceId: string;
  at: ISODateTime;
}

export type ReplyIntent = "positive" | "info_request" | "referral" | "not_now" | "objection" | "negative" | "unsubscribe" | "ooo";

export interface OutreachPackage {
  id: ID;
  mode: "cold" | "follow_up" | "linkedin" | "warm_intro" | "reply";
  personId?: ID;
  accountDomain: string;
  angleId?: ID;
  createdAt: ISODateTime;
  runId?: ID;
  steps: DraftStep[];
  alternates: DraftStep[];
  linkedin?: { note: string | null; recommendNoNote: boolean; postAcceptDm: string };
  intro?: { connectorName: string; wrapper: string; forwardable: { subject: string; body: string } };
  blockers: string[];
  warnings: string[];
  pushedTo?: { integrationId: IntegrationId; at: ISODateTime; externalId?: string }[];
  /** Dossier angles, best first. "Different angle" drafts the next unused one. */
  angleOrder?: ID[];
  connectorId?: ID;
  /** Reply mode: the pasted reply and how it was read. */
  reply?: { text: string; intent: ReplyIntent; summary: string; receivedAt?: ISODateTime; referral?: { name?: string; email?: string } };
  /** Reply mode: what to do. "suppress" means no draft; the founder confirms the suppression. */
  replyAction?: "draft" | "book" | "nurture" | "suppress";
  /** Reply mode, "not now": the check-in date proposed in the draft. */
  nurtureUntil?: ISODate;
  /** Set when an outside agent (Muse, Claude, n8n…) submitted this draft over MCP/REST. Untrusted text; review before approving. */
  origin?: { kind: "agent"; keyId: ID; keyName: string; externalId?: string; note?: string };
}

/* ─────────────────────────────── Pipeline ─────────────────────────────── */

/**
 * Six stages. A deal starts when the first real conversation happens ("talking"); touches before
 * that live on the person's timeline, not the board.
 */
export type Stage = "talking" | "qualified" | "pilot" | "proposal" | "won" | "lost" | "nurture";
export const OPEN_STAGES: Stage[] = ["talking", "qualified", "pilot", "proposal"];
export const STAGE_LABELS: Record<Stage, string> = {
  talking: "Talking",
  qualified: "Qualified",
  pilot: "Pilot",
  proposal: "Proposal",
  won: "Won",
  lost: "Lost",
  nurture: "Nurture",
};
export type LossReason = "no_pain" | "no_budget" | "timing" | "competitor" | "build" | "price" | "product_gap" | "went_dark" | "not_icp";

export interface Field {
  value: string | null;
  quotes: string[];
  status: "captured" | "partial" | "not_covered";
}

export interface Qualification {
  pain: 0 | 1 | 2;
  spend: 0 | 1 | 2;
  criticalEvent: 0 | 1 | 2;
  champion: 0 | 1 | 2;
  economicBuyer: 0 | 1 | 2;
  icpFit: 0 | 1 | 2;
  total: number;
  qualified: boolean;
}

/** One qualification card: the six scored dimensions plus decision & paper process. */
export interface QualificationCard {
  pain: Field & { impact?: string };
  spend: Field;
  criticalEvent: Field & { date?: ISODate; consequence?: string };
  /** `championStatus` (not `status`, which is the capture status every Field has). */
  champion: Field & { name?: string; championStatus?: "none" | "coach" | "untested" | "tested" };
  economicBuyer: Field & { name?: string; engaged?: boolean };
  fit: Field;
  decisionProcess: Field;
}

export interface MutualActionPlan {
  targetDate: ISODate;
  goal: string;
  milestones: { id: ID; step: string; ownerSide: "buyer" | "seller" | "both"; ownerName?: string; due: ISODate; status: "todo" | "done" | "blocked" }[];
}

export interface MeetingBrief {
  callType: "first_discovery" | "follow_up" | "demo" | "technical" | "pilot_review" | "negotiation";
  fiveMinuteSummary: string;
  oneThingToLearn: string;
  whatsNew: { text: string; url?: string; date?: ISODate; evidenceId?: ID }[];
  /** `sources[i]` cites `background[i]` (evidence id or a URL seen this run). */
  attendees: { name: string; title?: string; background: string[]; likelyWants: string; personId?: ID; sources?: { evidenceId?: ID; url?: string }[] }[];
  goals: string[];
  upfrontContract: string;
  agenda: { minutes: number; block: string }[];
  questions: { q: string; category: string; why: string; probe: string; mandatory: boolean; goodAnswer?: string; priority?: 1 | 2 | 3; evidenceId?: ID }[];
  objections: { objection: string; response: string; approved?: boolean }[];
  aboutUs60s: string;
  landmines: string[];
  coaching: string[];
  desiredNextStep: string;
  generatedAt: ISODateTime;
}

export interface Debrief {
  /** Verbatim quotes are only trusted from transcripts; founder notes are paraphrase. */
  source: "transcript" | "founder_notes";
  quotes: { id: string; speaker?: string; text: string; kind?: "verbatim" | "note" }[];
  card: QualificationCard;
  qualification: Qualification;
  stageSuggestion: { to: Stage; criteriaMet: string[]; criteriaMissing: string[] } | null;
  nextStep: { what: string; date?: ISODate; buyerAgreed: boolean; owner?: "buyer" | "founder" | "both" } | null;
  noNextStepWarning: boolean;
  recap: { subject: string; body: string };
  schedulingEmail?: { subject: string; body: string };
  committeeUpdates: { name: string; title?: string; role?: PersonaRole }[];
  singleThreadWarning?: string;
  map?: MutualActionPlan;
  pilotCriteria?: string;
  tasks: { what: string; due?: ISODate; owner: "founder" | "buyer" }[];
  newObjections: string[];
  customerWords: string[];
  /** "Name at Company", for display. Debriefs since referrals became leads also carry `referralPeople`. */
  referrals: string[];
  /** Who they suggested talking to ("who else should I talk to?"), structured, with their words when quoted. */
  referralPeople?: { name?: string; company?: string; quote?: string; domain?: string }[];
  toConfirm: string[];
  coaching: string[];
  generatedAt: ISODateTime;
  appliedAt?: ISODateTime;
  /** A price the founder stated on the call (logging it unlocks $ amounts on the deal). */
  priceQuoted?: { amountUsd: number; quote?: string };
  /** Opinions the founder stated on the call; the founder can add them to the POV bank. */
  povCandidates?: { text: string; basis: string }[];
  /** A pilot came up: offer to draft the one-page pilot proposal. */
  offerProposal?: boolean;
  /** Card fields THIS call gave evidence for; Apply merges only these onto the card on file. */
  covered?: (keyof QualificationCard)[];
  /** This call's clamped score for each covered scored field. */
  fieldScores?: Partial<Record<Exclude<keyof QualificationCard, "decisionProcess">, 0 | 1 | 2>>;
  runId?: ID;
}

export interface Meeting {
  id: ID;
  dealId: ID;
  title: string;
  startsAt: ISODateTime;
  attendees: { personId?: ID; name: string; title?: string }[];
  brief?: MeetingBrief;
  notesRaw?: string;
  debrief?: Debrief;
  /** Indexes of brief questions the founder starred; they pin to the debrief form. */
  starred?: number[];
}

export interface Deal {
  id: ID;
  accountDomain: string;
  name: string;
  stage: Stage;
  stageHistory: { stage: Stage; at: ISODateTime }[];
  source: "warm_intro" | "signal_cold" | "investor_intro" | "community" | "content" | "dinner" | "event" | "inbound" | "network" | "referral";
  amountUsd?: number;
  closeDate?: ISODate;
  /** Times the close date moved later (a deal slipping twice is worth a look). */
  closeDatePushes?: number;
  nextStep?: { what: string; date: ISODate; buyerAgreed: boolean };
  /** `viaReply`: the answered "yes" (its reply package) that added them, so undoing that answer takes them off again. */
  contacts: { personId: ID; role?: PersonaRole; viaReply?: ID }[];
  qualification?: Qualification;
  card?: QualificationCard;
  map?: MutualActionPlan;
  priceQuotes?: { at: ISODate; amountUsd: number; outcome?: "accepted" | "pushback" | "lost" }[];
  proposal?: { body: string; generatedAt: ISODateTime };
  pilot?: { criteria: string; feeUsd?: number; paid: boolean; startedOn?: ISODate; endsOn?: ISODate };
  lossReason?: LossReason;
  nurtureUntil?: ISODate;
  meetingIds: ID[];
  notes?: string;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  lastActivityAt: ISODateTime;
  external?: { integrationId: IntegrationId; externalId: string }[];
  /** Follow-ups agreed on calls (accepted from a debrief or added by hand). */
  tasks?: { id: ID; what: string; due?: ISODate; owner: "founder" | "buyer"; done: boolean; meetingId?: ID }[];
  /** Exit criteria the founder ticked by hand (keys from `src/lib/deals/rules.ts`). */
  checklist?: Record<string, boolean>;
  /** The forecast call made by whoever owns the number, when it differs from the one code proposes. */
  forecastCall?: { category: ForecastCategory; at: ISODateTime; note?: string };
  /** Every close date this deal has had, oldest first. Slips are counted from it, never remembered. */
  closeDateHistory?: { date: ISODate; at: ISODateTime }[];
}

/* ─────────────────────────────── Revenue ─────────────────────────────── */

/** Where a deal sits in the forecast call. Code proposes one from evidence; the owner of the number can override it. */
export type ForecastCategory = "commit" | "best_case" | "pipeline" | "omitted";

/**
 * The number a Head of GTM is measured on: new annual contract value closed in a period. Optional;
 * a founder-led workspace can plan on `goal` (paid pilots) alone. Priors are used until the
 * workspace has enough closed deals of its own to replace them.
 */
export interface RevenueTarget {
  amountUsd: number;
  periodStart: ISODate;
  periodEnd: ISODate;
  /** "Q4 new ARR" */
  label: string;
  winRate?: number;
  avgDealUsd?: number;
  cycleDays?: number;
  /** Open pipeline needed per dollar still to close (3 = 3×). */
  coverageTarget?: number;
}

/** The forecast as it stood at the start of a week, so "what changed" is computed rather than remembered. */
export interface ForecastSnapshot {
  weekOf: ISODate;
  takenAt: ISODateTime;
  periodEnd: ISODate;
  target: number;
  closedWon: number;
  commit: number;
  bestCase: number;
  pipeline: number;
  /** The call at the time (category-weighted), so forecast accuracy can be scored when the period closes. */
  call?: number;
  deals: { id: ID; name: string; stage: Stage; category: ForecastCategory; amountUsd: number; closeDate?: ISODate }[];
}

/** The weekly GTM update (for the CEO, the board or the team). Numbers come from code; the model writes the story. */
export interface GtmUpdate {
  weekOf: ISODate;
  generatedAt: ISODateTime;
  audience: "ceo" | "board" | "team";
  subject: string;
  body: string; // markdown
  runId?: ID;
}

/* ─────────────────────────────── Plays ─────────────────────────────── */

/** A play the workspace runs: on (it feeds Today) or paused, and every time its matches were worked in bulk. */
export interface PlayState {
  enabled: boolean;
  updatedAt: ISODateTime;
  /** Accounts worked from this play and when, so results are attributed in code. */
  runs?: { at: ISODateTime; domains: string[] }[];
}

/* ─────────────────────────────── Activity & the desk ─────────────────────────────── */

export type ActivityKind =
  | "touch_sent"
  | "reply_received"
  | "bounce"
  | "unsubscribe"
  | "meeting_held"
  | "intro_requested"
  | "intro_made"
  | "linkedin_connect"
  | "linkedin_dm"
  | "stage_changed"
  | "event_invited"
  | "event_attended"
  | "note"
  | "skip"
  | "pushed"
  /** Consumer: a conversation with a user (interview, onboarding call, churn call). */
  | "user_conversation"
  /** Consumer: outreach to a creator, community, newsletter, podcast or press contact was sent. */
  | "partner_contacted";

export interface Activity {
  id: ID;
  at: ISODateTime;
  kind: ActivityKind;
  personId?: ID;
  accountDomain?: string;
  dealId?: ID;
  eventId?: ID;
  partnerId?: ID;
  /** The meeting a `meeting_held` activity records (set by the debrief). */
  meetingId?: ID;
  channel?: "email" | "linkedin" | "phone" | "in_person" | "intro" | "integration";
  draftRef?: { packageId: ID; step: number };
  angleId?: ID;
  signalType?: SignalType;
  summary: string;
  body?: string;
  sentiment?: "positive" | "neutral" | "negative" | "referral" | "ooo" | "unsubscribe";
  source?: "founder" | "ember" | IntegrationId;
  /** Touches only: what the founder marked in "Check replies" (R/N/B/U). Unset = not checked yet. */
  outcome?: "replied" | "no_reply" | "bounced" | "not_sent";
  outcomeAt?: ISODateTime;
  /** Touches: frame, POV, persona, subject style and message-bet arm, stamped when it was sent. */
  tags?: TouchTags;
  /** Touches from a draft: how much the founder changed it before sending, 0 (as drafted) to 1 (rewritten). */
  editDistance?: number;
  /** Replies only: a yes the founder answered and then let go (no call, and no deal to close as lost). */
  loopClosedAt?: ISODateTime;
  /**
   * Set when "Delete their details" anonymised it: `who` is one opaque id per deleted person (in place of
   * personId), `draft` what the touch was (the draft itself is gone), so the cold cap, the per-company
   * contact cap and the scoreboard still add up.
   */
  forgotten?: { who: ID; draft?: { packageId: ID; step: number; mode: OutreachPackage["mode"] } };
}

export type SkipReason = "not_relevant_now" | "wrong_person" | "weak_angle" | "already_handled" | "tone_off" | "other";

export type MoveKind =
  | "reply"
  | "follow_up"
  | "first_touch"
  | "linkedin"
  | "intro_ask"
  | "meeting_prep"
  | "debrief"
  | "next_step_missing"
  | "signal"
  | "event_task"
  | "question"
  | "review"
  | "post"
  | "setup"
  | "check_replies"
  | "close_out"
  | "import"
  | "research"
  // Consumer moves.
  | "growth"
  | "partner"
  | "user_talk"
  | "experiment";

/** One item in the founder's queue ("Your moves" on Today). Produced by code rules; ranked by code. */
export interface Move {
  id: ID;
  createdAt: ISODateTime;
  dueOn: ISODate;
  kind: MoveKind;
  title: string;
  why: string;
  minutes: number;
  ref?: EntityRef;
  draft?: { packageId: ID; step: number };
  evidenceIds: ID[];
  priority: number;
  rule: string; // which rule produced it, shown on hover
  status: "open" | "done" | "skipped" | "snoozed";
  snoozedUntil?: ISODate;
  skipReason?: SkipReason;
  receivedAt?: ISODateTime; // replies: speed-to-lead timer origin
  href?: string; // where "Open" goes
  /** People (check_replies) or deals (close_out) this move covers. */
  subjectIds?: ID[];
  /** Reply moves: the reply_received activity being answered. */
  activityId?: ID;
  /** The dated public fact behind the why line (a signal), shown as a source chip. */
  source?: { url: string; date?: ISODate; quote?: string };
  overdueDays?: number;
  /** Marked done by the engine because its condition resolved (not by the founder); reopens if the condition returns. */
  autoDone?: true;
  /** The play this move came from, when one did (see `src/lib/plays`). */
  playId?: string;
}

export interface Scoreboard {
  weekOf: ISODate;
  conversations: [number, number];
  firstTouches: [number, number];
  replies: number;
  /** Only shown when n ≥ 20. */
  replyRate?: { value: number; n: number };
  meetingsBooked: number;
  qualifiedDeals: number;
  /** Only once a price has been quoted; before that, dollar pipeline is fiction. */
  qualifiedPipelineUsd?: number;
  dealsMissingNextStep: number;
  goalProgress: [number, number]; // pilots/design partners won vs target
  positiveReplies?: number;
  introAsks?: [number, number];
}

/** A one-click change proposed by a weekly review. The founder applies or dismisses it; nothing applies itself. */
export interface ReviewProposal {
  id: ID;
  kind: "close_lost" | "nurture" | "add_pov" | "add_objection" | "add_customer_words" | "add_anti_icp" | "add_banned_word" | "message_bet" | "note" | "revise_foundation" | "experiment";
  title: string; // ≤12 words, "Nurture Northwind until Jan 12"
  detail: string; // the reason, ≤40 words
  /** Verbatim quotes or facts behind it. */
  justification?: string[];
  dealId?: ID;
  lossReason?: LossReason;
  nurtureUntil?: ISODate;
  text?: string; // the POV / objection / phrase to add
  objectionCategory?: ObjectionCard["category"];
  bet?: { variable: string; control: string; variant: string; why: string; dimension?: BetDimension; controlKey?: string; variantKey?: string };
  /** A started message bet's verdict from a monthly review. Code keeps it "inconclusive" below 100 sends per arm. */
  betReadout?: { verdict: "keep" | "drop" | "inconclusive"; notes: string; at: ISODateTime };
  /** A "note" that is the week's optional post draft (Today offers it the following week). */
  post?: boolean;
  /** revise_foundation: the one playbook change it makes, accepted or rejected by the founder. */
  revision?: FoundationRevision;
  /** Consumer growth review: an experiment the founder can add to the list with one click. */
  experiment?: Pick<Experiment, "stage" | "hypothesis" | "change" | "metric" | "ice" | "baseline">;
  status: "open" | "applied" | "dismissed";
  decidedAt?: ISODateTime;
}

/** What a bet refresh may change. Code applies each one; the model never writes a path. */
export type RevisionTarget =
  | "positioning.category"
  | "positioning.bestFit"
  | "icp.sentence"
  | "icp.segment"
  | "icp.criterion"
  | "icp.antiIcp"
  | "persona.line"
  | "persona.pain"
  | "messaging.oneLiner"
  | "messaging.customerWords";

/** One tracked suggestion to the playbook (SPEC W1c refresh): before and after, applied only when accepted. */
export interface FoundationRevision {
  target: RevisionTarget;
  op: "set" | "add" | "remove" | "validate";
  /** Personas and criteria: which one, by id (indexes move when the founder edits). */
  refId?: ID;
  text?: string;
  /** icp.antiIcp add: why it disqualifies. */
  reason?: string;
  /** icp.criterion add: the criterion's shape. */
  criterion?: Pick<ICPCriterion, "kind" | "mustHave" | "detection" | "howToTest">;
  section: "positioning" | "icp" | "personas" | "messaging";
  /** What the playbook says now; applying is refused if it changed since. */
  before: string;
  after: string;
}

/** A playbook version a refresh replaced, kept so it can be restored (SPEC §6: the last 10). */
export interface FoundationVersion {
  version: number;
  /** When it was replaced. */
  at: ISODateTime;
  /** What the next version changed, in words. */
  changes: string[];
  /** rebuild: the bet was written again from the site (a fresh first read). */
  source: "refresh" | "monthly" | "restore" | "rebuild";
  runId?: ID;
  snapshot: Foundation;
}

/**
 * monday = pipeline review, friday = learning review, growth = the consumer Monday review,
 * monthly = the monthly review, refresh = a bet refresh.
 */
export type ReviewKind = "monday" | "friday" | "growth" | "monthly" | "refresh";

export interface Brief {
  date: ISODate;
  kind: "daily" | ReviewKind;
  greeting: string;
  matters: { text: string; url?: string; ref?: EntityRef; date?: ISODate; quote?: string }[]; // ≤3
  generatedAt: ISODateTime;
  runId?: ID;
  review?: string; // Monday/Friday review narrative (markdown)
  scoreboard?: Scoreboard;
  moveIds?: ID[];
  /** Signal and reply keys a brief already covered, so the model only runs when something is new. */
  seen?: string[];
  llmRuns?: number;
  /** What Today started on its own today ("mtg:<id>:<brief at>", "acc:<domain>:<move id>"): capped per day, never twice (moves/ahead). */
  ahead?: string[];
  reviewKind?: ReviewKind;
  proposals?: ReviewProposal[];
  reviewRunId?: ID;
  /** Deals still listed on an open close-out at the day's last prepare (the next morning's greeting says so first). */
  closeOutLeft?: number;
}

/* ─────────────────────────────── Events ─────────────────────────────── */

export interface GuestCandidate {
  personId?: ID;
  name?: string;
  title: string;
  accountDomain: string;
  role: "anchor" | "customer_host" | "prospect" | "connector";
  score: number;
  dealId?: ID;
  personalLine: string;
  warmPath?: string;
  /** Code-scored parts: fit × seniority × why-now × warm path × same city. */
  scoreParts?: { fit: number; seniority: number; whyNow: number; warmPath: boolean; sameCity: boolean };
  evidenceIds?: ID[];
  /** Set when this guest competes with us or with another guest; such guests never share a room. */
  competitorConflict?: string | null;
  /** What this guest wants from the room (≤15 words); used in reminders and the briefing book. */
  wants?: string;
  /** Planned introduction: seat them beside this guest. */
  seatNextTo?: { guestId: ID; why: string };
  /** One of the 6–8 accounts the room needs; if 5+ decline, reschedule. */
  mustAttend?: boolean;
}

export interface Guest extends GuestCandidate {
  id: ID;
  status: "candidate" | "invited" | "accepted" | "declined" | "confirmed" | "attended" | "no_show" | "waitlist";
  invitedOn?: ISODate;
  dietary?: string;
  seat?: { table: number; seat: number; why?: string };
  voiceNote?: string;
  debrief?: {
    challenge: string;
    nextStep: string | null;
    fit: "pursue" | "nurture" | "none";
    nextMorningNote: string;
    wishes?: string;
    peersNamed?: string[];
    generatedAt?: ISODateTime;
  };
  /** Added by the founder by hand; survives re-plans. */
  manual?: boolean;
  /** The founder edited this guest's personal line or wants; survives re-plans. */
  edited?: boolean;
  remindedOn?: ISODate;
  /** Human follow-up touches after the event (max 5 in 90 days). */
  touches?: { at: ISODate; what: string }[];
}

export interface DinnerPlan {
  goal: "accelerate_deals" | "create_pipeline" | "expand_customers" | "market_intel";
  city: string;
  targetDate?: ISODate;
  budgetUsd: { low: number; high: number };
  coHostSuggestion?: string;
  coHost?: { name: string; kind: "vc_platform" | "non_competing_startup" | "community" | "customer"; why: string } | null;
  /** The agent's pick when the founder named no co-host; becomes `coHost` only once the founder says they agreed. */
  suggestedCoHost?: { name: string; kind: "vc_platform" | "non_competing_startup" | "community" | "customer"; why: string };
  themes: {
    title: string;
    question: string;
    whyNow: string;
    prompts: string[];
    reservePrompts: string[];
    evidenceIds?: ID[];
    /** Signals behind the theme that have no evidence record yet (job posts, news). */
    sources?: { url: string; label: string; date?: ISODate }[];
  }[];
  inviteMath: {
    invites: number;
    expectedAcceptRate: number;
    confirmsTarget: number;
    expectedShowRate: number;
    seats: number;
    warmInvites?: number;
    /** Cold invites count against the weekly cold first-touch cap. */
    coldInvites?: number;
    poolSize?: number;
    mustAttend?: number;
  };
  composition?: { hosts: number; anchor: number; customers: number; prospects: number; connector: number; seats: number };
  /** What the anchor (dinner) or framer (roundtable) should cover in 5–10 minutes. */
  anchorBrief?: string;
  /** Code-made recommendations and warnings (kind gate, thin pool, cold-cap impact). */
  notes?: string[];
  generatedAt?: ISODateTime;
  timeline: { due: ISODate; offset: string; task: string; owner: "founder" | "ember" | "cohost"; done?: boolean }[];
  venueCriteria: string[];
  venueIdeas: { name: string; why: string; url: string; quote?: string }[];
  copy: {
    inviteFounder: { subject: string; body: string };
    inviteCustomerHost: { subject: string; body: string };
    reminder48h: string;
    dayOfText: string;
    /** On a decline: "Is there a colleague who should be there instead?" */
    declineReply?: string;
  };
  runOfShow: { time: string; segment: string; notes: string }[];
  seatingRules: string[];
  followUp: { nextMorningNote: string; groupEmail: string; cadence: { day: number; touch: string }[]; noShow: string };
}

export interface GtmEvent {
  id: ID;
  kind: "dinner" | "roundtable";
  title: string;
  status: "planning" | "inviting" | "confirmed" | "done" | "cancelled";
  plan?: DinnerPlan;
  chosenThemeIdx?: number;
  date?: ISODateTime;
  venue?: { name: string; address?: string };
  /** Where the room is, for "Nearby": a city center or a geocoded venue, and how far guests would travel. */
  location?: { label: string; lat: number; lng: number; radiusKm: number; precision: "city" | "address" };
  guests: Record<ID, Guest>;
  createdAt: ISODateTime;
  runId?: ID;
  /** What the founder asked for; kept so a re-plan or retry uses the same inputs. */
  request?: { city?: string; month?: string; date?: ISODate; goal: DinnerPlan["goal"]; budgetUsd?: number; coHost?: string };
  /** After the event: themes heard and the group email (Chatham House). */
  after?: { themes: string[]; groupEmail: { subject: string; body: string }; generatedAt: ISODateTime; runId?: ID };
  /** Candidate keys the founder removed (the cut test); re-plans don't bring them back. */
  cut?: string[];
}

/* ─────────────────────────────── Integrations hub ─────────────────────────────── */

export type IntegrationId =
  | MetricProviderId
  | "waitlist"
  | "hubspot"
  | "attio"
  | "pipedrive"
  | "instantly"
  | "smartlead"
  | "lemlist"
  | "apollo"
  | "firecrawl"
  | "slack"
  | "webhook_out"
  | "webhook_in"
  | "csv"
  | "mcp"
  | "gmail"
  | "calendly"
  | "calcom";

export interface IntegrationState {
  id: IntegrationId;
  enabled: boolean;
  /** Connector-specific settings. Secrets (API keys, tokens) live in `.data/secrets.json`, never here. */
  config: Record<string, string | number | boolean | undefined>;
  connectedAt?: ISODateTime;
  lastSyncAt?: ISODateTime;
  lastError?: { at: ISODateTime; message: string };
  stats?: { pushed: number; pulled: number };
}

/** Events other tools can subscribe to via outbound webhooks. */
export type HubEventType =
  | "account.added"
  | "account.tracked"
  | "dossier.ready"
  | "draft.approved"
  | "touch.sent"
  | "reply.logged"
  | "deal.created"
  | "deal.stage_changed"
  | "meeting.debriefed"
  | "brief.ready";

export interface OutboundWebhook {
  id: ID;
  url: string;
  label: string;
  events: HubEventType[];
  createdAt: ISODateTime;
  lastDelivery?: { at: ISODateTime; status: number | "error"; event: HubEventType };
  /** Set when the endpoint answered 410 Gone (or the founder paused it); nothing is sent until resumed. */
  paused?: boolean;
}

/* ─────────────────────────────── Runs & usage ─────────────────────────────── */

export type WorkflowId =
  | "foundation"
  | "brief"
  | "discovery"
  | "dossier"
  | "compose"
  | "prep"
  | "debrief"
  | "review"
  | "dinner_plan"
  | "ask"
  | "enrich"
  | "asset"
  | "network"
  | "partners"
  | "studio"
  | "visual"
  | "agent_ask"
  | "gtm_update";

export type ModelTierName = "strategist" | "operator" | "fast" | "none";

export interface RunStep {
  at: ISODateTime;
  type: "status" | "thinking" | "search" | "read" | "sources" | "action" | "writing" | "text" | "error";
  text: string;
  url?: string;
  host?: string;
}

export interface RunReceipt {
  durationMs: number;
  sources: number;
  searches: number;
  fetches: number;
  drafts: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costUsd: number;
  model: ModelTierName;
  /** The model that did the work, on providers other than Anthropic (Anthropic's are named by `model`). */
  modelName?: string;
  /** No price was known for that model: costUsd is 0, not free. */
  unpriced?: boolean;
  /**
   * Compatibility mode: the API rejected an optional feature (the refusal-fallback and thinking betas, or
   * strict tool schemas) and the run went without it. `reason` is what the API said.
   */
  /** What compat mode left out. "betas" is both the fallback and the binding, on receipts from before they were split. */
  compat?: { features: ("fallback" | "binding" | "strict" | "betas")[]; reason: string };
}

export interface RunSummary {
  id: ID;
  workflow: WorkflowId;
  title: string;
  ref?: EntityRef;
  startedAt: ISODateTime;
  endedAt?: ISODateTime;
  status: "queued" | "running" | "done" | "error" | "stopped";
  receipt?: RunReceipt;
  /** requestId and detail (what the API said) are for "Copy details"; message is the plain sentence. */
  error?: { code: string; message: string; requestId?: string; detail?: string };
  seen?: boolean; // founder has looked at the result
}

export interface UsageMonth {
  costUsd: number;
  runs: number;
  byWorkflow: Partial<Record<WorkflowId, number>>;
  freeSignals: number; // signal lookups done in code (zero tokens)
  /** Firecrawl credits spent on people data (adding a person, finding an email). Searching is free. */
  dataCredits?: number;
}

/* ─────────────────────────────── Studio (marketing and launch copy) ─────────────────────────────── */

/**
 * Who reads the copy. It changes the reader the critic plays, which moves fit and which formats
 * come first. Founders of every kind use Studio, so this never assumes B2B.
 */
export type StudioAudience = "b2b" | "b2c" | "prosumer" | "developer";

/** A container: a channel or surface with fixed parts and limits (see src/lib/studio/formats.ts). */
export type StudioFormatId =
  | "one_liner"
  | "homepage_hero"
  | "billboard"
  | "linkedin_post"
  | "x_post"
  | "community_post"
  | "show_hn"
  | "product_hunt"
  | "email_announcement"
  | "meta_ad"
  | "linkedin_ad"
  | "search_ad"
  | "image"
  | "short_video"
  | "creator_brief"
  | "app_store"
  | "waitlist_page"
  | "comparison_page"
  | "changelog"
  | "customer_story";

/** Why the founder is writing now. The same format reads differently for a launch and a lesson. */
export type StudioOccasion = "evergreen" | "launch" | "feature" | "funding" | "milestone" | "customer_win" | "lesson" | "data_drop" | "hiring" | "event";

/**
 * Raw material only the founder has: the moments, numbers and words copy is built from. Copy may
 * only state specifics that trace to this, an approved claim or the playbook. Never invented.
 */
export interface StudioMaterial {
  id: ID;
  /** enemy: the old way the product replaces. limit: what it can't do yet (honest scope builds trust). */
  kind: "story" | "number" | "quote" | "demo" | "fact" | "belief" | "enemy" | "limit";
  text: string;
  /** Where a number or quote comes from, and when. Public claims need it (FTC/ASA substantiation). */
  source?: string;
  /** A user's words: may they be named, or only quoted without a name? */
  permission?: "public" | "anonymized_only";
  createdAt: ISODateTime;
  uses: number;
}

export type StudioLintCode =
  | "OVER_LIMIT"
  | "UNDER_MIN"
  | "PART_MISSING"
  | "PLACEHOLDER"
  | "AI_TELL"
  | "HYPE_WORD"
  | "AI_VOCAB"
  | "NEGATIVE_PARALLEL"
  | "TRIPLET"
  | "RHETORICAL_OPENER"
  | "ANNOUNCE_OPENER"
  | "BROETRY"
  | "MONOTONE"
  | "EM_DASH"
  | "EXCLAMATION"
  | "EMOJI"
  | "HASHTAGS"
  | "ALL_CAPS"
  | "VAGUE"
  | "NUMBER_UNSOURCED"
  | "SUPERLATIVE_UNSOURCED"
  | "COMPETITOR_CLAIM"
  | "FAKE_URGENCY"
  | "NEVER_SAY"
  | "PLATFORM_RULE"
  | "VISUAL_CLICHE"
  | "FK_GRADE"
  | "SAME_SHAPE";

export interface StudioLint {
  passed: boolean;
  /** `part` is the format part the issue is in ("headline"), or null for the whole option. */
  violations: { code: StudioLintCode; part: string | null; detail: string; severity: "error" | "warn" }[];
  stats: { words: number; grade: number; concrete: number; vague: number };
}

/** Hidden critic verdict (Haiku, blind, reading as the audience). Telemetry and ordering only. */
export interface StudioCritic {
  rank: number;
  of: number;
  stop: boolean;
  act: boolean;
  soundsAi: boolean;
  giveaway: string;
  swappable: boolean;
  fatal: string[];
  rewrite: string;
  at: ISODateTime;
}

/** One candidate. Parts are keyed by the format's part keys ("headline", "subhead"…). */
export interface StudioOption {
  id: ID;
  /** The move it was written with (src/lib/studio/moves.ts). */
  moveId: string;
  parts: Record<string, string>;
  /** Receipts its specifics rest on: approved claims, material, POVs, customer words. */
  receiptIds: ID[];
  /** The writer's one line on why it should work. Shown to the founder. */
  why: string;
  lint: StudioLint;
  edited?: boolean;
  kept?: boolean;
  critic?: StudioCritic;
  /** The last image prompt Claude wrote for this option, to paste into ChatGPT or reuse. */
  imagePrompt?: { text: string; preset: string; at: ISODateTime };
}

export interface StudioPiece {
  id: ID;
  format: StudioFormatId;
  occasion: StudioOccasion;
  audience: StudioAudience;
  brief: string;
  /** Curated creative references used for this piece; never product claim receipts. */
  campaignIds?: string[];
  /** Optional founder-supplied example or creative direction. */
  reference?: string;
  bold?: boolean;
  title: string;
  /** Best first: lint-clean options before ones with issues, then the reader's ranking. */
  options: StudioOption[];
  /** Facts the founder must supply ([[like this]] in the copy). Never filled in by the agent. */
  gaps: string[];
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  runId?: ID;
}

export interface StudioProfile {
  audience: StudioAudience;
  /** One line on who reads the copy. The critic plays this person. */
  reader: string;
  /** The product's name as copy should write it. */
  productName: string;
  /** Words the founder never wants in copy, on top of the house list. */
  neverSay: string[];
  /** Brand colors for graphics, hex, most used first. Empty → Studio's neutral ink-and-paper palette. */
  colors?: string[];
}

/**
 * An image layer: a real screenshot or photo the founder uploaded, or one OpenAI's GPT Image model
 * painted from a prompt Claude wrote. Files live in `.data/studio/`, never in the workspace JSON.
 */
export interface StudioCreativeReview {
  score: number;
  concept?: number;
  distinctiveness?: number;
  craft?: number;
  template?: boolean;
  issues: string[];
  fix: string;
}

export interface StudioImage {
  id: ID;
  source: "upload" | "openai" | "chatgpt";
  file: string;
  mime: "image/png" | "image/jpeg";
  width: number;
  height: number;
  alt: string;
  /** Generated images only. A generated image is never presented as the product's UI or a real customer. */
  generated?: {
    prompt: string; model: string; size: string; quality: string;
    artDirection?: { version: string; style: string; energy: string; referenceIds: string[]; optionId?: ID };
    /** Absent on subscription image-only runs, which make no additional model calls. */
    review?: StudioCreativeReview;
  };
  createdAt: ISODateTime;
}

/** Claude's layouts for a graphic (src/lib/studio/visuals.ts). */
export type VisualLayout = "statement" | "stat" | "quote" | "before_after" | "screenshot" | "photo" | "announcement";

export type VisualCheckCode =
  | "TEXT_NOT_APPROVED"
  | "TEXT_MISSING"
  | "LOW_CONTRAST"
  | "SAFE_ZONE"
  | "SMALL_TYPE"
  | "TEXT_HEAVY"
  | "SIZE_MISMATCH"
  | "UNSAFE_REMOVED"
  | "OVERFLOW"
  | "NO_IMAGE_SLOT"
  | "RENDER_FAILED"
  | "REVIEW";

/**
 * A finished graphic: Claude's sanitized SVG design, optionally over an image layer, rendered to
 * PNG on the server. Every word on it comes from the option's linted text.
 */
export interface StudioVisual {
  id: ID;
  pieceId: ID;
  optionId: ID;
  layout: VisualLayout;
  /** Preset id and pixel size ("linkedin" → 1200×627). */
  preset: string;
  width: number;
  height: number;
  svgFile: string;
  pngFile: string | null;
  imageId?: ID;
  /** Where the image layer sits, in canvas pixels. */
  slot?: { x: number; y: number; w: number; h: number };
  why: string;
  checks: { code: VisualCheckCode; detail: string; severity: "error" | "warn" }[];
  /** Claude's assessment of the actual render: 8+ overall and 7+ per creative dimension. */
  review?: StudioCreativeReview;
  /** Uses a generated image layer: platforms ask advertisers to disclose realistic AI imagery. */
  aiImagery: boolean;
  kept?: boolean;
  /** The option's words were edited after this graphic was made. */
  stale?: boolean;
  createdAt: ISODateTime;
  runId?: ID;
}

export interface StudioState {
  profile: StudioProfile | null;
  material: StudioMaterial[];
  pieces: Record<ID, StudioPiece>;
  images: Record<ID, StudioImage>;
  visuals: Record<ID, StudioVisual>;
}

/* ─────────────────────────────── Workspace ─────────────────────────────── */

export interface Suppression {
  id: ID;
  email?: string;
  domain?: string;
  reason: "unsubscribe" | "bounce" | "requested_delete" | "customer" | "competitor" | "manual";
  at: ISODateTime;
}

/** A row from the founder's LinkedIn Connections.csv export. Stored in connections.json, never sent to Claude in bulk. */
/** How someone knows the founder: tagged by the founder, or matched to a signup or user list (signup). */
export type RelationshipTag = "design_partner" | "past_user" | "ex_colleague" | "customer" | "investor" | "connector" | "signup";

export interface Connection {
  id: ID;
  firstName: string;
  lastName: string;
  url: string;
  email?: string;
  company: string;
  position: string;
  connectedOn?: ISODate;
  companyNorm: string;
  matchedDomain?: string;
  /** Code + Haiku screen: is this a buyer title at a likely-ICP company? */
  screen?: { icpCompany: "yes" | "no" | "maybe"; buyerTitle: boolean; screenedAt: ISODateTime };
  /** Set when a re-import shows a new company or title. */
  previous?: { company: string; position: string; changedOn: ISODate };
  /** Network screen detail (company-level verdict and why). Unknown is never treated as unlikely. */
  fit?: "likely" | "unknown" | "unlikely";
  fitReason?: string;
  /** Persona role the title matched in code, when it's a buyer title. */
  titleRole?: PersonaRole;
  /** Founder tags. design_partner / past_user / customer / ex_colleague / signup mean they know the product or the founder. */
  tags?: RelationshipTag[];
  /** Company and title as seen on each import, oldest first (the job-change diff). */
  history?: { company: string; position: string; seenOn: ISODate }[];
  /** The Person record created for this connection, once its company is tracked. */
  personId?: ID;
}

/** One company in the network screen (Integrations → LinkedIn import result). Built in code from connections.json. */
export interface NetworkCompany {
  name: string;
  domain?: string;
  contacts: number;
  buyerTitles: number;
  fit: "likely" | "unknown" | "unlikely";
  reason: string;
  jobChanges?: number;
  /** Already an account in the workspace (warm paths were attached automatically). */
  tracked?: boolean;
}

export interface Workspace {
  schemaVersion: 1;
  rev: number; // bumps on every write; clients use it to detect staleness
  createdAt: ISODateTime;
  sample?: boolean; // true for the demo workspace
  /**
   * First run. reading → drafting → offer ("Here's who I'd talk to first" is up; no offer letter) → hired.
   * The rest is what /welcome needs to resume after a reload.
   */
  onboarding: {
    status: "new" | "reading" | "drafting" | "offer" | "hired";
    hiredAt?: ISODateTime;
    runId?: ID;
    url?: string;
    domain?: string;
    /** "Anything your website won't tell me?" (or the description when there's no site). */
    note?: string;
    /** "Who buys from you?" at the start. Unset = let the site decide. */
    market?: Market;
    site?: "reading" | "ok" | "thin" | "spa" | "none" | "unreachable";
    pagesRead?: number;
    ledger?: OnboardingLedgerRow[];
    /** Inline answers while reading: last 3 users, what they did before, who buys (thin site). */
    answers?: { last3?: string; before?: string; who?: string };
    questionsDone?: boolean;
    /** When each part of the first bet landed. */
    sections?: Partial<Record<"snapshot" | FoundationSection, ISODateTime>>;
    discoveryRunId?: ID;
    dossierRunIds?: ID[];
    /** The "first three" the founder hired Ember to research (domains, best first). Today keeps a card for each. */
    firstThree?: string[];
    error?: { code: string; message: string };
  };
  founder: {
    name: string;
    title?: string;
    email?: string;
    /** Used only after a prospect engages ("Here are two times, or grab one here"). */
    schedulingUrl?: string;
    availability?: string; // "Tue–Thu 10–4 PT"
    linkedinPremium?: boolean;
    gmailAuthUser?: string;
    /** "HH:MM" local. After it, deals with no dated next step fold into one close-out card on Today. Default 16:30. */
    closeOutTime?: string;
  };
  company: CompanySnapshot | null;
  foundation: Foundation | null;
  /** Versions a refresh or restore replaced, oldest first, at most 10. */
  foundationHistory?: FoundationVersion[];
  claims: Claim[];
  objections: ObjectionCard[];
  povs: PovItem[];
  assets: Asset[];
  /** Marketing and launch copy: the founder's raw material and every piece written from it. */
  studio: StudioState;
  /** Summary of the last LinkedIn connections import (rows live in connections.json). */
  network?: {
    importedAt: ISODateTime;
    total: number;
    atIcpCompanies: number;
    buyerTitles: number;
    jobChanges: number;
    /** Distinct companies, likely-ICP companies, unscreened/unknown companies, connections with an email. */
    companies?: number;
    icpCompanies?: number;
    unknownCompanies?: number;
    withEmail?: number;
    /** "37 of your 1,240 connections work at likely-ICP companies; 6 have buyer titles." Built in code. */
    line?: string;
    screenedAt?: ISODateTime;
    runId?: ID;
    fileName?: string;
    /** Up to 25, warm-path order. */
    topCompanies?: NetworkCompany[];
  };
  voice: VoiceCard | null;
  sender: SenderIdentity | null;
  goal: Goal;
  caps: Caps;
  connectors: Connector[];
  /** Every intro asked for or made, by id. */
  intros: Record<ID, Intro>;
  evidence: Record<ID, Evidence>;
  accounts: Record<string, Account>;
  people: Record<ID, Person>;
  deals: Record<ID, Deal>;
  meetings: Record<ID, Meeting>;
  outreach: Record<ID, OutreachPackage>;
  activities: Activity[];
  moves: Record<ID, Move>;
  briefs: Record<ISODate, Brief>;
  events: Record<ID, GtmEvent>;
  integrations: Partial<Record<IntegrationId, IntegrationState>>;
  /** Read-only provider aggregates; independent of manually tracked deals and growth weeks. */
  businessMetrics?: Partial<Record<MetricProviderId, MetricSnapshot>>;
  webhooks: OutboundWebhook[];
  suppression: Suppression[];
  /**
   * What "Delete their details" keeps besides an address: one-way fingerprints of each deleted person's
   * LinkedIn profile and of their name at their company (src/lib/people/forget.ts forgetKeys), so a
   * restore or an import can recognise them without holding who they were.
   */
  forgotten?: string[];
  runs: RunSummary[]; // newest first, last 200
  usage: Record<string /* YYYY-MM */, UsageMonth>;
  /** Consumer: one row per week, oldest first. */
  growthLog?: GrowthWeek[];
  /** Consumer waitlist aggregates; database credentials live only in the secrets store. */
  waitlist?: WaitlistTracking;
  /** Creators, communities, newsletters, podcasts, press and partner brands or companies, by id. */
  partners?: Record<ID, Partner>;
  /** Consumer: growth experiments, by id. */
  experiments?: Record<ID, Experiment>;
  /** Consumer: Sean Ellis "how would you feel if you could no longer use it?" survey results, oldest first. */
  pmfSurveys?: PmfSurvey[];
  /** The revenue number, weekly forecast snapshots (last 26) and weekly updates (last 12). */
  revenue?: { target?: RevenueTarget; snapshots?: ForecastSnapshot[]; updates?: GtmUpdate[] };
  /** Plays by id (see `src/lib/plays/catalog.ts`). A play with no entry runs with its default. */
  plays?: Record<string, PlayState>;
  /** What each market had when the founder last switched away from it, so switching back restores it. */
  marketMemory?: Partial<Record<Market, MarketMemory>>;
}

export interface MarketMemory {
  goal: Pick<Goal, "metric" | "target" | "targetLabel">;
  /** Consumer only: the kind of consumer company. */
  consumerModel?: ConsumerModel;
}

export interface PmfSurvey {
  id: ID;
  on: ISODate;
  /** People who answered (ask only users with 2+ uses in the last 2 weeks). */
  answers: number;
  veryDisappointed: number;
  /** Who was asked, when it was one segment ("weekly runners"). */
  segment?: string;
  note?: string;
}

/* ─────────────────────────────── Ask (threads.json, not the workspace) ─────────────────────────────── */

export type AskProposalKind =
  | "track_account"
  | "create_deal"
  | "set_next_step"
  | "change_stage"
  | "add_task"
  | "add_person"
  | "add_pov"
  | "add_claim"
  | "add_objection"
  | "suppress"
  | "start_workflow";

/** A write proposed in Ask. Shown as an action chip; nothing changes until the founder applies it. */
export interface AskProposal {
  id: ID;
  kind: AskProposalKind;
  summary: string; // ≤12 words
  reason: string; // ≤30 words
  /** Validated per kind on the server (see src/lib/workflows/ask.ts). */
  payload: Record<string, unknown>;
  status: "proposed" | "applied" | "dismissed";
  decidedAt?: ISODateTime;
  /** start_workflow: the run the founder started from the chip. */
  runId?: ID;
}

export interface AskCitation {
  url: string;
  title?: string;
  quote?: string;
}

/** One display turn. The model's own history is stored separately (append-only) on the server. */
/**
 * The numbers behind an instant answer, so Ask can draw a card built for the question rather than a list.
 * Code-computed like the rows. `facts` counts the workspace records the answer read; `domains` names a few.
 */
export type AnswerView =
  | {
      kind: "forecast";
      period: string;
      start: ISODate;
      end: ISODate;
      weeksLeft: number;
      /** 0 when no target is set. */
      target: number;
      closedWon: number;
      commit: number;
      call: number;
      bestCase: number;
      pipeline: number;
      hitChance: number | null;
      coverage: number | null;
      coverageNeeded: number;
      facts: number;
      domains: string[];
    }
  | {
      kind: "week";
      weekOf: ISODate;
      conversations: [number, number];
      firstTouches: [number, number];
      replies: number;
      positiveReplies: number;
      qualified: number;
      missingNextStep: number;
      goal: [number, number];
      goalLabel: string;
      facts: number;
      domains: string[];
    }
  | {
      kind: "deals";
      /** What the list is: risk on file, no dated next step, gone quiet, or the open pipeline. */
      tone: "risk" | "missing" | "stale" | "pipeline";
      count: number;
      /** Dollar total of the listed deals that have an amount. */
      usd: number;
      facts: number;
      domains: string[];
    };

export interface AskTurn {
  id: ID;
  role: "founder" | "agent";
  text: string;
  at: ISODateTime;
  runId?: ID;
  /** Agent turn still being written by `runId`. */
  pending?: boolean;
  /** Answered in code from the workspace, with no model call. */
  instant?: { title: string; rows: { label: string; detail?: string; ref?: EntityRef; domain?: string; href?: string }[]; view?: AnswerView };
  /** Web sources the answer cited (evidence ids are cited inline as [ev_…]). */
  citations?: AskCitation[];
  proposals?: AskProposal[];
  /** Workspace records the answer drew on: the receipt. */
  records?: { ref: EntityRef; label: string; domain?: string }[];
  receipt?: { durationMs: number; sources: number; costUsd: number; model: ModelTierName; modelName?: string; unpriced?: boolean };
  error?: { code: string; message: string };
  web?: boolean;
  deep?: boolean;
}

export interface AskThread {
  id: ID;
  title: string;
  context?: EntityRef;
  contextLabel?: string;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  turns: AskTurn[];
  /** Rough size of the model history; long threads cost more per answer. */
  approxTokens: number;
}

export interface AskThreadSummary {
  id: ID;
  title: string;
  context?: EntityRef;
  contextLabel?: string;
  updatedAt: ISODateTime;
  turns: number;
  preview: string;
}
