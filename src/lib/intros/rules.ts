import { addDays, daysBetween } from "@/lib/domain/ids";
import type { Account, Connection, Connector, ID, Intro, IntroStage, Meeting, Person, RelationshipTag, Workspace } from "@/lib/domain/types";
import { bestPerson, first, knowsDirectly, localDate } from "@/lib/moves/util";
import { linkedinKey, normalizeCompany } from "@/lib/network/csv";
import { knowsByTag, tagPhrase } from "@/lib/network/tags";
import { normalizeTitle, seniority } from "@/lib/network/titles";

/**
 * Intros, end to end, in code (zero tokens). Pure: the Intros page, Today's cards, the company
 * sheet's "Ways in" and the agent API all read the same answers.
 *
 * What a good human connector does, and what an AI superconnector gets wrong when it goes quiet:
 * every intro always says whose move it is and when that changes. One nudge per ask, never a
 * sequence. The founder replies to an intro within a day, moves the connector to BCC, and tells
 * them how it went. Each connector carries one open ask at a time, rests two weeks between asks,
 * and gets help back before a fourth ask.
 */

export const TIMING = {
  /** Days before one polite nudge to a quiet connector (or side of a give). */
  nudgeAfter: 5,
  /** Days after the nudge before the ask is let go. */
  letGoAfterNudge: 7,
  /** Days a forwarded ask can sit before checking in with the connector. */
  checkInAfter: 7,
  /** Days after replying to an intro before one follow-up to book. */
  bookAfter: 5,
  /** Days between asks to the same connector. */
  connectorRest: 14,
  /** Asks in 90 days, with nothing given back, before the ledger says give first. */
  giveFirstAfter: 3,
  /** A path that was declined isn't suggested again for this long. */
  declinedCooldown: 90,
  /** Gives: days after the intro before checking how it went. */
  checkHowAfter: 14,
} as const;

export const OPEN_STAGES: IntroStage[] = ["asked", "forwarded", "introduced", "meeting"];
export const isOpenIntro = (i: Intro) => OPEN_STAGES.includes(i.stage);

export const STAGE_LABEL: Record<IntroStage, string> = {
  asked: "Asked",
  forwarded: "Checking with them",
  introduced: "Introduced",
  meeting: "Meeting",
  done: "Done",
  declined: "Passed",
  no_answer: "No answer",
};

export type IntroAction =
  /** One polite nudge to a quiet connector (ask) or a quiet side (give). */
  | "nudge"
  /** Forwarded, then quiet: ask the connector whether they heard back. */
  | "check_in"
  /** Quiet after the nudge: close it kindly and use another way in. */
  | "let_go"
  /** The intro email landed: reply all, connector to BCC, offer times. */
  | "reply"
  /** Replied, no time picked: one follow-up to the person. */
  | "book"
  /** Met (or it's settled): tell the connector how it went. */
  | "close_loop"
  /** The connector or the person passed: thank the connector for checking. */
  | "thank"
  /** Give: both said yes, send the double intro. */
  | "send_intro"
  /** Give: two weeks on, ask how it went. */
  | "check_how";

export interface IntroNext {
  /** Whose move it is. Never left implicit. */
  owner: "you" | "connector" | "target" | "sides" | null;
  action?: IntroAction;
  /** "Waiting on Claire · nudge Thu" or "Reply to the intro". Plain sentence fragment. */
  line: string;
  /** When it is (or became) the founder's move. */
  due?: string;
  overdueDays?: number;
  /** Give: which side the nudge or let-go is about. */
  side?: 0 | 1;
}

const weekday = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { weekday: "short" });
const shortDate = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** "Thu" within a week, "Oct 30" further out. */
export function when(iso: string, today: string): string {
  const d = daysBetween(today, iso);
  if (d === 0) return "today";
  if (d === 1) return "tomorrow";
  if (d > 1 && d < 7) return weekday(iso);
  return shortDate(iso);
}

function due(due: string, today: string): Pick<IntroNext, "due" | "overdueDays"> {
  const late = daysBetween(due, today);
  return late > 0 ? { due, overdueDays: late } : { due };
}

