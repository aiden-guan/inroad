import type { StudioMaterial, Workspace } from "@/lib/domain/types";

/**
 * Intake: the questions that pull real material out of the founder before anything is written.
 * The research's conclusion (docs/research/10-marketing-copy.md): in every campaign that worked, the
 * human-sounding material came from something real (onboarding calls, users' own pitches, the builder's
 * own reasons), so Studio asks for that first. Asked in code, zero tokens.
 */

export interface IntakeQuestion {
  kind: StudioMaterial["kind"];
  label: string;
  question: string;
  placeholder: string;
  /** Numbers and quotes are claims; they need a source to be used publicly. */
  askSource?: string;
}

export const INTAKE: IntakeQuestion[] = [
  {
    kind: "enemy",
    label: "The old way",
    question: "What do people use today instead of you, and what do they hate about it?",
    placeholder: "Two exports and a VLOOKUP every month-end. Nobody trusts the result.",
  },
  {
    kind: "story",
    label: "A moment",
    question: "Describe one moment a user's reaction surprised you. Where were they, what happened?",
    placeholder: "On her first close with us she found $14k of usage that never reached an invoice.",
  },
  {
    kind: "number",
    label: "A number",
    question: "What's one number a skeptic would stop for?",
    placeholder: "Month-end reconciliation went from 4 days to 6 hours.",
    askSource: "Where it's from and when (e.g. a design partner's close, Sept 2026)",
  },
  {
    kind: "quote",
    label: "Their words",
    question: "What has a user said about it, word for word?",
    placeholder: "“I didn't open the spreadsheet once.”",
    askSource: "Who said it and where (a call, an email, a review)",
  },
  {
    kind: "demo",
    label: "The demo",
    question: "What can you show in five seconds that nobody else can?",
    placeholder: "Pick last month and it lists every usage event that never reached an invoice, with the amount.",
  },
  {
    kind: "limit",
    label: "What it can't do yet",
    question: "What can't it do yet? Saying it first builds trust.",
    placeholder: "Only reads Stripe and Chargebee invoices so far.",
  },
  {
    kind: "belief",
    label: "Your belief",
    question: "What do you believe about this problem that most people in your space don't?",
    placeholder: "Leakage is rarely a billing bug. It's an event that arrives after the invoice run.",
  },
];

export function intakeFor(kind: StudioMaterial["kind"]): IntakeQuestion | undefined {
  return INTAKE.find((q) => q.kind === kind);
}

/** The questions the founder hasn't answered yet, most useful first. POVs count as beliefs. */
export function openQuestions(ws: Workspace): IntakeQuestion[] {
  const have = new Set(ws.studio.material.map((m) => m.kind));
  if (ws.povs.length) have.add("belief");
  if (ws.claims.some((c) => c.approved && c.kind === "metric")) have.add("number");
  if ((ws.foundation?.messaging.customerWords.length ?? 0) > 0) have.add("quote");
  return INTAKE.filter((q) => !have.has(q.kind));
}
