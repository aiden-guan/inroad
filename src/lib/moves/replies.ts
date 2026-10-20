import { addDays, todayISO } from "@/lib/domain/ids";
import type { Activity, Person, Workspace } from "@/lib/domain/types";
import { companyName, emailOf, localDate } from "./util";

/**
 * "Check replies": there's no inbox access, so approving a draft counts as sent and the founder
 * reconciles once a day: one Gmail search for everyone touched in 14 days, then R / N / B / U per person.
 */

export const REPLY_WINDOW_DAYS = 14;

export interface AwaitingPerson {
  personId: string;
  person?: Person;
  name: string;
  domain: string;
  company: string;
  email?: string;
  /** Unmarked email touches, oldest first. */
  touches: Activity[];
  lastAt: string;
  /** "First touch" / "Follow-up 2". */
  lastLabel: string;
}

function touchLabel(a: Activity): string {
  const step = a.draftRef?.step ?? 1;
  return step <= 1 ? "First touch" : `Follow-up ${step - 1}`;
}

export function awaitingOutcome(ws: Workspace, now: Date): AwaitingPerson[] {
  const since = addDays(todayISO(now), -REPLY_WINDOW_DAYS);
  const lastReply = new Map<string, string>();
  for (const a of ws.activities) {
    if (a.kind === "reply_received" && a.personId && (!lastReply.has(a.personId) || a.at > lastReply.get(a.personId)!)) lastReply.set(a.personId, a.at);
  }
  const byPerson = new Map<string, Activity[]>();
  for (const a of ws.activities) {
    if (a.kind !== "touch_sent" || !a.personId || a.outcome) continue;
    if (a.channel && a.channel !== "email") continue;
    if (localDate(a.at) < since) continue;
    const replied = lastReply.get(a.personId);
    if (replied && replied > a.at) continue;
    byPerson.set(a.personId, [...(byPerson.get(a.personId) ?? []), a]);
  }
  const out: AwaitingPerson[] = [];
  for (const [personId, touches] of byPerson) {
    touches.sort((x, y) => x.at.localeCompare(y.at));
    const person = ws.people[personId];
    const last = touches[touches.length - 1];
    const domain = person?.accountDomain ?? last.accountDomain ?? "";
    out.push({
      personId,
      person,
      name: person?.name ?? "Unknown contact",
      domain,
      company: companyName(ws, domain),
      email: emailOf(person),
      touches,
      lastAt: last.at,
      lastLabel: touchLabel(last),
    });
  }
  return out.sort((a, b) => a.lastAt.localeCompare(b.lastAt));
}

/* ───────────── Gmail search deep links ───────────── */

const MAX_URL = 1800;

export function gmailBase(authUser?: string): string {
  return `https://mail.google.com/mail/u/${encodeURIComponent(authUser?.trim() || "0")}/`;
}

/** `from:{a@x.com b@y.com} newer_than:14d` — braces mean OR in Gmail search. */
export function gmailQuery(emails: string[], days = REPLY_WINDOW_DAYS): string {
  return `from:{${emails.join(" ")}} newer_than:${days}d`;
}

/** One search covering everyone, split into several links so each stays under ~1,800 characters. */
export function gmailSearchLinks(emails: string[], authUser?: string): { url: string; query: string; count: number }[] {
  const unique = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter((e) => e.includes("@")))];
  const base = `${gmailBase(authUser)}#search/`;
  const links: { url: string; query: string; count: number }[] = [];
  let chunk: string[] = [];
  const build = (list: string[]) => {
    const query = gmailQuery(list);
    return { url: base + encodeURIComponent(query), query, count: list.length };
  };
  for (const email of unique) {
    const next = [...chunk, email];
    if (chunk.length && build(next).url.length > MAX_URL) {
      links.push(build(chunk));
      chunk = [email];
    } else {
      chunk = next;
    }
  }
  if (chunk.length) links.push(build(chunk));
  return links;
}
