import { daysBetween, todayISO } from "@/lib/domain/ids";
import { OPEN_STAGES, type Account, type Deal, type Person, type Stage, type Workspace } from "@/lib/domain/types";

/** Pure helpers shared by the move rules, the scoreboard and the review data. Server and browser. */

/** Local calendar date of an ISO timestamp (or the date itself if it's already `YYYY-MM-DD`). */
export function localDate(iso: string | undefined): string {
  if (!iso) return "";
  if (iso.length === 10) return iso;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso.slice(0, 10) : todayISO(d);
}

export function daysSince(iso: string | undefined, today: string): number {
  if (!iso) return 0;
  return Math.max(0, daysBetween(localDate(iso), today));
}

export function hoursSince(iso: string | undefined, now: Date): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : Math.max(0, (now.getTime() - t) / 3_600_000);
}

/** "3h ago", "2d ago", "just now". */
export function ago(iso: string | undefined, now: Date): string {
  if (!iso) return "";
  const t = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).getTime();
  if (Number.isNaN(t)) return "";
  const mins = Math.max(0, Math.round((now.getTime() - t) / 60_000));
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 45) return `${days}d ago`;
  return `${Math.round(days / 30)}mo ago`;
}

/** Compact age for dated facts: "today", "12d", "3mo". */
export function ageShort(date: string | undefined, today: string): string {
  if (!date) return "";
  const d = daysSince(date, today);
  if (d < 1) return "today";
  if (d < 45) return `${d}d`;
  return `${Math.round(d / 30)}mo`;
}

export function clockTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export function shortDay(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  return Number.isNaN(d.getTime()) ? date : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function first(name: string | undefined): string {
  return (name ?? "").trim().split(/\s+/)[0] ?? "";
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "a" or "an" by sound, for the words drafts offer: "an insight memo", "a one-pager", "a user guide". */
export function aOrAn(word: string): string {
  return /^[aeiou]/i.test(word) && !/^(one|once|uni|use|usu|eu)/i.test(word) ? "an" : "a";
}

export function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

export function companyName(ws: Workspace, domain: string | undefined): string {
  if (!domain) return "their company";
  return ws.accounts[domain]?.name ?? domain;
}

export function isOpen(deal: Deal | undefined): deal is Deal {
  return !!deal && OPEN_STAGES.includes(deal.stage);
}

export function openDealFor(ws: Workspace, domain: string | undefined): Deal | undefined {
  if (!domain) return undefined;
  const id = ws.accounts[domain]?.dealId;
  const deal = id ? ws.deals[id] : undefined;
  return isOpen(deal) ? deal : undefined;
}

/** Later stages carry more weight: a slipped proposal costs more than a slipped first call. */
export function stageMult(stage: Stage | undefined): number {
  switch (stage) {
    case "proposal":
      return 1.5;
    case "pilot":
      return 1.4;
    case "qualified":
      return 1.2;
    case "talking":
      return 1.1;
    default:
      return 1;
  }
}

export function overdueBoost(days: number): number {
  return Math.min(30, Math.max(0, days) * 5);
}

/** The address a touch went to: the person's email, else the first email-like contact path that hasn't bounced. */
export function emailOf(person: Person | undefined): string | undefined {
  if (!person) return undefined;
  const bounced = new Set(person.contactPaths.filter((p) => p.bounced).map((p) => p.value.toLowerCase()));
  if (person.email && person.email.includes("@") && !bounced.has(person.email.toLowerCase())) return person.email;
  return person.contactPaths.find((p) => p.value.includes("@") && !p.bounced)?.value;
}

export function isSuppressed(ws: Workspace, person: Person | undefined, domain?: string): boolean {
  if (person?.doNotContact) return true;
  const email = emailOf(person)?.toLowerCase();
  const d = (domain ?? person?.accountDomain)?.toLowerCase();
  return ws.suppression.some((s) => (email && s.email?.toLowerCase() === email) || (d && s.domain?.toLowerCase() === d));
}

/** Best person to write to at an account: the dossier's pick, then a champion or buyer, then anyone. */
export function bestPerson(ws: Workspace, acc: Account): Person | undefined {
  const pick = acc.dossier?.recommendation.personId;
  if (pick && ws.people[pick]) return ws.people[pick];
  const people = acc.peopleIds.map((id) => ws.people[id]).filter((p): p is Person => !!p && !p.doNotContact && !p.mayHaveLeft);
  return people.find((p) => p.role === "champion") ?? people.find((p) => p.role === "economic_buyer") ?? people[0];
}

/**
 * Whether a cold or LinkedIn draft has something cited to stand on: a dossier angle or an outreach-usable signal
 * backed by evidence that isn't flagged wrong and isn't low confidence (the composer's own test).
 */
export function hasDraftableAngle(ws: Workspace, acc: Account): boolean {
  const usable = (id: string | undefined) => {
    const ev = id ? ws.evidence[id] : undefined;
    return !!ev && !ev.flaggedWrong && (ev.confidence === "high" || ev.confidence === "medium");
  };
  return (acc.dossier?.angles ?? []).some((a) => a.evidenceIds.some(usable)) || acc.signals.some((s) => s.usableInOutreach && usable(s.evidenceId));
}

/** Someone the founder knows first-hand (a LinkedIn connection): write to them directly, no intro and no cold template. */
export function knowsDirectly(p: Person | undefined): boolean {
  return !!p && (p.source === "founder_network" || p.contactPaths.some((x) => x.kind === "linkedin" && x.via === "Your 1st-degree connection"));
}

/** The strongest fresh signal at an account (dated within `days`). */
export function topSignal(acc: Account, today: string, days = 30) {
  return [...acc.signals]
    .filter((s) => s.date && daysSince(s.date, today) <= days && s.type !== "sensitive")
    .sort((a, b) => b.strength - a.strength || b.date.localeCompare(a.date))[0];
}
