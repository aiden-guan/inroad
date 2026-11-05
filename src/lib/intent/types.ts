/**
 * Research → Intent: people asking in public for what the company sells, and developers engaging with the
 * repositories in its space. Plain, JSON-serializable data shared by server and client. Stored on the workspace
 * (`ws.intent`) so backups, the sample and resets carry it; raw API responses and model judgements live in the
 * disk cache (src/lib/signals/cache.ts), never here.
 */

export type IntentSourceId = "hn" | "stackexchange" | "github" | "reddit" | "bluesky";

export const SOURCE_LABEL: Record<IntentSourceId, string> = {
  hn: "Hacker News",
  stackexchange: "Stack Exchange",
  github: "GitHub",
  reddit: "Reddit",
  bluesky: "Bluesky",
};

/** What a kept post is doing, judged against the playbook. Irrelevant posts are never stored. */
export type IntentKind = "ask" | "problem" | "compare";

export const KIND_LABEL: Record<IntentKind, string> = {
  ask: "Asking for a tool",
  problem: "Describing the problem",
  compare: "Comparing tools",
};

/** A playbook term a post matched: one of the buyer's pains, a competitor, or the category. */
export interface IntentMatch {
  kind: "pain" | "competitor" | "category";
  label: string;
}

/** Where the author works, only when their profile, a work domain or their own words say so. */
export interface IntentCompany {
  name: string;
  domain?: string;
  basis: "profile" | "profile_email" | "profile_site" | "said_in_post";
  /** One line a person can check, e.g. "GitHub profile: company @fernwick". */
  evidence: string;
}

export interface IntentItem {
  /** "int_" + a hash of `key`: stable across scans. */
  id: string;
  /** The post itself: "hn:50313358", "stackexchange:stackoverflow:80014242", "github:acme/sdk#12". */
  key: string;
  /** The conversation it belongs to; "Not relevant" suppresses the whole thread. */
  thread: string;
  source: IntentSourceId;
  /** "Stack Overflow", "r/SaaS", "getlago/lago". */
  site?: string;
  url: string;
  /** The thread or question title. */
  title: string;
  /** Verbatim from the post, at most 300 characters. */
  quote: string;
  author: string;
  authorUrl?: string;
  /** Unknown when the source didn't say (a search snippet without a date). */
  postedAt?: string;
  kind: IntentKind;
  /** 3: has the problem now and would plausibly buy. 2: related, plausibly a buyer. */
  relevance: 2 | 3;
  /** The model's reason, at most about 18 words. */
  why: string;
  /** Kept by the code rules alone (no AI was set up): nothing judged it. */
  byCode?: boolean;
  matched: IntentMatch[];
  company?: IntentCompany;
  /** The query that found it (the first one, when several did). */
  query: string;
  queryKey: string;
  foundAt: string;
  /** The account its signal is on, once tracked (or matched to one already in Companies). */
  trackedDomain?: string;
  /** The reply draft's asset id, once one was started. */
  replyAssetId?: string;
}

export interface IntentQuery {
  source: IntentSourceId;
  query: string;
  /** source + normalized query: what feedback is counted against. */
  key: string;
  /** Which playbook term it came from. */
  from: IntentMatch;
  /** Stack Exchange site, when the source is stackexchange. */
  site?: string;
}

export interface SourceRequests {
  made: number;
  cached: number;
  failed: number;
}

export interface IntentScan {
  at: string;
  durationMs: number;
  windowDays: number;
  queries: IntentQuery[];
  requests: Partial<Record<IntentSourceId, SourceRequests>>;
  skipped: { source: IntentSourceId; reason: string }[];
  /** Posts the sources returned, before dedupe. */
  fetched: number;
  /** After dedupe, suppression and the code prefilter. */
  candidates: number;
  /** Sent to the model this scan. */
  judged: number;
  /** Judgements reused from the cache (no tokens). */
  reused: number;
  /** Kept as relevant this scan (new and already in the feed). */
  kept: number;
  /** New in the feed. */
  added: number;
  costUsd: number;
  tokens: { input: number; output: number };
  warnings: string[];
  runId?: string;
}