/** The person's first name when the target is a named person ("Rafael"), else undefined ("the Head of Finance"). */
export function targetFirstName(intro: Pick<Intro, "targetName" | "personId">): string | undefined {
  const t = intro.targetName.trim();
  if (intro.personId) return first(t);
  return /^(the|a|an|someone|somebody|two|three|their|her|his)\b/i.test(t) || !/^[A-Z]/.test(t) ? undefined : first(t);
}

/** How to name the target in a sentence: "Rafael", or "the Head of Finance" (without its company). */
export function targetLabel(intro: Pick<Intro, "targetName" | "personId">): string {
  return targetFirstName(intro) ?? intro.targetName.replace(/,.*$/, "").replace(/\s+at\s+.+$/i, "").trim();
}

/** The meeting that came out of this intro: the linked one, or the first with that company after the intro. */
export function introMeeting(ws: Workspace, intro: Intro, today: string): { id: ID; on: string; held: boolean } | undefined {
  const asSeen = (m: Meeting) => ({ id: m.id, on: localDate(m.startsAt), held: !!m.debrief || localDate(m.startsAt) < today });
  if (intro.meetingId && ws.meetings[intro.meetingId]) return asSeen(ws.meetings[intro.meetingId]);
  if (!intro.accountDomain || !intro.introducedOn) return undefined;
  const m = Object.values(ws.meetings)
    .filter((x) => ws.deals[x.dealId]?.accountDomain === intro.accountDomain && localDate(x.startsAt) >= intro.introducedOn!)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
  return m ? asSeen(m) : undefined;
}

/** Whose move it is and what it is. Deterministic; the same answer on Today, the Intros page and the sheet. */
export function nextStep(intro: Intro, ws: Workspace, today: string): IntroNext {
  const connector = first(intro.connectorName) || "your connector";
  const target = targetLabel(intro) || "them";

  if (intro.kind === "give") return nextGive(intro, today);

  switch (intro.stage) {
    case "asked": {
      if (intro.nudgedOn) {
        const at = addDays(intro.nudgedOn, TIMING.letGoAfterNudge);
        if (at <= today) return { owner: "you", action: "let_go", line: `${connector} hasn't answered since your nudge. Let it go kindly`, ...due(at, today) };
        return { owner: "connector", line: `Waiting on ${connector} · nudged ${when(intro.nudgedOn, today)}`, due: at };
      }
      const at = addDays(intro.askedOn, TIMING.nudgeAfter);
      if (at <= today) return { owner: "you", action: "nudge", line: `No answer from ${connector} yet. One short nudge`, ...due(at, today) };
      return { owner: "connector", line: `Waiting on ${connector} · nudge ${when(at, today)} if quiet`, due: at };
    }
    case "forwarded": {
      const since = intro.forwardedOn ?? intro.askedOn;
      const checked = intro.nudgedOn && intro.nudgedOn >= since;
      if (checked) {
        const at = addDays(intro.nudgedOn!, TIMING.letGoAfterNudge);
        if (at <= today) return { owner: "you", action: "let_go", line: `Still no word from ${target}. Let it go kindly`, ...due(at, today) };
        return { owner: "target", line: `${connector} is checking with ${target} · you checked in ${when(intro.nudgedOn!, today)}`, due: at };
      }
      const at = addDays(since, TIMING.checkInAfter);
      if (at <= today) return { owner: "you", action: "check_in", line: `${target} hasn't answered ${connector}. Ask if they heard back`, ...due(at, today) };
      return { owner: "target", line: `${connector} is checking with ${target} · check in ${when(at, today)}`, due: at };
    }
    case "introduced": {
      if (!intro.repliedOn) return { owner: "you", action: "reply", line: `Reply to ${connector}'s intro within a day`, ...due(intro.introducedOn ?? today, today) };
      const meeting = introMeeting(ws, intro, today);
      if (meeting?.held) return { owner: "you", action: "close_loop", line: `Tell ${connector} how it went with ${target}`, ...due(addDays(meeting.on, 1), today) };
      if (meeting) return { owner: null, line: `Meeting with ${target} ${when(meeting.on, today)}` };
      const followed = intro.nudgedOn && intro.nudgedOn >= intro.repliedOn;
      if (followed) return { owner: "target", line: `Waiting on ${target} to pick a time · followed up ${when(intro.nudgedOn!, today)}` };
      const at = addDays(intro.repliedOn, TIMING.bookAfter);
      if (at <= today) return { owner: "you", action: "book", line: `${target} hasn't picked a time. One follow-up`, ...due(at, today) };
      return { owner: "target", line: `Waiting on ${target} to pick a time · follow up ${when(at, today)}`, due: at };
    }
    case "meeting": {
      const meeting = introMeeting(ws, intro, today);
      const on = meeting ? meeting.on : intro.meetingOn;
      if (on && on < today) return { owner: "you", action: "close_loop", line: `Tell ${connector} how it went with ${target}`, ...due(addDays(on, 1), today) };
      return { owner: null, line: on ? `Meeting with ${target} ${when(on, today)}` : `Meeting with ${target} booked` };
    }
    case "done":
      if (!intro.thankedOn) return { owner: "you", action: "close_loop", line: `Tell ${connector} how it went`, ...due(intro.closedOn ?? today, today) };
      return { owner: null, line: `${connector} heard how it went` };
    case "declined":
      if (!intro.thankedOn && intro.declinedBy !== undefined) return { owner: "you", action: "thank", line: `Thank ${connector} for checking`, ...due(intro.closedOn ?? today, today) };
      return { owner: null, line: intro.declinedBy === "connector" ? `${connector} passed` : `${target} passed` };
    case "no_answer":
      return { owner: null, line: "Closed without an answer" };
  }
}

