import { pilotWatch } from "@/lib/deals/rules";
import { addDays, daysBetween, todayISO, weekOf } from "@/lib/domain/ids";
import { STAGE_LABELS, type Activity, type Deal, type LossReason, type ReviewProposal, type Stage, type Workspace } from "@/lib/domain/types";
import { SEND_KINDS, activeBet, betReadout, type BetReadout } from "@/lib/learning/bets";
import { sendChannel } from "@/lib/learning/tags";
import { coldFirstTouches } from "@/lib/quality/cap";
import { conversationsBetween, conversationsTarget, counters, goalWins, introAsksTarget, isColdFirstTouch, isQualified, sampleLabel } from "./scoreboard";
import { clip, companyName, daysSince, first, isOpen, localDate } from "./util";

/**
 * Everything a weekly review states as a number is computed here, in code. The model only selects,
 * explains and proposes. Rates hide below n=20; win rate and coverage hide until 10 closed deals;
 * dollars hide until a price has been quoted.
 */

export interface Diagnosis {
  stage: string;
  metric: string;
  value: number; // 0–1
  n: number;
  recommendation: string;
}

export interface DealFact {
  alias: string;
  dealId: string;
  domain: string;
  company: string;
  stage: Stage;
  line: string;
  flags: string[];
  daysWithoutDatedStep: number;
}

export interface PipelineData {
  weekOf: string;
  snapshot: { qualified: number; qualifiedUsd: number | null; open: number; missingNextStep: number; closed: number; winRate: number | null; coverage: number | null };
  deals: DealFact[];
  candidates: DealFact[];
  singleThreaded: DealFact[];
  overdue: DealFact[];
  targets: { conversations: number; coldFirstTouches: number; introAsks: number; eventActions: string[] };
  lastWeek: { conversations: number; coldFirstTouches: number; introAsks: number; replies: number; positiveReplies: number };
  diagnosis: Diagnosis | null;
  tooEarly: string;
}

const RISK_ORDER: Stage[] = ["proposal", "pilot", "qualified", "talking"];

function daysInStage(d: Deal, today: string): number {
  const entered = [...d.stageHistory].reverse().find((h) => h.stage === d.stage)?.at ?? d.createdAt;
  return daysSince(entered, today);
}

function everReached(d: Deal, stages: Stage[]): boolean {
  return stages.includes(d.stage) || d.stageHistory.some((h) => stages.includes(h.stage));
}