export interface IntentFeedback {
  /** Drafted a reply or tracked a company from one of its posts. */
  hits: number;
  /** Marked one of its posts not relevant. */
  misses: number;
}

/* ─────────────────────────── Developer radar ─────────────────────────── */

export type RadarActivityKind = "fork" | "issue" | "pull" | "comment" | "discussion";

export const ACTIVITY_LABEL: Record<RadarActivityKind, { one: string; many: string; verb: string }> = {
  fork: { one: "fork", many: "forks", verb: "forked" },
  issue: { one: "issue", many: "issues", verb: "opened an issue on" },
  pull: { one: "pull request", many: "pull requests", verb: "opened a pull request on" },
  comment: { one: "comment", many: "comments", verb: "commented on" },
  discussion: { one: "discussion", many: "discussions", verb: "started a discussion on" },
};

export interface RadarActivity {
  kind: RadarActivityKind;
  repo: string;
  url: string;
  at: string;
  title?: string;
  /** At most 25 words, verbatim from the issue, comment or discussion. */
  quote?: string;
}

export interface RadarPerson {
  login: string;
  url: string;
  name?: string;
  /** The company field as the profile writes it. */
  company?: string;
  domain?: string;
  basis?: "company_org" | "company_site" | "email";
  activity: RadarActivity[];
}

export interface RadarCompany {
  domain: string;
  name: string;
  logins: string[];
  counts: Partial<Record<RadarActivityKind, number>>;
  repos: string[];
  lastAt: string;
  /** The strongest written evidence: an issue or discussion in their own words, with the pain it matches. */
  quote?: { text: string; url: string; repo: string; kind: RadarActivityKind; login: string; at: string; pain?: string };
  /** Code-built: "3 people at Fernwick engaged with getlago/lago in 30 days: 2 forked it, 1 opened an issue about metered billing". */
  line: string;
  score: number;
}

export interface RadarRepo {
  full: string;
  url: string;
  stars?: number;
  /** From GitHub's aggregate star history; GitHub no longer says who starred. */
  starsLast30?: number;
  description?: string;
  /** The owner's website, when its profile lists one: its own people are left out. */
  ownerDomain?: string;
  error?: string;
}

export interface RadarSuggestion {
  full: string;
  url: string;
  stars: number;
  /** "From Lago, a competitor in your playbook". */
  why: string;
  /** The org's website matches the competitor's domain. */
  verified: boolean;
}

export interface RadarState {
  repos: RadarRepo[];
  windowDays: number;
  at?: string;
  people: RadarPerson[];
  companies: RadarCompany[];
  totals: {
    /** Distinct people with activity in the window. */
    engaged: number;
    profilesRead: number;
    /** People placed at a company. */
    placed: number;
    rateLimited: boolean;
    withToken: boolean;
  };
  requests: number;
  warnings: string[];
  durationMs?: number;
  runId?: string;
}

export interface IntentState {
  version: 1;
  /** Kept posts, newest found first. */
  items: IntentItem[];
  /** Threads marked not relevant: never shown again. */
  dismissed: { thread: string; at: string; queryKey?: string }[];
  /** Per query: what the founder kept and threw away. Retires queries that only find noise. */
  feedback: Record<string, IntentFeedback>;
  /** Most recent first. */
  scans: IntentScan[];
  radar?: RadarState;
}

export function emptyIntent(): IntentState {
  return { version: 1, items: [], dismissed: [], feedback: {}, scans: [] };
}

/** Caps, so the workspace stays small. */
export const INTENT_LIMITS = { items: 150, dismissed: 500, scans: 10, radarPeople: 100, radarCompanies: 60, repos: 5 } as const;