function nextGive(intro: Intro, today: string): IntroNext {
  const [a, b] = intro.sides ?? [];
  if (!a || !b) return { owner: null, line: "Incomplete" };
  const names = `${first(a.name)} and ${first(b.name)}`;
  switch (intro.stage) {
    case "asked": {
      if (a.consent === "no" || b.consent === "no") return { owner: null, line: `${first((a.consent === "no" ? a : b).name)} passed` };
      if (a.consent === "yes" && b.consent === "yes") return { owner: "you", action: "send_intro", line: `Both said yes. Introduce ${names}`, ...due(today, today) };
      const sides = [a, b];
      const pending = ([0, 1] as const).filter((i) => sides[i].consent === "pending");
      for (const i of pending) {
        if (!sides[i].askedOn) return { owner: "you", action: "nudge", side: i, line: `Ask ${first(sides[i].name)} if they'd like the intro`, ...due(today, today) };
      }
      const quiet = pending.find((i) => !sides[i].nudgedOn && addDays(sides[i].askedOn!, TIMING.nudgeAfter) <= today);
      if (quiet !== undefined) return { owner: "you", action: "nudge", side: quiet, line: `No answer from ${first(sides[quiet].name)}. One short nudge`, ...due(addDays(sides[quiet].askedOn!, TIMING.nudgeAfter), today) };
      const gone = pending.find((i) => sides[i].nudgedOn && addDays(sides[i].nudgedOn!, TIMING.letGoAfterNudge) <= today);
      if (gone !== undefined) return { owner: "you", action: "let_go", side: gone, line: `${first(sides[gone].name)} didn't answer. Let it go kindly`, ...due(addDays(sides[gone].nudgedOn!, TIMING.letGoAfterNudge), today) };
      const next = pending.map((i) => (sides[i].nudgedOn ? addDays(sides[i].nudgedOn!, TIMING.letGoAfterNudge) : addDays(sides[i].askedOn!, TIMING.nudgeAfter))).sort()[0];
      return { owner: "sides", line: `Waiting on ${pending.map((i) => first(sides[i].name)).join(" and ")} to say yes`, due: next };
    }
    case "introduced": {
      if (intro.thankedOn) return { owner: null, line: `Introduced ${names}` };
      const at = addDays(intro.introducedOn ?? today, TIMING.checkHowAfter);
      if (at <= today) return { owner: "you", action: "check_how", line: `Ask ${names} how it went`, ...due(at, today) };
      return { owner: null, line: `Introduced ${names} · check in ${when(at, today)}`, due: at };
    }
    default:
      return { owner: null, line: STAGE_LABEL[intro.stage] };
  }
}

/* ───────────── Connectors: the give/get ledger ───────────── */

