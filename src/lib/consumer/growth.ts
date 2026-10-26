import { addDays, weekOf } from "@/lib/domain/ids";
import type { Experiment, GrowthModel, GrowthWeek, Workspace } from "@/lib/domain/types";
import { ACTIVATION, ECONOMICS, PMF_SURVEY, QUICK_RATIO, REFERRALS, usersPerArm } from "./benchmarks";
import { growthDefaults } from "./plan";

/**
 * Growth math for consumer companies, in code (zero tokens). Every number on the growth card, in the weekly review and
 * in the pushback comes from here. Rates hide below a minimum n, the same way reply rates do for business outreach.
 */

/** Signups in a week below which a rate is an anecdote, not a number. */
export const MIN_SIGNUPS_FOR_RATE = 20;
/** Weeks of retention readings needed before "flattening" means anything. */
const TREND_WEEKS = 3;
/** Points of week-4 retention drift that still count as flat. */
const FLAT_POINTS = 3;

export type FunnelStage = "acquisition" | "activation" | "retention" | "referral" | "revenue";

export interface Verdict {
  id: string;
  severity: "block" | "warn" | "info";
  title: string;
  detail: string;
  stage?: FunnelStage;
  source?: string;
}

export interface GrowthRead {
  model: GrowthModel;
  weeks: GrowthWeek[];
  latest?: GrowthWeek;
  /** Signups this logged week vs the one before (fraction, 0.12 = +12%). */
  signupsWoW?: number;
  activationRate?: number;
  /** Week-4 retention (or 90-day repeat for DTC), percent, latest logged. */
  retention?: number;
  retentionStatus: "unknown" | "below" | "at_bar" | "strong";
  retentionTrend: "unknown" | "flat" | "falling" | "rising";
  /** True once week-4 retention clears the bar on the latest reading and isn't falling. */
  retentionHolds: boolean;
  /** Paying: (new paying) ÷ (churned paying). Users: unknown without resurrected counts, so paying only. */
  quickRatio?: number;
  referredShare?: number;
  /** Paid spend ÷ new paying customers this week (or ÷ signups when nobody pays yet). */
  cac?: number;
  cacBasis?: "paying" | "signups";
  /** Monthly revenue per paying customer, from the week's revenue. */
  arpuMonthly?: number;
  paybackMonths?: number;
  pmf?: { score: number; answers: number; readable: boolean; segment?: string };
  /** The earliest stage that's broken: where this week's effort goes. */
  focus: FunnelStage;
  verdicts: Verdict[];
  /** False while paid acquisition would buy users into a leaky product. */
  paidAllowed: boolean;
  goal: { current: number | null; target: number; label: string };
}

const pct = (n: number) => `${Math.round(n * 10) / 10}%`;
const money = (n: number) => `$${n >= 100 ? Math.round(n).toLocaleString("en-US") : n.toFixed(2)}`;

function last<T>(xs: T[], n = 1): T[] {
  return xs.slice(Math.max(0, xs.length - n));
}

function trend(values: number[]): GrowthRead["retentionTrend"] {
  if (values.length < TREND_WEEKS) return "unknown";
  const recent = last(values, TREND_WEEKS);
  const delta = recent[recent.length - 1] - recent[0];
  if (Math.abs(delta) <= FLAT_POINTS) return "flat";
  return delta < 0 ? "falling" : "rising";
}

