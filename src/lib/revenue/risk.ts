import { daysBetween } from "@/lib/domain/ids";
import { STAGE_LABELS, type Deal, type ISODate, type Workspace } from "@/lib/domain/types";
import { first, localDate } from "@/lib/moves/util";
import { closeDateSlips, daysInStage, openStage, type RevenueStats } from "./stats";

/**
 * Deal risk, in code. Each risk is a fact on file (a date, a count, a missing field), says how bad it
 * is at this stage, and carries the one fix that moves it. Health is 100 minus the weight of what's
 * wrong; nothing is guessed from tone. These are the questions a good deal review asks every week.
 */

export type RiskCode =
  | "close_passed"
  | "close_slipped"
  | "no_next_step"
  | "next_step_overdue"
  | "next_step_unconfirmed"
  | "single_threaded"
  | "pricing_silent"
  | "no_economic_buyer"
  | "economic_buyer_not_engaged"
  | "no_champion"
  | "champion_untested"
  | "stalled"
  | "quiet"
  | "no_critical_event"
  | "unpaid_pilot"
  | "no_pilot_criteria"
  | "plan_behind"
  | "no_decision_process";

export type Severity = "high" | "medium" | "low";

/** The one thing that moves a risk. `ask` opens Ask on the deal with this question; otherwise `href` opens the sheet. */
export interface Fix {
  label: string;
  href?: string;
  ask?: string;
}

export interface Risk {
  code: RiskCode;
  severity: Severity;
  /** ≤ 6 words, "Close date passed". */
  label: string;
  /** The fact behind it, ≤ 20 words. */
  detail: string;
  fix: Fix;
}

export const SEVERITY_WEIGHT: Record<Severity, number> = { high: 30, medium: 15, low: 5 };
export const QUIET_DAYS = 14;
export const STALL_FACTOR = 1.5;

const sheet = (d: Deal) => `/companies?c=${encodeURIComponent(d.accountDomain)}`;