export function diagnose(ws: Workspace, now: Date): { diagnosis: Diagnosis | null; tooEarly: string } {
  const touchedAt = new Map<string, string>();
  for (const a of ws.activities) {
    if (!isColdFirstTouch(ws, a) || !a.personId) continue;
    if (!touchedAt.has(a.personId) || a.at < touchedAt.get(a.personId)!) touchedAt.set(a.personId, a.at);
  }
  const sends = touchedAt.size;
  let replied = 0;
  for (const [pid, at] of touchedAt) if (ws.activities.some((a) => a.kind === "reply_received" && a.personId === pid && a.at > at)) replied++;

  const contacted = new Set(ws.activities.filter((a) => a.kind === "touch_sent" && a.outcome !== "not_sent" && a.accountDomain).map((a) => a.accountDomain!));
  const nowMs = now.getTime();
  const met = new Set(
    Object.values(ws.meetings)
      .filter((m) => new Date(m.startsAt).getTime() <= nowMs)
      .map((m) => ws.deals[m.dealId]?.accountDomain)
      .filter((d): d is string => !!d && contacted.has(d)),
  );
  const deals = Object.values(ws.deals);
  const discovered = deals.filter((d) => d.meetingIds.some((id) => ws.meetings[id] && new Date(ws.meetings[id].startsAt).getTime() <= nowMs));
  const qualifiedEver = discovered.filter((d) => everReached(d, ["qualified", "pilot", "proposal", "won"]));
  const pilots = deals.filter((d) => everReached(d, ["pilot"]));
  const paid = pilots.filter((d) => d.stage === "won" || d.pilot?.paid);
  const won = deals.filter((d) => d.stage === "won").length;
  const closed = won + deals.filter((d) => d.stage === "lost").length;

  const checks: (Diagnosis | null)[] = [
    sends >= 100 && replied / sends < 0.05
      ? { stage: "Replies", metric: "reply rate on targeted cold sends", value: replied / sends, n: sends, recommendation: "Replies are under 5% after 100+ targeted sends. Change the ICP slice or the angle, not the volume." }
      : null,
    contacted.size >= 100 && met.size / contacted.size < 0.03
      ? { stage: "Meetings", metric: "contacted accounts that took a meeting", value: met.size / contacted.size, n: contacted.size, recommendation: "Under 3% of contacted accounts take a meeting. Fix the ask or the persona you write to." }
      : null,
    discovered.length >= 10 && qualifiedEver.length / discovered.length < 0.4
      ? { stage: "Qualification", metric: "discovery calls that qualified", value: qualifiedEver.length / discovered.length, n: discovered.length, recommendation: "Under 40% of discovery calls qualify. Tighten targeting: the ICP filter is letting the wrong companies in." }
      : null,
    pilots.length >= 5 && paid.length / pilots.length < 0.7
      ? { stage: "Pilot to paid", metric: "pilots that converted to paid", value: paid.length / pilots.length, n: pilots.length, recommendation: "Under 70% of pilots convert. Agree written success criteria before kickoff and shorten time to first value." }
      : null,
    closed >= 10 && won / closed > 0.5
      ? { stage: "Pricing", metric: "win rate on closed deals", value: won / closed, n: closed, recommendation: "You win more than half of closed deals. Raise prices on the next quote." }
      : null,
  ];
  const diagnosis = checks.find(Boolean) ?? null;
  const tooEarly = `Too early to diagnose the funnel: ${sends} targeted cold sends (needs 100), ${discovered.length} discovery calls (needs 10), ${pilots.length} pilots (needs 5), ${closed} closed deals (needs 10).`;
  return { diagnosis, tooEarly };
}