export interface Ledger {
  asks: number;
  open: number;
  /** Intros made, including ones from before Inroad tracked them. */
  introduced: number;
  passed: number;
  quiet: number;
  asks90: number;
  gives90: number;
  lastAskedOn?: string;
  restUntil?: string;
  status: "ready" | "in_flight" | "resting" | "give_first";
  /** "2 intros from 3 asks · asked Oct 14" */
  line: string;
  /** Why not to ask right now, when there's a reason. */
  advice?: string;
}

export function ledger(ws: Workspace, c: Connector, today: string): Ledger {
  const intros = Object.values(ws.intros ?? {}).filter((i) => i.kind === "ask" && i.connectorId === c.id);
  const asks = intros.length;
  const open = intros.filter(isOpenIntro).length;
  const tracked = intros.filter((i) => i.introducedOn).length;
  const introduced = Math.max(c.introsMade, tracked);
  const passed = intros.filter((i) => i.stage === "declined").length;
  const quiet = intros.filter((i) => i.stage === "no_answer").length;
  const since = addDays(today, -90);
  const asks90 = intros.filter((i) => i.askedOn >= since).length;
  const gives90 = (c.gives ?? []).filter((g) => g.at >= since).length;
  const lastAskedOn = [c.lastAskedOn, ...intros.map((i) => i.askedOn)].filter(Boolean).sort().at(-1);
  const restUntil = lastAskedOn ? addDays(lastAskedOn, TIMING.connectorRest) : undefined;
  const name = first(c.name);

  let status: Ledger["status"] = "ready";
  let advice: string | undefined;
  const live = intros.find(isOpenIntro);
  if (open > 0) {
    status = "in_flight";
    advice = `${name} already has your ask about ${live?.targetName ?? "someone"}. One open ask at a time.`;
  } else if (restUntil && restUntil > today) {
    status = "resting";
    advice = `You asked ${name} ${daysBetween(lastAskedOn!, today) === 0 ? "today" : `${daysBetween(lastAskedOn!, today)}d ago`}. Next ask after ${shortDate(restUntil)}.`;
  } else if (asks90 >= TIMING.giveFirstAfter && gives90 === 0 && c.relationship !== "investor") {
    status = "give_first";
    advice = `You've asked ${name} ${asks90} times in 90 days and given nothing back. Help first: an intro, a customer lead, a thank-you with results.`;
  }

  const parts = [
    asks || introduced ? `${introduced} intro${introduced === 1 ? "" : "s"} from ${Math.max(asks, introduced)} ask${Math.max(asks, introduced) === 1 ? "" : "s"}` : "No asks yet",
    gives90 ? `${gives90} give${gives90 === 1 ? "" : "s"} in 90d` : null,
    lastAskedOn ? `asked ${shortDate(lastAskedOn)}` : null,
  ].filter(Boolean);
  return { asks, open, introduced, passed, quiet, asks90, gives90, lastAskedOn, restUntil: restUntil && restUntil > today ? restUntil : undefined, status, line: parts.join(" · "), advice };
}

/* ───────────── Ways in: every path into a company, ranked, with why and concerns ───────────── */

export type WayInKind = "direct" | "inside" | "alumni" | "connector" | "customer" | "investor";

export interface WayIn {
  /** Stable across renders: `${kind}:${who}`. */
  id: string;
  kind: WayInKind;
  via: { name: string; title?: string; company?: string; connectorId?: ID; linkedinUrl?: string; personId?: ID; connectionId?: ID; tags?: RelationshipTag[] };
  /** Who the intro would be to. */
  target?: { personId?: ID; name: string };
  why: string;
  /** What to watch for. A blocking concern makes the path not `ready`. */
  concerns: string[];
  ready: boolean;
  score: number;
}

const RANK: Record<WayInKind, number> = { direct: 100, inside: 80, connector: 72, alumni: 58, customer: 38, investor: 32 };
/** Someone who knows the product ranks above any other path of their kind (SPEC W2 warm-path order). */
const KNOWS_BONUS = 15;
const knowsLine = (name: string, tags: RelationshipTag[] | undefined) => {
  const phrase = tagPhrase(tags);
  return phrase ? `${first(name)} ${phrase}. ` : "";
};

/** Words too generic to say a connector reaches a company ("usage-priced SaaS founders" matches everyone otherwise). */
const STOP = new Set(
  "priced pricing billed billing per month monthly year annual usage platform platforms software company companies startup startups founder founders saas team teams people leaders heads head lead leads folks network portfolio across world space business businesses based tech technology".split(" "),
);

