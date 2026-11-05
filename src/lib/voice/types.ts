import type { Activity, ID, ISODate, ISODateTime, ObjectionCard, QualificationCard, ReplyIntent, Stage } from "@/lib/domain/types";

/**
 * Buyer voice: what buyers actually say, aggregated with receipts. Everything here is plain data. The persisted
 * part (`BuyerVoiceState`, on the workspace) holds only what a model wrote: theme names and battlecard drafts.
 * Every count, rate, trend and stage is computed in code from debriefs, replies and deals each time it's read.
 */

/* ─────────────────────────────── Persisted (workspace.buyerVoice) ─────────────────────────────── */

/** The cheap-tier pass that names and merges the clusters code built. Cached against the calls it read. */
export interface VoiceNames {
  /** Debriefed calls it read (meeting ids and debrief times). A new debrief makes the names stale. */
  fingerprint: string;
  calls: number;
  at: ISODateTime;
  runId?: ID;
  costUsd?: number;
  /** Theme key → its name in buyers' words, and one line on what they mean. */
  entries: Record<string, { name: string; gist?: string }>;
  /** Theme key → the theme (same kind) it was merged into. */
  merges: Record<string, string>;
  /** Theme key → snippet ids the pass said don't belong there. */
  outliers: Record<string, string[]>;
}

/** A drafted answer to one alternative or objection, sourced only from the quotes and approved claims. */
export interface VoiceBattlecard {
  /** The alternative or objection theme it answers. */
  key: string;
  /** What it answers, at the time it was drafted ("NetSuite", "We'd build it ourselves"). */
  subject: string;
  objection: string;
  category: ObjectionCard["category"];
  underlyingConcern: string;
  clarifyingQ: string;
  response: string;
  walkAwayIf: string;
  /** Questions that surface the gap (named competitors). */
  landmines: string[];
  whenWeWin?: string;
  whenWeLose?: string;
  /** Snippet ids and approved claim ids it rests on. */
  quoteIds: string[];
  claimIds: string[];
  at: ISODateTime;
  runId?: ID;
  costUsd?: number;
  /** Set once the founder saved it to Objections. */
  saved?: { at: ISODateTime; objectionId: ID; approved: boolean };
  /** The founder set it aside; a new draft replaces it. */
  dismissedAt?: ISODateTime;
}

export interface BuyerVoiceState {
  names?: VoiceNames;
  battlecards?: Record<string, VoiceBattlecard>;
}

/* ─────────────────────────────── Computed ─────────────────────────────── */

export type ThemeKind = "objection" | "pain" | "outcome" | "process";

/**
 * One thing a buyer said (or the founder wrote down that they said). `verbatim` is true only for transcript quotes
 * and the buyer's own email replies; founder notes and debrief summaries are paraphrase and always labeled so.
 */
export interface VoiceSnippet {
  id: string;
  text: string;
  verbatim: boolean;
  /** transcript: quoted from a call transcript · notes: the founder's call notes · summary: the debrief's one-line read of an objection · email: their reply · talk: notes from a consumer user conversation. */
  source: "transcript" | "notes" | "summary" | "email" | "talk";
  /** The conversation it came from: a meeting id, or the reply or user-talk activity id. */
  conv: string;
  convKind: "call" | "reply" | "talk";
  date: ISODate;
  at: ISODateTime;
  speaker?: string;
  title?: string;
  personId?: ID;
  domain?: string;
  company?: string;
  dealId?: ID;
  meetingId?: ID;
  activityId?: ID;
  /** Where the deal stood when it was said. */
  stage?: Stage;
  /** Card fields the debrief cited this quote for. */
  fields: (keyof QualificationCard)[];
  sentiment?: Activity["sentiment"];
  /** Replies: how the reply was read when it was answered (objection, not now…), when it was. */
  intent?: ReplyIntent;
  /** Normalized content terms (code), for matching and clustering. */
  terms: string[];
}

/** A call, a reply or a user talk: the denominator for "n of m". */
export interface VoiceConversation {
  id: string;
  kind: "call" | "reply" | "talk";
  date: ISODate;
  dealId?: ID;
  domain?: string;
  stage?: Stage;
}

