import { addDays, daysBetween, monthKey, todayISO, weekOf } from "@/lib/domain/ids";
import { STAGE_LABELS, type Asset, type Deal, type ID, type Move, type MoveKind, type OutreachPackage, type SignalType, type Workspace } from "@/lib/domain/types";
import { referralLeads } from "@/lib/deals/referrals";
import { pilotWatch, type PilotWatch } from "@/lib/deals/rules";
import { leadPoints, metros, nearby } from "@/lib/geo/leads";
import { placeLabel, resolvePlace } from "@/lib/geo/places";
import { ledger, openIntroFor, targetLabel, when, yourMoves, type IntroAction } from "@/lib/intros/rules";
import { offeredResource } from "@/lib/quality/lint";
import { senderOwnsSequence } from "@/lib/quality/sequence";
import { awaitingOutcome, BOOKING_NUDGES, bookingLoops, searchDays } from "./replies";
import { coldQuotaLeft, counters, introAsksTarget, type Counters } from "./scoreboard";
import {
  aOrAn,
  ago,
  ageShort,
  bestPerson,
  clip,
  clockTime,
  companyName,
  daysSince,
  first,
  isOpen,
  isSuppressed,
  knowsDirectly,
  localDate,
  openDealFor,
  overdueBoost,
  plural,
  shortDay,
  stageMult,
  topSignal,
} from "./util";

/**
 * The moves engine. Deterministic rules over workspace state produce every card on Today:
 * stable ids (so done / skipped / snoozed decisions stick), templated copy, and a priority of
 * base × stage multiplier + overdue boost. Code ranks; no model ever reorders or writes a title.
 */

export const RULE_PREFIX = "today.";

const RULES = {
  reply: { base: 100, label: "A reply is waiting for an answer" },
  check_replies: { base: 92, label: "Touches in the last 14 days with no outcome marked" },
  meeting_prep: { base: 90, label: "Meeting today" },
  debrief: { base: 88, label: "Meeting ended with no notes" },
  recap: { base: 85, label: "Debrief drafted but not applied" },
  referrals: { base: 62, label: "People a call suggested, not written to yet" },
  follow_up: { base: 70, label: "Follow-up step due" },
  reply_book: { base: 74, label: "They said yes and you answered; no call booked yet" },
  next_step: { base: 65, label: "Open deal without a dated next step" },
  review_monday: { base: 62, label: "Monday pipeline review" },
  close_out: { base: 60, label: "End-of-day close-out" },
  nurture: { base: 60, label: "Nurture check-back date reached" },
  warm_path: { base: 58, label: "Warm path at an ICP company" },
  connector: { base: 58, label: "Weekly intro asks not met and a connector exists" },
  intro_draft: { base: 58, label: "Intro ask drafted" },
  intro_reply: { base: 96, label: "An intro landed: reply within a day" },
  intro_send: { base: 80, label: "Both sides said yes to an intro you're making" },
  intro_close_loop: { base: 61, label: "Met through an intro; the connector hasn't heard how it went" },
  intro_nudge: { base: 57, label: "An intro ask has been quiet for five days" },
  intro_check_in: { base: 55, label: "A forwarded intro has been quiet for a week" },
  intro_book: { base: 53, label: "Replied to an intro, no time picked yet" },
  intro_check_how: { base: 42, label: "Two weeks after an intro you made" },
  intro_thank: { base: 40, label: "A connector passed; thank them for checking" },
  intro_let_go: { base: 34, label: "Quiet after the one nudge" },
  review_friday: { base: 56, label: "Friday learning review" },
  single_threaded: { base: 55, label: "Qualified or later with one contact" },
  unpaid: { base: 55, label: "Unpaid pilot past 30 days" },
  stalled: { base: 55, label: "Active deal quiet for over a week, next step still ahead" },
  slipped: { base: 55, label: "Close date pushed twice or more" },
  pilot_convert: { base: 62, label: "Pilot past its end date, still at Pilot" },
  pilot_roi: { base: 58, label: "Pilot ends within 5 days and no ROI review is booked" },
  map_overdue: { base: 55, label: "A mutual action plan step is overdue" },
  pilot_checkin: { base: 45, label: "Pilot running, no check-in for 3 days" },
  switch_channel: { base: 54, label: "Three emails without a reply" },
  cold_draft: { base: 52, label: "First-touch draft ready" },
  signal: { base: 50, label: "Fresh signal at an A-tier account" },
  linkedin_dm: { base: 52, label: "LinkedIn invite sent, message not sent yet" },
  linkedin: { base: 50, label: "LinkedIn invite drafted" },
  pov: { base: 45, label: "Cold drafts need a point of view" },
  research: { base: 44, label: "Top account without a dossier" },
  first_three: { base: 56, label: "One of the first three companies onboarding picked, not written to yet" },
  questions: { base: 35, label: "Open founder questions, a few at a time" },
  event_task: { base: 40, label: "Event task due" },
  event_nearby: { base: 47, label: "Warm or pipeline leads near an upcoming dinner aren't on its list" },
  question: { base: 35, label: "Open founder question" },
  import: { base: 30, label: "Connections import missing or older than 30 days" },
  network: { base: 57, label: "No LinkedIn import and no investors or advisors listed yet" },
  connectors: { base: 57, label: "No investors or advisors listed to ask for intros" },
  asset: { base: 30, label: "A draft offers an asset that doesn't exist yet" },
  post: { base: 32, label: "Optional post from last Friday's best insight" },
  room: { base: 38, label: "Tracked companies cluster on a theme or a city: worth a room" },
  discover: { base: 28, label: "Fewer than 10 untouched A/B prospects" },
} as const;

type RuleKey = keyof typeof RULES;

/** Shown on hover over a move ("why is this here?"). */
export function ruleLabel(rule: string): string | undefined {
  const key = rule.startsWith(RULE_PREFIX) ? rule.slice(RULE_PREFIX.length) : rule;
  return (RULES as Record<string, { label: string }>)[key]?.label;
}

export function isRuleMove(move: Move): boolean {
  return move.rule.startsWith(RULE_PREFIX);
}

/** At most this many open moves a day; the rest wait for tomorrow. */
export const DAILY_OPEN_MAX = 12;
export const TOP_MOVES = 5;
const MEETING_MINUTES = 45;
const CLOSE_OUT_MINUTES = 16 * 60 + 30;

/** The founder's close-out time (Settings → You, "HH:MM"), in minutes after midnight; 16:30 when unset or malformed. */
export function closeOutMinutes(ws: Workspace): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(ws.founder.closeOutTime?.trim() ?? "");
  if (!m) return CLOSE_OUT_MINUTES;
  const [h, mm] = [Number(m[1]), Number(m[2])];
  return h < 24 && mm < 60 ? h * 60 + mm : CLOSE_OUT_MINUTES;
}

/** Days without activity before an active deal with a future step gets a check-in card. */
const STALL_DAYS = 7;

type Cand = Omit<Move, "createdAt" | "status" | "rule" | "evidenceIds" | "dueOn"> & {
  rule: RuleKey;
  dueOn?: string;
  evidenceIds?: ID[];
};

const sheet = (domain: string) => `/companies?c=${encodeURIComponent(domain)}`;

interface Ctx {
  ws: Workspace;
  now: Date;
  today: string;
  weekStart: string;
  c: Counters;
  out: Cand[];
  /** Domains the first-three cards cover; other first-touch, warm-path and research rules stand down for them. */
  firstThree: Set<string>;
}

export function computeMoves(ws: Workspace, now: Date): Move[] {
  const today = todayISO(now);
  const ctx: Ctx = { ws, now, today, weekStart: weekOf(today), c: counters(ws, now), out: [], firstThree: new Set() };

  replies(ctx);
  checkReplies(ctx);
  bookings(ctx);
  meetings(ctx);
  callReferrals(ctx);
  sequences(ctx);
  deals(ctx);
  firstThree(ctx);
  firstTouches(ctx);
  warmPaths(ctx);
  introFollowThrough(ctx);
  setup(ctx);
  missingAssets(ctx);
  events(ctx);
  dinnerNeighbors(ctx);
  roomSuggestion(ctx);
  questions(ctx);
  reviews(ctx);
  weeklyPost(ctx);

  // Other surfaces (inbound webhooks, agent API) create their own reply and prep cards. When one already
  // covers the same reply or meeting, in any status, don't add a second card for it.
  const covered = new Set<string>();
  for (const m of Object.values(ws.moves)) {
    if (isRuleMove(m)) continue;
    if (m.activityId) covered.add(`${m.kind}:act:${m.activityId}`);
    if (m.ref) covered.add(`${m.kind}:${m.ref.kind}:${m.ref.id}`);
  }
  const isCovered = (c: Cand) => (c.activityId && covered.has(`${c.kind}:act:${c.activityId}`)) || (c.kind === "meeting_prep" && c.ref && covered.has(`${c.kind}:${c.ref.kind}:${c.ref.id}`));

  const ranked = ctx.out.sort((a, b) => b.priority - a.priority || a.title.localeCompare(b.title));
  const seen = new Set<string>();
  const moves: Move[] = [];
  let openCount = 0;
  for (const cand of ranked) {
    if (seen.has(cand.id) || isCovered(cand)) continue;
    seen.add(cand.id);
    const prev = ws.moves[cand.id];
    // Done, skipped and still-snoozed cards aren't on Today, so they don't use up the daily slots.
    const settled = !!prev && ((prev.status === "done" && !prev.autoDone) || prev.status === "skipped" || (prev.status === "snoozed" && !!prev.snoozedUntil && prev.snoozedUntil > today));
    const overflow = !settled && openCount >= DAILY_OPEN_MAX;
    if (!settled) openCount++;
    moves.push({
      ...cand,
      rule: RULE_PREFIX + cand.rule,
      priority: Math.round(cand.priority * 10) / 10,
      evidenceIds: cand.evidenceIds ?? [],
      // Overflow beyond the daily maximum waits until tomorrow instead of piling up.
      dueOn: overflow ? addDays(today, 1) : (cand.dueOn ?? today),
      createdAt: now.toISOString(),
      status: "open",
    });
  }
  return moves;
}