function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9.]+/)
    .map((w) => w.replace(/^\.+|\.+$/g, ""))
    .filter((w) => w.length >= 4 && !STOP.has(w) && !STOP.has(w.replace(/s$/, "")));
}

/** A connector's reach entry matched against the company: exact (domain or name) or by topic (industry words). */
export function reachMatch(entry: string, acc: Pick<Account, "domain" | "name" | "oneLiner" | "tags">): "exact" | "topic" | null {
  const e = entry.trim().toLowerCase();
  if (!e) return null;
  const domain = acc.domain.toLowerCase();
  const name = normalizeCompany(acc.name);
  const root = domain.split(".")[0];
  if (e === domain || e.endsWith(`@${domain}`) || e.replace(/^https?:\/\/(www\.)?/, "").startsWith(domain)) return "exact";
  if (name && name.length >= 3 && normalizeCompany(e) === name) return "exact";
  if (root.length >= 4 && new RegExp(`\\b${root.replace(/[^a-z0-9]/g, "")}\\b`).test(e)) return "exact";
  const topic = new Set(words([acc.oneLiner ?? "", ...(acc.tags ?? [])].join(" ")));
  const hit = words(e).find((w) => topic.has(w) || topic.has(w.replace(/s$/, "")));
  return hit ? "topic" : null;
}

function declinedRecently(ws: Workspace, domain: string, connectorId: ID | undefined, name: string, today: string): Intro | undefined {
  const since = addDays(today, -TIMING.declinedCooldown);
  return Object.values(ws.intros ?? {}).find(
    (i) =>
      i.kind === "ask" &&
      i.accountDomain === domain &&
      (i.stage === "declined" || i.stage === "no_answer") &&
      (i.closedOn ?? i.askedOn) >= since &&
      ((connectorId && i.connectorId === connectorId) || (i.connectorName ?? "").toLowerCase() === name.toLowerCase()),
  );
}

function concernsFor(ws: Workspace, c: Connector | undefined, domain: string, name: string, today: string): { concerns: string[]; blocked: boolean } {
  const concerns: string[] = [];
  let blocked = false;
  const passed = declinedRecently(ws, domain, c?.id, name, today);
  if (passed) {
    concerns.push(`${first(name)} ${passed.stage === "declined" ? "passed on this" : "didn't answer about this"} on ${shortDate(passed.closedOn ?? passed.askedOn)}.`);
    blocked = true;
  }
  if (c) {
    const l = ledger(ws, c, today);
    if (l.advice) concerns.push(l.advice);
    if (l.status === "in_flight" || l.status === "resting") blocked = true;
  }
  return { concerns, blocked };
}

/**
 * Every way into `domain` the founder has, best first. `connections` are the founder's LinkedIn
 * connections (server-side file); pass [] in the browser and only connector-based paths appear.
 */