export function readGrowth(ws: Workspace, today: string): GrowthRead {
  const model = growthDefaults(ws);
  const weeks = [...(ws.growthLog ?? [])].filter((w) => w.weekOf <= today).sort((a, b) => a.weekOf.localeCompare(b.weekOf));
  const latest = weeks.at(-1);
  const prev = weeks.at(-2);
  const verdicts: Verdict[] = [];

  const signupsWoW = latest && prev && prev.signups > 0 ? (latest.signups - prev.signups) / prev.signups : undefined;
  const activationRate = latest && latest.activated !== undefined && latest.signups >= MIN_SIGNUPS_FOR_RATE ? (100 * latest.activated) / latest.signups : undefined;

  const readings = weeks.map((w) => w.retainedPct).filter((v): v is number => typeof v === "number");
  const retention = readings.at(-1);
  const bar = model.retention;
  const retentionTrend = trend(readings);
  const retentionStatus: GrowthRead["retentionStatus"] = retention === undefined ? "unknown" : retention >= bar.good ? "strong" : retention >= bar.target ? "at_bar" : "below";
  const retentionHolds = (retentionStatus === "at_bar" || retentionStatus === "strong") && retentionTrend !== "falling";

  const quickRatio = latest?.newPaying !== undefined && latest.churnedPaying ? latest.newPaying / latest.churnedPaying : undefined;
  const referredShare = latest?.referred !== undefined && latest.signups >= MIN_SIGNUPS_FOR_RATE ? (100 * latest.referred) / latest.signups : undefined;

  let cac: number | undefined;
  let cacBasis: GrowthRead["cacBasis"];
  if (latest?.spendUsd && latest.spendUsd > 0) {
    if (latest.newPaying) {
      cac = latest.spendUsd / latest.newPaying;
      cacBasis = "paying";
    } else if (latest.signups) {
      cac = latest.spendUsd / latest.signups;
      cacBasis = "signups";
    }
  }
  // Weekly revenue × 52 ÷ 12 per paying customer. Gross of store fees: the payback line says so.
  const arpuMonthly = latest?.revenueUsd && latest.paying ? (latest.revenueUsd * 52) / 12 / latest.paying : undefined;
  const paybackMonths = cac !== undefined && cacBasis === "paying" && arpuMonthly ? cac / arpuMonthly : undefined;

  const survey = ws.pmfSurveys?.at(-1);
  const pmf = survey && survey.answers > 0 ? { score: (100 * survey.veryDisappointed) / survey.answers, answers: survey.answers, readable: survey.answers >= PMF_SURVEY.minAnswers.value, segment: survey.segment } : undefined;

  /* Verdicts, worst first. Each names the number and its source; none applies anything. */
  const spending = (latest?.spendUsd ?? 0) > 0;
  if (spending && !retentionHolds) {
    verdicts.push({
      id: "paid_before_retention",
      severity: "block",
      stage: "retention",
      title: retention === undefined ? "Hold paid spend until you can see week-4 retention" : `Hold paid spend: week-4 retention is ${pct(retention)}, the bar is ${bar.target}%`,
      detail:
        retention === undefined
          ? `You spent ${money(latest!.spendUsd!)} last week with no retention reading yet. Paid users into a product that doesn't keep them is money you don't get back.`
          : `Paid users churn like everyone else. Every point of retention you add first makes each dollar of paid worth more.`,
      source: bar.source,
    });
  }
  if (activationRate !== undefined && activationRate < ACTIVATION.median.value) {
    verdicts.push({
      id: "activation_low",
      severity: "warn",
      stage: "activation",
      title: `Only ${pct(activationRate)} of new users reach “${model.activation.event}”`,
      detail: `The median across 500+ products is ${ACTIVATION.median.value}%. Fix the first session before buying or begging for more signups.`,
      source: `${ACTIVATION.median.source} (${ACTIVATION.median.date})`,
    });
  }
  if (retentionStatus === "below") {
    verdicts.push({
      id: "retention_below",
      severity: "warn",
      stage: "retention",
      title: `Week-4 retention ${pct(retention!)} is under the ${bar.target}% bar`,
      detail: `A cohort only shrinks from week 4, so it can't reach the 6-month bar from here. Talk to the users who stayed: what do they do that the others don't?`,
      source: bar.source,
    });
  } else if (retentionTrend === "falling") {
    verdicts.push({
      id: "retention_falling",
      severity: "warn",
      stage: "retention",
      title: "Week-4 retention is falling",
      detail: `Down more than ${FLAT_POINTS} points over the last ${TREND_WEEKS} readings. Check what changed for the newest cohorts: channel, onboarding or the product.`,
    });
  } else if (retentionStatus === "strong" && retentionTrend === "flat") {
    verdicts.push({
      id: "retention_strong",
      severity: "info",
      stage: "referral",
      title: `Retention holds at ${pct(retention!)}: build the loop`,
      detail: "Users stay. Now make it easy for them to bring the next ones: an invite ask after the first win, and a referral reward for friends who activate.",
      source: bar.source,
    });
  }
  if (quickRatio !== undefined && quickRatio < QUICK_RATIO.growing.value) {
    verdicts.push({
      id: "quick_ratio",
      severity: "warn",
      stage: "retention",
      title: `More paying customers left than joined (quick ratio ${quickRatio.toFixed(1)})`,
      detail: `Below 1 the paying base shrinks; about ${QUICK_RATIO.consumerAverage.value} is average for consumer.`,
      source: `${QUICK_RATIO.growing.source} (${QUICK_RATIO.growing.date})`,
    });
  }
  if (paybackMonths !== undefined && paybackMonths > ECONOMICS.paybackMonths.value) {
    verdicts.push({
      id: "payback",
      severity: "warn",
      stage: "revenue",
      title: `Paid takes ${paybackMonths.toFixed(1)} months to pay back`,
      detail: `${money(cac!)} to acquire a paying customer who pays about ${money(arpuMonthly!)} a month (before store fees). Inroad's starting bar is ${ECONOMICS.paybackMonths.value} months.`,
      source: ECONOMICS.paybackMonths.source,
    });
  }
  if (referredShare !== undefined && referredShare >= REFERRALS.shareWhereItWorksLow.value) {
    verdicts.push({
      id: "referrals_working",
      severity: "info",
      stage: "referral",
      title: `${pct(referredShare)} of new users came from a friend`,
      detail: `Where referrals work they bring ${REFERRALS.shareWhereItWorksLow.value}–${REFERRALS.shareWhereItWorksHigh.value}% of new users. Make the ask easier, don't add a bigger reward.`,
      source: REFERRALS.shareWhereItWorksLow.source,
    });
  }
  if (pmf?.readable) {
    const hit = pmf.score >= PMF_SURVEY.threshold.value;
    verdicts.push({
      id: "pmf_survey",
      severity: hit ? "info" : "warn",
      stage: "retention",
      title: `${pct(pmf.score)} would be very disappointed without it${pmf.segment ? ` (${pmf.segment})` : ""}`,
      detail: hit
        ? `Over the ${PMF_SURVEY.threshold.value}% line. Find what the very-disappointed group has in common and narrow to them.`
        : `Under the ${PMF_SURVEY.threshold.value}% line. Superhuman got from 22% to 33% by narrowing to the people who loved it most, before changing the product.`,
      source: PMF_SURVEY.threshold.source,
    });
  }

  const focus = focusStage({ latest, activationRate, retentionStatus, retentionHolds, referredShare });
  if (!latest) {
    verdicts.push({ id: "no_numbers", severity: "info", stage: "acquisition", title: "Log last week's numbers", detail: "Signups, how many reached the first win, and who came back. Two minutes, and every recommendation gets sharper." });
  }

  const goalMetric = ws.goal.metric ?? "deals";
  const current = goalMetric === "paying" ? (latest?.paying ?? null) : goalMetric === "active_users" ? (latest?.active ?? null) : null;

  return {
    model,
    weeks,
    latest,
    signupsWoW,
    activationRate,
    retention,
    retentionStatus,
    retentionTrend,
    retentionHolds,
    quickRatio,
    referredShare,
    cac,
    cacBasis,
    arpuMonthly,
    paybackMonths,
    pmf,
    focus,
    verdicts,
    paidAllowed: retentionHolds,
    goal: { current, target: ws.goal.target, label: ws.goal.targetLabel },
  };
}