/** Merges freshly computed moves with what's stored, so the founder's decisions stick. Pure. */
export function mergeMoves(existing: Record<ID, Move>, computed: Move[], today: string): Record<ID, Move> {
  const next: Record<ID, Move> = {};
  const fresh = new Map(computed.map((m) => [m.id, m]));
  for (const m of Object.values(existing)) {
    if (!isRuleMove(m)) {
      // Moves other surfaces created (onboarding, imports) are theirs to manage, except that inbound
      // webhook cards go stale on the same clock as ours.
      const stale = inboundStale(m, today);
      if (stale === "drop") continue;
      next[m.id] = stale === "expire" ? { ...m, status: "done", autoDone: true } : m;
      continue;
    }
    if (fresh.has(m.id)) continue;
    // The condition is gone. Keep recent decisions as history. An open card that was on the desk was
    // resolved by its own work (the last reply marked, the dossier landed): record it as done, don't drop it.
    if (daysBetween(localDate(m.createdAt), today) > 30) continue;
    if (m.status === "done" || m.status === "skipped") next[m.id] = m;
    else if (m.status === "open" && m.dueOn <= today) next[m.id] = { ...m, status: "done", autoDone: true };
  }
  for (const m of computed) {
    const prev = existing[m.id];
    if (!prev) {
      next[m.id] = m;
      continue;
    }
    // Auto-done cards come back when their condition does (a new touch to check, a deal folded into last night's close-out).
    const wake = (prev.status === "snoozed" && (!prev.snoozedUntil || prev.snoozedUntil <= today)) || (prev.status === "done" && !!prev.autoDone);
    const merged: Move = { ...m, createdAt: prev.createdAt, status: wake ? "open" : prev.status };
    if (!wake && prev.snoozedUntil) merged.snoozedUntil = prev.snoozedUntil;
    if (prev.skipReason) merged.skipReason = prev.skipReason;
    next[m.id] = merged;
  }
  return next;
}

/** Replies older than this drop off Today, whether a rule or a webhook made the card. */
const REPLY_WINDOW_DAYS = 14;

/**
 * Inbound webhook cards (a reply from a sequencer, a booking with a personal email) expire like rule
 * moves: an unanswered reply after the reply window, a booking prep card once the call's day has
 * passed. Expired cards are kept as auto-done history for 30 days, then dropped.
 */
function inboundStale(m: Move, today: string): "expire" | "drop" | null {
  if (m.rule !== "inbound.reply" && m.rule !== "inbound.booking") return null;
  if (m.status === "done" || m.status === "skipped") return daysBetween(localDate(m.createdAt), today) > 30 ? "drop" : null;
  const expired = m.rule === "inbound.reply" ? daysSince(m.receivedAt ?? m.createdAt, today) > REPLY_WINDOW_DAYS : m.dueOn < today;
  return expired ? "expire" : null;
}

/** What Today shows: open (or woken) moves due today, best first. */
export function visibleMoves(moves: Record<ID, Move>, today: string): Move[] {
  return Object.values(moves)
    .filter((m) => (m.status === "open" || (m.status === "snoozed" && !!m.snoozedUntil && m.snoozedUntil <= today)) && m.dueOn <= today)
    .sort((a, b) => b.priority - a.priority || a.title.localeCompare(b.title));
}

/* ───────────────────────────── rules ───────────────────────────── */

const SENTIMENT: Record<string, string> = {
  positive: "Positive",
  neutral: "Neutral",
  negative: "Not interested",
  referral: "Referral",
  ooo: "Out of office",
};

function replies({ ws, now, today, out }: Ctx) {
  const latest = new Map<string, (typeof ws.activities)[number]>();
  for (const a of ws.activities) {
    if (a.kind !== "reply_received" || !a.personId) continue;
    if (daysSince(a.at, today) > REPLY_WINDOW_DAYS) continue;
    const prev = latest.get(a.personId);
    if (!prev || a.at > prev.at) latest.set(a.personId, a);
  }
  for (const [personId, reply] of latest) {
    const answered = ws.activities.some(
      (a) => a.personId === personId && a.at > reply.at && (a.kind === "touch_sent" || a.kind === "linkedin_dm" || a.kind === "intro_requested"),
    );
    if (answered || reply.sentiment === "ooo") continue;
    const person = ws.people[personId];
    const domain = person?.accountDomain ?? reply.accountDomain ?? "";
    const deal = openDealFor(ws, domain);
    const days = daysSince(reply.at, today);
    const name = first(person?.name) || "them";
    const unsubscribe = reply.sentiment === "unsubscribe";
    out.push({
      id: `mv_reply_${reply.id}`,
      kind: "reply",
      rule: "reply",
      title: unsubscribe ? `Stop contacting ${name}` : `Reply to ${name} at ${companyName(ws, domain)}`,
      why: unsubscribe
        ? `Asked not to be contacted · replied ${ago(reply.at, now)}`
        : `${SENTIMENT[reply.sentiment ?? ""] ? `${SENTIMENT[reply.sentiment ?? ""]} · ` : ""}replied ${ago(reply.at, now)}`,
      minutes: unsubscribe ? 1 : 5,
      priority: RULES.reply.base * stageMult(deal?.stage) + overdueBoost(days),
      ref: { kind: "person", id: personId },
      activityId: reply.id,
      receivedAt: reply.at,
      href: domain ? sheet(domain) : undefined,
    });
  }
}

function checkReplies({ ws, now, today, out }: Ctx) {
  const people = awaitingOutcome(ws, now);
  if (!people.length) return;
  const touches = people.reduce((n, p) => n + p.touches.length, 0);
  out.push({
    id: `mv_replies_${today}`,
    kind: "check_replies",
    rule: "check_replies",
    title: `Check replies from ${plural(people.length, "person", "people")}`,
    why: `${plural(touches, "touch", "touches")} in ${searchDays(people, today)} days · one Gmail search`,
    minutes: Math.min(15, 2 + Math.ceil(people.length / 3)),
    priority: RULES.check_replies.base,
    subjectIds: people.map((p) => p.personId),
  });
}

/**
 * A yes the founder answered, with no time picked: a one-line nudge two working days later, one more
 * three days after that, then "decide". Each nudge gets a fresh card id, so marking one done waits for the next.
 */
function bookings({ ws, now, today, out }: Ctx) {
  for (const loop of bookingLoops(ws, now)) {
    if (loop.dueOn > today) continue;
    const name = first(loop.person.name) || "them";
    const deal = loop.dealId ? ws.deals[loop.dealId] : undefined;
    const on = shortDay(localDate(loop.reply.at));
    const decide = loop.nudges >= BOOKING_NUDGES;
    const overdue = Math.max(0, daysBetween(loop.dueOn, today));
    out.push({
      id: `mv_book_${loop.reply.id}_${loop.nudges}`,
      kind: "follow_up",
      rule: "reply_book",
      title: decide
        ? `Decide on ${name} at ${loop.company}: book it, park it or let it go`
        : loop.intent === "positive"
          ? `Book ${name}: said yes ${on}, no time picked`
          : `Follow up with ${name}: asked for info ${on}, no call yet`,
      why: decide
        ? `${plural(loop.nudges, "nudge")} since you answered · close the loop either way`
        : loop.nudges
          ? `Nudged ${ago(loop.lastTouch.at, now)} · one more line, with times`
          : `You answered ${ago(loop.answeredAt, now)} · a one-line nudge${loop.intent === "positive" ? " with two times" : ""}`,
      minutes: 2,
      priority: RULES.reply_book.base * stageMult(deal?.stage) + overdueBoost(overdue),
      overdueDays: overdue || undefined,
      ref: { kind: "person", id: loop.personId },
      activityId: loop.reply.id,
      ...(deal ? { subjectIds: [deal.id] } : {}),
      href: sheet(loop.domain),
    });
  }
}

const CALL_TYPES: Record<string, string> = {
  first_discovery: "First discovery call",
  follow_up: "Follow-up call",
  demo: "Demo",
  technical: "Technical deep-dive",
  pilot_review: "Pilot review",
  negotiation: "Negotiation",
};

function meetings({ ws, now, today, out }: Ctx) {
  const nowMs = now.getTime();
  for (const m of Object.values(ws.meetings)) {
    const start = new Date(m.startsAt).getTime();
    if (Number.isNaN(start)) continue;
    const deal = ws.deals[m.dealId];
    const domain = deal?.accountDomain ?? "";
    const company = companyName(ws, domain);
    const mult = stageMult(deal?.stage);
    const end = start + MEETING_MINUTES * 60_000;

    if (localDate(m.startsAt) === today && nowMs < end + 15 * 60_000) {
      const names = m.attendees.map((a) => first(a.name)).filter(Boolean);
      const who = names.length ? (names.length > 2 ? `${names.slice(0, 2).join(", ")} +${names.length - 2}` : names.join(" and ")) : "attendees not set";
      out.push({
        id: `mv_prep_${m.id}`,
        kind: "meeting_prep",
        rule: "meeting_prep",
        title: `Prep for ${company} at ${clockTime(m.startsAt)}`,
        why: `${m.brief ? `Brief ready · ${CALL_TYPES[m.brief.callType] ?? "Call"}` : "Call"} · ${who}`,
        minutes: 10,
        priority: RULES.meeting_prep.base * mult,
        ref: { kind: "meeting", id: m.id },
        href: domain ? sheet(domain) : undefined,
      });
      continue;
    }

    const endedMinutesAgo = (nowMs - end) / 60_000;
    if (endedMinutesAgo >= 15 && daysSince(m.startsAt, today) <= 7 && !m.debrief && !m.notesRaw) {
      out.push({
        id: `mv_debrief_${m.id}`,
        kind: "debrief",
        rule: "debrief",
        title: `Log the ${company} call`,
        why: `Ended ${ago(new Date(end).toISOString(), now)} · no notes yet`,
        minutes: 5,
        priority: RULES.debrief.base * mult,
        ref: { kind: "meeting", id: m.id },
        href: domain ? sheet(domain) : undefined,
      });
    } else if (m.debrief && !m.debrief.appliedAt && daysSince(m.debrief.generatedAt, today) <= 3) {
      out.push({
        id: `mv_recap_${m.id}`,
        kind: "debrief",
        rule: "recap",
        title: `Apply the ${company} debrief and send the recap`,
        why: `Recap drafted ${ago(m.debrief.generatedAt, now)} · same-day recaps keep deals moving`,
        minutes: 3,
        priority: RULES.recap.base * mult,
        ref: { kind: "meeting", id: m.id },
        href: domain ? sheet(domain) : undefined,
      });
    }
  }
}

