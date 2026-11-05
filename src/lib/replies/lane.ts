import { addBusinessDays, addDays, daysBetween, todayISO } from "@/lib/domain/ids";
import type { Activity, ID, ISODate, Move, Person, ReplyIntent, Workspace } from "@/lib/domain/types";
import { SEND_KINDS } from "@/lib/learning/bets";
import { companyDomainOf } from "@/lib/hub/records";
import { companyName, emailOf, first, isSuppressed, localDate, shortDay } from "@/lib/moves/util";
import { onBusinessDay, parseReferral, parseReturnDate, parseRevisit, readOf, replyBy, type IntentRead, type Referral } from "./intent";

/**
 * Today's replies lane: one row per reply that needs the founder, wherever it came from (a sequencer's webhook or
 * poll, a pasted reply, Check replies). Each row carries how it reads and why, when an answer is due, the note it
 * answered, and up to four one-key actions that fit it. Built in code from the reply cards on the desk.
 */

export type LaneActionId = "draft" | "refer" | "hold" | "revisit" | "suppress" | "tomorrow" | "handled";

export interface LaneAction {
  id: LaneActionId;
  label: string;
  /** hold / revisit: the date it acts on. */
  until?: ISODate;
}

export interface LaneRow {
  move: Move;
  reply: Activity;
  person?: Person;
  name: string;
  firstName: string;
  company: string;
  domain: string;
  read: IntentRead;
  /** When an answer is due, if one is owed. */
  dueOn: ISODate | null;
  /** Working-calendar days until it's due (negative: overdue). */
  dueIn: number | null;
  /** Their words, one line. */
  snippet: string;
  /** The send they answered. */
  touch?: Activity;
  /** Out of office: the day they're back (parsed), and who covers. */
  backOn?: ISODate;
  delegate?: string;
  /** Not now: the day to check back, and whether it's a default rather than their words. */
  revisitOn?: ISODate;
  revisitGuessed?: boolean;
  /** Referral: who they pointed to, and whether that person is already on file. */
  referral?: Referral & { domain: string; personId?: ID };
  suppressed: boolean;
  /** Keys 1–4, in order. */
  actions: LaneAction[];
  dealId?: ID;
}

/** A not-now that names no time comes back in two months (the reply drafts' own default). */
export const REVISIT_DEFAULT_DAYS = 60;
/** An out-of-office with no return date holds a week. */
export const HOLD_DEFAULT_BUSINESS_DAYS = 5;

const GREETING = /^(hi|hey|hello|dear|thanks|thank you)\b[^.\n]{0,30}[,.!]?\s*$/i;

/** Their first real line, without the greeting. */
function snippetOf(text: string): string {
  const lines = text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  const body = lines.filter((l, i) => !(i === 0 && GREETING.test(l))).join(" ");
  const t = body.replace(/\s+/g, " ").trim();
  return t.length > 160 ? `${t.slice(0, 159).trimEnd()}…` : t;
}

/** The send a reply answers: the latest note to that person before it. */
export function touchBefore(ws: Workspace, reply: Activity): Activity | undefined {
  let best: Activity | undefined;
  for (const a of ws.activities) {
    if (!SEND_KINDS.has(a.kind) || a.personId !== reply.personId || a.at > reply.at) continue;
    if (!best || a.at > best.at) best = a;
  }
  return best;
}

/** The person a referral names, if they're already on file (same address, or same name at the company). */
function onFile(ws: Workspace, r: Referral, domain: string): Person | undefined {
  const email = r.email?.toLowerCase();
  const name = r.name?.toLowerCase();
  return Object.values(ws.people).find(
    (p) => (email && (p.email?.toLowerCase() === email || p.contactPaths.some((c) => c.value.toLowerCase() === email))) || (!!name && p.accountDomain === domain && p.name.toLowerCase() === name),
  );
}

function actionsFor(row: Omit<LaneRow, "actions">, intent: ReplyIntent | null): LaneAction[] {
  const f = row.firstName || "them";
  const draft = (label: string): LaneAction => ({ id: "draft", label });
  const tomorrow: LaneAction = { id: "tomorrow", label: "Tomorrow" };
  const handled: LaneAction = { id: "handled", label: "Handled" };
  switch (intent) {
    case "referral": {
      const who = row.referral?.name ? first(row.referral.name) : row.referral?.email;
      const refer: LaneAction = { id: "refer", label: row.referral?.personId ? `Draft a note to ${who}` : who ? `Add ${who} and draft a note` : "Add who they named" };
      return [refer, draft(`Thank ${f}`), handled];
    }
    case "not_now":
      return [{ id: "revisit", label: `Check back ${shortDay(row.revisitOn!)}`, until: row.revisitOn }, draft("Reply first"), handled];
    case "negative":
      return [draft("Close it kindly"), handled];
    case "unsubscribe":
      return row.suppressed ? [{ ...handled, label: "Done" }] : [{ id: "suppress", label: `Suppress ${f}` }];
    case "ooo":
      return [{ id: "hold", label: `Hold follow-ups to ${shortDay(row.backOn!)}`, until: row.backOn }, handled];
    case null:
      return [draft("Read it and draft"), tomorrow, handled];
    case "info_request":
      return [draft("Draft an answer"), tomorrow, handled];
    default:
      return [draft("Draft a reply"), tomorrow, handled];
  }
}