/** Earliest broken stage. Too few users to measure anything means getting users, by hand. */
function focusStage(r: { latest?: GrowthWeek; activationRate?: number; retentionStatus: GrowthRead["retentionStatus"]; retentionHolds: boolean; referredShare?: number }): FunnelStage {
  if (!r.latest || r.latest.signups < MIN_SIGNUPS_FOR_RATE) return "acquisition";
  if (r.activationRate !== undefined && r.activationRate < ACTIVATION.median.value) return "activation";
  if (r.retentionStatus === "below" || (r.retentionStatus !== "unknown" && !r.retentionHolds)) return "retention";
  if (r.retentionStatus === "unknown") return "activation";
  if (r.referredShare === undefined || r.referredShare < REFERRALS.shareWhereItWorksLow.value) return "referral";
  return "acquisition";
}

export const STAGE_LABELS: Record<FunnelStage, string> = {
  acquisition: "Getting users",
  activation: "First win",
  retention: "Coming back",
  referral: "Bringing friends",
  revenue: "Paying",
};

/** The Monday a log entry is for: last week until Monday's numbers exist. */
export function lastWeekOf(today: string): string {
  return addDays(weekOf(today), -7);
}

export function hasLoggedLastWeek(ws: Workspace, today: string): boolean {
  const want = lastWeekOf(today);
  return (ws.growthLog ?? []).some((w) => w.weekOf >= want);
}

/** An experiment's size, so the founder knows whether it can read as an A/B test or only as a before/after. */
export function sizeExperiment(e: Pick<Experiment, "baseline">, weeklySignups: number, relativeLift = 0.2): { perArm: number | null; weeksToRead: number | null; abReadable: boolean } {
  const perArm = e.baseline ? usersPerArm(e.baseline, relativeLift) : null;
  if (!perArm || weeklySignups <= 0) return { perArm, weeksToRead: null, abReadable: false };
  const weeksToRead = Math.ceil((2 * perArm) / weeklySignups);
  // Past about two months, outside change swamps the test: ship it as a before/after instead.
  return { perArm, weeksToRead, abReadable: weeksToRead <= 8 };
}

/** ICE: impact × confidence × ease, each 1–10. Ranking only. */
export function iceScore(e: Pick<Experiment, "ice">): number {
  return e.ice ? e.ice.impact * e.ice.confidence * e.ice.ease : 0;
}
