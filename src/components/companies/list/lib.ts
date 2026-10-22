import { useSyncExternalStore } from "react";
import { BOARD_STAGES, missingCriteria, type Criterion } from "@/lib/deals/rules";
import { daysBetween, todayISO } from "@/lib/domain/ids";
import type { Account, Activity, Deal, DiscoverySource, Signal, SignalType, Stage, Workspace } from "@/lib/domain/types";

/** Pure helpers for the Companies surface. No React state, no fetching. */

/* ─────────────────────────── Today, without impure calls in render ─────────────────────────── */

function subscribeDay(cb: () => void) {
  const t = setInterval(cb, 60_000);
  return () => clearInterval(t);
}

/** Today's local date (`YYYY-MM-DD`). Re-renders when the day rolls over. */
export function useToday(): string {
  return useSyncExternalStore(subscribeDay, () => todayISO(), () => "");
}

/* ─────────────────────────── Prospects ─────────────────────────── */

export type ProspectStatus = "new" | "tracked" | "contacted" | "replied" | "dismissed";

export const PROSPECT_STATUS_LABEL: Record<ProspectStatus, string> = {
  new: "New",
  tracked: "Tracked",
  contacted: "Contacted",
  replied: "Replied",
  dismissed: "Dismissed",
};

/** Per account: has the founder sent anything, has anyone replied (reply wins). */
export function touchIndex(activities: Activity[]): Map<string, "contacted" | "replied"> {
  const out = new Map<string, "contacted" | "replied">();
  for (const a of activities) {
    if (!a.accountDomain) continue;
    if (a.kind === "reply_received") out.set(a.accountDomain, "replied");
    else if ((a.kind === "touch_sent" || a.kind === "linkedin_dm" || a.kind === "intro_requested") && out.get(a.accountDomain) !== "replied") {
      out.set(a.accountDomain, "contacted");
    }
  }
  return out;
}

export function prospectStatus(a: Account, touched: Map<string, "contacted" | "replied">): ProspectStatus {
  if (a.status === "disqualified") return "dismissed";
  const t = touched.get(a.domain);
  if (t) return t;
  return a.status === "tracked" || a.watch ? "tracked" : "new";
}

export const SIGNAL_LABEL: Record<SignalType, string> = {
  first_hire: "First hire",
  hiring: "Hiring",
  funding: "Funding",
  launch: "Launch",
  new_leader: "New leader",
  champion_job_change: "Champion moved",
  jd_names_pain: "Job post names the pain",
  stack_change: "Stack change",
  compliance_deadline: "Compliance deadline",
  persona_post: "Wrote about the problem",
  community_request: "Asked for help publicly",
  public_pain: "Public pain",
  filing: "Filing",
  sensitive: "Context only",
};

// Mirrors the server's freshness windows (src/lib/workflows/enrich.ts).
const WINDOW: Record<SignalType, number> = {
  champion_job_change: 90,
  first_hire: 60,
  jd_names_pain: 60,
  community_request: 14,
  new_leader: 90,
  funding: 90,
  stack_change: 90,
  launch: 60,
  compliance_deadline: 270,
  persona_post: 30,
  public_pain: 90,
  filing: 90,
  hiring: 45,
  sensitive: 90,
};

export function signalDecay(s: Pick<Signal, "type" | "date">, today: string): number {
  if (s.type === "sensitive" || !today) return 0;
  const age = Math.max(0, daysBetween(s.date, today));
  const w = WINDOW[s.type];
  if (age <= w / 3) return 1;
  if (age <= (2 * w) / 3) return 0.6;
  if (age <= w) return 0.3;
  return 0;
}

/** The signal the row leads with: strongest × freshest; never a sensitive one. */
export function topSignal(a: Account, today: string): Signal | undefined {
  const usable = a.signals.filter((s) => s.type !== "sensitive");
  const fresh = usable
    .filter((s) => s.strength > 0 && signalDecay(s, today) > 0)
    .sort((x, y) => y.strength * signalDecay(y, today) - x.strength * signalDecay(x, today) || y.date.localeCompare(x.date));
  return fresh[0];
}

/** "6d", "3mo", from a date and today (pure, so it's safe in render). */
export function ageLabel(date: string, today: string): string {
  if (!today) return "";
  const d = Math.max(0, daysBetween(date, today));
  if (d < 1) return "today";
  if (d < 30) return `${d}d`;
  if (d < 365) return `${Math.round(d / 30)}mo`;
  return `${Math.round(d / 365)}y`;
}

export function isScored(a: Account): boolean {
  return a.criteria.length > 0 || a.fitScore > 0;
}

export function priority(a: Account): number {
  return (isScored(a) ? a.fitScore : 40) * (1 + a.whyNowScore / 2);
}

export const TIER_HINT: Record<Account["tier"], string> = {
  A: "Tier A · strong fit and a fresh reason to talk now",
  B: "Tier B · strong fit, no fresh reason yet",
  C: "Tier C · partial fit with a strong signal",
};

export const SOURCE_LABEL: Record<DiscoverySource, string> = {
  yc_directory: "YC directory",
  ats_search: "Job boards",
  hn_hiring: "HN hiring",
  form_d: "SEC Form D",
  press: "Press",
  competitor_customers: "Competitor's customers",
  community: "Community",
  founder_network: "Your network",
  stargazers: "GitHub stargazers",
  referral: "Referral",
  web_search: "Web search",
  manual: "Added by you",
  csv_import: "CSV import",
  integration: "Integrations",
};

