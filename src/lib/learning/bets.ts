import { newId, todayISO } from "@/lib/domain/ids";
import type { Activity, BetArm, BetDimension, DraftFrame, ID, ISODate, PersonaRole, ReviewProposal, SignalType, Workspace } from "@/lib/domain/types";

/**
 * Message bets (SPEC W9 monthly): one variable, a control and a variant, judged by reading replies and counting the
 * positive ones. "Start this bet" applies a review proposal; from then until the end of the next calendar month, cold
 * first touches are written for alternating arms (writing variables) or sorted into arms by who and why they were
 * sent to (targeting variables), and every send carries its arm. No verdict below 100 sends per arm, ever.
 */

export const BET_MIN_PER_ARM = 100;

/**
 * Every way a first touch reaches someone: an email, a LinkedIn note or message, a draft handed to a sequencer or
 * exported as CSV ("pushed", which carries the tags; the tool's own "sent" event comes later), or an intro ask.
 */
export const SEND_KINDS: ReadonlySet<Activity["kind"]> = new Set(["touch_sent", "pushed", "linkedin_dm", "linkedin_connect", "intro_requested"]);

/** Variables the draft itself can carry (the composer writes to the arm). */
export const WRITING_DIMENSIONS: BetDimension[] = ["angle", "frame", "subject_style", "cta", "pov"];
/** Variables decided by who and why a note goes out; the arm is read off the send's tags. */
export const TARGETING_DIMENSIONS: BetDimension[] = ["persona", "signal", "channel"];

export const DIMENSION_LABELS: Record<BetDimension, string> = {
  angle: "Angle",
  frame: "Frame",
  subject_style: "Subject line",
  cta: "The ask",
  pov: "Point of view",
  persona: "Who you write to",
  signal: "Why-now signal",
  channel: "Channel",
};

/** Cold frames a frame bet can force (the composer still applies the peer-proof rule on top). */
export const BET_FRAMES: DraftFrame[] = ["founder_card", "4t", "problem_prompter", "mouse_trap", "observation_problem_proof"];
const ROLES: PersonaRole[] = ["economic_buyer", "champion", "technical_approver", "user", "blocker"];
const SIGNALS: SignalType[] = [
  "champion_job_change",
  "first_hire",
  "jd_names_pain",
  "new_leader",
  "funding",
  "stack_change",
  "launch",
  "compliance_deadline",
  "persona_post",
  "community_request",
  "public_pain",
  "filing",
  "hiring",
];
const CHANNELS = ["email", "linkedin"] as const;

export interface StartedBet {
  id: ID;
  variable: string;
  control: string;
  variant: string;
  why: string;
  dimension?: BetDimension;
  controlKey?: string;
  variantKey?: string;
  startedOn: ISODate;
  /** The last day it runs: the end of the calendar month after the one it started in. */
  endsOn: ISODate;
  readout?: ReviewProposal["betReadout"];
}

export interface ArmCounts {
  sent: number;
  replies: number;
  positive: number;
}

export interface BetReadout {
  control: ArmCounts;
  variant: ArmCounts;
  /** Both arms reached 100 sends: only then may a verdict be anything but inconclusive. */
  enough: boolean;
}

/** The last day of the month after `date`'s month. */
export function betEndsOn(date: ISODate): ISODate {
  const [y, m] = date.split("-").map(Number);
  // Day 0 of the month after next is the last day of next month.
  const end = new Date(y, m + 1, 0);
  return todayISO(end);
}

/** Bets written before the review named a dimension: read it off the variable's words. */
export function inferDimension(variable: string): BetDimension | undefined {
  const v = variable.toLowerCase();
  if (/subject/.test(v)) return "subject_style";
  if (/\bframe|advice|observation|\b4t\b|mouse|expert interview/.test(v)) return "frame";
  if (/point of view|\bpov\b|opinion/.test(v)) return "pov";
  if (/\bcta\b|the ask|question|call to action|meeting ask/.test(v)) return "cta";
  if (/channel|linkedin/.test(v)) return "channel";
  if (/signal|trigger|why.?now/.test(v)) return "signal";
  if (/persona|title|role|seniority|buyer|champion/.test(v)) return "persona";
  if (/angle/.test(v)) return "angle";
  return undefined;
}

