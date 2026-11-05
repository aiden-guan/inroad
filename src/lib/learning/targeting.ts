import { addDays, daysBetween } from "@/lib/domain/ids";
import type { Account, EntityRef, ID, ISODate, ISODateTime, Move, MoveKind, Person, PersonaRole, SignalType, SkipReason, SkipTarget, Workspace } from "@/lib/domain/types";

/**
 * Skips that teach (W9 learning, audit 14 #9). A skip reason used to be counted only in the Friday review. Now three
 * "wrong person" skips on one persona inside 30 days rank that persona's new-outreach cards lower, and three "weak
 * angle" skips on one kind of why-now signal rank that signal's cards lower, until the skips age out. "Tone off" keeps
 * the draft as an example of what not to write (the voice card). Every adjustment lists the skips behind it, when it
 * lapses, and can be undone. Code decides all of it; nothing here calls a model.
 */

export const LEARN_WINDOW_DAYS = 30;
export const LEARN_MIN_SKIPS = 3;
/** Weight for cards that match: a quarter lower at 3 skips, 40% lower at 5 or more. */
export const LEARN_WEIGHTS = { at3: 0.75, at5: 0.6 } as const;

/**
 * Rules whose cards start new outreach, the only cards an adjustment may rank lower. Replies, meetings, deals and the
 * first three onboarding promised are never touched: a real conversation is never demoted by a targeting guess.
 */
export const TARGETING_RULES: ReadonlySet<string> = new Set(["cold_draft", "signal", "warm_path", "linkedin", "play"]);

export const ROLE_LABELS: Record<PersonaRole, string> = {
  economic_buyer: "Economic buyer",
  champion: "Champion",
  technical_approver: "Technical approver",
  user: "User",
  blocker: "Blocker",
  early_adopter: "Early adopter",
  payer: "Payer",
  influencer: "Influencer",
};

export const SIGNAL_LABELS: Record<SignalType, string> = {
  champion_job_change: "Champion job changes",
  first_hire: "First hires",
  jd_names_pain: "Job posts that name the pain",
  new_leader: "New leaders",
  funding: "Funding news",
  stack_change: "Stack changes",
  launch: "Launches",
  compliance_deadline: "Compliance deadlines",
  persona_post: "Posts by the buyer",
  community_request: "Community questions",
  public_pain: "Public complaints",
  filing: "Filings",
  hiring: "Hiring posts",
  sensitive: "Sensitive news",
  life_event: "Life events",
  seasonal: "Seasonal moments",
  trend: "Trends",
  competitor_gap: "Competitor gaps",
};

type Target = Pick<Move, "id" | "ref" | "source"> & { evidenceIds?: Move["evidenceIds"] };

function domainOf(ws: Workspace, ref: EntityRef | undefined): string | undefined {
  if (!ref) return undefined;
  if (ref.kind === "person") return ws.people[ref.id]?.accountDomain;
  if (ref.kind === "account") return ref.id;
  if (ref.kind === "deal") return ws.deals[ref.id]?.accountDomain;
  return undefined;
}

/** The persona a card was written to: the playbook persona its title matches, else the buying role, else the title. */
export function personaOf(ws: Workspace, person: Person | undefined, acc: Account | undefined): SkipTarget["persona"] {
  const title = (person?.title || acc?.suggestedTitle || acc?.dossier?.committee.find((m) => m.role === "champion")?.likelyTitles[0] || "").trim();
  const lower = title.toLowerCase();
  if (lower) {
    const p = (ws.foundation?.personas ?? []).find((x) => x.titles.some((t) => t && lower.includes(t.toLowerCase())));
    if (p) return { key: `psn:${p.id}`, label: p.titles[0] ?? title };
  }
  if (person?.role) return { key: `role:${person.role}`, label: ROLE_LABELS[person.role] };
  if (lower) return { key: `title:${lower.replace(/\s+/g, " ")}`, label: title };
  return undefined;
}

