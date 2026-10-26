import type { ConsumerModel, RetentionMetric } from "@/lib/domain/types";

/**
 * Consumer GTM numbers the product leans on, each with where it came from (docs/research/10-consumer-gtm.md).
 * `basis` says how much weight a number can carry:
 *   practitioner — a named operator or investor's published benchmark
 *   vendor       — a tool vendor's own dataset (large, but self-selected and self-reported)
 *   primary      — the rule-maker's own page (Apple, the FTC)
 *   secondary    — reported by someone else about the original
 *   derived      — arithmetic on the above, or a standard formula
 *   heuristic    — Inroad's starting default, until the founder's own numbers replace it
 * Most were read from search summaries, not the original pages, during research (see the report's limits section).
 * Show the source next to the number; never present a benchmark as the founder's result.
 */

export type Basis = "practitioner" | "vendor" | "primary" | "secondary" | "derived" | "heuristic";

export interface Benchmark {
  value: number;
  /** "Lenny Rachitsky & Casey Winters, What is good retention". */
  source: string;
  date: string;
  basis: Basis;
  note?: string;
}

/* ───────────────────────────── Retention ───────────────────────────── */

export type RetentionCategory = "consumer_social" | "consumer_transactional" | "consumer_subscription";

/**
 * About six months after signup, percent of a cohort still active. Good / great. A cohort only shrinks (resurrection
 * aside), so a week-4 number under the six-month "good" bar can't reach it: that's the floor Inroad checks first.
 */
export const RETENTION_6M: Record<RetentionCategory, { good: number; great: number }> = {
  consumer_social: { good: 25, great: 45 },
  consumer_transactional: { good: 30, great: 50 },
  consumer_subscription: { good: 40, great: 70 },
};
export const RETENTION_SOURCE = "Lenny Rachitsky and Casey Winters, “What is good retention” (about 6 months; good / great)";

/** DTC repeat purchase: share of first-time buyers who order again. Vendor dataset, 156,110 customers, Feb 2026. */
export const REPEAT_PURCHASE = {
  within90Days: { value: 12, source: "E-commerce repeat-purchase dataset (156,110 customers)", date: "2026-02", basis: "vendor" },
  within365Days: { value: 18.8, source: "E-commerce repeat-purchase dataset (156,110 customers)", date: "2026-02", basis: "vendor" },
} as const satisfies Record<string, Benchmark>;

/** Which retention bar a consumer model is held to, and over which window. */
export function retentionBar(model: ConsumerModel, charges: boolean): { metric: RetentionMetric; target: number; good: number; source: string } {
  if (model === "dtc") {
    return {
      metric: "m3_repeat",
      target: REPEAT_PURCHASE.within90Days.value,
      good: REPEAT_PURCHASE.within365Days.value,
      source: "Repeat purchase within 90 days: typical about 12%; reaching the 12-month typical (18.8%) inside 90 days is strong. Vendor dataset, Feb 2026.",
    };
  }
  const category: RetentionCategory =
    model === "marketplace" ? "consumer_transactional" : model === "social" ? "consumer_social" : charges || model === "prosumer" ? "consumer_subscription" : "consumer_social";
  const bar = RETENTION_6M[category];
  const label = { consumer_social: "consumer social", consumer_transactional: "consumer transactional", consumer_subscription: "consumer subscription" }[category];
  return {
    metric: "w4",
    target: bar.good,
    good: bar.great,
    source: `${RETENTION_SOURCE}, ${label}: ${bar.good}% / ${bar.great}%. Week 4 must clear the 6-month “good” bar, since a cohort only shrinks.`,
  };
}

/* ───────────────────────────── Activation & fit ───────────────────────────── */

/** Share of signups who reach the activation event. Survey of 500+ products, Oct 2022. */
export const ACTIVATION = {
  median: { value: 25, source: "Lenny Rachitsky and Yuriy Timen, activation survey of 500+ products", date: "2022-10", basis: "practitioner" },
  average: { value: 34, source: "Lenny Rachitsky and Yuriy Timen, activation survey of 500+ products", date: "2022-10", basis: "practitioner" },
} as const satisfies Record<string, Benchmark>;

/** Sean Ellis: share answering "very disappointed" if they could no longer use the product. Ask users with 2+ uses in 2 weeks. */
export const PMF_SURVEY = {
  threshold: { value: 40, source: "Sean Ellis, product-market fit survey", date: "n.d.", basis: "practitioner" },
  /** Fewer answers than this and the score is too noisy to act on (±15 points at 40 answers). */
  minAnswers: { value: 40, source: "Binomial margin of error at n = 40", date: "2026", basis: "derived" },
} as const satisfies Record<string, Benchmark>;