/** A key the code can match or force for this dimension, or undefined when the text is free-form. */
export function betKey(dimension: BetDimension | undefined, key: string | null | undefined): string | undefined {
  const k = key?.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!k || !dimension) return undefined;
  if (dimension === "persona") return ROLES.find((r) => r === k);
  if (dimension === "signal") return SIGNALS.find((s) => s === k);
  if (dimension === "channel") return CHANNELS.find((c) => c === k);
  if (dimension === "frame") return BET_FRAMES.find((f) => f === k);
  return undefined;
}

/** Every bet the founder started, oldest first. */
export function startedBets(ws: Workspace): StartedBet[] {
  const out: StartedBet[] = [];
  for (const b of Object.values(ws.briefs)) {
    for (const p of b.proposals ?? []) {
      if (p.kind !== "message_bet" || p.status !== "applied" || !p.bet || !p.decidedAt) continue;
      const startedOn = todayISO(new Date(p.decidedAt));
      const dimension = p.bet.dimension ?? inferDimension(p.bet.variable);
      out.push({
        id: p.id,
        variable: p.bet.variable,
        control: p.bet.control,
        variant: p.bet.variant,
        why: p.bet.why,
        dimension,
        controlKey: betKey(dimension, p.bet.controlKey),
        variantKey: betKey(dimension, p.bet.variantKey),
        startedOn,
        endsOn: betEndsOn(startedOn),
        readout: p.betReadout,
      });
    }
  }
  return out.sort((a, b) => a.startedOn.localeCompare(b.startedOn) || a.id.localeCompare(b.id));
}

/** The bet running today: the newest one started, while it lasts. One bet at a time. */
export function activeBet(ws: Workspace, today: ISODate): StartedBet | null {
  const newest = startedBets(ws).filter((b) => b.startedOn <= today).at(-1);
  return newest && today <= newest.endsOn ? newest : null;
}

/** A targeting bet sorts a send into an arm by its tags; writing bets are stamped on the draft instead. */
export function betArmFor(bet: StartedBet | null, sent: { persona?: PersonaRole; signalType?: SignalType; channel?: string }): BetArm | undefined {
  if (!bet?.dimension || !TARGETING_DIMENSIONS.includes(bet.dimension) || !bet.controlKey || !bet.variantKey) return undefined;
  const value = bet.dimension === "persona" ? sent.persona : bet.dimension === "signal" ? sent.signalType : sent.channel;
  if (!value) return undefined;
  if (value === bet.controlKey) return { id: bet.id, arm: "control" };
  if (value === bet.variantKey) return { id: bet.id, arm: "variant" };
  return undefined;
}

/** Can the composer write to this bet's arms (a writing variable it knows how to vary)? */
export function steerable(bet: StartedBet | null): bet is StartedBet {
  return !!bet?.dimension && WRITING_DIMENSIONS.includes(bet.dimension);
}

/** The arm the next draft goes to: whichever has fewer first touches drafted for it so far (control on a tie). */
export function nextArm(ws: Workspace, bet: StartedBet): BetArm["arm"] {
  let control = 0;
  let variant = 0;
  for (const pkg of Object.values(ws.outreach)) {
    const first = pkg.steps.find((s) => s.step === 1);
    if (first?.bet?.id !== bet.id) continue;
    if (first.bet.arm === "control") control++;
    else variant++;
  }
  return variant < control ? "variant" : "control";
}

/**
 * What the composer adds for an arm: an instruction block, and for a frame bet the one frame to use (when the
 * peer-proof rule allows it). The draft must differ from the other arm only in the bet's variable.
 */