/** "Who else should I talk to?": the people a call named, until the founder writes to them (two weeks after the debrief). */
function callReferrals({ ws, today, out }: Ctx) {
  for (const m of Object.values(ws.meetings)) {
    if (!m.debrief || daysSince(m.debrief.generatedAt, today) > 14) continue;
    // A drafted note has its own card (a cold draft); this one asks for the rest.
    const open = referralLeads(ws, m).filter((l) => !l.acted && !l.drafted);
    if (!open.length) continue;
    const domain = ws.deals[m.dealId]?.accountDomain;
    const who = (l: (typeof open)[number]) => (l.name ? `${first(l.name)}${l.company ? ` at ${l.company}` : ""}` : (l.company ?? "them"));
    const referrers = [...new Set(open.map((l) => l.referrerId).filter((x): x is string => !!x))];
    const by = referrers.length === 1 ? first(ws.people[referrers[0]]?.name) : "";
    out.push({
      id: `mv_referrals_${m.id}`,
      kind: "first_touch",
      rule: "referrals",
      title: open.length === 1 ? `Write to ${who(open[0])}, ${by ? `${by}'s` : "a"} referral` : `Write to the ${open.length} people ${by || "they"} suggested`,
      why: `Named on the ${companyName(ws, domain)} call ${shortDay(localDate(m.startsAt))} · a referral is the warmest first touch`,
      minutes: 3 * open.length,
      priority: RULES.referrals.base,
      ref: { kind: "meeting", id: m.id },
      href: domain ? sheet(domain) : undefined,
    });
  }
}

/** The signal a first-touch card is built on: strongest usable one in the last 14 days. */
function freshSignal(acc: Workspace["accounts"][string], today: string) {
  return acc.signals
    .filter((s) => s.strength >= 2 && s.usableInOutreach && s.date && daysSince(s.date, today) <= 14 && s.type !== "sensitive")
    .sort((a, b) => b.strength - a.strength || b.date.localeCompare(a.date))[0];
}

function angleTitle(ws: Workspace, domain: string, angleId?: ID): string | undefined {
  if (!angleId) return undefined;
  return ws.accounts[domain]?.dossier?.angles.find((a) => a.id === angleId)?.title;
}

const LI_DM_AFTER_DAYS = 2;
const LI_DM_UNTIL_DAYS = 21;

/** Follow-ups (drafted when due), LinkedIn invites and the message after, intro asks, and the switch-channel nudge. */
function sequences({ ws, now, today, out }: Ctx) {
  const pkgs = Object.values(ws.outreach);
  for (const pkg of pkgs) {
    if (!pkg.personId) continue;
    const person = ws.people[pkg.personId];
    const domain = pkg.accountDomain;
    const company = companyName(ws, domain);
    const name = first(person?.name) || "them";
    if (isSuppressed(ws, person, domain)) continue;
    const deal = openDealFor(ws, domain);
    const mult = stageMult(deal?.stage);

    if (pkg.mode === "linkedin") {
      const step = pkg.steps.find((s) => s.status === "draft");
      if (!step) continue;
      const invite = ws.activities.find((a) => a.kind === "linkedin_connect" && a.draftRef?.packageId === pkg.id);
      if (!invite) {
        if (daysSince(pkg.createdAt, today) <= 14) {
          out.push({
            id: `mv_li_${pkg.id}`,
            kind: "linkedin",
            rule: "linkedin",
            title: `Connect with ${name} on LinkedIn`,
            why: `${pkg.linkedin?.recommendNoNote ? "Blank invite" : "Invite with a short note"} · doesn't count toward your email cap`,
            minutes: 1,
            priority: RULES.linkedin.base * mult,
            ref: { kind: "person", id: pkg.personId },
            draft: { packageId: pkg.id, step: step.step },
            href: sheet(domain),
          });
        }
        continue;
      }
      // Invite out, message still a draft. Nothing tells us they accepted, so ask after a couple of days,
      // and let it go after three weeks (an invite that old rarely gets accepted).
      const since = daysSince(invite.at, today);
      const moved = ws.activities.some((a) => a.personId === pkg.personId && a.at > invite.at && (a.kind === "linkedin_dm" || a.kind === "reply_received"));
      if (!moved && since >= LI_DM_AFTER_DAYS && since <= LI_DM_UNTIL_DAYS) {
        out.push({
          id: `mv_li_dm_${pkg.id}`,
          kind: "linkedin",
          rule: "linkedin_dm",
          title: `Message ${name} on LinkedIn`,
          why: `Invite sent ${ago(invite.at, now)} · once they accept, send the message`,
          minutes: 1,
          priority: RULES.linkedin_dm.base * mult,
          ref: { kind: "person", id: pkg.personId },
          draft: { packageId: pkg.id, step: step.step },
          href: sheet(domain),
        });
      }
      continue;
    }

    if (pkg.mode === "warm_intro") {
      const step = pkg.steps.find((s) => s.status === "draft");
      if (step && daysSince(pkg.createdAt, today) <= 14) {
        out.push({
          // Same id as the warm-path / connector card it was drafted from, so that card fills in place.
          id: pkg.connectorId ? `mv_connector_${pkg.connectorId}_${weekOf(localDate(pkg.createdAt))}` : `mv_warm_${domain}`,
          kind: "intro_ask",
          rule: "intro_draft",
          title: pkg.intro?.connectorName ? `Send the intro ask to ${first(pkg.intro.connectorName)}` : `Send your intro ask for ${company}`,
          why: `Warm path to ${company} · intro asks don't count toward your email cap`,
          minutes: 3,
          priority: RULES.intro_draft.base * mult,
          ref: { kind: "person", id: pkg.personId },
          draft: { packageId: pkg.id, step: step.step },
          href: sheet(domain),
        });
      }
      continue;
    }

    // "Not now, check back in …" replies that never became a nurture deal: bring them back on the date.
    if (
      pkg.mode === "reply" &&
      pkg.nurtureUntil &&
      pkg.nurtureUntil <= today &&
      !pkgs.some((p) => p.mode === "reply" && p.personId === pkg.personId && p.createdAt > pkg.createdAt) &&
      ws.deals[ws.accounts[domain]?.dealId ?? ""]?.stage !== "nurture" &&
      !ws.activities.some((a) => a.personId === pkg.personId && (a.kind === "touch_sent" || a.kind === "linkedin_dm") && localDate(a.at) >= pkg.nurtureUntil!)
    ) {
      const overdue = daysBetween(pkg.nurtureUntil, today);
      out.push({
        id: `mv_nurture_pkg_${pkg.id}`,
        kind: "next_step_missing",
        rule: "nurture",
        title: `Check back with ${name} at ${company}`,
        why: `Asked you to check back ${shortDay(pkg.nurtureUntil)} · write a short, specific note`,
        minutes: 3,
        priority: RULES.nurture.base + overdueBoost(Math.floor(overdue / 7)),
        overdueDays: overdue || undefined,
        ref: { kind: "person", id: pkg.personId },
        href: sheet(domain),
      });
      continue;
    }

    if (pkg.mode !== "cold" && pkg.mode !== "follow_up") continue;
    if (senderOwnsSequence(pkg)) continue;
    if (pkg.steps.some((s) => s.status === "cancelled_by_reply")) continue;
    const sent = pkg.steps.filter((s) => s.status === "sent" || s.status === "approved").sort((a, b) => a.step - b.step);
    if (!sent.length) continue;
    const firstSentAt = sent[0].sentAt ?? pkg.createdAt;
    const last = sent[sent.length - 1];
    if (ws.activities.some((a) => a.kind === "reply_received" && a.personId === pkg.personId && a.at > firstSentAt)) continue;

    if (last.step >= 3) {
      // Three unanswered emails: one blank LinkedIn invite, then stop.
      const onLinkedIn = pkgs.some((p) => p.personId === pkg.personId && p.mode === "linkedin") || ws.activities.some((a) => a.personId === pkg.personId && (a.kind === "linkedin_connect" || a.kind === "linkedin_dm"));
      const lastAt = last.sentAt ?? firstSentAt;
      if (!onLinkedIn && daysSince(lastAt, today) >= 3 && daysSince(lastAt, today) <= 21 && person?.linkedinUrl) {
        out.push({
          id: `mv_switch_${pkg.id}`,
          kind: "linkedin",
          rule: "switch_channel",
          title: `Switch to LinkedIn for ${name}`,
          why: "Three emails, no reply · one blank invite, then stop",
          minutes: 1,
          priority: RULES.switch_channel.base * mult,
          ref: { kind: "person", id: pkg.personId },
          href: person.linkedinUrl,
        });
      }
      continue;
    }

    const nextNo = last.step + 1;
    const inPkg = pkg.steps.find((s) => s.step === nextNo && s.status === "draft");
    const elsewhere = inPkg
      ? undefined
      : pkgs.find((p) => p.id !== pkg.id && p.personId === pkg.personId && p.mode === "follow_up" && p.createdAt > (last.sentAt ?? "") && p.steps.some((s) => s.status === "draft"));
    const draftStep = inPkg ?? elsewhere?.steps.find((s) => s.status === "draft");
    const dueOn = inPkg?.sendOn ?? addDays(localDate(firstSentAt), nextNo === 2 ? 3 : 8);
    if (dueOn > today) continue;
    const overdue = Math.max(0, daysBetween(dueOn, today));
    const angle = angleTitle(ws, domain, draftStep?.angleId);
    out.push({
      id: `mv_followup_${pkg.id}_${nextNo}`,
      kind: "follow_up",
      rule: "follow_up",
      title: `Follow up with ${name} at ${company}`,
      why: `Step ${nextNo} of 3 · ${angle ? `new angle: ${angle}` : draftStep ? "new angle drafted" : nextNo === 3 ? "last note: who owns this, or close the loop" : "a new angle, never just bumping"}`,
      minutes: draftStep ? 2 : 3,
      priority: RULES.follow_up.base * mult + overdueBoost(overdue),
      overdueDays: overdue || undefined,
      ref: { kind: "person", id: pkg.personId },
      draft: draftStep ? { packageId: inPkg ? pkg.id : elsewhere!.id, step: draftStep.step } : undefined,
      href: sheet(domain),
    });
  }
}

