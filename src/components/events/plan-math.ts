/**
 * Events: the deterministic half of planning a room. Pure functions, shared by the dinner_plan
 * workflow (server) and the Events UI (browser). Code scores guests, computes invite math,
 * dates and seating; Claude only writes the words.
 *
 * Sources for the numbers: docs/research/02 §2 (SignalFire, BCV, Samaaro, Ortus, getboothiq).
 */
import { addDays, daysBetween, todayISO } from "@/lib/domain/ids";
import type { Account, Deal, DinnerPlan, GtmEvent, Guest, GuestCandidate, ISODate, Meeting, Person, Stage, Workspace } from "@/lib/domain/types";

export type EventKind = GtmEvent["kind"];
export type EventGoal = DinnerPlan["goal"];
export type TimelineTask = DinnerPlan["timeline"][number];

export const KIND_LABEL: Record<EventKind, string> = { roundtable: "Virtual roundtable", dinner: "Dinner" };

export const GOALS: { value: EventGoal; label: string; hint: string }[] = [
  { value: "create_pipeline", label: "Create pipeline", hint: "Meet target accounts you aren't talking to yet" },
  { value: "accelerate_deals", label: "Move open deals", hint: "Seat open deals beside peers who solved it" },
  { value: "expand_customers", label: "Expand customers", hint: "Let customers meet each other and go deeper" },
  { value: "market_intel", label: "Learn the market", hint: "Test a pain with 6–8 buyers before you build" },
];
export const GOAL_LABEL = Object.fromEntries(GOALS.map((g) => [g.value, g.label])) as Record<EventGoal, string>;

export const STATUS_LABEL: Record<GtmEvent["status"], string> = {
  planning: "Planning",
  inviting: "Inviting",
  confirmed: "Confirmed",
  done: "Done",
  cancelled: "Cancelled",
};

export const GUEST_STATUSES: Guest["status"][] = ["candidate", "invited", "accepted", "confirmed", "declined", "waitlist", "attended", "no_show"];
export const GUEST_STATUS_LABEL: Record<Guest["status"], string> = {
  candidate: "To invite",
  invited: "Invited",
  accepted: "Accepted",
  confirmed: "Confirmed",
  declined: "Declined",
  waitlist: "Waitlist",
  attended: "Attended",
  no_show: "No-show",
};

export function roleLabel(role: GuestCandidate["role"], kind: EventKind): string {
  switch (role) {
    case "anchor":
      return kind === "roundtable" ? "Framer" : "Anchor";
    case "customer_host":
      return "Customer host";
    case "connector":
      return "Connector";
    default:
      return "Prospect";
  }
}

const EVER_INVITED = new Set<Guest["status"]>(["invited", "accepted", "declined", "confirmed", "attended", "no_show"]);
const SAID_YES = new Set<Guest["status"]>(["accepted", "confirmed", "attended", "no_show"]);
const CONFIRMED = new Set<Guest["status"]>(["confirmed", "attended", "no_show"]);
export const IN_ROOM = new Set<Guest["status"]>(["accepted", "confirmed", "attended"]);

/* ─────────────────────────────── Dates ─────────────────────────────── */

/** Lead time a room needs: dinners fill in ~6 weeks, roundtables compress to 3 (SPEC W11). */
export const LEAD_DAYS: Record<EventKind, number> = { dinner: 42, roundtable: 21 };
export const START_TIME: Record<EventKind, string> = { dinner: "18:30", roundtable: "12:00" };

function parts(d: ISODate) {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, m - 1, day);
}

function weekday(d: ISODate): number {
  return parts(d).getDay();
}

/** Weeks executives don't come out: late December, early January, Thanksgiving week, July 4th week. */
function isDeadWeek(d: ISODate): boolean {
  const md = d.slice(5);
  if (md >= "12-19" || md <= "01-05") return true;
  if (md >= "07-01" && md <= "07-07") return true;
  if (d.slice(5, 7) === "11") {
    const year = Number(d.slice(0, 4));
    const first = new Date(year, 10, 1).getDay();
    const thanksgiving = 1 + ((4 - first + 7) % 7) + 21;
    const day = Number(d.slice(8, 10));
    if (day >= thanksgiving - 3 && day <= thanksgiving + 1) return true;
  }
  return false;
}

/** Tuesday to Thursday, outside dead weeks. */
function goodDay(d: ISODate): boolean {
  const wd = weekday(d);
  return wd >= 2 && wd <= 4 && !isDeadWeek(d);
}

/**
 * Picks the event date. In the requested month when it leaves enough lead time, otherwise the
 * earliest workable Tue–Thu (and says so).
 */
export function proposeDate(kind: EventKind, month: string | undefined, today = todayISO()): { date: ISODate; moved: boolean } {
  const earliest = addDays(today, LEAD_DAYS[kind]);
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    let d = `${month}-06` < earliest ? earliest : `${month}-06`;
    while (d.slice(0, 7) === month) {
      if (goodDay(d)) return { date: d, moved: false };
      d = addDays(d, 1);
    }
  }
  let d = earliest;
  for (let i = 0; i < 90; i++) {
    if (goodDay(d)) return { date: d, moved: Boolean(month) };
    d = addDays(d, 1);
  }
  return { date: earliest, moved: Boolean(month) };
}

export function eventDay(ev: Pick<GtmEvent, "date" | "plan">): ISODate | undefined {
  return ev.date?.slice(0, 10) ?? ev.plan?.targetDate;
}

export function eventDateTime(kind: EventKind, date: ISODate, time = START_TIME[kind]): string {
  return `${date}T${time}:00`;
}

export function formatEventDate(ev: Pick<GtmEvent, "date" | "plan">, opts: { time?: boolean; weekday?: boolean } = {}): string {
  const day = eventDay(ev);
  if (!day) return "Date to be set";
  const d = parts(day);
  const date = d.toLocaleDateString("en-US", { weekday: opts.weekday === false ? undefined : "short", month: "short", day: "numeric" });
  if (!opts.time || !ev.date || ev.date.length < 16) return date;
  const [h, m] = ev.date.slice(11, 16).split(":").map(Number);
  const time = `${((h + 11) % 12) + 1}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h >= 12 ? "pm" : "am"}`;
  return `${date} · ${time}`;
}