export function waysIn(ws: Workspace, domain: string, connections: Connection[], today: string): WayIn[] {
  const acc = ws.accounts[domain];
  if (!acc) return [];
  // An intro aims at someone the founder doesn't already know: knowing the best person directly means
  // the intro paths are for the next seat (another buyer there), or for the role when no one else is named.
  const best = bestPerson(ws, acc);
  const others = acc.peopleIds.map((id) => ws.people[id]).filter((p): p is Person => !!p && !p.doNotContact && !p.mayHaveLeft && !knowsDirectly(p));
  const target = best && !knowsDirectly(best) ? best : (others.find((p) => p.role === "economic_buyer") ?? others.find((p) => p.role === "champion") ?? others[0]);
  const targetName = target ? target.name : `the ${acc.suggestedTitle ?? "right person"} at ${acc.name}`;
  const tgt = target ? { personId: target.id, name: target.name } : { name: targetName };
  const out: WayIn[] = [];
  const byUrl = new Map(ws.connectors.filter((c) => c.linkedinUrl).map((c) => [linkedinKey(c.linkedinUrl), c]));
  const seen = new Set<string>();
  const push = (w: WayIn) => {
    const key = w.via.linkedinUrl ? linkedinKey(w.via.linkedinUrl) : w.via.name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(w);
  };

  // Direct: someone there the founder knows first-hand. No intro needed.
  const people = acc.peopleIds.map((id) => ws.people[id]).filter((p): p is Person => !!p && !p.doNotContact && !p.mayHaveLeft);
  for (const p of people.filter(knowsDirectly)) {
    push({
      id: `direct:${p.id}`,
      kind: "direct",
      via: { name: p.name, title: p.title, personId: p.id, linkedinUrl: p.linkedinUrl, ...(p.tags?.length ? { tags: p.tags } : {}) },
      why: `${knowsLine(p.name, p.tags)}You're connected to ${first(p.name)}. Write to them yourself: an intro would only slow it down.`,
      concerns: [],
      ready: true,
      score: RANK.direct + seniority(normalizeTitle(p.title)) + (knowsByTag(p.tags) ? KNOWS_BONUS : 0),
    });
  }
  const targetUrl = target?.linkedinUrl ? linkedinKey(target.linkedinUrl) : "";

  // Inside: a connection who works there now (a colleague forwards more readily than an outsider).
  const accName = normalizeCompany(acc.name);
  for (const c of connections.filter((x) => x.matchedDomain === domain || (accName && x.companyNorm === accName))) {
    const name = `${c.firstName} ${c.lastName}`.trim();
    if (targetUrl && linkedinKey(c.url) === targetUrl) continue;
    if (people.some((p) => knowsDirectly(p) && p.name.toLowerCase() === name.toLowerCase())) continue;
    const listed = byUrl.get(linkedinKey(c.url));
    const { concerns, blocked } = concernsFor(ws, listed, domain, name, today);
    push({
      id: `inside:${c.id}`,
      kind: "inside",
      via: { name, title: c.position, company: c.company, connectorId: listed?.id, linkedinUrl: c.url, connectionId: c.id, ...(c.tags?.length ? { tags: c.tags } : {}) },
      target: tgt,
      why: `${knowsLine(name, c.tags)}${first(name)} works at ${acc.name}${c.position ? ` as ${c.position}` : ""}. A colleague's forward reads as a referral, not a pitch.`,
      concerns,
      ready: !blocked,
      score: RANK.inside + seniority(normalizeTitle(c.position)) + (knowsByTag(c.tags) ? KNOWS_BONUS : 0),
    });
  }

  // Connectors the founder listed: working there, or naming the company (or its world) in who they can reach.
  for (const c of ws.connectors) {
    const worksThere = c.company && reachMatch(c.company, acc) === "exact";
    const match = worksThere ? "exact" : (c.reach ?? []).map((r) => ({ r, m: reachMatch(r, acc) })).find((x) => x.m === "exact") ?? (c.reach ?? []).map((r) => ({ r, m: reachMatch(r, acc) })).find((x) => x.m === "topic");
    if (!match) continue;
    const exact = worksThere || (typeof match === "object" && match.m === "exact");
    const entry = typeof match === "object" ? match.r : c.company!;
    const { concerns, blocked } = concernsFor(ws, c, domain, c.name, today);
    push({
      id: `connector:${c.id}`,
      kind: worksThere ? "inside" : "connector",
      via: { name: c.name, connectorId: c.id, linkedinUrl: c.linkedinUrl, company: c.company },
      target: tgt,
      why: worksThere
        ? `${first(c.name)} works at ${acc.name}.`
        : exact
          ? `${first(c.name)} can reach people at ${acc.name}: “${entry}” is on their list.`
          : `${first(c.name)} knows the “${entry}” world, and ${acc.name} is in it.`,
      concerns,
      ready: !blocked,
      score: (worksThere ? RANK.inside : RANK.connector) - (exact ? 0 : 20) + (c.relationship === "advisor" || c.relationship === "investor" ? 3 : 0),
    });
  }

  // Alumni: a connection who used to work there and may still know the team.
  for (const c of connections) {
    const past = (c.history ?? []).find((h) => accName && normalizeCompany(h.company) === accName);
    if (!past || c.companyNorm === accName) continue;
    const name = `${c.firstName} ${c.lastName}`.trim();
    const listed = byUrl.get(linkedinKey(c.url));
    const { concerns, blocked } = concernsFor(ws, listed, domain, name, today);
    push({
      id: `alumni:${c.id}`,
      kind: "alumni",
      via: { name, title: c.position, company: c.company, connectorId: listed?.id, linkedinUrl: c.url, connectionId: c.id, ...(c.tags?.length ? { tags: c.tags } : {}) },
      target: tgt,
      why: `${knowsLine(name, c.tags)}${first(name)} worked at ${acc.name} (seen ${past.seenOn.slice(0, 4)}) and now works at ${c.company}. Alumni usually still know who owns what.`,
      concerns: [...concerns, "Check they still talk to the team before asking."],
      ready: !blocked,
      score: RANK.alumni + Math.min(10, seniority(normalizeTitle(past.position))) + (knowsByTag(c.tags) ? KNOWS_BONUS : 0),
    });
  }

  // A customer in the same role: peers in a function know each other. One, the best rested.
  const customer = ws.connectors
    .filter((c) => c.relationship === "customer" && !out.some((w) => w.via.connectorId === c.id))
    .map((c) => ({ c, l: ledger(ws, c, today) }))
    .sort((a, b) => Number(a.l.status !== "ready") - Number(b.l.status !== "ready") || (a.l.lastAskedOn ?? "").localeCompare(b.l.lastAskedOn ?? ""))[0];
  if (customer) {
    const { concerns, blocked } = concernsFor(ws, customer.c, domain, customer.c.name, today);
    push({
      id: `customer:${customer.c.id}`,
      kind: "customer",
      via: { name: customer.c.name, connectorId: customer.c.id, linkedinUrl: customer.c.linkedinUrl, company: customer.c.company },
      target: tgt,
      why: `${first(customer.c.name)} is a customer. People in the same role know each other; ask who they know at ${acc.name}. A customer's word also carries proof.`,
      concerns: [...concerns, "A guess, not a known tie: ask who they know rather than for a specific intro."],
      ready: !blocked,
      score: RANK.customer,
    });
  }

  // An investor: a generic but often productive ask. One, the best rested.
  const investor = ws.connectors
    .filter((c) => (c.relationship === "investor" || c.relationship === "angel") && !out.some((w) => w.via.connectorId === c.id))
    .map((c) => ({ c, l: ledger(ws, c, today) }))
    .sort((a, b) => Number(a.l.status !== "ready") - Number(b.l.status !== "ready") || (a.l.lastAskedOn ?? "").localeCompare(b.l.lastAskedOn ?? ""))[0];
  if (investor) {
    const { concerns, blocked } = concernsFor(ws, investor.c, domain, investor.c.name, today);
    push({
      id: `investor:${investor.c.id}`,
      kind: "investor",
      via: { name: investor.c.name, connectorId: investor.c.id, linkedinUrl: investor.c.linkedinUrl },
      target: tgt,
      why: `${first(investor.c.name)} ${investor.c.relationship === "angel" ? "is an angel in your round" : "is your investor"}. Investors can check their portfolio and co-investors for someone at ${acc.name}.`,
      concerns: [...concerns, "A guess, not a known tie: ask them to check rather than to introduce."],
      ready: !blocked,
      score: RANK.investor,
    });
  }

  return out.sort((a, b) => Number(b.ready) - Number(a.ready) || b.score - a.score).slice(0, 6);
}

/** The open intro for a company, if one is in flight (one ask per company at a time). */
export function openIntroFor(ws: Workspace, domain: string): Intro | undefined {
  return Object.values(ws.intros ?? {})
    .filter((i) => i.kind === "ask" && i.accountDomain === domain && isOpenIntro(i))
    .sort((a, b) => b.askedOn.localeCompare(a.askedOn))[0];
}

/** Intros that need the founder now, most urgent first. */
export function yourMoves(ws: Workspace, today: string): { intro: Intro; next: IntroNext }[] {
  const urgency: Partial<Record<IntroAction, number>> = { reply: 0, send_intro: 1, close_loop: 2, check_in: 3, nudge: 4, book: 5, check_how: 6, thank: 7, let_go: 8 };
  return Object.values(ws.intros ?? {})
    .map((intro) => ({ intro, next: nextStep(intro, ws, today) }))
    .filter((x) => x.next.owner === "you" && x.next.action)
    .sort((a, b) => (urgency[a.next.action!] ?? 9) - (urgency[b.next.action!] ?? 9) || (b.next.overdueDays ?? 0) - (a.next.overdueDays ?? 0));
}