/** The newest sign of life on a deal: its own timestamp, any activity on it or its company, or a meeting already held. */
function lastDealActivity(ws: Workspace, deal: Deal, now: Date): string {
  let last = deal.lastActivityAt || deal.updatedAt;
  const nowIso = now.toISOString();
  for (const a of ws.activities) {
    if (a.kind === "skip" || a.at > nowIso || a.at <= last) continue;
    if (a.dealId === deal.id || (!!a.accountDomain && a.accountDomain === deal.accountDomain)) last = a.at;
  }
  for (const id of deal.meetingIds) {
    const m = ws.meetings[id];
    if (m && m.startsAt <= nowIso && m.startsAt > last) last = m.startsAt;
  }
  return last;
}

const PILOT_CHECKIN_DAYS = 3;
const ROI_WINDOW_DAYS = 5;

/** The champion's first name on a deal: the card's, then a contact with the role, then the first contact. */
function championOf(ws: Workspace, deal: Deal): string {
  const named = deal.card?.champion.name;
  if (named) return first(named);
  const c = deal.contacts.find((x) => x.role === "champion") ?? deal.contacts[0];
  return c ? first(ws.people[c.personId]?.name) : "";
}

function pilotMoves(ws: Workspace, deal: Deal, pw: PilotWatch, running: boolean, now: Date, today: string, out: Cand[]) {
  const domain = deal.accountDomain;
  const company = companyName(ws, domain);
  const mult = stageMult(deal.stage);
  const champion = championOf(ws, deal);
  const endsOn = deal.pilot?.endsOn;

  if (deal.stage === "pilot" && endsOn && pw.endsIn !== undefined && pw.endsIn < 0) {
    const past = -pw.endsIn;
    out.push({
      id: `mv_pilot_convert_${deal.id}_${endsOn}`,
      kind: "next_step_missing",
      rule: "pilot_convert",
      title: `Ask ${company} for the conversion decision`,
      why: `Pilot ended ${shortDay(endsOn)} · results against the success criteria, then the order form`,
      minutes: 5,
      priority: RULES.pilot_convert.base * mult + overdueBoost(past),
      overdueDays: past,
      ref: { kind: "deal", id: deal.id },
      subjectIds: [deal.id],
      href: sheet(domain),
    });
  } else if (deal.stage === "pilot" && endsOn && pw.endsIn !== undefined && pw.endsIn <= ROI_WINDOW_DAYS && !pw.roiBooked) {
    const nowIso = now.toISOString();
    const booked = Object.values(ws.meetings).some((m) => m.dealId === deal.id && m.startsAt > nowIso && /\b(roi|review|readout|results)\b/i.test(m.title));
    if (!booked) {
      out.push({
        id: `mv_pilot_roi_${deal.id}_${endsOn}`,
        kind: "next_step_missing",
        rule: "pilot_roi",
        title: `Book the ROI review with ${champion || company}`,
        why: `${company}'s pilot ends ${pw.endsIn === 0 ? "today" : shortDay(endsOn)} · results vs the baseline, with the economic buyer`,
        minutes: 3,
        priority: RULES.pilot_roi.base * mult,
        ref: { kind: "deal", id: deal.id },
        subjectIds: [deal.id],
        href: sheet(domain),
      });
    }
  }

  if (running) {
    const last = lastDealActivity(ws, deal, now);
    const quiet = daysSince(last, today);
    if (quiet >= PILOT_CHECKIN_DAYS) {
      const day = daysSince(deal.pilot!.startedOn, today) + 1;
      const length = endsOn ? daysBetween(deal.pilot!.startedOn!, endsOn) + 1 : undefined;
      out.push({
        id: `mv_pilot_checkin_${deal.id}_${localDate(last)}`,
        kind: "next_step_missing",
        rule: "pilot_checkin",
        title: `Check in on the ${company} pilot`,
        why: `Day ${day}${length ? ` of ${length}` : ""} · quiet for ${quiet} days · every 2–3 days keeps it on track`,
        minutes: 2,
        priority: RULES.pilot_checkin.base * mult,
        ref: { kind: "deal", id: deal.id },
        subjectIds: [deal.id],
        href: sheet(domain),
      });
    }
  }

  const late = pw.overdue[0];
  const yours = pw.overdue.find((m) => m.ownerSide !== "buyer");
  // Only their steps late and the deal's next step already overdue or missing: the next-step card is the chase.
  const chased = !deal.nextStep?.date || deal.nextStep.date < today;
  if (late && isOpen(deal) && (yours || !chased)) {
    const lead = yours ?? late;
    const days = daysBetween(lead.due, today);
    out.push({
      id: `mv_map_${deal.id}_${lead.id}`,
      kind: "next_step_missing",
      rule: "map_overdue",
      title: yours ? `Do your overdue plan step for ${company}: “${clip(lead.step, 40)}”` : `Check on ${company}'s plan: “${clip(lead.step, 40)}” was due ${shortDay(lead.due)}`,
      why: `${pw.overdue.length > 1 ? `${plural(pw.overdue.length, "plan step")} overdue` : `Due ${shortDay(lead.due)}`} · keep the owners and dates current with them`,
      minutes: 3,
      priority: RULES.map_overdue.base * mult + overdueBoost(Math.floor(days / 3)),
      overdueDays: days,
      ref: { kind: "deal", id: deal.id },
      subjectIds: pw.overdue.map((m) => m.id),
      href: sheet(domain),
    });
  }
}

function upcomingMeeting(ws: Workspace, deal: Deal, now: Date): boolean {
  const nowIso = now.toISOString();
  return Object.values(ws.meetings).some((m) => m.dealId === deal.id && m.startsAt > nowIso);
}

function deals({ ws, now, today, out }: Ctx) {
  const missing: { deal: Deal; cand: Cand }[] = [];
  // A deal waiting on a time they haven't picked is the booking card's (see bookings).
  const awaitingTime = new Set(bookingLoops(ws, now).map((l) => l.dealId));
  for (const deal of Object.values(ws.deals)) {
    const domain = deal.accountDomain;
    const company = companyName(ws, domain);
    // A parked deal comes back on its check-back date. The id carries the date, so re-parking makes a fresh card.
    if (deal.stage === "nurture" && deal.nurtureUntil && deal.nurtureUntil <= today) {
      const overdue = daysBetween(deal.nurtureUntil, today);
      out.push({
        id: `mv_nurture_${deal.id}_${deal.nurtureUntil}`,
        kind: "next_step_missing",
        rule: "nurture",
        title: `Check back with ${company}`,
        why: `Parked until ${shortDay(deal.nurtureUntil)} · reopen it, or close it`,
        minutes: 3,
        priority: RULES.nurture.base + overdueBoost(Math.floor(overdue / 7)),
        overdueDays: overdue || undefined,
        ref: { kind: "deal", id: deal.id },
        subjectIds: [deal.id],
        href: sheet(domain),
      });
      continue;
    }
    if (!isOpen(deal)) continue;
    const mult = stageMult(deal.stage);
    const stage = STAGE_LABELS[deal.stage];

    const dated = deal.nextStep?.date;
    if ((!dated || dated < today) && !awaitingTime.has(deal.id)) {
      const overdue = dated ? daysBetween(dated, today) : 0;
      const without = dated ? overdue : daysSince(deal.lastActivityAt || deal.updatedAt, today);
      const decide = without >= 14;
      missing.push({
        deal,
        cand: {
          id: `mv_nextstep_${deal.id}_${dated ?? "none"}`,
          kind: "next_step_missing",
          rule: "next_step",
          title: decide ? `Decide on ${company}: book it, nurture or close` : `Set a next step for ${company}`,
          why: dated
            ? `${stage} · “${clip(deal.nextStep!.what, 48)}” was due ${shortDay(dated)}`
            : `${stage} · last activity ${ago(deal.lastActivityAt || deal.updatedAt, now)}${decide ? " · no dated next step for 2 weeks" : ""}`,
          minutes: 2,
          priority: RULES.next_step.base * mult + (dated ? overdueBoost(overdue) : overdueBoost(Math.floor(without / 7))),
          overdueDays: overdue || undefined,
          ref: { kind: "deal", id: deal.id },
          subjectIds: [deal.id],
          href: sheet(domain),
        },
      });
    }

    if ((deal.stage === "qualified" || deal.stage === "pilot" || deal.stage === "proposal") && deal.contacts.length <= 1) {
      const only = deal.contacts[0] ? first(ws.people[deal.contacts[0].personId]?.name) : "";
      out.push({
        id: `mv_thread_${deal.id}_${deal.stage}`,
        kind: "next_step_missing",
        rule: "single_threaded",
        title: `Add a second contact at ${company}`,
        why: `${stage} · ${only ? `single-threaded through ${only}` : "no contacts on the deal"} · aim for 3`,
        minutes: 5,
        priority: RULES.single_threaded.base * mult,
        ref: { kind: "deal", id: deal.id },
        href: sheet(domain),
      });
    }

    if (deal.stage === "pilot" && deal.pilot && !deal.pilot.paid && deal.pilot.startedOn && daysSince(deal.pilot.startedOn, today) > 30) {
      out.push({
        id: `mv_unpaid_${deal.id}`,
        kind: "next_step_missing",
        rule: "unpaid",
        title: `Put the ${company} pilot on paid terms`,
        why: `Unpaid for ${daysSince(deal.pilot.startedOn, today)} days · agree a fee or a conversion date`,
        minutes: 5,
        priority: RULES.unpaid.base * mult,
        ref: { kind: "deal", id: deal.id },
        href: sheet(domain),
      });
    }

    // Pilot to paid, where first deals stall: a check-in every few days while it runs, the ROI review booked
    // before the end date, the conversion asked for once it passes, and the plan's dates kept current.
    const pw = pilotWatch(deal, today);
    const running = deal.stage === "pilot" && !!deal.pilot?.startedOn && deal.pilot.startedOn <= today && (pw.endsIn === undefined || pw.endsIn >= 0);
    pilotMoves(ws, deal, pw, running, now, today, out);

    // A dated step ahead doesn't mean the deal is alive: quiet for over a week, with no call booked and the
    // step more than two days out, it gets a one-line check-in that re-confirms the date. (A running pilot has its own cadence.)
    if (!running && dated && dated > addDays(today, 2) && !awaitingTime.has(deal.id) && !upcomingMeeting(ws, deal, now)) {
      const last = lastDealActivity(ws, deal, now);
      const quiet = daysSince(last, today);
      if (quiet > STALL_DAYS) {
        out.push({
          id: `mv_stalled_${deal.id}_${localDate(last)}`,
          kind: "next_step_missing",
          rule: "stalled",
          title: `Check in with ${company}: quiet for ${quiet} days`,
          why: `${stage} · “${clip(deal.nextStep!.what, 40)}” on ${shortDay(dated)} · one line that re-confirms it`,
          minutes: 2,
          priority: RULES.stalled.base * mult + overdueBoost(Math.floor((quiet - STALL_DAYS) / 7)),
          ref: { kind: "deal", id: deal.id },
          subjectIds: [deal.id],
          href: sheet(domain),
        });
      }
    }

    // A close date that keeps moving is a deal losing its reason to happen.
    const pushes = deal.closeDatePushes ?? 0;
    if (pushes >= 2) {
      out.push({
        id: `mv_slipped_${deal.id}_${pushes}`,
        kind: "next_step_missing",
        rule: "slipped",
        title: `${company}'s close date has slipped ${pushes} times`,
        why: `${stage}${deal.closeDate ? ` · now ${shortDay(deal.closeDate)}` : ""} · ask what changed and who else has to say yes`,
        minutes: 5,
        priority: RULES.slipped.base * mult,
        ref: { kind: "deal", id: deal.id },
        subjectIds: [deal.id],
        href: sheet(domain),
      });
    }
  }

  // After the close-out time (16:30 unless Settings says otherwise) the per-deal cards fold into one
  // close-out card with a count. Nothing is blocked.
  const minutes = now.getHours() * 60 + now.getMinutes();
  if (minutes >= closeOutMinutes(ws) && missing.length >= 2) {
    out.push({
      id: `mv_closeout_${today}`,
      kind: "close_out",
      rule: "close_out",
      title: `${missing.length} deals have no dated next step`,
      why: "Fix, park or close each one",
      minutes: Math.min(15, 2 + missing.length),
      priority: RULES.close_out.base + Math.max(...missing.map((m) => m.deal.stage === "proposal" ? 10 : m.deal.stage === "pilot" ? 8 : 0)),
      subjectIds: missing.map((m) => m.deal.id),
    });
  } else {
    for (const m of missing) out.push(m.cand);
  }
}