export function pipelineData(ws: Workspace, now: Date): PipelineData {
  const today = todayISO(now);
  const start = weekOf(today);
  const lastStart = addDays(start, -7);
  const open = Object.values(ws.deals)
    .filter(isOpen)
    .sort((a, b) => RISK_ORDER.indexOf(a.stage) - RISK_ORDER.indexOf(b.stage));

  const facts: DealFact[] = open.map((d, i) => {
    const flags: string[] = [];
    const dated = d.nextStep?.date;
    const overdue = dated && dated < today ? daysBetween(dated, today) : 0;
    const without = !dated ? daysSince(d.lastActivityAt || d.updatedAt, today) : overdue;
    if (!dated) flags.push("no_dated_next_step");
    if (overdue) flags.push(`next_step_overdue_${overdue}d`);
    if (dated && !d.nextStep?.buyerAgreed) flags.push("next_step_not_buyer_agreed");
    if (d.contacts.length <= 1 && d.stage !== "talking") flags.push("single_threaded");
    const lastActivity = daysSince(d.lastActivityAt || d.updatedAt, today);
    if (lastActivity > 7) flags.push(`no_activity_${lastActivity}d`);
    if (d.stage === "pilot" && d.pilot && !d.pilot.paid) flags.push("unpaid_pilot");
    // Pilot to paid: the same reads as Today's pilot cards.
    const pw = pilotWatch(d, today);
    if (d.stage === "pilot" && pw.endsIn !== undefined && pw.endsIn < 0) flags.push(`pilot_ended_${-pw.endsIn}d_ago_no_decision`);
    else if (d.stage === "pilot" && pw.endsIn !== undefined && pw.endsIn <= 5 && !pw.roiBooked) flags.push("pilot_ending_no_roi_review");
    if (pw.overdue.length) flags.push(`map_steps_overdue_${pw.overdue.length}`);
    if (d.stage !== "talking" && !d.card?.economicBuyer?.value && !d.qualification?.economicBuyer) flags.push("economic_buyer_unknown");
    const champion = d.card?.champion?.name ? `${d.card.champion.name}${d.card.champion.status ? ` (${d.card.champion.status})` : ""}` : d.contacts.find((c) => c.role === "champion") ? first(ws.people[d.contacts.find((c) => c.role === "champion")!.personId]?.name) : "none";
    const company = companyName(ws, d.accountDomain);
    const parts = [
      `${STAGE_LABELS[d.stage]} for ${daysInStage(d, today)}d`,
      `next step: ${d.nextStep ? `"${clip(d.nextStep.what, 80)}"${dated ? ` on ${dated}` : ""}${d.nextStep.buyerAgreed ? " (buyer agreed)" : ""}` : "none"}`,
      `last activity ${lastActivity}d ago`,
      `${d.contacts.length} contact${d.contacts.length === 1 ? "" : "s"}`,
      `champion: ${champion}`,
      `economic buyer: ${d.card?.economicBuyer?.name ?? d.card?.economicBuyer?.value ?? "unknown"}`,
      d.qualification ? `card ${d.qualification.total}/12` : "card not scored",
      d.card?.criticalEvent?.value ? `critical event: ${clip(d.card.criticalEvent.value, 60)}${d.card.criticalEvent.date ? ` (${d.card.criticalEvent.date})` : ""}` : "critical event: none captured",
      d.card?.decisionProcess?.value ? `decision process: ${clip(d.card.decisionProcess.value, 60)}` : "decision process: unknown",
      d.pilot ? `pilot: ${d.pilot.paid ? "paid" : "unpaid"}${d.pilot.criteria ? `, criteria "${clip(d.pilot.criteria, 60)}"` : ", no written criteria"}${d.pilot.endsOn ? `, ends ${d.pilot.endsOn}` : ""}` : "",
      d.priceQuotes?.length ? `quoted $${d.priceQuotes.at(-1)!.amountUsd}` : "",
    ].filter(Boolean);
    const alias = `d${i + 1}`;
    return { alias, dealId: d.id, domain: d.accountDomain, company, stage: d.stage, line: `${alias} · ${company} · ${parts.join(" · ")}${flags.length ? ` · flags: ${flags.join(", ")}` : ""}`, flags, daysWithoutDatedStep: without };
  });

  const deals = Object.values(ws.deals);
  const won = deals.filter((d) => d.stage === "won").length;
  const closed = won + deals.filter((d) => d.stage === "lost").length;
  const winRate = closed >= 10 ? won / closed : null;
  const priced = deals.some((d) => (d.priceQuotes?.length ?? 0) > 0);
  const qualified = open.filter((d) => isQualified(ws, d.id));

  const lastWeekActs = ws.activities.filter((a) => localDate(a.at) >= lastStart && localDate(a.at) < start);
  const replies = lastWeekActs.filter((a) => a.kind === "reply_received");

  const eventActions: string[] = [];
  for (const ev of Object.values(ws.events)) {
    if (ev.status === "done" || ev.status === "cancelled") continue;
    for (const t of ev.plan?.timeline ?? []) {
      if (!t.done && t.owner !== "ember" && t.due >= start && t.due < addDays(start, 7)) eventActions.push(`${ev.title}: ${clip(t.task, 70)} (due ${t.due})`);
    }
  }

  const { diagnosis, tooEarly } = diagnose(ws, now);
  return {
    weekOf: start,
    snapshot: {
      qualified: qualified.length,
      qualifiedUsd: priced ? qualified.reduce((s, d) => s + (d.amountUsd ?? d.priceQuotes?.at(-1)?.amountUsd ?? 0), 0) : null,
      open: open.length,
      missingNextStep: facts.filter((f) => f.flags.includes("no_dated_next_step") || f.flags.some((x) => x.startsWith("next_step_overdue"))).length,
      closed,
      winRate,
      coverage: winRate ? 1 / winRate : null,
    },
    deals: facts,
    candidates: facts.filter((f) => (f.flags.includes("no_dated_next_step") || f.flags.some((x) => x.startsWith("next_step_overdue"))) && f.daysWithoutDatedStep >= 14),
    singleThreaded: facts.filter((f) => f.flags.includes("single_threaded")),
    overdue: facts.filter((f) => f.flags.some((x) => x.startsWith("next_step_overdue"))),
    targets: { conversations: conversationsTarget(ws), coldFirstTouches: ws.caps.firstTouchesPerWeek, introAsks: introAsksTarget(ws), eventActions },
    lastWeek: {
      conversations: conversationsBetween(ws, lastStart, new Date(`${start}T00:00:00`)),
      coldFirstTouches: coldFirstTouches(ws, { from: lastStart, until: addDays(start, -1) }),
      introAsks: lastWeekActs.filter((a) => a.kind === "intro_requested").length,
      replies: replies.length,
      positiveReplies: replies.filter((a) => a.sentiment === "positive").length,
    },
    diagnosis,
    tooEarly,
  };
}