/** The why-now signal a card rested on: the one its id names, its source link, or its cited evidence. */
export function signalOf(acc: Account | undefined, move: Target): SignalType | undefined {
  if (!acc) return undefined;
  const prefix = `mv_signal_${acc.domain}_`;
  if (move.id.startsWith(prefix)) {
    const hit = acc.signals.find((s) => s.id === move.id.slice(prefix.length));
    if (hit) return hit.type;
  }
  if (move.source?.url) {
    const hit = acc.signals.find((s) => s.url === move.source!.url);
    if (hit) return hit.type;
  }
  const ids = new Set(move.evidenceIds ?? []);
  return acc.signals.find((s) => s.evidenceId && ids.has(s.evidenceId))?.type;
}

/** What a card targets, read from the workspace as it is now. The reducer stamps this on a skip. */
export function skipTarget(ws: Workspace, move: Target): SkipTarget {
  const person = move.ref?.kind === "person" ? ws.people[move.ref.id] : undefined;
  const domain = person?.accountDomain ?? domainOf(ws, move.ref);
  const acc = domain ? ws.accounts[domain] : undefined;
  const persona = personaOf(ws, person, acc);
  const signalType = signalOf(acc, move);
  return { ...(persona ? { persona } : {}), ...(signalType ? { signalType } : {}), ...(domain ? { domain } : {}), ...(person ? { personId: person.id } : {}) };
}

export interface LearnedSkip {
  moveId: ID;
  title: string;
  at: ISODateTime;
}

export interface Adjustment {
  /** "persona:psn:psn_data_lead", "signal:funding", "tone". */
  key: string;
  kind: "persona" | "signal" | "tone";
  /** "Head of Data", "Funding news", "Tone". */
  label: string;
  reason: SkipReason;
  /** Cards that match rank at this fraction of their priority (persona and signal). */
  weight?: number;
  /** Persona key or signal type the adjustment matches. */
  match?: string;
  /** Newest first. */
  skips: LearnedSkip[];
  /** The first skip it counts. */
  since: ISODate;
  /** When it lapses, unless more skips come. Tone notes keep until newer ones replace them. */
  expiresOn?: ISODate;
}

const localDay = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Skips that still count: skipped for a reason that teaches, inside the window, not taken back. */
function countedSkips(ws: Workspace, today: ISODate, reason: SkipReason): Move[] {
  return Object.values(ws.moves).filter((m) => {
    if (m.status !== "skipped" || m.skipReason !== reason || m.learnIgnored || !m.skipTarget) return false;
    const on = localDay(m.settledAt ?? m.createdAt);
    return daysBetween(on, today) <= LEARN_WINDOW_DAYS && on <= today;
  });
}

function group(moves: Move[], keyOf: (m: Move) => string | undefined): Map<string, Move[]> {
  const out = new Map<string, Move[]>();
  for (const m of moves) {
    const k = keyOf(m);
    if (k) out.set(k, [...(out.get(k) ?? []), m]);
  }
  return out;
}

function adjustmentFrom(kind: "persona" | "signal", reason: SkipReason, match: string, label: string, moves: Move[]): Adjustment {
  const skips = moves
    .map((m) => ({ moveId: m.id, title: m.title, at: m.settledAt ?? m.createdAt }))
    .sort((a, b) => b.at.localeCompare(a.at));
  const third = skips[LEARN_MIN_SKIPS - 1];
  return {
    key: `${kind}:${match}`,
    kind,
    label,
    reason,
    weight: skips.length >= 5 ? LEARN_WEIGHTS.at5 : LEARN_WEIGHTS.at3,
    match,
    skips,
    since: localDay(skips[skips.length - 1].at),
    expiresOn: addDays(localDay(third.at), LEARN_WINDOW_DAYS),
  };
}