/** One lane row for a reply card, or null when the reply it answers is gone. */
export function laneRow(ws: Workspace, move: Move, now: Date): LaneRow | null {
  const reply = move.activityId ? ws.activities.find((a) => a.id === move.activityId) : undefined;
  if (!reply || reply.kind !== "reply_received") return null;
  const today = todayISO(now);
  const person = reply.personId ? ws.people[reply.personId] : undefined;
  const domain = person?.accountDomain ?? reply.accountDomain ?? "";
  const company = companyName(ws, domain);
  const read = readOf(ws, reply);
  const intent = read.intent;
  const text = (reply.body ?? reply.summary ?? "").trim();
  const dueOn = replyBy(intent, reply.at);
  const base: Omit<LaneRow, "actions"> = {
    move,
    reply,
    person,
    name: person?.name ?? "Someone",
    firstName: first(person?.name),
    company,
    domain,
    read,
    dueOn,
    dueIn: dueOn ? daysBetween(today, dueOn) : null,
    snippet: snippetOf(text) || reply.summary,
    touch: touchBefore(ws, reply),
    suppressed: !!person && isSuppressed(ws, person),
    ...(ws.accounts[domain]?.dealId ? { dealId: ws.accounts[domain].dealId } : {}),
  };
  if (intent === "ooo") {
    const back = (reply.body && parseReturnDate(reply.body, reply.at)) || addBusinessDays(localDate(reply.at), HOLD_DEFAULT_BUSINESS_DAYS);
    base.backOn = reply.holdUntil ?? back;
    const exclude = { names: [person?.name ?? "", ws.founder.name].filter(Boolean), emails: [emailOf(person) ?? "", ws.founder.email ?? ""].filter(Boolean) };
    const covering = reply.body ? parseReferral(reply.body, exclude) : null;
    if (covering?.name) base.delegate = covering.name;
  }
  if (intent === "not_now") {
    const parsed = parseRevisit(text, reply.at);
    base.revisitOn = reply.holdUntil ?? parsed ?? onBusinessDay(addDays(localDate(reply.at), REVISIT_DEFAULT_DAYS));
    base.revisitGuessed = !reply.holdUntil && !parsed;
  }
  if (intent === "referral") {
    // The model's read names the person when drafting ran; else code reads the address and the name.
    const pkg = read.by === "model" ? Object.values(ws.outreach).find((p) => p.mode === "reply" && p.personId === reply.personId && p.reply?.referral) : undefined;
    const exclude = { names: [person?.name ?? "", ws.founder.name].filter(Boolean), emails: [emailOf(person) ?? "", ws.founder.email ?? "", ws.sender?.email ?? ""].filter(Boolean) };
    const r = pkg?.reply?.referral?.name || pkg?.reply?.referral?.email ? { ...parseReferral(text, exclude), ...pkg!.reply!.referral } : parseReferral(text, exclude);
    if (r) {
      const at = companyDomainOf(r.email) ?? domain;
      const known = onFile(ws, r, at);
      base.referral = { ...r, domain: at, ...(known ? { personId: known.id } : {}) };
    }
  }
  return { ...base, actions: actionsFor(base, intent) };
}

/** Intents that owe nothing, in the order they still need a decision. */
const NO_DUE_ORDER: (ReplyIntent | null)[] = ["unsubscribe", "not_now", "negative", "ooo"];

/** The lane, most urgent first: overdue, due today, due later, then the ones that only need a decision. */
export function laneRows(ws: Workspace, moves: Move[], now: Date): LaneRow[] {
  return moves
    .map((m) => laneRow(ws, m, now))
    .filter((r): r is LaneRow => !!r)
    .sort((a, b) => {
      if (a.dueIn !== null && b.dueIn !== null) return a.dueIn - b.dueIn || a.reply.at.localeCompare(b.reply.at);
      if (a.dueIn !== null) return -1;
      if (b.dueIn !== null) return 1;
      return NO_DUE_ORDER.indexOf(a.read.intent) - NO_DUE_ORDER.indexOf(b.read.intent) || a.reply.at.localeCompare(b.reply.at);
    });
}

/** "Reply today", "Reply by tomorrow", "Reply by Mon", "1 day late". */
export function dueLabel(row: Pick<LaneRow, "dueIn" | "dueOn">): string | null {
  if (row.dueIn === null || !row.dueOn) return null;
  if (row.dueIn < 0) return `${-row.dueIn} ${row.dueIn === -1 ? "day" : "days"} late`;
  if (row.dueIn === 0) return "Reply today";
  if (row.dueIn === 1) return "Reply by tomorrow";
  return `Reply by ${new Date(`${row.dueOn}T12:00:00`).toLocaleDateString("en-US", { weekday: "short" })}`;
}