/* ───────────────────────────── Friday ───────────────────────────── */

export interface ReplyFact {
  alias: string;
  activityId: string;
  who: string;
  company: string;
  sentiment: string;
  body: string;
  angle?: string;
  signal?: string;
  persona?: string;
}

export interface ConversionRow {
  dimension: "angle" | "signal" | "persona" | "channel" | "frame" | "pov" | "subject_style";
  key: string;
  sent: number;
  replies: number;
  positive: number;
  meetings: number;
  label: "anecdote" | "directional" | "reliable";
}

export type ActiveBet = NonNullable<ReviewProposal["bet"]> & { startedOn: string; id?: string; endsOn?: string; readout?: BetReadout };

export interface LearningData {
  weekOf: string;
  /** toDate: a cumulative row (not this week's activity). */
  inputs: { metric: string; actual: number; target: number | null; note?: string; toDate?: true }[];
  replies: ReplyFact[];
  conversions: ConversionRow[];
  objections: { alias: string; text: string; source: string }[];
  losses: { alias: string; company: string; reason: LossReason | "unknown" }[];
  skips: { reason: string; count: number }[];
  activeBet: ActiveBet | null;
  founderMaterial: { alias: string; text: string; kind: string }[];
  segment: { name: string; touches: number; positiveReplies: number; meetings: number } | null;
}

/** The touch a reply answers: the latest send to that person before the reply (email, LinkedIn, sequencer or intro). */
function touchBefore(ws: Workspace, reply: Activity): Activity | undefined {
  return ws.activities.filter((a) => SEND_KINDS.has(a.kind) && a.personId === reply.personId && a.at <= reply.at).sort((a, b) => b.at.localeCompare(a.at))[0];
}

function angleName(ws: Workspace, domain: string | undefined, angleId: string | undefined): string | undefined {
  if (!angleId) return undefined;
  const fromAccount = domain ? ws.accounts[domain]?.dossier?.angles.find((a) => a.id === angleId)?.title : undefined;
  if (fromAccount) return fromAccount;
  for (const acc of Object.values(ws.accounts)) {
    const hit = acc.dossier?.angles.find((a) => a.id === angleId);
    if (hit) return hit.title;
  }
  return undefined;
}

const FRAME_LABELS: Record<string, string> = {
  founder_card: "advice ask (founder card)",
  "4t": "4T",
  problem_prompter: "problem prompter",
  mouse_trap: "mouse trap",
  observation_problem_proof: "observation, problem, proof",
  referral: "referral",
  permission_to_close: "permission to close",
};

const SUBJECT_LABELS: Record<string, string> = { trigger: "subject names their trigger", problem: "subject names the problem", other: "subject names neither" };

function povLabel(ws: Workspace, povId: string | undefined, credentialId: string | undefined): string {
  if (povId) {
    const pov = ws.povs.find((p) => p.id === povId);
    return pov ? `POV: ${clip(pov.text, 60)}` : "a POV since removed";
  }
  if (credentialId) return "a credential, no POV";
  return "no POV tagged";
}

/** The persona a send was written to (its tag, stamped at send time), else the person's role or title. */
function personaOf(ws: Workspace, personId: string | undefined, touch?: Activity): string {
  if (touch?.tags?.persona) return touch.tags.persona.replace(/_/g, " ");
  const p = personId ? ws.people[personId] : undefined;
  if (!p) return "unknown";
  if (p.role) return p.role.replace(/_/g, " ");
  return clip(p.title || "unknown", 40);
}