/** The first three onboarding picked: recorded at hire, else read back from the dossier runs it started. */
export function firstThreeDomains(ws: Workspace): string[] {
  const o = ws.onboarding;
  if (o.firstThree?.length) return o.firstThree;
  return (o.dossierRunIds ?? []).map((id) => ws.runs.find((r) => r.id === id)?.ref).flatMap((ref) => (ref?.kind === "account" ? [ref.id] : []));
}

const FIRST_THREE_DAYS = 21;
const STARTED: Set<string> = new Set(["touch_sent", "pushed", "intro_requested", "linkedin_connect", "linkedin_dm"]);

/**
 * "Here's who I'd talk to first" keeps its promise: one card per company the founder hired Ember to research,
 * whatever the stricter signal rule says, until the first note goes (or three weeks pass). What the card asks
 * follows the dossier's recommendation; the cold draft starts itself once the dossier lands (see ./ahead).
 * Best first, then the network and the plan's questions, then the other two (SPEC §3.2 step 4).
 */
function firstThree(ctx: Ctx) {
  const { ws, today, out } = ctx;
  const o = ws.onboarding;
  if (o.status !== "hired" || !o.hiredAt || daysSince(o.hiredAt, today) > FIRST_THREE_DAYS) return;
  firstThreeDomains(ws).forEach((domain, rank) => {
    const acc = ws.accounts[domain];
    if (!acc || acc.status === "disqualified" || acc.status === "customer" || (acc.dealId && ws.deals[acc.dealId])) return;
    if (ws.activities.some((a) => a.accountDomain === domain && STARTED.has(a.kind) && a.outcome !== "not_sent")) return;
    const person = bestPerson(ws, acc);
    if (isSuppressed(ws, person, domain)) return;
    const rec = acc.dossier?.recommendation;
    // A draft of the recommended kind takes over the card (a cold draft keeps its id; LinkedIn and intro drafts have their own cards).
    const hasDraft = (mode: OutreachPackage["mode"]) =>
      Object.values(ws.outreach).some((p) => p.mode === mode && p.accountDomain === domain && p.createdAt >= o.hiredAt! && p.steps.some((st) => st.status === "draft"));
    if (hasDraft("cold") || (rec?.move === "linkedin_first" && hasDraft("linkedin")) || (rec?.move === "warm_intro" && hasDraft("warm_intro"))) {
      ctx.firstThree.add(domain);
      return;
    }
    ctx.firstThree.add(domain);
    const sig = topSignal(acc, today, 60);
    const titled = acc.dossier?.committee.find((m) => m.role === "champion")?.likelyTitles[0] ?? acc.suggestedTitle;
    const who = first(person?.name) || (titled ? `the ${titled}` : "the right person");
    const because = sig ? `${clip(sig.headline, 60)} · ${ageShort(sig.date, today)}` : (acc.whyNow ? clip(acc.whyNow, 70) : `${acc.tier}-tier fit`);
    const base = {
      id: `mv_first_${domain}`,
      rule: "first_three" as const,
      minutes: 5,
      // The best one leads the desk; the other two follow the network and the questions.
      priority: rank === 0 ? RULES.first_three.base : 46 - rank,
      ref: person ? { kind: "person" as const, id: person.id } : { kind: "account" as const, id: domain },
      source: sig ? { url: sig.url, date: sig.date } : undefined,
      evidenceIds: sig?.evidenceId ? [sig.evidenceId] : undefined,
      href: sheet(domain),
    };
    if (!acc.dossier) {
      out.push({ ...base, kind: "first_touch", title: `Write to ${who} at ${acc.name}`, why: `${because} · researching first, then the draft` });
    } else if (rec?.move === "warm_intro") {
      out.push({ ...base, kind: "intro_ask", title: `Ask for an intro to ${who} at ${acc.name}`, why: `${acc.warmPathCount ? `${plural(acc.warmPathCount, "person", "people")} you know there` : "A warm path beats cold here"} · ${clip(rec.why, 60)}` });
    } else if (rec?.move === "linkedin_first") {
      out.push({ ...base, kind: "linkedin", title: `Connect with ${who} at ${acc.name} on LinkedIn`, why: `${clip(rec.why, 70)} · doesn't count toward your email cap` });
    } else if (rec?.move === "reply_in_thread" && sig) {
      out.push({ ...base, kind: "signal", title: `Answer the thread on ${sig.host}`, why: `${because} · reply there, not by email`, href: sig.url });
    } else if (rec?.move === "watch") {
      out.push({ ...base, kind: "research", minutes: 1, title: `Keep watching ${acc.name}`, why: `Not yet · ${clip(rec.why, 80)}` });
    } else if (rec?.move === "disqualify") {
      out.push({ ...base, kind: "research", minutes: 1, title: `${acc.name} may not be a fit`, why: clip(rec.why, 90) });
    } else {
      out.push({ ...base, kind: "first_touch", title: `Write to ${who} at ${acc.name}`, why: `${because} · draft on its way` });
    }
  });
}

