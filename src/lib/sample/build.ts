import { daysBetween } from "@/lib/domain/ids";
import type {
  Account,
  Confidence,
  DraftFrame,
  DraftStep,
  Evidence,
  ICPCriterion,
  ID,
  ISODate,
  ISODateTime,
  LintResult,
  Signal,
  SignalType,
  SourceType,
} from "@/lib/domain/types";

/* ───────────── Evidence ───────────── */

export interface EvidenceInput {
  claim: string;
  quote: string;
  url: string;
  sourceType: SourceType;
  publishedAt?: ISODate;
  retrievedAt: ISODateTime;
  confidence?: Confidence;
  runId?: ID;
}

export function evidence(id: ID, e: EvidenceInput): Evidence {
  return { id, host: new URL(e.url).hostname.replace(/^www\./, ""), confidence: "high", ...e };
}

/* ───────────── Drafts ─────────────
 * Steps start with plain counts; index.ts re-lints every step with the composer's own `lintStep` once the
 * workspace is assembled, so the sample's checks match what the editor shows. */

const YOU = /\b(?:you|your|yours|you're|you've|you'll|you'd|yourself)\b/gi;
const I_WE = /\b(?:i|me|my|mine|i'm|i've|i'll|i'd|we|us|our|ours|we're|we've|we'll|we'd)\b/gi;

export function countsOnly(body: string): LintResult {
  return {
    passed: true,
    violations: [],
    stats: {
      words: body.split(/\s+/).filter(Boolean).length,
      fkGrade: 0,
      you: (body.match(YOU) ?? []).length,
      iWe: (body.match(I_WE) ?? []).length,
      questionMarks: (body.match(/\?/g) ?? []).length,
      links: (body.match(/https?:\/\/|www\./gi) ?? []).length,
    },
  };
}

export interface StepInput {
  step: number;
  frame: DraftFrame;
  subject: string | null;
  body: string;
  sendOn: ISODate;
  thread?: DraftStep["thread"];
  spans: { text: string; evidenceId: ID }[];
  evidenceIds?: ID[];
  claimIds?: ID[];
  credentialClaimId?: ID;
  povId?: ID;
  assetId?: ID;
  angleId?: ID;
  status?: DraftStep["status"];
  sentAt?: ISODateTime;
}

export function draftStep(s: StepInput): DraftStep {
  for (const span of s.spans) {
    if (!s.body.includes(span.text)) throw new Error(`Sample span not found in draft body: "${span.text}"`);
  }
  return {
    step: s.step,
    personalizedSpans: s.spans,
    povId: s.povId,
    assetId: s.assetId,
    sendOn: s.sendOn,
    thread: s.thread ?? (s.step === 1 ? "new" : "reply"),
    subject: s.subject,
    body: s.body,
    frame: s.frame,
    evidenceIds: s.evidenceIds ?? [...new Set(s.spans.map((x) => x.evidenceId))],
    claimIds: s.claimIds ?? [],
    lint: countsOnly(s.body),
    status: s.status ?? "draft",
    sentAt: s.sentAt,
    angleId: s.angleId,
    credentialClaimId: s.credentialClaimId,
  };
}

/* ───────────── Scoring (the discovery rules, applied in code) ───────────── */

/** fit = round(100 × Σ(w·m) / Σw); must-have w=3, nice-to-have w=1; true=1, unknown=0.5, false=0. */
export function fitScore(criteria: ICPCriterion[], met: Account["criteria"]): number {
  let num = 0;
  let den = 0;
  for (const c of criteria) {
    const w = c.mustHave ? 3 : 1;
    const m = met.find((x) => x.criterionId === c.id)?.met ?? "unknown";
    den += w;
    num += w * (m === "true" ? 1 : m === "unknown" ? 0.5 : 0);
  }
  return den ? Math.round((100 * num) / den) : 0;
}

/** Freshness windows from the signal catalog, in days. */
const WINDOW: Record<SignalType, number> = {
  champion_job_change: 90,
  first_hire: 60,
  jd_names_pain: 60,
  new_leader: 90,
  funding: 90,
  stack_change: 90,
  launch: 60,
  compliance_deadline: 180,
  persona_post: 30,
  community_request: 14,
  public_pain: 90,
  filing: 90,
  hiring: 30,
  sensitive: 0,
  life_event: 60,
  seasonal: 45,
  trend: 30,
  competitor_gap: 60,
};

function decay(signal: Signal, today: ISODate): number {
  const window = WINDOW[signal.type];
  const age = daysBetween(signal.date, today);
  if (!window || age > window) return 0;
  if (age <= window / 3) return 1;
  if (age <= (2 * window) / 3) return 0.6;
  return 0.3;
}

/** whyNow = min(4, max(s·decay) + 0.5 × other fresh signals with s ≥ 2) + warm-path bonus, capped at 4. */
export function whyNowScore(signals: Signal[], today: ISODate, warm: "knows_product" | "path" | null): number {
  const scored = signals
    .filter((s) => s.usableInOutreach)
    .map((s) => ({ s, v: s.strength * decay(s, today) }))
    .sort((a, b) => b.v - a.v);
  const top = scored[0]?.v ?? 0;
  const others = scored.slice(1).filter((x) => x.v > 0 && x.s.strength >= 2).length;
  const base = Math.min(4, top + 0.5 * others);
  const bonus = warm === "knows_product" ? 1 : warm === "path" ? 0.5 : 0;
  return Math.round(Math.min(4, base + bonus) * 10) / 10;
}

/** A: fit ≥70 and whyNow ≥2 · B: fit ≥70 · C: fit 50–69 with whyNow ≥3 (and everything else kept for history). */
export function tierFor(fit: number, whyNow: number): Account["tier"] {
  if (fit >= 70) return whyNow >= 2 ? "A" : "B";
  return "C";
}