export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long" });
}

/** The next n months as `YYYY-MM`, starting with the first month that leaves enough lead time. */
export function upcomingMonths(kind: EventKind, n = 4, today = todayISO()): string[] {
  const earliest = proposeDate(kind, undefined, today).date;
  const out: string[] = [];
  let [y, m] = earliest.slice(0, 7).split("-").map(Number);
  for (let i = 0; i < n; i++) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/* ─────────────────────────────── Timeline (dated tasks; feed Today) ─────────────────────────────── */

interface Step {
  days: number;
  offset: string;
  task: string;
  owner: TimelineTask["owner"];
  needsCoHost?: boolean;
}

const DINNER_STEPS: Step[] = [
  { days: -42, offset: "T-6w", task: "Lock the question, the goal and the co-host", owner: "founder" },
  { days: -40, offset: "T-6w", task: "Approve the must-attend list: would you be happy if only this person showed up?", owner: "founder" },
  { days: -38, offset: "T-5w", task: "Confirm the anchor and the customer host", owner: "founder" },
  { days: -35, offset: "T-5w", task: "Book a private room; visit at peak hours to test the noise", owner: "founder" },
  { days: -28, offset: "T-4w", task: "Send personal invites to the must-attend list", owner: "founder" },
  { days: -28, offset: "T-4w", task: "Co-host sends personal invites to their list", owner: "cohost", needsCoHost: true },
  { days: -21, offset: "T-3w", task: "Send the second wave until you reach the confirms target", owner: "founder" },
  { days: -14, offset: "T-2w", task: "One follow-up to anyone who hasn't answered; on a decline, ask for a colleague", owner: "founder" },
  { days: -7, offset: "T-1w", task: "Confirm dietary needs, send logistics, over-confirm the waitlist", owner: "founder" },
  { days: -2, offset: "T-48h", task: "Review the briefing book: deal stage, challenge, desired outcome, planned intros", owner: "ember" },
  { days: -2, offset: "T-48h", task: "Personal reminder to each guest that names what they want from the night", owner: "founder" },
  { days: 0, offset: "Day of", task: "Short text by 2pm: the room, the time, your number", owner: "founder" },
  { days: 0, offset: "Day of", task: "Record a 30-second voice note per guest before you leave", owner: "founder" },
  { days: 1, offset: "T+1d", task: "Next-morning note to each guest with one concrete next step", owner: "founder" },
  { days: 2, offset: "T+2d", task: "Group email: 3–5 themes, promised intros, no attribution", owner: "founder" },
  { days: 30, offset: "T+30d", task: "Count meetings from attendees (target: 35% or more)", owner: "founder" },
  { days: 90, offset: "T+90d", task: "Each attendee: a deal in motion, or nurture", owner: "founder" },
];

const ROUNDTABLE_STEPS: Step[] = [
  { days: -21, offset: "T-3w", task: "Lock the question and confirm the framer", owner: "founder" },
  { days: -20, offset: "T-3w", task: "Approve the invite list: would you be happy if only this person showed up?", owner: "founder" },
  { days: -18, offset: "T-18d", task: "Send personal invites, warm paths first", owner: "founder" },
  { days: -18, offset: "T-18d", task: "Co-host shares the invite with their list", owner: "cohost", needsCoHost: true },
  { days: -11, offset: "T-11d", task: "One follow-up to anyone who hasn't answered; on a decline, ask for a colleague", owner: "founder" },
  { days: -7, offset: "T-1w", task: "Send the calendar invite with one question: what do you want from the hour?", owner: "founder" },
  { days: -2, offset: "T-48h", task: "Review the briefing book: challenge, desired outcome, planned intros", owner: "ember" },
  { days: -2, offset: "T-48h", task: "Personal reminder to each guest that names what they want from the hour", owner: "founder" },
  { days: 0, offset: "Day of", task: "Morning note with the link; start on time under the Chatham House rule", owner: "founder" },
  { days: 0, offset: "Day of", task: "Record a 30-second voice note per guest right after the call", owner: "founder" },
  { days: 1, offset: "T+1d", task: "Next-morning note to each guest with one concrete next step", owner: "founder" },
  { days: 2, offset: "T+2d", task: "Group email: 3–5 themes, promised intros, no attribution", owner: "founder" },
  { days: 30, offset: "T+30d", task: "Count meetings from attendees (target: 35% or more)", owner: "founder" },
  { days: 90, offset: "T+90d", task: "Each attendee: a deal in motion, or nurture", owner: "founder" },
];

/**
 * Dated tasks from the event date. Pre-event tasks that would already be past are due today
 * (the timeline is compressed, not skipped). `done` flags carry over by task text.
 */
export function computeTimeline(kind: EventKind, date: ISODate, opts: { coHost: boolean; today?: ISODate; prev?: TimelineTask[] }): TimelineTask[] {
  const today = opts.today ?? todayISO();
  const done = new Set((opts.prev ?? []).filter((t) => t.done).map((t) => t.task));
  return (kind === "dinner" ? DINNER_STEPS : ROUNDTABLE_STEPS)
    .filter((s) => opts.coHost || !s.needsCoHost)
    .map((s) => {
      const raw = addDays(date, s.days);
      const due = s.days < 0 && raw < today ? today : raw;
      return { due, offset: s.offset, task: s.task, owner: s.owner, ...(done.has(s.task) ? { done: true } : {}) };
    });
}

/* ─────────────────────────────── Places ─────────────────────────────── */

const METROS: [string, string[]][] = [
  ["New York", ["new york", "nyc", "manhattan", "brooklyn", "queens", "jersey city", "hoboken"]],
  ["San Francisco Bay Area", ["san francisco", "sf", "bay area", "oakland", "berkeley", "palo alto", "mountain view", "menlo park", "san mateo", "redwood city", "san jose", "sunnyvale", "cupertino", "santa clara", "burlingame"]],
  ["Los Angeles", ["los angeles", "la", "santa monica", "venice, ca", "culver city", "pasadena", "playa vista"]],
  ["Boston", ["boston", "cambridge, ma", "cambridge, massachusetts", "somerville"]],
  ["Seattle", ["seattle", "bellevue", "redmond", "kirkland"]],
  ["Washington DC", ["washington, dc", "washington dc", "washington, d.c.", "dc", "arlington, va", "bethesda"]],
  ["Chicago", ["chicago"]],
  ["Austin", ["austin"]],
  ["Denver", ["denver", "boulder"]],
  ["Miami", ["miami"]],
  ["Atlanta", ["atlanta"]],
  ["Toronto", ["toronto"]],
  ["London", ["london"]],
  ["Paris", ["paris"]],
  ["Berlin", ["berlin"]],
  ["Amsterdam", ["amsterdam"]],
  ["Tel Aviv", ["tel aviv"]],
  ["Singapore", ["singapore"]],
  ["Sydney", ["sydney"]],
  ["Bangalore", ["bangalore", "bengaluru"]],
];

/** "NYC", "Brooklyn, NY" and "New York, United States" are the same room. */
export function metroOf(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const s = raw.toLowerCase().trim();
  if (!s || /^(remote|virtual|anywhere)$/.test(s)) return null;
  for (const [metro, aliases] of METROS) {
    for (const a of aliases) {
      const hit = a.length <= 3 ? new RegExp(`(^|[^a-z])${a}([^a-z]|$)`).test(s) : s.includes(a);
      if (hit) return metro;
    }
  }
  const first = s.split(",")[0].trim();
  return first ? first.replace(/\b\w/g, (c) => c.toUpperCase()) : null;
}

/** Cities where the founder's target accounts cluster, for the planner's suggestions. */
export function cityClusters(ws: Workspace, limit = 4): { city: string; accounts: number }[] {
  const counts = new Map<string, Set<string>>();
  for (const acc of Object.values(ws.accounts)) {
    if (acc.status === "disqualified") continue;
    const metros = new Set<string>();
    const hq = metroOf(acc.hqCity);
    if (hq) metros.add(hq);
    for (const id of acc.peopleIds) {
      const m = metroOf(ws.people[id]?.location);
      if (m) metros.add(m);
    }
    for (const m of metros) counts.set(m, (counts.get(m) ?? new Set()).add(acc.domain));
  }
  return [...counts.entries()]
    .map(([city, set]) => ({ city, accounts: set.size }))
    .sort((a, b) => b.accounts - a.accounts)
    .slice(0, limit);
}

/* ─────────────────────────────── Guest scoring ─────────────────────────────── */

/** 5 = C-level/founder · 4 = VP · 3.5 = Head of · 3 = Director · 2 = Manager/Lead · 1.5 = IC. */
export function seniorityLevel(title: string | undefined): number {
  const t = (title ?? "").toLowerCase();
  if (!t) return 2.5;
  if (/\b(svp|evp|vp|vice[- ]president)\b/.test(t)) return 4;
  if (/\b(ceo|cto|cfo|coo|cio|ciso|cpo|cro|cmo|chief|founder|co-?founder|president|owner|managing partner)\b/.test(t)) return 5;
  if (/\bhead\b/.test(t)) return 3.5;
  if (/\bdirector\b/.test(t)) return 3;
  if (/\b(manager|lead|principal|staff)\b/.test(t)) return 2;
  return 1.5;
}

/** The seniority the room is for: the playbook's buyer and champion personas, else Head-of level. */
export function targetSeniority(ws: Workspace): number {
  const titles = (ws.foundation?.personas ?? []).filter((p) => p.role === "economic_buyer" || p.role === "champion").flatMap((p) => p.titles.slice(0, 3));
  if (!titles.length) return 3.5;
  return titles.reduce((n, t) => n + seniorityLevel(t), 0) / titles.length;
}

export type CandidateCategory = "customer" | "design_partner" | "open_deal" | "prospect";

export interface ScoredCandidate extends GuestCandidate {
  company: string;
  category: CandidateCategory;
  dealStage?: Stage;
  city?: string;
  email?: string;
  signal?: { headline: string; date: string; url: string; evidenceId?: string };
  pain?: { text: string; evidenceIds: string[] };
  /** Rough chance this person accepts: warm and open-deal guests ~45%, cold senior buyers 15–25%. */
  acceptP: number;
}

export interface ScoreOptions {
  kind: EventKind;
  city?: string;
  goal: EventGoal;
  /** Domains where the founder has a first-degree LinkedIn connection, with the names. */
  connected?: Map<string, string[]>;
  today?: ISODate;
}

const GOAL_MULT: Record<EventGoal, Record<CandidateCategory, number>> = {
  accelerate_deals: { open_deal: 1.6, design_partner: 1.3, prospect: 1, customer: 1 },
  create_pipeline: { open_deal: 1, design_partner: 1, prospect: 1.15, customer: 0.9 },
  expand_customers: { open_deal: 1, design_partner: 1.3, prospect: 0.9, customer: 1.6 },
  market_intel: { open_deal: 1, design_partner: 1, prospect: 1, customer: 1 },
};

const ROLE_RANK: Record<string, number> = { economic_buyer: 2.5, champion: 2.2, technical_approver: 1.2, user: 0.6, blocker: -2 };

const norm = (s: string | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

export function emailFor(p: Person | undefined): string | undefined {
  if (!p) return undefined;
  if (p.email) return p.email;
  return p.contactPaths.find((c) => !c.bounced && (c.kind === "published_email" || c.kind === "role_inbox" || c.kind === "pattern_guess"))?.value;
}

function competitorReason(ws: Workspace, acc: Account): string | null {
  if (acc.disqualified?.reason === "competitor") return "Marked as a competitor";
  if (ws.suppression.some((s) => s.reason === "competitor" && s.domain === acc.domain)) return "On your suppression list as a competitor";
  for (const c of ws.foundation?.competitors ?? []) {
    if ((c.domain && c.domain.replace(/^www\./, "") === acc.domain) || (norm(c.name) && norm(c.name) === norm(acc.name))) return `Competes with you (${c.name})`;
  }
  return null;
}

function bestPerson(ws: Workspace, acc: Account, deal: Deal | undefined, target: number): Person | undefined {
  const dealContacts = new Set(deal?.contacts.map((c) => c.personId) ?? []);
  const suppressed = new Set(ws.suppression.map((s) => s.email?.toLowerCase()).filter(Boolean));
  const people = acc.peopleIds
    .map((id) => ws.people[id])
    .filter((p): p is Person => Boolean(p) && !p.doNotContact && !p.mayHaveLeft && !(p.email && suppressed.has(p.email.toLowerCase())));
  const rank = (p: Person) =>
    (dealContacts.has(p.id) ? 3 : 0) +
    (ROLE_RANK[p.role ?? ""] ?? 0.8) +
    (p.champion === "tested" ? 0.6 : 0) +
    2 * Math.max(0.4, 1 - 0.18 * Math.abs(seniorityLevel(p.title) - target)) +
    (emailFor(p) ? 0.3 : 0);
  return people.sort((a, b) => rank(b) - rank(a))[0];
}

function bestSignal(acc: Account, today: ISODate) {
  return acc.signals
    .filter((s) => s.type !== "sensitive" && daysBetween(s.date, today) <= 180)
    .sort((a, b) => b.strength - a.strength || Number(b.usableInOutreach) - Number(a.usableInOutreach) || b.date.localeCompare(a.date))[0];
}

/**
 * score = fit × seniorityMatch × (1 + whyNow/4) × (warm ? 1.3 : 1) × (sameCity || virtual ? 1 : 0.2)
 *         × goal weight × (named person ? 1 : 0.75)   — SPEC W11 step 4, plus goal and naming.
 * Competitors never make the list; they come back in `excluded` so the plan can say so.
 */
export function scoreCandidates(ws: Workspace, opts: ScoreOptions): { candidates: ScoredCandidate[]; excluded: { domain: string; name: string; reason: string }[] } {
  const today = opts.today ?? todayISO();
  const target = targetSeniority(ws);
  const metro = opts.kind === "dinner" ? metroOf(opts.city) : null;
  const ownDomain = ws.company?.domain;
  const suppressedDomains = new Set(ws.suppression.filter((s) => s.domain).map((s) => s.domain));
  const candidates: ScoredCandidate[] = [];
  const excluded: { domain: string; name: string; reason: string }[] = [];

  for (const acc of Object.values(ws.accounts)) {
    if (acc.domain === ownDomain) continue;
    const conflict = competitorReason(ws, acc);
    if (conflict) {
      excluded.push({ domain: acc.domain, name: acc.name, reason: conflict });
      continue;
    }
    if (acc.status === "disqualified" || suppressedDomains.has(acc.domain)) continue;

    const deal = acc.dealId ? ws.deals[acc.dealId] : undefined;
    if (deal && (deal.stage === "lost" || deal.stage === "nurture") && deal.lossReason === "not_icp") continue;
    const category: CandidateCategory =
      acc.status === "customer" || deal?.stage === "won"
        ? "customer"
        : deal?.stage === "pilot"
          ? "design_partner"
          : deal && ["talking", "qualified", "proposal"].includes(deal.stage)
            ? "open_deal"
            : "prospect";

    const person = bestPerson(ws, acc, deal, target);
    const title = person?.title || acc.dossier?.committee.find((c) => c.role === "economic_buyer" || c.role === "champion")?.likelyTitles[0] || "";
    if (!title && !person) continue;

    const fit = acc.fitScore > 0 ? acc.fitScore / 100 : acc.tier === "A" ? 0.85 : acc.tier === "B" ? 0.65 : 0.4;
    const seniority = Math.max(0.4, 1 - 0.18 * Math.abs(seniorityLevel(title) - target));
    const whyNow = Math.max(0, Math.min(4, acc.whyNowScore || 0));

    const intro = person?.contactPaths.find((c) => c.kind === "warm_intro");
    const linked = opts.connected?.get(acc.domain);
    const warmPath = intro
      ? intro.via
        ? `Intro via ${intro.via}`
        : "Warm intro available"
      : category === "customer"
        ? "Customer"
        : category === "design_partner"
          ? "Design partner"
          : category === "open_deal"
            ? "Open deal"
            : linked?.length
              ? `You know ${linked[0]}${linked.length > 1 ? ` +${linked.length - 1}` : ""}`
              : acc.warmPathCount > 0
                ? `${acc.warmPathCount} warm path${acc.warmPathCount === 1 ? "" : "s"}`
                : person?.source === "founder_network"
                  ? "In your network"
                  : undefined;

    const city = person?.location || acc.hqCity || undefined;
    const cityMetros = [metroOf(acc.hqCity), metroOf(person?.location)].filter(Boolean);
    const sameCity = opts.kind === "roundtable" || (metro !== null && cityMetros.includes(metro));
    const cityFactor = sameCity ? 1 : cityMetros.length ? 0.2 : 0.4;

    const raw =
      fit * seniority * (1 + whyNow / 4) * (warmPath ? 1.3 : 1) * cityFactor * GOAL_MULT[opts.goal][category] * (person ? 1 : 0.75);

    const signal = bestSignal(acc, today);
    const painHyp = acc.dossier?.painHypotheses[0];
    const pain = deal?.card?.pain.value
      ? { text: deal.card.pain.value, evidenceIds: [] }
      : painHyp
        ? { text: painHyp.pain, evidenceIds: painHyp.evidenceIds }
        : undefined;
    const evidenceIds = [...new Set([signal?.evidenceId, ...(pain?.evidenceIds ?? [])].filter((x): x is string => Boolean(x) && Boolean(ws.evidence[x as string])))];

    candidates.push({
      personId: person?.id,
      name: person?.name,
      title: title || "Decision maker",
      accountDomain: acc.domain,
      company: acc.name,
      role: "prospect",
      score: Math.round(Math.min(99, (raw / 2.6) * 100)),
      scoreParts: { fit: Math.round(fit * 100) / 100, seniority: Math.round(seniority * 100) / 100, whyNow, warmPath: Boolean(warmPath), sameCity },
      dealId: deal?.id,
      dealStage: deal?.stage,
      personalLine: "",
      warmPath,
      evidenceIds,
      competitorConflict: null,
      category,
      city,
      email: emailFor(person),
      signal: signal ? { headline: signal.headline, date: signal.date, url: signal.url, evidenceId: signal.evidenceId } : undefined,
      pain,
      acceptP: category === "customer" || category === "design_partner" ? 0.8 : warmPath ? 0.45 : opts.kind === "roundtable" ? 0.2 : 0.18,
    });
  }

  candidates.sort((a, b) => b.score - a.score);
  return { candidates, excluded };
}

/* ─────────────────────────────── Composition & invite math ─────────────────────────────── */

export interface Room {
  anchor?: ScoredCandidate;
  customerHosts: ScoredCandidate[];
  connector?: ScoredCandidate;
  /** Prospects to invite, best first. */
  invitees: ScoredCandidate[];
  waitlist: ScoredCandidate[];
  mustAttendKeys: Set<string>;
  composition: NonNullable<DinnerPlan["composition"]>;
  inviteMath: DinnerPlan["inviteMath"];
}

export const candidateKey = (c: Pick<GuestCandidate, "personId" | "accountDomain" | "name" | "title">) =>
  c.personId ?? `${c.accountDomain}|${(c.name ?? c.title).toLowerCase()}`;

/**
 * Roundtable: 1 host, 1 framer, 5–7 peers (7 guest seats). Dinner: 2 hosts, 1–2 customers, 1 anchor,
 * 5–6 prospects, ≤1 connector (8 guest seats, 10 at the table). Confirm ~125% of seats; senior buyers
 * accept 15–25% of cold invites, warm and co-host lists far more. Roundtables: 15–25 invites; dinners 30–50.
 */
export function composeRoom(
  cands: ScoredCandidate[],
  ws: Workspace,
  opts: { kind: EventKind; hasCoHost: boolean },
): Room {
  const kind = opts.kind;
  const seats = kind === "dinner" ? 8 : 7;
  const local = (c: ScoredCandidate) => c.scoreParts?.sameCity || kind === "roundtable";
  const hosts = cands.filter((c) => (c.category === "customer" || c.category === "design_partner") && local(c));
  const used = new Set<string>();

  let anchor: ScoredCandidate | undefined;
  const customerHosts: ScoredCandidate[] = [];
  if (kind === "roundtable") {
    anchor = hosts[0];
  } else {
    const customers = hosts.filter((c) => c.category === "customer");
    if (customers[0]) customerHosts.push(customers[0]);
    const senior = hosts.find((c) => c !== customers[0] && seniorityLevel(c.title) >= 3.5);
    anchor = senior ?? hosts.find((c) => c !== customers[0]);
    if (customers[1] && customers[1] !== anchor) customerHosts.push(customers[1]);
  }
  if (anchor) {
    anchor = { ...anchor, role: "anchor", acceptP: 0.85 };
    used.add(candidateKey(anchor));
  }
  for (const [i, h] of customerHosts.entries()) {
    customerHosts[i] = { ...h, role: "customer_host", acceptP: 0.85 };
    used.add(candidateKey(h));
  }

  let connector: ScoredCandidate | undefined;
  if (kind === "dinner") {
    const c = [...ws.connectors]
      .filter((x) => x.relationship === "investor" || x.relationship === "angel" || x.relationship === "advisor")
      .sort((a, b) => b.introsMade - a.introsMade)[0];
    if (c) {
      connector = {
        name: c.name,
        title: c.relationship === "advisor" ? "Advisor" : "Investor",
        accountDomain: "",
        company: c.relationship === "advisor" ? "Your advisor" : "Your investor",
        role: "connector",
        score: 0,
        personalLine: "",
        warmPath: "Knows you",
        category: "prospect",
        acceptP: 0.8,
      };
    }
  }

  const fixed = (anchor ? 1 : 0) + customerHosts.length + (connector ? 1 : 0);
  const prospectSeats = Math.max(4, seats - fixed);
  const prospectConfirms = Math.ceil(prospectSeats * 1.25);
  const [minInv, maxInv] = kind === "dinner" ? [30, 50] : [15, 25];

  const pool = cands.filter((c) => !used.has(candidateKey(c)) && (kind === "roundtable" || c.scoreParts?.sameCity || !c.scoreParts));
  // Keep out-of-town people out of a dinner unless the pool is thin.
  const fallback = kind === "dinner" ? cands.filter((c) => !used.has(candidateKey(c)) && !pool.includes(c)) : [];

  const invitees: ScoredCandidate[] = [];
  let expected = 0;
  for (const c of [...pool, ...fallback]) {
    if (invitees.length >= maxInv) break;
    if (expected >= prospectConfirms && invitees.length >= minInv) break;
    invitees.push(c);
    expected += c.acceptP;
  }
  const rest = [...pool, ...fallback].filter((c) => !invitees.includes(c));
  const waitlist = rest.slice(0, 10);
  const mustAttendKeys = new Set(invitees.slice(0, kind === "dinner" ? 8 : 6).map(candidateKey));

  const warm = invitees.filter((c) => c.warmPath).length;
  const all = [...invitees, ...(anchor ? [anchor] : []), ...customerHosts, ...(connector ? [connector] : [])];
  const totalP = all.reduce((n, c) => n + c.acceptP, 0);
  const neededInvites = Math.max(minInv, Math.min(maxInv, Math.ceil(prospectConfirms / (expected / Math.max(1, invitees.length) || 0.25)) + fixed));

  return {
    anchor,
    customerHosts,
    connector,
    invitees,
    waitlist,
    mustAttendKeys,
    composition: {
      hosts: kind === "dinner" ? 2 : 1,
      anchor: anchor ? 1 : 0,
      customers: customerHosts.length,
      prospects: prospectSeats,
      connector: connector ? 1 : 0,
      seats,
    },
    inviteMath: {
      invites: Math.max(all.length, neededInvites),
      expectedAcceptRate: all.length ? Math.round((totalP / all.length) * 100) / 100 : 0.25,
      confirmsTarget: Math.ceil(seats * 1.25),
      expectedShowRate: 0.8,
      seats,
      warmInvites: warm + fixed,
      coldInvites: invitees.length - warm,
      poolSize: all.length,
      mustAttend: mustAttendKeys.size,
    },
  };
}

/* ─────────────────────────────── Defaults (used when Claude is unavailable, and as skeletons) ─────────────────────────────── */

export function defaultBudget(kind: EventKind, budgetUsd?: number): DinnerPlan["budgetUsd"] {
  if (budgetUsd && budgetUsd > 0) return { low: Math.round(budgetUsd * 0.8), high: Math.round(budgetUsd) };
  return kind === "dinner" ? { low: 3500, high: 7000 } : { low: 0, high: 300 };
}

export function defaultRunOfShow(kind: EventKind): DinnerPlan["runOfShow"] {
  return kind === "dinner"
    ? [
        { time: "6:30", segment: "Drinks", notes: "30+ minutes. Don't seat anyone early." },
        { time: "7:05", segment: "Seat and welcome", notes: "Under 5 minutes. Norms: off the record, no recording, no pitch." },
        { time: "7:10", segment: "Introductions", notes: "Name, role, what you're working on this quarter." },
        { time: "7:25", segment: "Anchor framing", notes: "5–10 minutes that set up the question." },
        { time: "7:35", segment: "Discussion over the main course", notes: "2–3 prompts, 3–4 in reserve. Draw in quiet guests by name." },
        { time: "8:40", segment: "Dessert, seats switched", notes: "Move people so every prospect meets someone new." },
        { time: "9:10", segment: "Close", notes: "One observation that ties the night together, then thanks." },
      ]
    : [
        { time: "0:00", segment: "Welcome and norms", notes: "5 minutes. Chatham House rule, no recording, no pitch." },
        { time: "0:05", segment: "Introductions", notes: "10 minutes. Name, role, one sentence on what you're working on." },
        { time: "0:15", segment: "Framing", notes: "5 minutes from the framer." },
        { time: "0:20", segment: "Discussion", notes: "35 minutes. 2–3 prompts, reserves ready; call on quiet guests by name." },
        { time: "0:55", segment: "Close", notes: "5 minutes. One observation that ties it together; ask who should meet whom." },
      ];
}

export function defaultSeatingRules(kind: EventKind): string[] {
  return kind === "dinner"
    ? [
        "Customer host at one end, the co-host or you at the other.",
        "Seat each priority prospect next to someone who solved the same problem, not next to you.",
        "Peers by seniority; no direct competitors at the same table.",
        "Double-sided place cards; no name badges.",
        "Over 10 guests: two round tables with a host at each.",
      ]
    : [
        "Cameras on. You moderate; you don't present.",
        "Call on quiet guests by name in the first 15 minutes.",
        "When someone dominates: \"Let's hear from someone who hasn't spoken yet.\"",
        "The product comes up only if a guest asks.",
      ];
}

export function defaultCadence(): DinnerPlan["followUp"]["cadence"] {
  return [
    { day: 1, touch: "Next-morning note: one thing they said, one concrete next step" },
    { day: 7, touch: "Specific follow-up on what they asked about" },
    { day: 28, touch: "A relevant piece of content or an intro to a peer" },
    { day: 60, touch: "Direct meeting request" },
    { day: 90, touch: "Deal in motion, or move to nurture" },
  ];
}

export const NO_PITCH = "No slides, no pitch, off the record.";

/* ─────────────────────────────── Copy merge ─────────────────────────────── */

export function firstNameOf(name: string | undefined): string | undefined {
  const f = (name ?? "").trim().split(/\s+/)[0];
  return f || undefined;
}

export function guestLabel(g: Pick<GuestCandidate, "name" | "title">): string {
  return g.name || g.title;
}

/** Who this guest will meet: their planned seat partner, else the strongest other guest at another company. */
export function peerFor(ev: GtmEvent, guest: Guest, ws: Workspace): Guest | undefined {
  const others = Object.values(ev.guests).filter((g) => g.id !== guest.id && g.accountDomain !== guest.accountDomain && g.name && g.status !== "declined");
  const paired = guest.seatNextTo ? ev.guests[guest.seatNextTo.guestId] : undefined;
  if (paired && paired.name) return paired;
  const partner = others.find((g) => g.seatNextTo?.guestId === guest.id);
  if (partner) return partner;
  void ws;
  return others.filter((g) => g.role !== "connector").sort((a, b) => Number(IN_ROOM.has(b.status)) - Number(IN_ROOM.has(a.status)) || b.score - a.score)[0];
}

function describe(g: Guest, ws: Workspace): string {
  const company = ws.accounts[g.accountDomain]?.name;
  return [g.name, [g.title, company].filter(Boolean).join(" at ")].filter(Boolean).join(", ");
}

export function guestVars(ev: GtmEvent, guest: Guest, ws: Workspace): Record<string, string | undefined> {
  const peer = peerFor(ev, guest, ws);
  const day = eventDay(ev);
  return {
    first_name: firstNameOf(guest.name),
    personal_line: guest.personalLine || undefined,
    peer: peer ? describe(peer, ws) : "a few peers working through the same problem",
    wants: guest.wants || undefined,
    date: day ? formatEventDate(ev, { weekday: true }) : undefined,
    time: ev.date ? formatEventDate(ev, { time: true }).split(" · ")[1] : undefined,
    venue: ev.venue?.name,
    link: ev.kind === "roundtable" ? ev.venue?.address || undefined : undefined,
    founder_name: firstNameOf(ws.founder.name) ?? ws.founder.name,
  };
}

/** Fills `{token}`s. Unknown tokens stay visible so the founder sees what still needs a value. */
export function mergeTokens(text: string, vars: Record<string, string | undefined>): string {
  return text
    .replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function missingTokens(text: string): string[] {
  return [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))];
}

export function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

/** Gmail compose URL (under ~2,000 chars), else a mailto: fallback. */
export function composeUrl(ws: Workspace, to: string | undefined, subject: string, body: string, bcc: string[] = []): string {
  const u = encodeURIComponent(ws.founder.gmailAuthUser || "0");
  const b = bcc.length ? `&bcc=${encodeURIComponent(bcc.join(","))}` : "";
  const gmail = `https://mail.google.com/mail/u/${u}/?tf=cm${to ? `&to=${encodeURIComponent(to)}` : ""}${b}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  if (gmail.length <= 2000) return gmail;
  return `mailto:${to ? encodeURIComponent(to) : ""}?subject=${encodeURIComponent(subject)}${b}&body=${encodeURIComponent(body)}`;
}

/* ─────────────────────────────── Funnel, status, attribution ─────────────────────────────── */

export interface Funnel {
  invited: number;
  accepted: number;
  confirmed: number;
  attended: number;
  meetings: number;
  target: number;
}

export function funnelOf(ev: GtmEvent, ws: Workspace): Funnel {
  const gs = Object.values(ev.guests);
  return {
    invited: gs.filter((g) => EVER_INVITED.has(g.status)).length,
    accepted: gs.filter((g) => SAID_YES.has(g.status)).length,
    confirmed: gs.filter((g) => CONFIRMED.has(g.status)).length,
    attended: gs.filter((g) => g.status === "attended").length,
    meetings: attribution(ev, ws).meetingAccounts90,
    target: ev.plan?.inviteMath.invites ?? 0,
  };
}

/**
 * Status follows the guest list unless the founder closed or cancelled the event. A past event
 * only becomes "done" by itself once its follow-ups are finished (or the 90-day window is over),
 * so recording attendance never hides the T+1…T+90 tasks from Today.
 */
export function deriveStatus(ev: GtmEvent, today = todayISO()): GtmEvent["status"] {
  if (ev.status === "cancelled") return "cancelled";
  const gs = Object.values(ev.guests);
  const day = eventDay(ev);
  const met = gs.some((g) => g.status === "attended" || g.status === "no_show");
  const openAfter = day ? (ev.plan?.timeline ?? []).some((t) => !t.done && t.owner !== "ember" && t.due > day) : false;
  if (ev.status === "done" || (day && day < today && met && (!openAfter || daysBetween(day, today) > 90))) return "done";
  // It happened and follow-ups are open: never fall back to "Inviting" because fewer than the seats came.
  if (day && day < today && met) return "confirmed";
  const seats = ev.plan?.inviteMath.seats ?? 0;
  if (seats && gs.filter((g) => CONFIRMED.has(g.status)).length >= seats) return "confirmed";
  if (gs.some((g) => EVER_INVITED.has(g.status))) return "inviting";
  return "planning";
}

export interface Attribution {
  day?: ISODate;
  daysSince: number;
  attendees: number;
  meetingAccounts30: number;
  meetingAccounts90: number;
  rate90: number | null;
  meetings: (Meeting & { accountDomain: string })[];
  sourced: Deal[];
  influenced: Deal[];
}

/**
 * Pipeline from attendee accounts: meetings at 30 and 90 days; deals created within 90 days are
 * sourced, deals already open that moved stage within 90 days are influenced (research 02 §2.9).
 */
export function attribution(ev: GtmEvent, ws: Workspace, today = todayISO()): Attribution {
  const day = eventDay(ev);
  const attendees = Object.values(ev.guests).filter((g) => g.status === "attended" && g.accountDomain);
  const empty: Attribution = { day, daysSince: 0, attendees: attendees.length, meetingAccounts30: 0, meetingAccounts90: 0, rate90: null, meetings: [], sourced: [], influenced: [] };
  if (!day || !attendees.length) return empty;
  const after = (iso: string, days: number) => {
    const d = daysBetween(day, iso.slice(0, 10));
    return d >= 0 && d <= days;
  };
  const domains = new Set(attendees.map((g) => g.accountDomain));
  const deals = Object.values(ws.deals).filter((d) => domains.has(d.accountDomain));
  const meetings: Attribution["meetings"] = [];
  const met30 = new Set<string>();
  const met90 = new Set<string>();
  for (const d of deals) {
    for (const id of d.meetingIds) {
      const m = ws.meetings[id];
      if (!m || !after(m.startsAt, 90)) continue;
      meetings.push({ ...m, accountDomain: d.accountDomain });
      met90.add(d.accountDomain);
      if (after(m.startsAt, 30)) met30.add(d.accountDomain);
    }
  }
  const sourced = deals.filter((d) => after(d.createdAt, 90));
  const influenced = deals.filter((d) => !sourced.includes(d) && d.createdAt.slice(0, 10) < day && d.stageHistory.some((h) => after(h.at, 90)));
  return {
    day,
    daysSince: Math.max(0, daysBetween(day, today)),
    attendees: attendees.length,
    meetingAccounts30: met30.size,
    meetingAccounts90: met90.size,
    rate90: met90.size / attendees.length,
    meetings: meetings.sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    sourced,
    influenced,
  };
}

/** Post-event human touches in the 90 days after the event (cap: 5). */
export function touchesUsed(g: Guest, ev: GtmEvent): number {
  const day = eventDay(ev);
  return (g.touches ?? []).filter((t) => !day || (daysBetween(day, t.at) >= 0 && daysBetween(day, t.at) <= 90)).length;
}

/* ─────────────────────────────── Seating (dinner) ─────────────────────────────── */

export interface SeatSlot {
  kind: "founder" | "cohost" | "guest";
  guestId?: string;
  label: string;
  sub: string;
  why?: string;
}

/**
 * Customer host at one end, co-host (or founder) at the other; each priority prospect beside the
 * guest they were paired with (someone who faced the same problem). Over 10 people: two tables.
 * Uses accepted/confirmed guests; before anyone accepts it previews the must-attend list.
 */
export function seatingPlan(ev: GtmEvent, ws: Workspace): { tables: SeatSlot[][]; preview: boolean } {
  const all = Object.values(ev.guests).filter((g) => !g.competitorConflict);
  let pool = all.filter((g) => IN_ROOM.has(g.status));
  const preview = pool.length === 0;
  if (preview) {
    pool = all
      .filter((g) => g.status !== "declined" && g.status !== "waitlist" && (g.mustAttend || g.role !== "prospect"))
      .slice(0, ev.plan?.inviteMath.seats ?? 8);
  }
  const company = (g: Guest) => ws.accounts[g.accountDomain]?.name ?? (g.accountDomain || (g.role === "connector" ? "Connector" : g.title));
  const slot = (g: Guest, why?: string): SeatSlot => ({ kind: "guest", guestId: g.id, label: guestLabel(g), sub: company(g), why });
  const coHostName = ev.plan?.coHost?.name;
  const hostSlots: SeatSlot[] = [
    { kind: "founder", label: firstNameOf(ws.founder.name) ?? "You", sub: "Host" },
    ...(coHostName ? [{ kind: "cohost" as const, label: coHostName, sub: "Co-host" }] : []),
  ];

  const hosts = pool.filter((g) => g.role === "customer_host");
  const rest = pool.filter((g) => g.role !== "customer_host").sort((a, b) => b.score - a.score);
  // Units: planned pairs first, then singles.
  const placed = new Set<string>();
  const units: SeatSlot[][] = [];
  for (const g of rest) {
    if (placed.has(g.id)) continue;
    const partnerId = g.seatNextTo?.guestId;
    const partner = partnerId ? pool.find((p) => p.id === partnerId && !placed.has(p.id) && p.role !== "customer_host") : undefined;
    placed.add(g.id);
    if (partner) {
      placed.add(partner.id);
      units.push([slot(g, g.seatNextTo?.why), slot(partner, g.seatNextTo?.why)]);
    } else units.push([slot(g)]);
  }

  const people = pool.length + hostSlots.length;
  const tableCount = people > 10 ? 2 : 1;
  const tables: SeatSlot[][] = [];
  for (let t = 0; t < tableCount; t++) {
    // Ends of the table: a customer host at one, a host (founder or co-host) at the other.
    const myHosts = tableCount === 1 ? hostSlots : hostSlots.filter((_, i) => i % 2 === t);
    const ends: SeatSlot[] = [...(hosts[t] ? [slot(hosts[t], "Customer host: tells the story so you don't have to")] : []), ...myHosts];
    const mine = units.filter((_, i) => i % tableCount === t);
    const left: SeatSlot[] = [];
    const right: SeatSlot[] = [];
    mine.forEach((u, i) => (i % 2 === 0 ? left : right).push(...u));
    // A third host (customer host + founder + co-host) sits mid-way along the shorter side.
    for (const extra of ends.slice(2)) {
      const side = left.length <= right.length ? left : right;
      side.splice(Math.floor(side.length / 2), 0, extra);
    }
    tables.push([...(ends[0] ? [ends[0]] : []), ...left, ...(ends[1] ? [ends[1]] : []), ...right.reverse()]);
  }
  // Customer hosts beyond one per table sit mid-table.
  for (const h of hosts.slice(tableCount)) tables[0].splice(Math.ceil(tables[0].length / 2), 0, slot(h));
  return { tables, preview };
}

/* ─────────────────────────────── Briefing book ─────────────────────────────── */

export interface BriefingEntry {
  guest: Guest;
  company: string;
  stage?: string;
  challenge?: string;
  wants?: string;
  intro?: string;
  signal?: { headline: string; url: string; date: string };
}

export function briefingBook(ev: GtmEvent, ws: Workspace): BriefingEntry[] {
  const pool = Object.values(ev.guests);
  const inRoom = pool.filter((g) => IN_ROOM.has(g.status));
  const list = (inRoom.length ? inRoom : pool.filter((g) => g.mustAttend || g.role !== "prospect")).sort((a, b) => b.score - a.score);
  return list.map((g) => {
    const acc = ws.accounts[g.accountDomain];
    const deal = g.dealId ? ws.deals[g.dealId] : acc?.dealId ? ws.deals[acc.dealId] : undefined;
    const peer = peerFor(ev, g, ws);
    const sig = acc ? bestSignal(acc, todayISO()) : undefined;
    return {
      guest: g,
      company: acc?.name ?? (g.accountDomain || (g.role === "connector" ? "Your network" : "")),
      stage: deal ? deal.stage : undefined,
      challenge: deal?.card?.pain.value ?? acc?.dossier?.painHypotheses[0]?.pain,
      wants: g.wants,
      intro: peer ? `${guestLabel(peer)}${g.seatNextTo?.why ? ` · ${g.seatNextTo.why}` : ""}` : undefined,
      signal: sig ? { headline: sig.headline, url: sig.url, date: sig.date } : undefined,
    };
  });
}

export function briefingMarkdown(ev: GtmEvent, ws: Workspace): string {
  const theme = ev.plan?.themes[ev.chosenThemeIdx ?? 0];
  const lines = [`# Briefing book · ${ev.title}`, `${formatEventDate(ev, { time: true })}${theme ? ` · ${theme.question}` : ""}`, ""];
  for (const b of briefingBook(ev, ws)) {
    lines.push(`## ${guestLabel(b.guest)} · ${b.guest.title}, ${b.company}`);
    if (b.stage) lines.push(`- Deal stage: ${b.stage}`);
    if (b.challenge) lines.push(`- Challenge: ${b.challenge}`);
    if (b.wants) lines.push(`- Wants from the room: ${b.wants}`);
    if (b.intro) lines.push(`- Planned intro: ${b.intro}`);
    if (b.signal) lines.push(`- Recent: ${b.signal.headline} (${b.signal.url})`);
    lines.push("");
  }
  return lines.join("\n");
}