/** Cold drafts ready to approve, then fresh signals worth a first touch, all inside the daily/weekly cap. */
function firstTouches({ ws, today, c, out, firstThree: covered }: Ctx) {
  let quota = coldQuotaLeft(ws, c);
  const perAccountCap = ws.caps.contactsPerAccountPerWeek;
  const accountFull = (domain: string, personId?: string) => {
    const set = c.peopleThisWeek.get(domain);
    return !!set && set.size >= perAccountCap && !(personId && set.has(personId));
  };

  const ready = Object.values(ws.outreach)
    .filter((p) => p.mode === "cold" && p.steps.find((s) => s.step === 1)?.status === "draft")
    .sort((a, b) => (ws.accounts[b.accountDomain]?.fitScore ?? 0) - (ws.accounts[a.accountDomain]?.fitScore ?? 0));
  for (const pkg of ready) {
    if (quota <= 0) break;
    const person = pkg.personId ? ws.people[pkg.personId] : undefined;
    if (isSuppressed(ws, person, pkg.accountDomain) || accountFull(pkg.accountDomain, pkg.personId)) continue;
    const acc = ws.accounts[pkg.accountDomain];
    const sig = acc ? topSignal(acc, today) : undefined;
    const angle = angleTitle(ws, pkg.accountDomain, pkg.steps[0]?.angleId ?? pkg.angleId);
    // A draft written from a signal card keeps that card's id, so the card stays put while it fills in (a
    // first-three card's draft too).
    const origin = acc ? freshSignal(acc, today) : undefined;
    const fromFirstThree = firstThreeDomains(ws).includes(pkg.accountDomain) && !!ws.onboarding.hiredAt && pkg.createdAt >= ws.onboarding.hiredAt;
    quota--;
    out.push({
      id: fromFirstThree ? `mv_first_${pkg.accountDomain}` : origin && localDate(pkg.createdAt) >= origin.date ? `mv_signal_${acc!.domain}_${origin.id}` : `mv_draft_${pkg.id}_1`,
      kind: "first_touch",
      rule: "cold_draft",
      title: `Write to ${first(person?.name) || "the buyer"} at ${companyName(ws, pkg.accountDomain)}`,
      why: sig ? `${clip(sig.headline, 70)} · ${ageShort(sig.date, today)}` : angle ? `Draft ready · angle: ${angle}` : "Draft ready",
      minutes: 3,
      priority: RULES.cold_draft.base + (acc?.tier === "A" ? 3 : 0),
      ref: pkg.personId ? { kind: "person", id: pkg.personId } : { kind: "account", id: pkg.accountDomain },
      draft: { packageId: pkg.id, step: 1 },
      source: sig ? { url: sig.url, date: sig.date } : undefined,
      evidenceIds: sig?.evidenceId ? [sig.evidenceId] : undefined,
      href: sheet(pkg.accountDomain),
    });
  }

  const pkgsByAccount = new Map<string, OutreachPackage[]>();
  for (const p of Object.values(ws.outreach)) pkgsByAccount.set(p.accountDomain, [...(pkgsByAccount.get(p.accountDomain) ?? []), p]);

  const fresh = Object.values(ws.accounts)
    // Nurture deals come back through the nurture rule on their date, not as fresh cold targets.
    .filter((a) => a.status !== "disqualified" && a.status !== "customer" && !openDealFor(ws, a.domain) && ws.deals[a.dealId ?? ""]?.stage !== "nurture")
    .map((acc) => ({ acc, s: freshSignal(acc, today) }))
    .filter((x): x is { acc: (typeof x)["acc"]; s: NonNullable<(typeof x)["s"]> } => !!x.s)
    .sort((x, y) => y.s.strength - x.s.strength || y.s.date.localeCompare(x.s.date));
  const used = new Set<string>();
  for (const { acc, s } of fresh) {
    if (used.has(acc.domain) || covered.has(acc.domain)) continue;
    // Already drafted since the signal, or touched in the last 60 days: recycle only after 60 days AND a new signal.
    const busy = (pkgsByAccount.get(acc.domain) ?? []).some((p) => localDate(p.createdAt) >= s.date || daysSince(p.createdAt, today) <= 60);
    if (busy) continue;
    const person = bestPerson(ws, acc);
    if (isSuppressed(ws, person, acc.domain)) continue;
    const name = first(person?.name);
    const company = acc.name;

    if (s.type === "community_request") {
      used.add(acc.domain);
      out.push({
        id: `mv_signal_${acc.domain}_${s.id}`,
        kind: "signal",
        rule: "signal",
        title: `Answer the thread on ${s.host}`,
        why: `${clip(s.headline, 70)} · ${ageShort(s.date, today)} · reply there, not by email`,
        minutes: 5,
        priority: RULES.signal.base,
        ref: { kind: "account", id: acc.domain },
        source: { url: s.url, date: s.date },
        evidenceIds: s.evidenceId ? [s.evidenceId] : undefined,
        href: s.url,
      });
      continue;
    }
    const champion = s.type === "champion_job_change";
    // Champion moves are warm; everything else needs a tracked A-tier account with a dossier and quota left.
    if (!champion) {
      if (acc.tier !== "A" || !(acc.watch || acc.status === "tracked") || !acc.dossier || acc.warmPathCount > 0) continue;
      if (quota <= 0 || accountFull(acc.domain, person?.id)) continue;
      quota--;
    }
    used.add(acc.domain);
    const who = name || acc.dossier?.committee.find((m) => m.role === "champion")?.likelyTitles[0] || "the right person";
    out.push({
      id: `mv_signal_${acc.domain}_${s.id}`,
      kind: "first_touch",
      rule: "signal",
      title: `Write to ${who} at ${company}`,
      why: `${clip(s.headline, 70)} · ${ageShort(s.date, today)}${champion ? " · they know you" : ""}`,
      minutes: 4,
      priority: (champion ? 68 : RULES.signal.base) + (s.strength === 3 ? 5 : 0),
      ref: person ? { kind: "person", id: person.id } : { kind: "account", id: acc.domain },
      source: { url: s.url, date: s.date },
      evidenceIds: s.evidenceId ? [s.evidenceId] : undefined,
      href: sheet(acc.domain),
    });
  }
}

const INTRO_RULE: Record<IntroAction, RuleKey> = {
  reply: "intro_reply",
  send_intro: "intro_send",
  close_loop: "intro_close_loop",
  nudge: "intro_nudge",
  check_in: "intro_check_in",
  book: "intro_book",
  check_how: "intro_check_how",
  thank: "intro_thank",
  let_go: "intro_let_go",
};

/** Intro follow-through: one card per founder move, from the same rules as the Intros page. */
function introFollowThrough({ ws, today, out }: Ctx) {
  for (const { intro, next } of yourMoves(ws, today)) {
    const action = next.action!;
    const c = first(intro.connectorName) || "your connector";
    const t = targetLabel(intro);
    const company = intro.accountDomain ? companyName(ws, intro.accountDomain) : undefined;
    const about = company && !intro.targetName.toLowerCase().includes(company.toLowerCase()) ? `${t} at ${company}` : intro.targetName.replace(/^the /, "");
    const [a, b] = intro.sides ?? [];
    const sideName = next.side !== undefined && intro.sides ? first(intro.sides[next.side].name) : "";
    const otherName = next.side !== undefined && intro.sides ? first(intro.sides[next.side === 0 ? 1 : 0].name) : "";
    const title =
      intro.kind === "give"
        ? action === "send_intro"
          ? `Introduce ${first(a?.name)} and ${first(b?.name)}`
          : action === "check_how"
            ? `Ask ${first(a?.name)} and ${first(b?.name)} how it went`
            : action === "let_go"
              ? `Let the ${sideName} and ${otherName} intro go`
              : next.side !== undefined && !intro.sides?.[next.side].askedOn
                ? `Ask ${sideName} about meeting ${otherName}`
                : `Nudge ${sideName} about meeting ${otherName}`
        : {
            reply: `Reply to ${c}'s intro to ${t}`,
            nudge: `Nudge ${c} about ${about}`,
            check_in: `Check in with ${c} about ${t}`,
            let_go: `Let the ${company ?? about} ask go`,
            book: `Follow up with ${t} to book`,
            close_loop: `Tell ${c} how it went with ${t}`,
            thank: `Thank ${c} for checking`,
            send_intro: "",
            check_how: "",
          }[action];
    const why =
      intro.kind === "give"
        ? action === "send_intro"
          ? "Both said yes · double opt-in done, send it today"
          : action === "check_how"
            ? `Introduced ${when(intro.introducedOn ?? today, today)} · a reason to stay in touch`
            : "Double opt-in: nothing moves until both say yes"
        : {
            reply: `Intro made ${when(intro.introducedOn ?? today, today)} · reply within a day, ${c} to BCC`,
            nudge: `Asked ${when(intro.askedOn, today)} · one nudge, never two`,
            check_in: `${c} checked with ${t} ${when(intro.forwardedOn ?? intro.askedOn, today)}`,
            let_go: `No answer since your nudge ${when(intro.nudgedOn ?? intro.askedOn, today)} · close it kindly, try another way in`,
            book: `You replied ${when(intro.repliedOn ?? today, today)}, no time picked yet`,
            close_loop: `Connectors who hear back introduce again`,
            thank: `${c} checked for you · say thanks either way`,
            send_intro: "",
            check_how: "",
          }[action];
    const rule = INTRO_RULE[action];
    out.push({
      id: `mv_intro_${intro.id}_${action}${next.side !== undefined ? `_${next.side}` : ""}`,
      kind: "intro_ask",
      rule,
      title,
      why,
      minutes: action === "send_intro" || action === "reply" ? 3 : 2,
      priority: RULES[rule].base + overdueBoost(next.overdueDays ?? 0) / 3,
      ref: intro.personId ? { kind: "person", id: intro.personId } : intro.accountDomain ? { kind: "account", id: intro.accountDomain } : undefined,
      subjectIds: [intro.id],
      overdueDays: next.overdueDays,
      href: `/intros?i=${encodeURIComponent(intro.id)}`,
    });
  }
}

const RELATIONSHIP: Record<string, string> = {
  investor: "Investor",
  angel: "Angel",
  advisor: "Advisor",
  customer: "Customer",
  friend: "Friend",
  ex_colleague: "Ex-colleague",
  connection: "LinkedIn connection",
};

function warmPaths({ ws, today, weekStart, c, out, firstThree: covered }: Ctx) {
  const asks = c.introAsksThisWeek;
  // The plan's number (Playbook → Plan), not a constant: raising intro asks there keeps these cards up.
  const askTarget = introAsksTarget(ws);
  const quotaMet = asks >= askTarget;
  const recentPkg = (domain: string) => Object.values(ws.outreach).some((p) => p.accountDomain === domain && daysSince(p.createdAt, today) <= 30) || !!openIntroFor(ws, domain);
  const prospects = Object.values(ws.accounts)
    // Any deal, open or closed, rules a company out: open ones have their own moves, and lost or nurture ones aren't intro targets.
    .filter((a) => (a.tier === "A" || a.tier === "B") && a.status !== "disqualified" && a.status !== "customer" && !(a.dealId && ws.deals[a.dealId]) && !recentPkg(a.domain) && !covered.has(a.domain))
    .sort((a, b) => b.fitScore - a.fitScore);

  // A first-touch card already covers the account (a champion who moved, a draft): don't add an intro ask on top.
  const firstTouch = (domain: string) =>
    out.some((x) => x.kind === "first_touch" && x.ref && (x.ref.kind === "account" ? x.ref.id === domain : x.ref.kind === "person" && ws.people[x.ref.id]?.accountDomain === domain));
  for (const acc of prospects.filter((a) => a.warmPathCount > 0 && !firstTouch(a.domain)).slice(0, 3)) {
    const sig = topSignal(acc, today, 30);
    const target = bestPerson(ws, acc);
    if (isSuppressed(ws, target, acc.domain)) continue;
    if (knowsDirectly(target)) {
      // The founder knows them: an intro ask would be pointless. Write to them directly, in their own words.
      const name = first(target!.name);
      out.push({
        id: `mv_warm_${acc.domain}`,
        kind: "first_touch",
        rule: "warm_path",
        title: `Write to ${name} at ${acc.name}`,
        why: `You know ${name} · warm path${sig ? ` · ${clip(sig.headline, 50)}` : ""}`,
        minutes: 4,
        priority: RULES.warm_path.base + (acc.tier === "A" ? 2 : 0),
        ref: { kind: "person", id: target!.id },
        source: sig ? { url: sig.url, date: sig.date } : undefined,
        href: sheet(acc.domain),
      });
      continue;
    }
    out.push({
      id: `mv_warm_${acc.domain}`,
      kind: "intro_ask",
      rule: "warm_path",
      title: `Use your warm path into ${acc.name}`,
      why: `${plural(acc.warmPathCount, "person", "people")} you know there${sig ? ` · ${clip(sig.headline, 50)}` : ""} · ${asks} of ${askTarget} intro asks this week`,
      minutes: 4,
      priority: quotaMet ? 40 : RULES.warm_path.base + (acc.tier === "A" ? 2 : 0),
      // Name who the intro is for, so the ask isn't drafted blind.
      ref: target ? { kind: "person", id: target.id } : { kind: "account", id: acc.domain },
      source: sig ? { url: sig.url, date: sig.date } : undefined,
      href: sheet(acc.domain),
    });
  }

  if (quotaMet || !ws.connectors.length) return;
  const target = prospects.find((a) => a.warmPathCount === 0);
  if (!target) return;
  // Only a connector the ledger says is ready: no open ask, rested two weeks, not owed a give first.
  const connector = [...ws.connectors]
    .filter((x) => x.relationship !== "connection" && ledger(ws, x, today).status === "ready")
    .sort((a, b) => (ledger(ws, a, today).lastAskedOn ?? "").localeCompare(ledger(ws, b, today).lastAskedOn ?? ""))[0];
  if (!connector) return;
  out.push({
    id: `mv_connector_${connector.id}_${weekStart}`,
    kind: "intro_ask",
    rule: "connector",
    title: `Ask ${first(connector.name)} for an intro to ${target.name}`,
    why: `${RELATIONSHIP[connector.relationship] ?? "Connector"} · ${asks} of ${askTarget} intro asks this week`,
    minutes: 4,
    priority: RULES.connector.base,
    ref: { kind: "account", id: target.domain },
    subjectIds: [connector.id],
    href: sheet(target.domain),
  });
}