/** "HubSpot", "CSV · targets.csv", "YC directory". */
export function sourceText(a: Pick<Account, "source" | "sourceDetail">): string {
  if (a.source === "integration") return a.sourceDetail || "Integration";
  if (a.source === "csv_import") return a.sourceDetail ? `CSV · ${a.sourceDetail}` : "CSV import";
  return SOURCE_LABEL[a.source] ?? a.source;
}

export type DismissReason = NonNullable<Account["disqualified"]>["reason"];

export const DISMISS_REASONS: { value: DismissReason; label: string }[] = [
  { value: "not_icp", label: "Not ICP" },
  { value: "already_known", label: "Already know them" },
  { value: "competitor", label: "Competitor" },
  { value: "customer", label: "Customer" },
  { value: "too_small", label: "Too small" },
  { value: "too_big", label: "Too big" },
  { value: "other", label: "Other" },
];

/* ─────────────────────────── Deals ─────────────────────────── */

export function isForward(from: Stage, to: Stage): boolean {
  const a = BOARD_STAGES.indexOf(from);
  const b = BOARD_STAGES.indexOf(to);
  return a !== -1 && b !== -1 && b > a;
}

export function stageEnteredAt(d: Deal): string {
  for (let i = d.stageHistory.length - 1; i >= 0; i--) if (d.stageHistory[i].stage === d.stage) return d.stageHistory[i].at;
  return d.createdAt;
}

export function daysInStage(d: Deal, today: string): number {
  return today ? Math.max(0, daysBetween(stageEnteredAt(d), today)) : 0;
}

export function nextStepState(d: Deal, today: string): "ok" | "overdue" | "missing" {
  if (!d.nextStep?.date || !d.nextStep.what) return "missing";
  return today && d.nextStep.date < today ? "overdue" : "ok";
}

export interface ChampionInfo {
  name?: string;
  status: "tested" | "untested" | "coach" | "none";
}

export function championOf(d: Deal, ws: Workspace): ChampionInfo {
  const c = d.card?.champion;
  if (c?.championStatus && c.championStatus !== "none") return { name: c.name, status: c.championStatus };
  const contact = d.contacts.find((x) => x.role === "champion");
  const person = contact ? ws.people[contact.personId] : undefined;
  if (person) return { name: person.name, status: person.champion ?? "untested" };
  const p = Object.values(ws.people).find((x) => x.accountDomain === d.accountDomain && x.champion);
  if (p) return { name: p.name, status: p.champion ?? "untested" };
  return { status: "none" };
}

/**
 * What's usually true before a deal belongs at `to`, for every stage it would pass through
 * (the shared rules in src/lib/deals/rules.ts, same as the company sheet). A check, not a gate.
 */
export function exitCriteria(d: Deal, to: Stage, today: string): Criterion[] {
  const from = BOARD_STAGES.indexOf(d.stage);
  const at = BOARD_STAGES.indexOf(to);
  if (at === -1) return [];
  const stages = BOARD_STAGES.slice(Math.max(0, from + 1), at + 1);
  return stages.flatMap((s) => missingCriteria(s, d, today));
}

export function lastActivityDays(d: Deal, today: string): number | null {
  return today && d.lastActivityAt ? Math.max(0, daysBetween(d.lastActivityAt, today)) : null;
}

export interface CustomerRow {
  key: string;
  domain: string;
  since: string;
  deal?: Deal;
}

/** Won deals, plus paying customers that came in without a deal (Stripe or customer CSV imports). Newest first. */
export function customerRows(ws: Workspace): CustomerRow[] {
  const won = Object.values(ws.deals).filter((d) => d.stage === "won");
  const wonDomains = new Set(won.map((d) => d.accountDomain));
  return [
    ...won.map((d) => ({ key: d.id, domain: d.accountDomain, since: stageEnteredAt(d), deal: d })),
    ...Object.values(ws.accounts)
      .filter((a) => a.status === "customer" && !wonDomains.has(a.domain))
      .map((a) => ({ key: a.domain, domain: a.domain, since: a.customerAt ?? a.addedAt })),
  ].sort((a, b) => b.since.localeCompare(a.since));
}

export function dealValue(d: Deal): number | undefined {
  if (d.amountUsd) return d.amountUsd;
  const quotes = d.priceQuotes ?? [];
  return quotes.length ? quotes[quotes.length - 1].amountUsd : undefined;
}

/* ─────────────────────────── Misc ─────────────────────────── */

export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
}

/** True when a menu, popover or dialog has focus, so page shortcuts stay quiet. */
export function inOverlay(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el?.closest?.('[role="menu"],[role="dialog"],[role="listbox"],[data-radix-popper-content-wrapper]');
}

export function normalizeDomainInput(input: string): string | null {
  const raw = input.trim().toLowerCase();
  if (!raw) return null;
  try {
    const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
    const host = url.hostname.replace(/^www\./, "");
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : null;
  } catch {
    return null;
  }
}

export function nameFromDomain(domain: string): string {
  const stem = domain.split(".")[0];
  return stem.charAt(0).toUpperCase() + stem.slice(1);
}