export function betSteer(bet: StartedBet, arm: BetArm["arm"], frames: DraftFrame[]): { frames: DraftFrame[]; block: string } {
  const key = arm === "control" ? bet.controlKey : bet.variantKey;
  const forced = bet.dimension === "frame" && key && frames.includes(key as DraftFrame) ? [key as DraftFrame] : frames;
  const text = arm === "control" ? bet.control : bet.variant;
  const other = arm === "control" ? bet.variant : bet.control;
  const block = `<message_bet arm="${arm}">The founder is testing one thing this month: ${bet.variable}. This draft is the ${arm.toUpperCase()} arm: ${text}. Write it that way; the other arm is "${other}". Keep everything else as you normally would, so the arms differ only in this one thing. Never mention the test.</message_bet>`;
  return { frames: forced, block };
}

/** First sends in a bet, one per person (the earliest), with what came back. Drafts handed to a sequencer count too. */
export function betReadout(ws: Workspace, betId: ID): BetReadout {
  const firstByPerson = new Map<string, Activity>();
  for (const a of ws.activities) {
    if (a.tags?.bet?.id !== betId || a.outcome === "not_sent" || !a.personId) continue;
    if (!SEND_KINDS.has(a.kind)) continue;
    const prev = firstByPerson.get(a.personId);
    if (!prev || a.at < prev.at) firstByPerson.set(a.personId, a);
  }
  const counts = { control: { sent: 0, replies: 0, positive: 0 }, variant: { sent: 0, replies: 0, positive: 0 } };
  for (const [personId, touch] of firstByPerson) {
    const arm = counts[touch.tags!.bet!.arm];
    arm.sent++;
    const replies = ws.activities.filter((x) => x.kind === "reply_received" && x.personId === personId && x.at > touch.at);
    if (replies.length) arm.replies++;
    if (replies.some((x) => x.sentiment === "positive")) arm.positive++;
  }
  return { ...counts, enough: counts.control.sent >= BET_MIN_PER_ARM && counts.variant.sent >= BET_MIN_PER_ARM };
}

/** Code has the last word: below 100 sends per arm the verdict is inconclusive, whatever anyone read into it. */
export function betVerdict(readout: BetReadout, suggested: "keep" | "drop" | "inconclusive" | null | undefined): "keep" | "drop" | "inconclusive" {
  return readout.enough ? (suggested ?? "inconclusive") : "inconclusive";
}

/** One line for a readout: "Control 14 sent · 1 positive. Variant 12 sent · 2 positive." */
export function readoutLine(r: BetReadout): string {
  const arm = (label: string, c: ArmCounts) => `${label} ${c.sent} sent · ${c.replies} ${c.replies === 1 ? "reply" : "replies"} · ${c.positive} positive`;
  return `${arm("Control", r.control)}. ${arm("Variant", r.variant)}.`;
}

/**
 * A review's proposed message bet, with its dimension and the code values arms are matched or forced by. A
 * who-or-why bet (persona, signal, channel) that names no values can't be measured, so it isn't proposed.
 */
export function betProposal(b: { dimension: BetDimension; controlKey: string | null; variantKey: string | null; variable: string; control: string; variant: string; why: string }): ReviewProposal | null {
  const controlKey = betKey(b.dimension, b.controlKey);
  const variantKey = betKey(b.dimension, b.variantKey);
  if (TARGETING_DIMENSIONS.includes(b.dimension) && (!controlKey || !variantKey || controlKey === variantKey)) return null;
  const clean = (s: string) => s.replace(/!/g, ".").trim();
  return {
    id: newId("prop"),
    kind: "message_bet",
    title: `Next month's bet: ${clean(b.variable)}`,
    detail: clean(b.why),
    bet: { variable: clean(b.variable), control: clean(b.control), variant: clean(b.variant), why: clean(b.why), dimension: b.dimension, controlKey, variantKey },
    status: "open",
  };
}