/** What Today has learned from skips, strongest first, then tone notes. Pure. */
export function learnedAdjustments(ws: Workspace, today: ISODate): Adjustment[] {
  const out: Adjustment[] = [];
  for (const [key, moves] of group(countedSkips(ws, today, "wrong_person"), (m) => m.skipTarget?.persona?.key)) {
    if (moves.length >= LEARN_MIN_SKIPS) out.push(adjustmentFrom("persona", "wrong_person", key, moves[0].skipTarget!.persona!.label, moves));
  }
  for (const [type, moves] of group(countedSkips(ws, today, "weak_angle"), (m) => m.skipTarget?.signalType)) {
    if (moves.length >= LEARN_MIN_SKIPS) out.push(adjustmentFrom("signal", "weak_angle", type, SIGNAL_LABELS[type as SignalType] ?? type, moves));
  }
  out.sort((a, b) => b.skips.length - a.skips.length || b.skips[0].at.localeCompare(a.skips[0].at));
  const tone = ws.voice?.toneOff ?? [];
  if (tone.length) {
    const skips = [...tone]
      .map((t) => ({ moveId: t.moveId ?? "", title: (t.moveId && ws.moves[t.moveId]?.title) || "A draft you marked tone off", at: t.at }))
      .sort((a, b) => b.at.localeCompare(a.at));
    out.push({ key: "tone", kind: "tone", label: "Tone", reason: "tone_off", skips, since: localDay(skips[skips.length - 1].at) });
  }
  return out;
}

/** Whether an adjustment applies to a card. */
export function matches(a: Adjustment, t: SkipTarget): boolean {
  if (a.kind === "persona") return !!t.persona && t.persona.key === a.match;
  if (a.kind === "signal") return !!t.signalType && t.signalType === a.match;
  return false;
}

type Ranked = Target & { rule: string; kind: MoveKind; priority: number; why: string };

/**
 * Ranks new-outreach cards lower where an adjustment matches, in place, and says so on the card. Returns how many it
 * touched per adjustment key, so Today can show "ranked 2 cards lower". Pure apart from the candidates it's handed.
 */
export function applyLearned<T extends Ranked>(ws: Workspace, cands: T[], today: ISODate): Map<string, number> {
  const touched = new Map<string, number>();
  const live = learnedAdjustments(ws, today).filter((a) => a.weight !== undefined);
  if (!live.length) return touched;
  for (const c of cands) {
    if (!TARGETING_RULES.has(c.rule)) continue;
    const t = skipTarget(ws, c);
    const hits = live.filter((a) => matches(a, t));
    if (!hits.length) continue;
    const weight = hits.reduce((w, a) => w * (a.weight ?? 1), 1);
    c.priority = Math.round(c.priority * weight * 10) / 10;
    const n = hits.reduce((sum, a) => sum + a.skips.length, 0);
    c.why = `${c.why} · ranked lower after ${n} similar skips`;
    for (const a of hits) touched.set(a.key, (touched.get(a.key) ?? 0) + 1);
  }
  return touched;
}

/**
 * What one more skip would teach, before it's dispatched: the adjustment it completes (the third skip on a persona
 * or signal), or null. Today's toast says so ("I'll rank Head of Data cards lower until Dec 5").
 */
export function wouldLearn(ws: Workspace, move: Target, reason: SkipReason, at: ISODateTime, today: ISODate): { label: string; kind: "persona" | "signal"; until: ISODate } | null {
  if (reason !== "wrong_person" && reason !== "weak_angle") return null;
  const t = skipTarget(ws, move);
  const key = reason === "wrong_person" ? t.persona?.key : t.signalType;
  if (!key) return null;
  const counted = countedSkips(ws, today, reason).filter((m) => m.id !== move.id && (reason === "wrong_person" ? m.skipTarget?.persona?.key === key : m.skipTarget?.signalType === key));
  if (counted.length !== LEARN_MIN_SKIPS - 1) return null;
  const dates = [...counted.map((m) => m.settledAt ?? m.createdAt), at].sort().reverse();
  return {
    kind: reason === "wrong_person" ? "persona" : "signal",
    label: reason === "wrong_person" ? t.persona!.label : (SIGNAL_LABELS[t.signalType!] ?? t.signalType!),
    until: addDays(localDay(dates[LEARN_MIN_SKIPS - 1]), LEARN_WINDOW_DAYS),
  };
}