/** Growth accounting (Jonathan Hsu, Social Capital): (new + resurrected) ÷ churned. */
export const QUICK_RATIO = {
  growing: { value: 1, source: "Jonathan Hsu, growth accounting", date: "2015", basis: "practitioner", note: "Above 1 the user base grows." },
  consumerAverage: { value: 1.5, source: "Jonathan Hsu, growth accounting", date: "2015", basis: "practitioner", note: "About 1.5 is average for consumer; 1–1.5 is “so-so”." },
} as const satisfies Record<string, Benchmark>;

/* ───────────────────────────── Subscription apps ───────────────────────────── */

/** RevenueCat, State of Subscription Apps 2026 (about 115,000 apps). Vendor data. */
export const SUBSCRIPTION_APPS = {
  hardPaywallDay35: { value: 10.7, source: "RevenueCat, State of Subscription Apps 2026", date: "2026", basis: "vendor", note: "Hard paywall, download to paid by day 35 (2.1% for freemium)." },
  freemiumDay35: { value: 2.1, source: "RevenueCat, State of Subscription Apps 2026", date: "2026", basis: "vendor" },
  longTrialToPaid: { value: 42.5, source: "RevenueCat, State of Subscription Apps 2026", date: "2026", basis: "vendor", note: "Trials of 17–32 days." },
  shortTrialToPaid: { value: 25.5, source: "RevenueCat, State of Subscription Apps 2026", date: "2026", basis: "vendor", note: "Trials under 4 days; 55% of 3-day-trial cancels happen on day 0." },
  annualYearOneRetention: { value: 27, source: "RevenueCat, State of Subscription Apps 2026", date: "2026", basis: "vendor", note: "Annual subscribers still subscribed after a year (27% hard paywall, 28% freemium)." },
  refundMedian: { value: 3.4, source: "RevenueCat, State of Subscription Apps 2026", date: "2026", basis: "vendor", note: "North America median." },
  reach1kMrr: { value: 17.3, source: "RevenueCat, State of Subscription Apps 2026", date: "2026", basis: "vendor", note: "Share of new apps that reach $1K MRR within two years." },
} as const satisfies Record<string, Benchmark>;

/* ───────────────────────────── Creators ───────────────────────────── */

/** Engagement rates differ by method: compare a creator only against a benchmark computed the same way. */
export const CREATOR_ENGAGEMENT = {
  instagramNano: { value: 2.19, source: "HypeAuditor, about 76M accounts (by followers, 1K–10K)", date: "2025", basis: "vendor" },
  instagramAverage: { value: 1.59, source: "HypeAuditor, about 76M accounts (by followers)", date: "2024", basis: "vendor" },
  tiktokNano: { value: 7.84, source: "SociaVault, 150,000 accounts (median, by followers)", date: "2026", basis: "vendor" },
  tiktokMega: { value: 1.84, source: "SociaVault, 150,000 accounts (median, by followers)", date: "2026", basis: "vendor" },
} as const satisfies Record<string, Benchmark>;

export const CREATOR_RATES = {
  instagramPerDeal: { value: 212, source: "Collabstr 2025 (15,000+ deals), average paid per deal", date: "2025", basis: "vendor" },
  tiktokPerDeal: { value: 200, source: "Collabstr 2025 (15,000+ deals), average paid per deal", date: "2025", basis: "vendor" },
  ugcPerDeal: { value: 178, source: "Collabstr 2025 (15,000+ deals), average paid per deal", date: "2025", basis: "vendor" },
  /** Share of gifted creators who post: 20–40% typical, up to about 62% in mature programs. */
  giftingPostRateLow: { value: 20, source: "Creator-program vendors (no stated method)", date: "2025", basis: "vendor" },
  giftingPostRateHigh: { value: 40, source: "Creator-program vendors (no stated method)", date: "2025", basis: "vendor" },
  affiliateLow: { value: 10, source: "DTC affiliate programs", date: "2025", basis: "vendor" },
  affiliateHigh: { value: 25, source: "DTC affiliate programs", date: "2025", basis: "vendor" },
} as const satisfies Record<string, Benchmark>;

/** Outreach: no controlled study compares email with DMs; these are practice, not proof. */
export const CREATOR_OUTREACH = {
  maxWords: 200,
  /** Days before the one follow-up: about a week (practitioners send one or two; Inroad sends one). */
  followUpAfterDays: 7,
  /** Days after the follow-up with no answer before the partner is let go. */
  letGoAfterDays: 14,
  replyRateLow: { value: 8, source: "Creator outreach vendors", date: "2025", basis: "vendor", note: "Falls as creator size rises." },
  replyRateHigh: { value: 25, source: "Creator outreach vendors", date: "2025", basis: "vendor" },
  latePaymentPain: { value: 41, source: "Creator survey (vendor)", date: "2025", basis: "vendor", note: "41% of creators name late payment as their top pain: state payment terms up front." },
} as const;

/* ───────────────────────────── Referrals & virality ───────────────────────────── */