export function learningData(ws: Workspace, now: Date): LearningData {
  const today = todayISO(now);
  const start = weekOf(today);
  const inWeek = (iso: string) => localDate(iso) >= start;
  const c = counters(ws, now);
  const weekActs = ws.activities.filter((a) => inWeek(a.at));

  const replyActs = weekActs.filter((a) => a.kind === "reply_received");
  const replies: ReplyFact[] = replyActs.map((a, i) => {
    const touch = touchBefore(ws, a);
    const p = a.personId ? ws.people[a.personId] : undefined;
    const domain = p?.accountDomain ?? a.accountDomain;
    return {
      alias: `r${i + 1}`,
      activityId: a.id,
      who: p ? `${p.name}${p.title ? `, ${p.title}` : ""}` : "Unknown contact",
      company: companyName(ws, domain),
      sentiment: a.sentiment ?? "unclassified",
      body: clip(a.body ?? a.summary ?? "", 500),
      angle: angleName(ws, domain, touch?.angleId),
      signal: touch?.signalType,
      persona: personaOf(ws, a.personId, touch),
    };
  });

  // Conversions over the trailing 8 weeks, by person: the first send on any channel, including drafts handed to a
  // sequencer. Labels carry the sample size.
  const since = addDays(today, -56);
  const firstTouches = new Map<string, Activity>();
  for (const a of ws.activities) {
    if (!SEND_KINDS.has(a.kind) || a.outcome === "not_sent" || !a.personId || localDate(a.at) < since) continue;
    const prev = firstTouches.get(a.personId);
    if (!prev || a.at < prev.at) firstTouches.set(a.personId, a);
  }
  const rows = new Map<string, ConversionRow>();
  const bump = (dimension: ConversionRow["dimension"], key: string, replied: boolean, positive: boolean, meeting: boolean) => {
    const id = `${dimension}:${key}`;
    const row = rows.get(id) ?? { dimension, key, sent: 0, replies: 0, positive: 0, meetings: 0, label: "anecdote" as const };
    row.sent++;
    if (replied) row.replies++;
    if (positive) row.positive++;
    if (meeting) row.meetings++;
    rows.set(id, row);
  };
  for (const [personId, touch] of firstTouches) {
    const later = ws.activities.filter((a) => a.kind === "reply_received" && a.personId === personId && a.at > touch.at);
    const domain = touch.accountDomain ?? ws.people[personId]?.accountDomain;
    const deal = domain ? Object.values(ws.deals).find((d) => d.accountDomain === domain) : undefined;
    const meeting = !!deal?.meetingIds.some((id) => ws.meetings[id] && ws.meetings[id].startsAt > touch.at);
    const replied = later.length > 0;
    const positive = later.some((a) => a.sentiment === "positive");
    const channel = sendChannel(ws, touch);
    bump("persona", personaOf(ws, personId, touch), replied, positive, meeting);
    bump("channel", channel, replied, positive, meeting);
    // An intro ask went to the connector, not the buyer: it says nothing about how the note was written.
    if (channel === "intro") continue;
    bump("angle", angleName(ws, domain, touch.angleId) ?? "no angle tagged", replied, positive, meeting);
    bump("signal", touch.signalType ?? "no signal tagged", replied, positive, meeting);
    bump("frame", FRAME_LABELS[touch.tags?.frame ?? ""] ?? touch.tags?.frame ?? "no frame tagged", replied, positive, meeting);
    bump("pov", povLabel(ws, touch.tags?.povId, touch.tags?.credentialClaimId), replied, positive, meeting);
    // LinkedIn notes have no subject line.
    if (channel === "email") bump("subject_style", SUBJECT_LABELS[touch.tags?.subjectStyle ?? ""] ?? "no subject tagged", replied, positive, meeting);
  }
  const conversions = [...rows.values()].map((r) => ({ ...r, label: sampleLabel(r.sent) })).sort((a, b) => a.dimension.localeCompare(b.dimension) || b.sent - a.sent);

  const objections: LearningData["objections"] = [];
  for (const m of Object.values(ws.meetings)) {
    if (!m.debrief || !inWeek(m.debrief.generatedAt)) continue;
    const company = companyName(ws, ws.deals[m.dealId]?.accountDomain);
    for (const o of m.debrief.newObjections) {
      objections.push({ alias: `q${objections.length + 1}`, text: clip(o, 240), source: `${company} call, ${m.debrief.source === "transcript" ? "verbatim" : "founder notes"}` });
    }
  }
  for (const r of replies) {
    if (r.sentiment === "negative" && r.body) objections.push({ alias: `q${objections.length + 1}`, text: clip(r.body, 240), source: `${r.who} at ${r.company}, reply ${r.alias}` });
  }

  const losses = Object.values(ws.deals)
    .filter((d) => d.stage === "lost" && d.stageHistory.some((h) => h.stage === "lost" && inWeek(h.at)))
    .map((d, i) => ({ alias: `l${i + 1}`, company: companyName(ws, d.accountDomain), reason: d.lossReason ?? ("unknown" as const) }));

  const skipCounts = new Map<string, number>();
  for (const m of Object.values(ws.moves)) {
    if (m.status === "skipped" && m.skipReason && inWeek(m.createdAt)) skipCounts.set(m.skipReason, (skipCounts.get(m.skipReason) ?? 0) + 1);
  }

  const activeBet = activeMessageBet(ws, today);

  const founderMaterial: LearningData["founderMaterial"] = [
    ...ws.povs.map((p) => ({ text: `${p.text} (${p.evidence})`, kind: "point of view" })),
    ...(ws.foundation?.founderQuestions ?? []).filter((q) => q.answer).map((q) => ({ text: `${q.question} → ${q.answer}`, kind: "founder answer" })),
    ...Object.values(ws.meetings)
      .filter((m) => m.debrief && inWeek(m.debrief.generatedAt))
      .flatMap((m) => m.debrief!.coaching.map((t) => ({ text: t, kind: "call note" }))),
  ]
    .slice(0, 12)
    .map((x, i) => ({ alias: `f${i + 1}`, ...x }));

  const segmentName = ws.foundation?.icp.primarySegment;
  let segment: LearningData["segment"] = null;
  if (segmentName) {
    const since = ws.foundation?.icp.segmentLockedAt ? localDate(ws.foundation.icp.segmentLockedAt) : addDays(today, -90);
    const touches = ws.activities.filter((a) => isColdFirstTouch(ws, a) && localDate(a.at) >= since);
    const people = new Set(touches.map((a) => a.personId).filter(Boolean));
    const positive = ws.activities.filter((a) => a.kind === "reply_received" && a.sentiment === "positive" && a.personId && people.has(a.personId)).length;
    const meetings = Object.values(ws.meetings).filter((m) => localDate(m.startsAt) >= since).length;
    segment = { name: segmentName, touches: touches.length, positiveReplies: positive, meetings };
  }

  return {
    weekOf: start,
    inputs: [
      { metric: "Conversations held", actual: conversationsBetween(ws, start, now), target: conversationsTarget(ws) },
      { metric: "Cold first touches", actual: c.coldThisWeek, target: ws.caps.firstTouchesPerWeek, note: "a ceiling, not a goal" },
      { metric: "Intro asks", actual: c.introAsksThisWeek, target: introAsksTarget(ws) },
      { metric: "Replies", actual: replyActs.length, target: null },
      { metric: "Positive replies", actual: replyActs.filter((a) => a.sentiment === "positive").length, target: null },
      { metric: "Paid pilots (to date)", actual: goalWins(ws), target: ws.goal.target, toDate: true },
    ],
    replies,
    conversions,
    objections,
    losses,
    skips: [...skipCounts.entries()].map(([reason, count]) => ({ reason: reason.replace(/_/g, " "), count })),
    activeBet,
    founderMaterial,
    segment,
  };
}

/**
 * The message bet the founder started most recently, while it runs: through the end of the calendar month after the
 * one it started in, so a bet started on the 30th still gets a full month of sends. Carries the per-arm counts so far.
 */
export function activeMessageBet(ws: Workspace, today: string): ActiveBet | null {
  const bet = activeBet(ws, today);
  if (!bet) return null;
  return {
    variable: bet.variable,
    control: bet.control,
    variant: bet.variant,
    why: bet.why,
    dimension: bet.dimension,
    controlKey: bet.controlKey,
    variantKey: bet.variantKey,
    startedOn: bet.startedOn,
    id: bet.id,
    endsOn: bet.endsOn,
    readout: betReadout(ws, bet.id),
  };
}

export function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