/** Just-in-time setup: only what the next real move needs. */
function setup({ ws, now, today, weekStart, out, firstThree: covered }: Ctx) {
  const accounts = Object.values(ws.accounts).filter((a) => a.status !== "disqualified");
  const anyDossier = accounts.some((a) => a.dossier);

  // Research the top accounts that have no dossier yet (the first three have their own cards).
  const research = accounts
    .filter((a) => !a.dossier && !a.dealId && !covered.has(a.domain) && (a.tier === "A" || !anyDossier) && (a.watch || a.status === "tracked" || a.status === "new"))
    .sort((a, b) => b.fitScore - a.fitScore)
    .slice(0, 3);
  for (const acc of research) {
    const sig = topSignal(acc, today, 60);
    out.push({
      id: `mv_research_${acc.domain}`,
      kind: "research",
      rule: "research",
      title: `Research ${acc.name}`,
      why: `${sig ? `${clip(sig.headline, 60)} · ${ageShort(sig.date, today)}` : acc.whyNow ? clip(acc.whyNow, 70) : `${acc.tier}-tier fit`} · dossier in about 2 min`,
      minutes: 1,
      priority: RULES.research.base + (sig && sig.strength >= 2 ? 6 : 0) + (anyDossier ? 0 : 8),
      ref: { kind: "account", id: acc.domain },
      source: sig ? { url: sig.url, date: sig.date } : undefined,
      href: sheet(acc.domain),
    });
  }

  // While the first three are on the desk their drafts ask for it inline, just in time (SPEC §3.2): no card on top.
  const needsPov = !ws.povs.length && !covered.size && (Object.values(ws.outreach).some((p) => p.mode === "cold") || accounts.some((a) => a.dossier && a.tier === "A"));
  if (needsPov) {
    out.push({
      id: "mv_setup_pov",
      kind: "setup",
      rule: "pov",
      title: "Write down one opinion only you hold",
      why: "Cold drafts lean on a first-hand point of view, and only you have one",
      minutes: 2,
      priority: RULES.pov.base,
    });
  }

  if (ws.onboarding.status === "hired") {
    // Warm before cold: who already knows the founder, and who their investors and advisors can reach. Without
    // either, intros never start (the connector card needs a connector), so this ranks above cold touches; while
    // the first three are on the desk it sits second, as on arrival (SPEC §3.2 step 4).
    const noConnectors = !ws.connectors.some((x) => x.relationship !== "connection");
    const warmRank = covered.size ? 48 : RULES.network.base;
    if (!ws.network && noConnectors) {
      out.push({
        id: "mv_network",
        kind: "import",
        rule: "network",
        title: "Bring in your network",
        why: "Warm intros beat cold email · your LinkedIn connections, and who your investors and advisors know",
        minutes: 5,
        priority: warmRank,
        href: "/integrations?import=linkedin",
      });
    } else {
      if (noConnectors) {
        out.push({
          id: "mv_setup_connectors",
          kind: "setup",
          rule: "connectors",
          title: "Add your investors and advisors",
          why: "2 minutes · say who each can reach, and I'll match them to the companies you want",
          minutes: 2,
          priority: warmRank,
          href: "/intros",
        });
      }
      if (!ws.network) {
        out.push({
          id: "mv_import_linkedin",
          kind: "import",
          rule: "import",
          title: "Import your LinkedIn connections",
          why: "Finds people you already know at the companies you want to reach",
          minutes: 3,
          // Warm before cold: matters most while the list is short.
          priority: accounts.length <= 10 ? 48 : RULES.import.base,
          href: "/integrations?import=linkedin",
        });
      } else if (daysSince(ws.network.importedAt, today) > 30) {
        out.push({
          id: `mv_import_${monthKey(now)}`,
          kind: "import",
          rule: "import",
          title: "Re-import your LinkedIn connections",
          why: `Last import ${ago(ws.network.importedAt, now)} · finds champions who changed jobs`,
          minutes: 3,
          priority: RULES.import.base,
          href: "/integrations?import=linkedin",
        });
      }
    }
  }

  // Weekly discovery top-up: keep at least 10 untouched A/B prospects ready.
  if (accounts.length) {
    const touched = new Set(Object.values(ws.outreach).map((p) => p.accountDomain));
    const untouched = accounts.filter((a) => (a.tier === "A" || a.tier === "B") && (a.status === "new" || a.status === "tracked") && !touched.has(a.domain) && !a.dealId).length;
    if (untouched < 10) {
      out.push({
        id: `mv_discover_${weekStart}`,
        kind: "research",
        rule: "discover",
        title: `Find ${10 - untouched} more companies to talk to`,
        why: `${plural(untouched, "untouched A or B prospect", "untouched A and B prospects")} left · keep 10 ready`,
        minutes: 2,
        priority: RULES.discover.base,
      });
    }
  }
}

/** What an offered resource is, as an asset: the lint's word ("teardown") → the Playbook kind that covers it. */
const ASSET_FOR: [RegExp, Asset["kind"], string][] = [
  [/one-?pager|one pager|deck|slides|pdf/, "one_pager", "one-pager"],
  [/demo|video|loom|recording/, "demo_script", "demo"],
  [/case study/, "case_study", "case study"],
  [/terms/, "design_partner_terms", "design-partner terms"],
  [/./, "insight", "write-up"],
];

/**
 * W6 "a CTA needs an asset that doesn't exist yet": open drafts that offer a one-pager, a demo or a
 * write-up with no approved asset of that kind to point at. One card per kind; writing it once fixes every draft.
 */
function missingAssets({ ws, today, out }: Ctx) {
  const byKind = new Map<Asset["kind"], { label: string; word: string; pkgs: OutreachPackage[] }>();
  for (const pkg of Object.values(ws.outreach)) {
    if (daysSince(pkg.createdAt, today) > 30) continue;
    const person = pkg.personId ? ws.people[pkg.personId] : undefined;
    if (isSuppressed(ws, person, pkg.accountDomain)) continue;
    const word = pkg.steps.filter((st) => st.status === "draft" && !st.assetId).map((st) => offeredResource(st.body)).find(Boolean);
    if (!word) continue;
    const [, kind, label] = ASSET_FOR.find(([re]) => re.test(word))!;
    if (ws.assets.some((a) => a.kind === kind && a.approved)) continue;
    const entry = byKind.get(kind) ?? { label: kind === "insight" ? word : label, word, pkgs: [] };
    entry.pkgs.push(pkg);
    byKind.set(kind, entry);
  }
  for (const [kind, { label, pkgs }] of byKind) {
    const a = aOrAn(label);
    out.push({
      id: `mv_asset_${kind}`,
      kind: "setup",
      rule: "asset",
      title: pkgs.length === 1 ? `Make the ${label} your ${companyName(ws, pkgs[0].accountDomain)} draft offers` : `${pkgs.length} drafts offer ${a} ${label} you don't have yet`,
      why: "Write it once and approve it, and every draft can attach it · or drop the offer",
      minutes: 15,
      priority: RULES.asset.base,
      subjectIds: pkgs.map((p) => p.id),
      href: `/playbook?new=${kind}`,
    });
  }
}

function events({ ws, today, out }: Ctx) {
  for (const ev of Object.values(ws.events)) {
    if (ev.status === "done" || ev.status === "cancelled" || !ev.plan) continue;
    ev.plan.timeline.forEach((task, i) => {
      if (task.done || task.owner === "ember" || !task.due || task.due > today) return;
      const overdue = daysBetween(task.due, today);
      out.push({
        id: `mv_event_${ev.id}_${i}`,
        kind: "event_task",
        rule: "event_task",
        title: clip(task.task, 90),
        why: `${ev.title} · ${overdue > 0 ? `was due ${shortDay(task.due)}` : "due today"}${task.owner === "cohost" ? " · co-host's task, check in" : ""}`,
        minutes: 10,
        priority: RULES.event_task.base + overdueBoost(overdue),
        overdueDays: overdue || undefined,
        ref: { kind: "event", id: ev.id },
        subjectIds: [String(i)],
        href: `/events/${encodeURIComponent(ev.id)}?tab=timeline`,
      });
    });
  }
}

/**
 * An upcoming dinner with people nearby the founder knows (or is already selling to) who aren't on
 * the guest list. Places come from the built-in city list only, so this stays pure and offline.
 */
