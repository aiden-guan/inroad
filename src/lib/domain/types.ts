/**
 * Inroad domain model. Shared by server and client; plain data only (JSON-serializable).
 *
 * Storage: `.data/workspace.json` holds everything below in one `Workspace` document.
 * Run logs, Ask threads and imported LinkedIn connections live in their own files
 * (`runs.json`, `threads.json`, `connections.json`) because they are large and rarely read.
 */

export type ID = string;
/** Local calendar date, `YYYY-MM-DD`. */
export type ISODate = string;
/** Full ISO timestamp. */
export type ISODateTime = string;

export type Confidence = "high" | "medium" | "low";
export type Jurisdiction = "US" | "EU" | "UK" | "CA" | "other" | "unknown";
export type EntityKind = "account" | "person" | "deal" | "meeting" | "event" | "guest" | "evidence" | "claim" | "objection" | "playbook" | "draft";
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

export type DetectionMethod = "job_posts" | "form_d" | "press" | "site" | "yc_directory" | "github" | "dns" | "hn" | "founder_knowledge";

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
  | "sensitive";

export interface ICPCriterion {
  id: ID;
  text: string;
  kind: "firmographic" | "technographic" | "situational";
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

export type PersonaRole = "economic_buyer" | "champion" | "technical_approver" | "user" | "blocker";

export interface Persona {
  id: ID;
  role: PersonaRole;
  titles: string[];
  kpis: string[];
  pains: string[];
  triggers: string[];
  objections: string[];
  wateringHoles: { name: string; kind: "community" | "podcast" | "newsletter" | "conference"; url?: string }[];
  line: string; // ≤25 words, how to talk to this persona
}

export interface MessagingTree {
  oneLiner: string; // ≤25 words
  themes: { valueThemeId: ID; headline: string; vsAlternative: string }[];
  byPersona: { personaId: ID; line: string }[];
  bySignal: { signal: SignalType; implication: string }[];
  customerWords: { phrase: string; source: "call" | "site" | "job_post" | "review" | "community" | "founder" }[];
  bannedWords: string[];
}

export type Motion =
  | "warm_network"
  | "signal_cold"
  | "investor_intros"
  | "communities"
  | "founder_content"
  | "exec_dinners"
  | "design_partner_program"
  | "launches";

export interface ChannelPlan {
  funnel: {
    qualifiedNeeded: number;
    discoveryCallsNeeded: number;
    coldContactsNeeded: number;
    perWeek: { conversations: number; firstTouches: number; introAsks: number; meetings: number };
    warning?: string;
  };
  motions: { motion: Motion; rank: number; why: string; weeklyTarget: string; firstActions: string[] }[];
}

export interface CommercialDefault {
  structure: "paid_pilot" | "paid_design_partner" | "annual_with_opt_out";
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

export type FoundationSection = "positioning" | "icp" | "personas" | "messaging" | "questions";

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
  kind: "one_pager" | "demo_script" | "security" | "design_partner_terms" | "pilot_proposal" | "insight" | "case_study" | "other";
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
}

/** People who can make introductions (investors, advisors, customers…). */
export interface Connector {
  id: ID;
  name: string;
  relationship: "investor" | "angel" | "advisor" | "customer" | "friend" | "ex_colleague";
  linkedinUrl?: string;
  lastAskedOn?: ISODate;
  introsMade: number;
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
  | "NEAR_DUPLICATE";

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
  referrals: string[];
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
  nextStep?: { what: string; date: ISODate; buyerAgreed: boolean };
  contacts: { personId: ID; role?: PersonaRole }[];
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
  | "pushed";

export interface Activity {
  id: ID;
  at: ISODateTime;
  kind: ActivityKind;
  personId?: ID;
  accountDomain?: string;
  dealId?: ID;
  eventId?: ID;
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
  | "research";

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
  kind: "close_lost" | "nurture" | "add_pov" | "add_objection" | "add_customer_words" | "add_anti_icp" | "add_banned_word" | "message_bet" | "note";
  title: string; // ≤12 words, "Nurture Northwind until Jan 12"
  detail: string; // the reason, ≤40 words
  /** Verbatim quotes or facts behind it. */
  justification?: string[];
  dealId?: ID;
  lossReason?: LossReason;
  nurtureUntil?: ISODate;
  text?: string; // the POV / objection / phrase to add
  objectionCategory?: ObjectionCard["category"];
  bet?: { variable: string; control: string; variant: string; why: string };
  status: "open" | "applied" | "dismissed";
  decidedAt?: ISODateTime;
}

export interface Brief {
  date: ISODate;
  kind: "daily" | "monday" | "friday";
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
  reviewKind?: "monday" | "friday";
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
  | "gmail";

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
  | "network";

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
  error?: { code: string; message: string };
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

/* ─────────────────────────────── Workspace ─────────────────────────────── */

export interface Suppression {
  id: ID;
  email?: string;
  domain?: string;
  reason: "unsubscribe" | "bounce" | "requested_delete" | "customer" | "competitor" | "manual";
  at: ISODateTime;
}

/** A row from the founder's LinkedIn Connections.csv export. Stored in connections.json, never sent to Claude in bulk. */
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
  /** Founder tags. design_partner / past_user / customer / ex_colleague mean they know the product or the founder. */
  tags?: ("design_partner" | "past_user" | "ex_colleague" | "customer" | "investor" | "connector")[];
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
  };
  company: CompanySnapshot | null;
  foundation: Foundation | null;
  claims: Claim[];
  objections: ObjectionCard[];
  povs: PovItem[];
  assets: Asset[];
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
  webhooks: OutboundWebhook[];
  suppression: Suppression[];
  runs: RunSummary[]; // newest first, last 200
  usage: Record<string /* YYYY-MM */, UsageMonth>;
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
export interface AskTurn {
  id: ID;
  role: "founder" | "agent";
  text: string;
  at: ISODateTime;
  runId?: ID;
  /** Agent turn still being written by `runId`. */
  pending?: boolean;
  /** Answered in code from the workspace, with no model call. */
  instant?: { title: string; rows: { label: string; detail?: string; ref?: EntityRef; domain?: string; href?: string }[] };
  /** Web sources the answer cited (evidence ids are cited inline as [ev_…]). */
  citations?: AskCitation[];
  proposals?: AskProposal[];
  /** Workspace records the answer drew on: the receipt. */
  records?: { ref: EntityRef; label: string; domain?: string }[];
  receipt?: { durationMs: number; sources: number; costUsd: number; model: ModelTierName };
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