export const REFERRALS = {
  shareWhereItWorksLow: { value: 15, source: "Lenny Rachitsky, referral program research", date: "n.d.", basis: "practitioner", note: "Where referrals work, they bring 15–50% of new users." },
  shareWhereItWorksHigh: { value: 50, source: "Lenny Rachitsky, referral program research", date: "n.d.", basis: "practitioner" },
  referrersShare: { value: 10, source: "Lenny Rachitsky, referral program research", date: "n.d.", basis: "practitioner", note: "Expect fewer than 10% of users to refer someone successfully." },
} as const satisfies Record<string, Benchmark>;

/** With K < 1, each user brought in by any channel brings 1 ÷ (1 − K) users in total. Derived from K = invites × conversion. */
export function viralMultiplier(k: number): number | null {
  if (!Number.isFinite(k) || k < 0) return null;
  return k < 1 ? 1 / (1 - k) : null;
}

/* ───────────────────────────── Acquisition ───────────────────────────── */

export const FIRST_USERS = {
  /** Lenny Rachitsky's study of 100+ startups (2022): over half went to where a super-specific audience already gathers. */
  existingGatheringSpot: { value: 50, source: "Lenny Rachitsky, how consumer startups found their first 1,000 users (100+ startups)", date: "2022", basis: "practitioner" },
  /** Most apps used one strategy; "no one found success from more than three" (40+ apps, 2020). */
  maxChannels: { value: 3, source: "Lenny Rachitsky, how the biggest consumer apps got their first 1,000 users (40+ apps)", date: "2020", basis: "practitioner" },
  /** 14 of 17 marketplaces started with supply; almost all constrained geography or category first. */
  marketplacesSupplyFirst: { value: 14 / 17, source: "Lenny Rachitsky, marketplace research (17 marketplaces)", date: "2019", basis: "practitioner" },
} as const satisfies Record<string, Benchmark>;

/** Apple App Store rules, read from developer.apple.com (Oct 2026). */
export const APP_STORE = {
  featuringLeadWeeks: 3, // App Store Connect help says 3 weeks; "Getting featured" says 2, up to 3 months ahead for wider consideration
  ratingPromptsPerYear: 3,
  nameChars: 30,
  subtitleChars: 30,
  keywordChars: 100,
  promoTextChars: 170,
  screenshots: 10,
  customProductPages: 70,
  pageTestVariants: 3,
} as const;

/** Meta ad sets leave learning after about 50 optimization events in 7 days (third-party figure). */
export const PAID_SOCIAL = {
  eventsToLeaveLearning: { value: 50, source: "Third-party summary of Meta's learning phase", date: "2025", basis: "secondary" },
} as const satisfies Record<string, Benchmark>;

/* ───────────────────────────── Experiments ───────────────────────────── */

/**
 * Users per variant for 80% power at α = 0.05 (Lehr's rule): 16 · p(1 − p) ÷ δ², with δ the absolute change.
 * Below a few thousand users a week, most consumer A/B tests can't read: ship big changes and compare before/after.
 */
export function usersPerArm(baseline: number, relativeLift: number): number | null {
  const p = baseline;
  const delta = p * relativeLift;
  if (!(p > 0 && p < 1) || !(delta > 0)) return null;
  return Math.ceil((16 * p * (1 - p)) / (delta * delta));
}

/** Sean Ellis's weekly growth meeting, 60 minutes. */
export const GROWTH_MEETING = [
  { minutes: 15, block: "Numbers: the north star and each funnel stage, week over week" },
  { minutes: 10, block: "Last week's experiments: what ran, what happened" },
  { minutes: 15, block: "What we learned, and what it changes" },
  { minutes: 15, block: "Pick this week's experiments (ICE: impact, confidence, ease)" },
  { minutes: 5, block: "Grow the idea list" },
] as const;

/* ───────────────────────────── Economics ───────────────────────────── */

export const ECONOMICS = {
  /** LTV:CAC of 3:1 traces to David Skok's B2B SaaS writing; no sourced consumer threshold was found. */
  ltvToCac: { value: 3, source: "David Skok, SaaS Metrics 2.0", date: "c. 2010", basis: "practitioner", note: "A B2B SaaS rule of thumb, used here as a starting bar." },
  /** No consumer investor's sourced payback bar was found: Inroad starts at 12 months and the founder can change it. */
  paybackMonths: { value: 12, source: "Inroad default (B2B SaaS norm; no sourced consumer bar)", date: "2026", basis: "heuristic" },
  shopifyConversion: { value: 1.4, source: "Littledata, about 2,800 Shopify stores (top 20% above 3.2%)", date: "2023", basis: "vendor" },
  emailShareOfRevenue: { value: 27, source: "Klaviyo-attributed email revenue", date: "2025", basis: "vendor" },
} as const satisfies Record<string, Benchmark>;