function dinnerNeighbors({ ws, today, out }: Ctx) {
  const dinners = Object.values(ws.events).filter((ev) => ev.kind === "dinner" && ev.plan && ev.status !== "done" && ev.status !== "cancelled");
  if (!dinners.length) return;
  const { points } = leadPoints(ws, resolvePlace);
  for (const ev of dinners) {
    const day = ev.date?.slice(0, 10) ?? ev.plan?.targetDate;
    if (!day || day < today || daysBetween(today, day) > 45) continue;
    const place = ev.location ?? (() => {
      const p = resolvePlace(ev.venue?.address) ?? resolvePlace(ev.plan?.city) ?? resolvePlace(ev.request?.city);
      return p ? { label: placeLabel(p), lat: p.lat, lng: p.lng, radiusKm: 25 * 1.609344 } : null;
    })();
    if (!place) continue;
    const listed = new Set(Object.values(ev.guests).map((g) => g.personId).filter(Boolean));
    const missing = nearby(points, place, place.radiusKm).filter((p) => p.personId && !listed.has(p.personId) && p.group !== "customer" && (p.warm || p.group === "pipeline"));
    if (missing.length < 2) continue;
    const city = place.label.split(",")[0];
    const names = missing.slice(0, 2).map((p) => first(p.name));
    out.push({
      id: `mv_event_nearby_${ev.id}`,
      kind: "event_task",
      rule: "event_nearby",
      title: `${plural(missing.length, "warm lead")} near your ${city} dinner ${missing.length === 1 ? "isn't" : "aren't"} invited`,
      why: `${names.join(", ")}${missing.length > 2 ? ` and ${missing.length - 2} more` : ""} · ${shortDay(day)} · people you know fill seats first`,
      minutes: 3,
      // Invites go out three to four weeks ahead: inside 30 days, the seats are being decided now.
      priority: RULES.event_nearby.base + (daysBetween(today, day) <= 30 ? 10 : 0) + Math.min(5, missing.length),
      ref: { kind: "event", id: ev.id },
      subjectIds: missing.slice(0, 8).map((p) => p.personId!),
      href: `/events/${encodeURIComponent(ev.id)}?tab=nearby`,
    });
  }
}

/** What tracked companies have in common, as a live question for a room (W11 themes). */
const ROOM_THEME: Partial<Record<SignalType, string>> = {
  first_hire: "are making a first hire for the job you do",
  hiring: "are hiring for the problem you solve",
  jd_names_pain: "have job posts that name the pain",
  funding: "raised in the last two months",
  new_leader: "have a new leader in the seat",
  launch: "just launched",
  stack_change: "are changing their stack",
  compliance_deadline: "face a compliance deadline",
  persona_post: "wrote about the problem in public",
  public_pain: "complained about the problem in public",
  filing: "filed something new",
};
const ROOM_THEME_MIN = 6;
const ROOM_CITY_MIN = 8;

/**
 * Monday's room suggestion (W11 triggers, §5.2): six or more tracked A/B companies sharing a theme make a
 * virtual roundtable; eight or more in one city make a dinner, but only with a co-host or a customer to host.
 * Shown through the week; never while a room is already being planned.
 */
function roomSuggestion({ ws, today, weekStart, out }: Ctx) {
  const live = Object.values(ws.events).some((e) => e.status !== "done" && e.status !== "cancelled");
  if (live || Object.values(ws.events).some((e) => daysSince(e.createdAt, today) <= 30)) return;
  const tracked = Object.values(ws.accounts).filter(
    (a) => (a.tier === "A" || a.tier === "B") && a.status !== "disqualified" && a.status !== "customer" && (a.watch || a.status === "tracked" || a.status === "in_pipeline"),
  );

  const byTheme = new Map<SignalType, number>();
  for (const acc of tracked) {
    const types = new Set(acc.signals.filter((sg) => sg.usableInOutreach && sg.date && daysSince(sg.date, today) <= 60 && ROOM_THEME[sg.type]).map((sg) => sg.type));
    for (const t of types) byTheme.set(t, (byTheme.get(t) ?? 0) + 1);
  }
  const theme = [...byTheme.entries()].sort((a, b) => b[1] - a[1])[0];

  const host =
    ws.connectors.find((c) => c.relationship === "investor" || c.relationship === "customer") ??
    (Object.values(ws.accounts).some((a) => a.status === "customer") || Object.values(ws.deals).some((d) => d.stage === "won") ? { name: "a customer" } : undefined);
  const domains = new Set(tracked.map((a) => a.domain));
  const { points } = leadPoints(ws, resolvePlace);
  const city = host ? metros(points.filter((p) => domains.has(p.domain))).find((m) => m.companies >= ROOM_CITY_MIN) : undefined;
  // Start virtual: a dinner first only for a founder who has already hosted a room, or when no theme holds six.
  const hosted = Object.values(ws.events).some((e) => e.status === "done");
  const roundtable = theme && theme[1] >= ROOM_THEME_MIN && (!city || !hosted);

  if (roundtable) {
    out.push({
      id: `mv_room_${weekStart}`,
      kind: "event_task",
      rule: "room",
      title: `Host a roundtable: ${theme[1]} of your tracked companies ${ROOM_THEME[theme[0]]}`,
      why: "6–8 peers on one live question · 60 minutes, virtual · no pitch",
      minutes: 5,
      priority: RULES.room.base,
      href: "/events?new=1",
    });
  } else if (city && host) {
    const place = city.place.split(",")[0];
    out.push({
      id: `mv_room_${weekStart}`,
      kind: "event_task",
      rule: "room",
      title: `Plan a dinner in ${place}: ${city.companies} of your target companies are there`,
      why: `${host.name === "a customer" ? "A customer could host" : `${first(host.name)} could co-host`} · 8–10 seats, open deals first`,
      minutes: 5,
      priority: RULES.room.base,
      href: `/events?new=1&city=${encodeURIComponent(place)}`,
    });
  }
}

/** Founder questions per card at a time. */
export const QUESTIONS_PER_CARD = 3;

/**
 * Open founder questions, folded into one card ("Answer 3 questions that change the plan") instead of a card
 * each: day one is for companies, not homework. The id follows the newest question, so answering inside the card
 * keeps it, and a skip holds until the plan asks something new. Onboarding week ranks it after the first company.
 */
function questions({ ws, today, out }: Ctx) {
  const all = ws.foundation?.founderQuestions ?? [];
  const open = all.filter((q) => !q.answer);
  if (!open.length) return;
  const n = Math.min(QUESTIONS_PER_CARD, open.length);
  const onboardingWeek = !!ws.onboarding.hiredAt && daysSince(ws.onboarding.hiredAt, today) <= 7;
  out.push({
    id: `mv_questions_${all[all.length - 1].id}`,
    kind: "question",
    rule: "questions",
    title: n === 1 ? `Answer: ${clip(open[0].question, 90)}` : `Answer ${n} questions that change the plan`,
    why: n === 1 ? clip(open[0].whyItMatters, 110) : "Your answers move the bet more than anything on your site",
    minutes: n,
    priority: RULES.questions.base + (onboardingWeek ? 12 : 0),
    subjectIds: open.slice(0, n).map((q) => q.id),
    ref: { kind: "playbook", id: open[0].id },
  });
}

/** Monday pipeline review all week until done; Friday learning review from 14:00 Friday through Sunday. */
function reviews({ ws, now, today, weekStart, out }: Ctx) {
  const dow = (now.getDay() + 6) % 7; // 0 = Monday
  const open = Object.values(ws.deals).filter(isOpen);
  const recentTouches = ws.activities.filter((a) => a.kind === "touch_sent" && daysSince(a.at, today) <= 14).length;
  if (open.length || recentTouches) {
    const noStep = open.filter((d) => !d.nextStep?.date || d.nextStep.date < today).length;
    out.push({
      id: `mv_review_monday_${weekStart}`,
      kind: "review",
      rule: "review_monday",
      title: "Monday pipeline review",
      why: `${plural(open.length, "open deal")} · ${noStep} without a dated next step`,
      minutes: 25,
      priority: RULES.review_monday.base - dow * 6,
    });
  }
  const fridayOpen = (dow === 4 && now.getHours() >= 14) || dow >= 5;
  if (!fridayOpen) return;
  const thisWeek = ws.activities.filter((a) => localDate(a.at) >= weekStart);
  const replies = thisWeek.filter((a) => a.kind === "reply_received").length;
  const touches = thisWeek.filter((a) => a.kind === "touch_sent").length;
  if (!replies && !touches && !Object.values(ws.meetings).some((m) => localDate(m.startsAt) >= weekStart && localDate(m.startsAt) <= today)) return;
  out.push({
    id: `mv_review_friday_${weekStart}`,
    kind: "review",
    rule: "review_friday",
    title: "Friday learning review",
    why: replies ? `${plural(replies, "reply", "replies")} to read · ${plural(touches, "touch", "touches")} this week` : `${plural(touches, "touch", "touches")} this week · no replies yet`,
    minutes: 20,
    priority: RULES.review_friday.base,
  });
}

/**
 * The weekly optional post (§5.2): last Friday's review drafted one from the founder's own material. It's
 * offered the week after, until it's copied or dismissed, and never more than one a week.
 */
function weeklyPost({ ws, weekStart, out }: Ctx) {
  const review = ws.briefs[`${addDays(weekStart, -7)}:friday`];
  const post = review?.proposals?.find((p) => p.status === "open" && p.kind === "note" && !!p.text && (p.post || p.title.startsWith("Post draft:")));
  if (!post) return;
  out.push({
    id: `mv_post_${post.id}`,
    kind: "post",
    rule: "post",
    title: "Post last week's best insight",
    why: `“${clip(post.title.replace(/^Post draft:\s*/, ""), 60)}” · from your own material · optional`,
    minutes: 5,
    priority: RULES.post.base,
    subjectIds: [post.id],
  });
}

/** Kind → display order for "Later", grouped. */
export const KIND_ORDER: MoveKind[] = [
  "reply",
  "check_replies",
  "meeting_prep",
  "debrief",
  "follow_up",
  "first_touch",
  "intro_ask",
  "linkedin",
  "next_step_missing",
  "close_out",
  "signal",
  "review",
  "research",
  "event_task",
  "question",
  "setup",
  "import",
  "post",
];