/** "Oct 31" for copy. */
function day(date: ISODate): string {
  const d = new Date(`${date}T12:00:00`);
  return Number.isNaN(d.getTime()) ? date : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function championName(ws: Workspace, deal: Deal): string | undefined {
  const named = deal.card?.champion?.name;
  if (named) return first(named);
  const c = deal.contacts.find((x) => x.role === "champion");
  return c ? first(ws.people[c.personId]?.name) : undefined;
}

export function dealRisks(ws: Workspace, deal: Deal, stats: RevenueStats, today: ISODate): Risk[] {
  if (!openStage(deal.stage)) return [];
  const out: Risk[] = [];
  const stage = deal.stage;
  const late = stage === "pilot" || stage === "proposal";
  const qualifiedPlus = stage !== "talking";
  const champ = championName(ws, deal);
  const via = champ ? ` with ${champ}` : "";
  const add = (code: RiskCode, severity: Severity, label: string, detail: string, fix: Fix) => out.push({ code, severity, label, detail, fix });

  if (deal.closeDate && deal.closeDate < today) {
    const d = daysBetween(deal.closeDate, today);
    add("close_passed", late ? "high" : "medium", "Close date passed", `It was ${day(deal.closeDate)}, ${d} ${d === 1 ? "day" : "days"} ago, and the deal is still open.`, {
      label: `Re-confirm the date${via}`,
      ask: `The close date on ${deal.name} passed. What should I ask${via} to get a real date, and what's the honest forecast call?`,
    });
  }
  const slips = closeDateSlips(deal);
  if (slips >= 1) {
    const firstDate = deal.closeDateHistory?.[0]?.date;
    const pushedDays = firstDate && deal.closeDate ? Math.max(0, daysBetween(firstDate, deal.closeDate)) : 0;
    // Two pushes, three weeks in all, or across a quarter line: deals that slip like that win far less often (Ebsta).
    const crossed = !!firstDate && !!deal.closeDate && quarterKey(firstDate) !== quarterKey(deal.closeDate);
    const severe = slips >= 2 || pushedDays >= 21 || crossed;
    add("close_slipped", severe ? "high" : "medium", slips >= 2 ? `Pushed ${slips} times` : crossed ? "Pushed into next quarter" : "Close date pushed", `First promised for ${firstDate ? day(firstDate) : "earlier"}; now ${deal.closeDate ? day(deal.closeDate) : "undated"}${pushedDays ? `, ${pushedDays} days later` : ""}.`, {
      label: "Find what's really blocking it",
      ask: `${deal.name}'s close date has moved ${slips} ${slips === 1 ? "time" : "times"}. What is most likely blocking it, based on the card and the calls, and what should I do this week?`,
    });
  }

  const step = deal.nextStep;
  if (!step?.date) {
    add("no_next_step", qualifiedPlus ? "high" : "medium", "No dated next step", "Nothing on the calendar with the buyer.", { label: "Set the next step", href: sheet(deal) });
  } else if (step.date < today) {
    const d = daysBetween(step.date, today);
    add("next_step_overdue", d > 7 || late ? "high" : "medium", "Next step overdue", `"${step.what.slice(0, 60)}" was due ${d} ${d === 1 ? "day" : "days"} ago.`, { label: "Update the next step", href: sheet(deal) });
  } else if (!step.buyerAgreed) {
    add("next_step_unconfirmed", stage === "proposal" ? "medium" : "low", "Next step not confirmed", "The buyer hasn't agreed to it on a call or in writing.", { label: "Get it on their calendar", href: sheet(deal) });
  }

  // Two buyer contacts by Qualified, three by Pilot or Proposal: won deals have more people on the buyer side.
  const want = late ? 3 : 2;
  if (qualifiedPlus && deal.contacts.length < want) {
    const one = deal.contacts.length <= 1;
    add("single_threaded", one && late ? "high" : "medium", one ? "Single-threaded" : "Thin on the buyer side", `${deal.contacts.length} ${deal.contacts.length === 1 ? "contact" : "contacts"}${one && champ ? ` (${champ})` : ""}; aim for ${want} at ${STAGE_LABELS[stage]}. If one goes quiet, so does the deal.`, {
      label: "Add another thread",
      ask: `${deal.name} has ${deal.contacts.length} buyer ${deal.contacts.length === 1 ? "contact" : "contacts"}. Who else should I bring in (economic buyer, technical approver, a user), and draft the note asking${via ? ` ${champ}` : " my contact"} to loop them in.`,
    });
  }

  const eb = deal.card?.economicBuyer;
  const ebKnown = !!(eb?.name || eb?.value) || (deal.qualification?.economicBuyer ?? 0) >= 1 || deal.contacts.some((c) => c.role === "economic_buyer");
  const ebEngaged = !!eb?.engaged || (deal.qualification?.economicBuyer ?? 0) === 2;
  if (qualifiedPlus && !ebKnown) {
    add("no_economic_buyer", late ? "high" : "medium", "No economic buyer", "Nobody on file owns the budget.", {
      label: "Find who signs",
      ask: `Who is most likely the economic buyer at ${deal.name}, and how do I get them into the next call?`,
    });
  } else if (late && !ebEngaged) {
    add("economic_buyer_not_engaged", stage === "proposal" ? "high" : "medium", "Economic buyer not engaged", `${eb?.name ? first(eb.name) : "The budget owner"} hasn't been on a call.`, {
      label: "Get the buyer in the room",
      ask: `Draft a short note${via ? ` to ${champ}` : ""} asking to bring ${eb?.name ?? "the economic buyer"} into the next ${deal.name} call, with a reason that serves them.`,
    });
  }

  const champion = deal.card?.champion?.championStatus ?? "none";
  if (qualifiedPlus && champion === "none" && !deal.contacts.some((c) => c.role === "champion")) {
    add("no_champion", "medium", "No champion", "No one inside is selling this when you're not there.", { label: "Find your champion", href: sheet(deal) });
  } else if (late && champion !== "tested") {
    add("champion_untested", "medium", "Champion untested", `${champ ?? "Your contact"} hasn't done anything costly for the deal yet.`, {
      label: "Test the champion",
      ask: `What's a fair ask that tests whether ${champ ?? "my contact"} at ${deal.name} is a real champion (an intro, a meeting, a shared doc)? Draft it.`,
    });
  }

  const inStage = daysInStage(deal, today);
  const typical = stats.stageDays[stage].value;
  if (inStage > typical * STALL_FACTOR) {
    add("stalled", inStage > typical * 2 ? "high" : "medium", `Stalled in ${STAGE_LABELS[stage]}`, `${inStage} days here; deals usually move on in about ${Math.round(typical)}.`, {
      label: "Plan the unstick",
      ask: `${deal.name} has been in ${STAGE_LABELS[stage]} for ${inStage} days. What's the most likely reason, and what's the one move that gets it moving this week?`,
    });
  }

  // Late-stage deals go cold faster: a week of silence at Pilot or Proposal means as much as two weeks earlier on.
  const quiet = Math.max(0, daysBetween(localDate(deal.lastActivityAt || deal.updatedAt), today));
  const quietAfter = late ? QUIET_DAYS / 2 : QUIET_DAYS;
  if (quiet >= quietAfter) {
    add("quiet", quiet >= quietAfter * 1.5 ? "high" : "medium", "Gone quiet", `No activity for ${quiet} days.`, {
      label: `Re-engage${via}`,
      ask: `${deal.name} has been quiet for ${quiet} days. Draft a short, specific re-engagement note${via} that gives them a reason to answer.`,
    });
  }

  const ce = deal.card?.criticalEvent;
  if (qualifiedPlus && !(ce?.value && ce.status !== "not_covered")) {
    add("no_critical_event", stage === "proposal" ? "medium" : "low", "No critical event", "No date it has to be fixed by, so no reason to buy now.", {
      label: "Find the deadline",
      ask: `What questions should I ask on the next ${deal.name} call to find their critical event (a date and what happens if they miss it)?`,
    });
  }

  if (stage === "pilot") {
    if (!deal.pilot?.criteria) add("no_pilot_criteria", "medium", "No success criteria", "Nothing written that says the pilot worked.", { label: "Write the criteria", href: sheet(deal) });
    const started = deal.pilot?.startedOn;
    if (deal.pilot && !deal.pilot.paid && started && daysBetween(started, today) > 30) {
      add("unpaid_pilot", "medium", "Unpaid pilot", `Free for ${daysBetween(started, today)} days.`, { label: "Ask for the conversion", href: sheet(deal) });
    }
  }

  const behind = (deal.map?.milestones ?? []).filter((m) => m.status !== "done" && m.due < today);
  if (behind.length) {
    add("plan_behind", late ? "medium" : "low", "Action plan behind", `${behind.length} ${behind.length === 1 ? "milestone" : "milestones"} past due, starting with "${behind[0].step.slice(0, 50)}".`, {
      label: "Review the plan with them",
      href: sheet(deal),
    });
  }

  if (late && deal.closeDate && deal.closeDate >= today && daysBetween(today, deal.closeDate) <= 30 && !deal.priceQuotes?.length && !deal.amountUsd) {
    add("pricing_silent", "low", "No price discussed", `Closes in ${daysBetween(today, deal.closeDate)} days and no number has been said out loud.`, {
      label: "Put a number on the table",
      ask: `${deal.name} closes in under a month and we haven't discussed price. What should I anchor on, and how do I bring it up on the next call?`,
    });
  }

  if (stage === "proposal" && !deal.card?.decisionProcess?.value) {
    add("no_decision_process", "medium", "Paper process unknown", "No one has said who signs, or what happens between yes and signature.", {
      label: "Map the paper process",
      ask: `Draft the questions to map ${deal.name}'s decision and paper process (signer, legal, security, procurement, timing).`,
    });
  }

  return out.sort((a, b) => SEVERITY_WEIGHT[b.severity] - SEVERITY_WEIGHT[a.severity]);
}

function quarterKey(date: ISODate): string {
  const [y, m] = date.split("-").map(Number);
  return `${y}-Q${Math.floor((m - 1) / 3) + 1}`;
}

/** 100 when nothing is wrong, less the weight of each risk. */
export function healthOf(risks: Risk[]): number {
  return Math.max(0, 100 - risks.reduce((n, r) => n + SEVERITY_WEIGHT[r.severity], 0));
}

/** Healthy only when nothing worse than a low risk is open; one high risk is enough to be at risk. */
export function healthBand(health: number, risks: Risk[] = []): "healthy" | "watch" | "at_risk" {
  if (risks.some((r) => r.severity === "high") || health < 50) return "at_risk";
  if (risks.some((r) => r.severity === "medium") || health < 80) return "watch";
  return "healthy";
}