/** Won N of n decided deals where it came up, against the deals where it didn't. Counts first; a rate only when n allows. */
export interface WinSplit {
  with: { won: number; n: number };
  without: { won: number; n: number };
  /** too_early below the sample gate; then whether deals where it came up were won more, less or about as often. */
  verdict: "too_early" | "more" | "less" | "same";
}

export interface VoiceTrend {
  /** Conversations in the last 30 days that raised it, out of all conversations in those days. */
  recent: number;
  recentTotal: number;
  before: number;
  beforeTotal: number;
  label: "new" | "rising" | "fading" | null;
  /** Conversations that raised it in each 30-day window, oldest first (the last one ends today). */
  buckets: number[];
}

export interface DealRef {
  dealId: ID;
  name: string;
  domain: string;
  stage: Stage;
  amountUsd?: number;
}

export interface VoiceTheme {
  key: string;
  kind: ThemeKind;
  /** The cached AI name when there is one, else the code label. */
  label: string;
  codeLabel: string;
  named: boolean;
  gist?: string;
  /** Phrases buyers used most in it (verbatim only), counted by conversation. */
  phrases: string[];
  /** The debriefs' customer words found in its quotes, most conversations first: candidates for messaging. */
  words: string[];
  /** Members, newest first; one summary per call is dropped when the call also has a quote. */
  snippets: VoiceSnippet[];
  calls: number;
  replies: number;
  talks: number;
  deals: number;
  companies: string[];
  dealIds: ID[];
  /** Where deals stood when it came up, by conversation, in pipeline order. */
  stages: { stage: Stage; n: number }[];
  trend: VoiceTrend;
  win: WinSplit;
  /** Open deals where it came up. */
  open: DealRef[];
  firstHeard: ISODate;
  lastHeard: ISODate;
  /** Pains and outcomes: where the playbook already says it, when it does. */
  inPlaybook?: string;
  /** Objections: the ObjectionCard category that answers it. */
  category?: ObjectionCard["category"];
  response?: { objectionId: ID; approved: boolean; text: string };
}

export type AlternativeKind = "competitor" | "status_quo" | "in_house" | "hire" | "nothing";

export interface VoiceAlternative {
  key: string;
  name: string;
  kind: AlternativeKind;
  /** Named in the playbook (competitors or alternatives). */
  inPlaybook: boolean;
  /** Index in foundation.competitors, when it is one. */
  competitorIndex?: number;
  domain?: string;
  snippets: VoiceSnippet[];
  calls: number;
  replies: number;
  deals: number;
  dealRows: (DealRef & { outcome: "won" | "lost" | "open" | "nurture"; lostTo: boolean })[];
  record: { won: number; lost: number; open: number };
  firstHeard?: ISODate;
  lastHeard?: ISODate;
  response?: { objectionId: ID; approved: boolean; text: string };
  /** The ObjectionCard category a battlecard for it uses. */
  category: ObjectionCard["category"];
}

export interface VoiceHeadline {
  text: string;
  /** What it's about, for the link: a theme key or an alternative key. */
  theme?: string;
  alternative?: string;
  tone: "neutral" | "attention";
}

export interface BuyerVoice {
  snippets: VoiceSnippet[];
  conversations: VoiceConversation[];
  summary: {
    calls: number;
    transcripts: number;
    notes: number;
    replies: number;
    talks: number;
    companies: number;
    deals: number;
    quotes: number;
    verbatim: number;
    paraphrase: number;
    firstDate?: ISODate;
    lastDate?: ISODate;
    /** Decided deals with at least one call or reply on file: the win/loss comparison's population. */
    decided: number;
  };
  themes: VoiceTheme[];
  alternatives: VoiceAlternative[];
  headlines: VoiceHeadline[];
  /** Objections and alternatives raised in 2+ conversations with no approved answer. */
  needsAnswer: number;
  naming: { status: "none" | "fresh" | "stale"; newCalls: number; at?: ISODateTime; costUsd?: number };
  fingerprint: string;
  today: ISODate;
}
