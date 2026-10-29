import { addDays, daysBetween, weekOf } from "@/lib/domain/ids";
import type { ForecastSnapshot, GtmUpdate, RevenueTarget, Workspace } from "@/lib/domain/types";
import { computeForecast, computePlan, money, shortDay } from "@/lib/revenue/forecast";
import { quarterOf } from "@/lib/revenue/stats";
import { updateBody, updateFacts } from "@/lib/revenue/update";
import type { Clock } from "./clock";
import { DEAL } from "./ids";

/**
 * The revenue side of the sample: this quarter's number, last week's forecast photo (so "what changed"
 * has a story: Rowanstack's price pushback and slipped date, Northwind qualifying), and this week's CEO
 * update, written the way the gtm_update workflow writes it (code-built table and changes, prose around them).
 */

export function revenueTarget(c: Clock): RevenueTarget {
  const q = quarterOf(c.today);
  return { amountUsd: 150_000, periodStart: q.start, periodEnd: q.end, label: `${q.label.split(" ")[0]} new ARR` };
}

export function lastWeekSnapshot(c: Clock, target: RevenueTarget): ForecastSnapshot {
  const monday = addDays(weekOf(c.today), -7);
  return {
    weekOf: monday,
    takenAt: c.at(daysBetween(c.today, monday), "08:05"),
    periodEnd: target.periodEnd,
    target: target.amountUsd,
    closedWon: 30_000,
    commit: 84_000,
    bestCase: 120_000,
    pipeline: 204_000,
    deals: [
      // Undated deals carry no close date here, so their moving estimate isn't reported as a slip.
      { id: DEAL.rowanstack, name: "Rowanstack", stage: "proposal", category: "commit", amountUsd: 54_000, closeDate: c.d(3) },
      { id: DEAL.lumenwire, name: "Lumenwire", stage: "pilot", category: "best_case", amountUsd: 36_000, closeDate: c.d(21) },
      { id: DEAL.northwind, name: "Northwind Metrics", stage: "talking", category: "pipeline", amountUsd: 42_000 },
      { id: DEAL.saltmarsh, name: "Saltmarsh Compute", stage: "talking", category: "pipeline", amountUsd: 42_000 },
    ],
  };
}

export function ceoUpdate(ws: Workspace, c: Clock): GtmUpdate {
  const f = computeForecast(ws, c.today);
  const data = updateFacts(ws, f, computePlan(ws, f, c.now), c.now);
  const body = updateBody(
    {
      headline: `${f.period.label} turns on two deals in the next three weeks: Lumenwire's ROI review, which turns commit into a signature, and Rowanstack's redlines, which slipped it to best case.`,
      forecast:
        "Lumenwire ($36K) passes every commit test; the ROI review with Grace is what turns it into a signature. Rowanstack ($48K) dropped to best case: counsel's redlines are late and the close date moved a week. Northwind is qualified but has no close date, so it sits in pipeline. Coverage is under half of the 3x a quarter should start with, so this quarter is about converting what's open; new pipeline mostly lands next quarter.",
      changes: data.changes.slice(0, 4),
      risks: [
        "Rowanstack: counsel's redlines were due two days ago and the close date already slipped a week. Ask Nadia for the redlines and a signature date this week.",
        "Lumenwire: commit, but only two people on the buyer side. Book Grace's ROI review before the pilot ends and bring a third person from their team into it.",
        "Saltmarsh: one call, no next step. Get a dated discovery follow-up or close it.",
      ],
      working: [
        "Your network and introductions produced the only win and the largest open deal. Signal-based outbound has one open deal from three, too early to call.",
        "The job post that named the pain got a reply and a deal (1 of 1); launch signals haven't yet (0 of 1). Both are anecdotes until 20.",
      ],
      focus: ["Lumenwire's ROI review on Grace's calendar.", "Rowanstack's redlines back and a signature date confirmed.", "A dated next step on Saltmarsh, or close it."],
      asks: ["One intro to a controller at a usage-priced company, for next quarter's pipeline."],
    },
    data.table,
  );
  return { weekOf: weekOf(c.today), generatedAt: c.ago(50), audience: "ceo", subject: `GTM update, week of ${shortDay(weekOf(c.today))}: commit ${money(f.commit)}`, body };
}
