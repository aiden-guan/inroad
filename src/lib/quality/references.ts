import type { DraftFrame, Workspace } from "@/lib/domain/types";

/**
 * Reference emails for the blind pairwise critic ("which would you answer, A or B?").
 * The founder's own sent emails win when they've pasted some (voice samples). Otherwise these
 * bundled references are used: written to the playbook's rules (research 01 §3, SPEC W5 example),
 * for hypothetical companies. They're a calibration floor, not real customer emails.
 * TODO: replace with permissioned human emails that got replies (SPEC §4.0 critic, 24 by frame).
 */
export interface ReferenceEmail {
  id: string;
  frames: DraftFrame[];
  step: number;
  subject: string | null;
  body: string;
}

export const REFERENCES: ReferenceEmail[] = [
  {
    id: "ref-advice-ledger",
    frames: ["founder_card"],
    step: 1,
    subject: "reconciliation after the first hire",
    body: `Dana, Northwind's founding platform role lists "own ledger reconciliation" as a first-90-days goal. From 30 calls with platform leads, the reconciliation script usually outlives the person who wrote it, and the second hire inherits a black box. I'm building ledger tooling after five years on Stripe's billing infra. Is reconciliation part of the platform role at Northwind, or does finance own it?`,
  },
  {
    id: "ref-expert-oncall",
    frames: ["founder_card"],
    step: 1,
    subject: "your on-call write-up",
    body: `Sam, your post on cutting pages by moving alerts to SLOs was the clearest version of that argument I've read this year. I'm researching how infra teams under 30 engineers decide what wakes someone up, and you've clearly thought about it more than most. Not a pitch: would you give me 20 minutes of your view on where SLO alerting breaks down?`,
  },
  {
    id: "ref-4t-usage",
    frames: ["4t", "observation_problem_proof"],
    step: 1,
    subject: "usage tiers and close",
    body: `Ana, your pricing page moved to usage tiers in June. When usage events and invoices live in two systems, month-end close tends to become a spreadsheet only one analyst understands. The fix most teams try first, a BI dashboard, shows the gap but doesn't close it. Is invoicing straight from usage data on your list this quarter, or is it a next-year problem?`,
  },
  {
    id: "ref-exec-soc2",
    frames: ["problem_prompter"],
    step: 1,
    subject: "enterprise tier and SOC 2",
    body: `Mei, your September letter puts the enterprise tier first for next year. The deals that tier needs will ask for SOC 2 evidence before a pilot, and most teams your size collect it by hand the week a questionnaire lands. Before starting Vanta-style tooling, it can pay to see which controls your stack already proves. Who on your team owns security questionnaires today?`,
  },
  {
    id: "ref-step2-implication",
    frames: ["4t", "mouse_trap", "founder_card"],
    step: 2,
    subject: null,
    body: `Dana, one more angle. The job post also mentions owning the Snowflake bill. Reconciliation and cost reporting usually share the same brittle export, so fixing one tends to fix both. Does the new hire inherit both?`,
  },
  {
    id: "ref-step3-close",
    frames: ["permission_to_close", "referral"],
    step: 3,
    subject: null,
    body: `Dana, sounds like the timing is off for you, so this is my last note. Will reconciliation matter to your team in about two quarters?`,
  },
  {
    id: "ref-dm-talk",
    frames: ["mouse_trap"],
    step: 1,
    subject: null,
    body: `Thanks for connecting, Raj. Your point at KubeCon that cost alerts arrive a sprint too late matched what I hear from platform leads. Do your teams see spend per service before merge, or only after the bill?`,
  },
];

/**
 * Picks the reference to compare against: one of the founder's pasted emails if any, else the
 * bundled reference closest to this frame and step.
 */
export function pickReference(ws: Workspace, frame: DraftFrame, step: number, rand = Math.random): { id: string; text: string } {
  const own = (ws.voice?.samples ?? []).filter((s) => s.kind === "email" && s.text.split(/\s+/).length >= 25);
  if (own.length) {
    const i = Math.floor(rand() * own.length);
    return { id: `voice-${i}`, text: own[i].text.slice(0, 1200) };
  }
  const exact = REFERENCES.filter((r) => r.frames.includes(frame) && r.step === step);
  const byFrame = REFERENCES.filter((r) => r.frames.includes(frame));
  const pool = exact.length ? exact : byFrame.length ? byFrame : REFERENCES.filter((r) => r.step === Math.min(step, 3));
  const ref = pool[Math.floor(rand() * pool.length)] ?? REFERENCES[0];
  return { id: ref.id, text: ref.subject ? `Subject: ${ref.subject}\n\n${ref.body}` : ref.body };
}
