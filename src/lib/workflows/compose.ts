import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { defineTool, type AgentTool } from "@/lib/ai/engine";
import { AgentError } from "@/lib/ai/errors";
import { EMBER_CORE, companyContext, taskHeader } from "@/lib/ai/prompts/core";
import { CRITIC_RULES, OUTREACH_RULES, REPLY_READ_RULES, fmtAngle, fmtEvidence, fmtRecipient, fmtVoice } from "@/lib/ai/prompts/outreach";
import { shortDate } from "@/lib/client/format";
import { applyAction } from "@/lib/domain/actions";
import { addDays, monthKey, newId, nowISO, todayISO } from "@/lib/domain/ids";
import type {
  Account,
  Activity,
  Angle,
  BetArm,
  DraftCritic,
  DraftFrame,
  DraftStep,
  Evidence,
  MoveKind,
  OutreachPackage,
  Person,
  Persona,
  ReplyIntent,
  Workspace,
} from "@/lib/domain/types";
import { lintStep, recentDraftsFor } from "@/lib/quality/context";
import { preflight, resolveEmail } from "@/lib/quality/gates";
import { countWords } from "@/lib/quality/lint";
import { pickReference } from "@/lib/quality/references";
import { localReferences } from "@/lib/quality/references-store";
import { nextFollowUp, recentFirstTouch, repliedSinceFirstTouch, senderOwnsSequence, sequenceOwnerName } from "@/lib/quality/sequence";
import { stripGreeting, sentences } from "@/lib/quality/similarity";
import { activeBet, betSteer, nextArm, steerable } from "@/lib/learning/bets";
import { signalTypeFor } from "@/lib/learning/tags";
import { defineWorkflow, type WorkflowContext } from "./types";

/**
 * W5 — the outreach composer. Code gathers and checks; Sonnet writes; Haiku judges.
 *   generate (Sonnet, effort medium, no web) → lint + span check (code) → regenerate once with the
 *   violations → blind pairwise critic (Haiku, low) → regenerate once if it wouldn't get a reply →
 *   pre-send gates (code) → persist ws.outreach[id].
 * Modes: cold · follow_up (next due step) · linkedin · warm_intro · reply. `alternate: true` writes a
 * different angle for an existing cold package (the "]" key).
 */

const MODES = ["cold", "follow_up", "linkedin", "warm_intro", "reply"] as const;
type Mode = (typeof MODES)[number];

const Args = z.object({
  domain: z.string().min(1),
  personId: z.string().optional(),
  angleId: z.string().optional(),
  mode: z.enum(MODES).optional(),
  replyText: z.string().max(10_000).optional(),
  receivedAt: z.string().optional(),
  connectorId: z.string().optional(),
  /** follow_up / alternate: the package to extend. */
  packageId: z.string().optional(),
  /** Write a different angle for `packageId`'s first touch into its alternates. */
  alternate: z.boolean().optional(),
  /** Cold mode: the person who pointed the founder here (a referral reply). The referral is the premise. */
  referredBy: z.string().optional(),
  /** Cold mode, with referredBy: what they said when the referral came on a call (a debrief quote). */
  referralQuote: z.string().max(600).optional(),
});
type ComposeArgs = z.infer<typeof Args>;

export interface ComposeResult {
  drafts: number;
  packageId: string;
  alternateIndex?: number;
  /** Reply mode, unsubscribe: no draft. The founder confirms this with one click. */
  suppress?: { email?: string; domain: string; personId?: string };
}

/* ─────────────────────────────── Tools (byte-stable per mode, so the prompt cache holds) ─────────────────────────────── */

const Span = z.object({
  text: z.string().max(200).describe("The exact phrase, copied from the body (≤200 chars)."),
  evidenceId: z.string().describe("Id of the evidence this phrase rests on, e.g. ev_3f9k2m1x0q."),
});
const Spans = z.array(Span).max(4).describe("Every personalized phrase with its evidence id. Up to 4; never pad.");

const EmailDraft = z.object({
  frame: z
    .enum(["founder_card", "4t", "problem_prompter", "observation_problem_proof", "mouse_trap", "referral", "permission_to_close"])
    .describe("The frame you used. Must be one the task allows."),
  subject: z.string().max(80).nullable().describe("1–5 words in the founder's style. null for a same-thread follow-up."),
  body: z
    .string()
    .max(1200)
    .describe("Greeting and message only. No sign-off, signature or footer. Step 1: 40–90 words (never over 100; mouse_trap 12–60, never over 75). Follow-ups 25–60. Final ≤45."),
  personalizedSpans: Spans,
  povId: z.string().nullable().describe("The founder POV id you used, or null."),
  credentialClaimId: z.string().nullable().describe("An approved credential claim id you used, or null."),
  claimIds: z.array(z.string()).max(3).describe("Approved claim ids that any statement about us relies on. Up to 3; usually empty."),
  assetId: z.string().nullable().describe("Asset id when the question offers a resource; otherwise null."),
});
type EmailDraftT = z.infer<typeof EmailDraft>;

const LinkedInDraft = z.object({
  note: z.string().max(240).nullable().describe("Connection note, ≤200 characters, no pitch. null when the task says no note."),
  recommendNoNote: z.boolean().describe("true when a blank invite is the better move."),
  message: z.string().max(360).describe("Message after they accept, ≤300 characters: context → insight → one question. No link."),
  personalizedSpans: Spans,
  povId: z.string().nullable().describe("The founder POV id you used, or null."),
  credentialClaimId: z.string().nullable().describe("An approved credential claim id you used, or null."),
});
type LinkedInDraftT = z.infer<typeof LinkedInDraft>;

const IntroDraft = z.object({
  wrapper: z.string().max(600).describe("Note to the connector, ≤60 words: the ask, why this person, and that they can forward the note below."),
  subject: z.string().max(80).describe("Forwardable subject, 1–5 words."),
  forwardable: z.string().max(1000).describe("≤120 words: who I am (1 line) → why them (signal) → one proof or credential → 20 minutes of their perspective."),
  personalizedSpans: Spans,
  povId: z.string().nullable().describe("The founder POV id you used, or null."),
  credentialClaimId: z.string().nullable().describe("An approved credential claim id you used, or null."),
  claimIds: z.array(z.string()).max(3).describe("Approved claim ids used. Up to 3; usually empty."),
});
type IntroDraftT = z.infer<typeof IntroDraft>;

const ReplyDraft = z.object({
  body: z.string().max(700).describe("The reply, ≤60 words. Greeting optional. No sign-off, no footer."),
  assetId: z.string().nullable().describe("An asset id only if they asked for info and one fits; else null."),
  claimIds: z.array(z.string()).max(3).describe("Approved claim ids used. Usually empty."),
  checkBackOn: z.string().nullable().describe("not_now only: the ISO date (YYYY-MM-DD) proposed for the check-in; else null."),
});
type ReplyDraftT = z.infer<typeof ReplyDraft>;

const ReplyRead = z.object({
  intent: z.enum(["positive", "info_request", "referral", "not_now", "objection", "negative", "unsubscribe", "ooo"]).describe("What the reply is."),
  summary: z.string().max(160).describe("What they said, plain, ≤120 characters."),
  referralName: z.string().max(80).nullable().describe("Name of the person they referred you to, if written; else null."),
  referralEmail: z.string().max(120).nullable().describe("Their email, if written; else null."),
  checkBackOn: z.string().nullable().describe("ISO date if they named a time; else null."),
});

const Verdict = z.object({
  wouldReply: z.boolean().describe("Would you reply to this email?"),
  fatalIssues: z.array(z.string().max(100)).max(4).describe("Up to 4 fatal issues, a few words each. Empty if none."),
  rewrite: z.string().max(320).describe("≤40 words: the one change most likely to earn a reply. Empty if you'd reply."),
});
const Critique = z.object({
  a: Verdict,
  b: Verdict,
  preferred: z.enum(["A", "B"]).describe("If you could answer only one."),
  unsupportedSpans: z.array(z.string().max(200)).max(4).describe("Span texts that do NOT follow from their quote. Empty if all do."),
  povObvious: z.boolean().describe("true if the point-of-view sentence is something your role has heard many times."),
});
type CritiqueT = z.infer<typeof Critique>;

const submitEmail = defineTool({ name: "submit_draft", description: "Submit the email draft. Call exactly once.", schema: EmailDraft, terminal: true });
const submitLinkedIn = defineTool({ name: "submit_linkedin", description: "Submit the LinkedIn note and message. Call exactly once.", schema: LinkedInDraft, terminal: true });
const submitIntro = defineTool({ name: "submit_intro", description: "Submit the intro ask and the forwardable note. Call exactly once.", schema: IntroDraft, terminal: true });
const submitReply = defineTool({ name: "submit_reply", description: "Submit the reply draft. Call exactly once.", schema: ReplyDraft, terminal: true });
export const submitRead = defineTool({ name: "submit_reply_read", description: "Submit how you read the reply. Call exactly once.", schema: ReplyRead, terminal: true });
const submitCritique = defineTool({ name: "submit_critique", description: "Submit your judgment. Call exactly once.", schema: Critique, terminal: true });

/* ─────────────────────────────── Workspace reads (code gathers, ranks and trims) ─────────────────────────────── */

const USABLE = (ev: Evidence | undefined): ev is Evidence => Boolean(ev && !ev.flaggedWrong && (ev.confidence === "high" || ev.confidence === "medium"));

/** Dossier angles best first; without a dossier, outreach-usable signals become angles. */
function anglesFor(ws: Workspace, account: Account): Angle[] {
  const dossier = [...(account.dossier?.angles ?? [])].filter((a) => a.evidenceIds.some((id) => USABLE(ws.evidence[id])));
  dossier.sort((a, b) => b.strength - a.strength);
  if (dossier.length) return dossier;
  return account.signals
    .filter((s) => s.usableInOutreach && s.evidenceId && USABLE(ws.evidence[s.evidenceId]))
    .sort((a, b) => b.strength - a.strength || b.date.localeCompare(a.date))
    .slice(0, 4)
    .map(
      (s): Angle => ({
        id: `sig_${s.id}`,
        title: s.headline.split(/\s+/).slice(0, 8).join(" "),
        signal: `${s.headline} (${s.date})`,
        interpretation: s.implication,
        pressure: "",
        pov: "",
        proof: null,
        ask: "",
        evidenceIds: [s.evidenceId!],
        bestFor: "champion",
        strength: Math.min(5, Math.max(1, s.strength + 2)) as Angle["strength"],
      }),
    );
}

function evidenceFor(ws: Workspace, account: Account, angle: Angle | undefined, exclude: Set<string> = new Set()): Evidence[] {
  const ids = [
    ...(angle?.evidenceIds ?? []),
    ...account.signals.map((s) => s.evidenceId).filter(Boolean),
    ...(account.dossier?.facts ?? []).flatMap((f) => f.evidenceIds),
    ...(account.dossier?.painHypotheses ?? []).flatMap((p) => p.evidenceIds),
  ] as string[];
  const out: Evidence[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const ev = ws.evidence[id];
    if (USABLE(ev)) out.push(ev);
  }
  // Fresh-first among the non-angle evidence; the angle's own evidence stays on top.
  const angleIds = new Set(angle?.evidenceIds ?? []);
  const top = out.filter((e) => angleIds.has(e.id));
  const rest = out.filter((e) => !angleIds.has(e.id)).sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));
  return [...top, ...rest.filter((e) => !exclude.has(e.id)), ...rest.filter((e) => exclude.has(e.id))].slice(0, 8);
}

function pickPerson(ws: Workspace, account: Account, personId: string | undefined, angle: Angle | undefined): Person | undefined {
  if (personId) return ws.people[personId];
  const people = account.peopleIds.map((id) => ws.people[id]).filter((p): p is Person => Boolean(p && !p.doNotContact));
  const rec = account.dossier?.recommendation.personId;
  return (
    (rec ? people.find((p) => p.id === rec) : undefined) ??
    (angle ? people.find((p) => p.role === angle.bestFor) : undefined) ??
    people.find((p) => p.role === "champion") ??
    people[0]
  );
}

function personaFor(ws: Workspace, person: Person | undefined): Persona | undefined {
  const personas = ws.foundation?.personas ?? [];
  if (!person) return undefined;
  const title = person.title.toLowerCase();
  return personas.find((p) => p.titles.some((t) => title.includes(t.toLowerCase()))) ?? personas.find((p) => p.role === person.role);
}

const EXEC = /\b(vp|vice president|chief|head of|director|c[eftio]o|founder|president|partner)\b/i;

/** Frames the model may use. With no approved peer proof the frame is advice-first (founder_card). */
function allowedFrames(ws: Workspace, person: Person | undefined, step: number): DraftFrame[] {
  if (step === 3) return ["referral", "permission_to_close"];
  const peerProof = ws.claims.some((c) => c.approved && c.kind !== "credential");
  if (step === 2) return peerProof ? ["4t", "mouse_trap", "founder_card", "observation_problem_proof"] : ["mouse_trap", "founder_card", "4t"];
  if (!peerProof) return ["founder_card"];
  const frames: DraftFrame[] = ["founder_card", "4t", "observation_problem_proof", "mouse_trap"];
  if (person && EXEC.test(person.title)) frames.push("problem_prompter");
  return frames;
}

function recentOpeners(ws: Workspace, domain: string): string[] {
  return recentDraftsFor(ws, null, domain)
    .filter((r) => r.ageDays <= 7)
    .map((r) => sentences(stripGreeting(r.body))[0] ?? "")
    .filter(Boolean)
    .slice(0, 6)
    .map((s) => (s.length > 90 ? `${s.slice(0, 87)}…` : s));
}

function priorTouches(ws: Workspace, pkg: OutreachPackage | undefined): string {
  if (!pkg) return "";
  const sent = pkg.steps.filter((s) => s.status === "sent" || s.status === "approved");
  if (!sent.length) return "";
  return sent.map((s) => `<touch step="${s.step}" sent="${s.sentAt?.slice(0, 10) ?? ""}"${s.subject ? ` subject="${s.subject}"` : ""}>\n${s.body}\n</touch>`).join("\n");
}

function lines(...parts: (string | number | false | null | undefined)[]): string {
  return parts.filter((p): p is string => typeof p === "string" && p.length > 0).join("\n\n");
}

/* ─────────────────────────────── Generation with one feedback loop ─────────────────────────────── */

interface Gen<T> {
  data: T;
  messages: Anthropic.Beta.BetaMessageParam[];
}

const SYSTEM = (ws: Workspace) => [EMBER_CORE, OUTREACH_RULES, companyContext(ws)];

async function generate<T>(
  ctx: WorkflowContext<ComposeArgs>,
  ws: Workspace,
  tool: AgentTool,
  task: string,
  effort: "low" | "medium",
  prior?: { messages: Anthropic.Beta.BetaMessageParam[]; feedback: string },
): Promise<Gen<T>> {
  let messages: Anthropic.Beta.BetaMessageParam[];
  if (prior) {
    // Replace our own "Saved." tool_result (never seen by the model) with the feedback, so the model
    // revises in context instead of starting over.
    const history = [...prior.messages];
    const last = history[history.length - 1];
    const assistant = history[history.length - 2];
    const use =
      assistant && Array.isArray(assistant.content)
        ? (assistant.content as Anthropic.Beta.BetaContentBlockParam[]).find((b): b is Anthropic.Beta.BetaToolUseBlockParam => b.type === "tool_use" && b.name === tool.name)
        : undefined;
    if (use && last?.role === "user") {
      history[history.length - 1] = {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: use.id, is_error: true, content: `${prior.feedback}\nRevise and call ${tool.name} again.` }],
      };
      messages = history;
    } else {
      messages = [{ role: "user", content: `${task}\n\n<revise>\n${prior.feedback}\n</revise>` }];
    }
  } else {
    messages = [{ role: "user", content: task }];
  }
  const res = await ctx.agent<T>({
    tier: "operator",
    system: SYSTEM(ws),
    messages,
    tools: [tool],
    effort,
    maxTokens: 8000,
    requireTerminal: true,
  });
  if (res.result === undefined) throw new AgentError("I couldn't finish that draft. Try again in a moment.", "unknown");
  return { data: res.result, messages: res.messages };
}

/**
 * Drops ids the model invented; returns what it dropped so the revision can fix it. `spans` holds
 * only real citations; `lintSpans` also keeps each rejected phrase under an id that never resolves,
 * so lint flags it (SPAN_UNSUPPORTED) for as long as the phrase stays in the body.
 */
function sanitizeRefs(
  ws: Workspace,
  allowedEvidence: Set<string>,
  draft: { personalizedSpans: { text: string; evidenceId: string }[]; povId: string | null; credentialClaimId: string | null; claimIds?: string[]; assetId?: string | null },
) {
  const problems: string[] = [];
  const spans: { text: string; evidenceId: string }[] = [];
  const lintSpans: { text: string; evidenceId: string }[] = [];
  for (const s of draft.personalizedSpans) {
    if (allowedEvidence.has(s.evidenceId)) {
      spans.push(s);
      lintSpans.push(s);
      continue;
    }
    problems.push(`Span "${s.text.slice(0, 50)}" cites ${s.evidenceId}, which isn't in the evidence list. Cite a listed id or drop the phrase.`);
    lintSpans.push({ text: s.text, evidenceId: `unresolved:${s.evidenceId}` });
  }
  const povId = draft.povId && ws.povs.some((p) => p.id === draft.povId) ? draft.povId : null;
  if (draft.povId && !povId) problems.push(`povId ${draft.povId} doesn't exist. Use one of the founder's POV ids.`);
  const cred = draft.credentialClaimId && ws.claims.some((c) => c.id === draft.credentialClaimId && c.approved && c.kind === "credential") ? draft.credentialClaimId : null;
  if (draft.credentialClaimId && !cred) problems.push(`credentialClaimId ${draft.credentialClaimId} isn't an approved credential claim.`);
  const claimIds = (draft.claimIds ?? []).filter((id) => {
    const ok = ws.claims.some((c) => c.id === id && c.approved);
    if (!ok) problems.push(`CLAIM_UNAPPROVED: ${id} isn't an approved claim. Remove the statement it supports.`);
    return ok;
  });
  const assetId = draft.assetId && ws.assets.some((a) => a.id === draft.assetId && a.approved === true) ? draft.assetId : null;
  if (draft.assetId && !assetId) problems.push(`assetId ${draft.assetId} isn't an approved asset. Drop the resource offer or use a listed asset.`);
  return { spans, lintSpans, povId, credentialClaimId: cred, claimIds, assetId, problems };
}

function errorsOf(lint: DraftStep["lint"]): string[] {
  return lint.violations.filter((v) => v.severity === "error").map((v) => `${v.code}: ${v.detail}`);
}

/** Lower is better: lint errors plus refs the model invented (dropped claims and assets leave no text to lint). */
function score(x: { step: DraftStep; problems: string[] }): number {
  return errorsOf(x.step.lint).length + x.problems.length;
}

const CLAIM_WARNING = "A sentence relied on a claim that isn't approved. Check statements about us.";

/** Codes the model can't fix by rewriting (missing founder input) — don't spend a loop on them. */
function fixable(lint: DraftStep["lint"], ws: Workspace): boolean {
  const noPovSource = !ws.povs.length && !ws.claims.some((c) => c.approved && c.kind === "credential");
  return lint.violations.some((v) => v.severity === "error" && !(v.code === "POV_MISSING" && noPovSource));
}

/* ─────────────────────────────── Critic (Haiku, blind, pairwise) ─────────────────────────────── */

/** Exported for the critic eval (src/lib/quality/critic-eval.ts), which runs it on a labeled set. */
export async function critique(ctx: Pick<WorkflowContext<unknown>, "agent">, ws: Workspace, step: DraftStep, person: Pick<Person, "title"> | undefined, account: Account): Promise<DraftCritic | null> {
  const ref = pickReference(ws, step.frame, step.step, Math.random, localReferences());
  const draftIsA = Math.random() < 0.5;
  const draftText = step.subject ? `Subject: ${step.subject}\n\n${step.body}` : step.body;
  const [a, b] = draftIsA ? [draftText, ref.text] : [ref.text, draftText];
  const label = draftIsA ? "A" : "B";
  const spans = step.personalizedSpans
    .map((s) => {
      const ev = ws.evidence[s.evidenceId];
      return ev ? `- "${s.text}" ← quote: "${ev.quote}"` : null;
    })
    .filter(Boolean);
  const pov = step.povId ? ws.povs.find((p) => p.id === step.povId)?.text : undefined;
  const band = account.dossier?.snapshot.headcount?.value;
  const who = `You are ${person?.title ? `a ${person.title}` : "a senior buyer"} at a ${band ? `${band}-person` : "small"} company.`;
  try {
    const res = await ctx.agent<CritiqueT>({
      tier: "fast",
      system: CRITIC_RULES,
      messages: [
        {
          role: "user",
          content: lines(
            who,
            `<email label="A">\n${a}\n</email>`,
            `<email label="B">\n${b}\n</email>`,
            spans.length ? `Spans from email ${label}:\n${spans.join("\n")}` : `Email ${label} has no spans to check.`,
            pov ? `Point-of-view sentence in email ${label} rests on: "${pov}"` : `Email ${label} states no point of view; answer povObvious false.`,
          ),
        },
      ],
      tools: [submitCritique],
      effort: "low",
      maxTokens: 3000,
      requireTerminal: true,
    });
    const r = res.result;
    if (!r) return null;
    const mine = draftIsA ? r.a : r.b;
    return {
      wouldReply: mine.wouldReply,
      preferredOverReference: r.preferred === label,
      povObvious: Boolean(pov) && r.povObvious,
      fatal: mine.fatalIssues,
      rewrite: mine.rewrite,
      unsupportedSpans: r.unsupportedSpans,
      referenceId: ref.id,
      at: nowISO(),
    };
  } catch (err) {
    // The critic is a quality pass, not a gate: if it fails, ship the linted draft.
    if (err instanceof AgentError && err.code === "stopped") throw err;
    return null;
  }
}

export function criticPassed(c: DraftCritic | null): boolean {
  return !c || (c.wouldReply && c.fatal.length === 0 && c.unsupportedSpans.length === 0 && !c.povObvious);
}

function criticFeedback(c: DraftCritic): string {
  const parts = ["A busy buyer read this and would not reply."];
  if (c.fatal.length) parts.push(`Fatal issues: ${c.fatal.join("; ")}.`);
  if (c.rewrite) parts.push(`Rewrite instruction: ${c.rewrite}`);
  if (c.unsupportedSpans.length) parts.push(`These phrases don't follow from their quotes; fix or drop them: ${c.unsupportedSpans.map((s) => `"${s}"`).join(", ")}.`);
  if (c.povObvious) parts.push("The point of view is one they've heard many times. Use a sharper one from the POV bank, or the credential.");
  parts.push("Keep every rule from before (length, one question, spans, banned phrases).");
  return parts.join("\n");
}

/* ─────────────────────────────── Email drafting (cold, alternate, follow-up) ─────────────────────────────── */

interface EmailPlan {
  ws: Workspace;
  account: Account;
  person: Person | undefined;
  angle: Angle | undefined;
  angles: Angle[];
  evidence: Evidence[];
  step: number;
  sendOn: string;
  thread: "new" | "reply";
  frames: DraftFrame[];
  pkg?: OutreachPackage;
  extra?: string;
  /** The message-bet arm this first touch is written for, when a bet runs. */
  bet?: BetArm;
}

function emailTask(plan: EmailPlan): string {
  const { ws, account, person, angle, evidence, step } = plan;
  const persona = personaFor(ws, person);
  const credentials = ws.claims.filter((c) => c.approved && c.kind === "credential");
  const openers = recentOpeners(ws, account.domain);
  const what =
    step === 1
      ? `Write the cold first touch (step 1, new thread) to ${person?.name ?? "the right person"} at ${account.name}.`
      : step === 2
        ? `Write follow-up step 2 (day +3, same thread, so subject is null) to ${person?.name ?? "them"} at ${account.name}. Use a NEW angle or a second implication, and cite evidence you didn't use before. 25–60 words.`
        : `Write the final step 3 (day +8, same thread, subject null) to ${person?.name ?? "them"} at ${account.name}: referral or permission_to_close, ≤45 words.`;
  return lines(
    taskHeader(),
    `<task>${what}\nAllowed frames: ${plan.frames.join(", ")}.${plan.frames.length === 1 && plan.frames[0] === "founder_card" ? " (No approved peer proof yet, so this is an advice ask: their view, not a meeting.)" : ""}</task>`,
    `<recipient>\n${fmtRecipient(person, persona, account.name, account.domain)}\n</recipient>`,
    angle && `<angle>\n${fmtAngle(angle)}\n</angle>`,
    evidence.length ? `<evidence>\n${evidence.map(fmtEvidence).join("\n")}\n</evidence>` : "<evidence>none usable</evidence>",
    step === 1 &&
      (ws.povs.length || credentials.length
        ? `<pov_rule>Use one POV id from company_context${credentials.length ? ` or one credential claim id (${credentials.map((c) => c.id).join(", ")})` : ""}. Least-used POVs: ${[...ws.povs]
            .sort((a, b) => a.uses - b.uses)
            .slice(0, 3)
            .map((p) => p.id)
            .join(", ")}.</pov_rule>`
        : "<pov_rule>The founder has no POV or credential on file yet. Use the angle's 'why the obvious fix fails' as an observation, set povId and credentialClaimId to null.</pov_rule>"),
    plan.pkg && priorTouches(ws, plan.pkg) && `<prior_touches>\n${priorTouches(ws, plan.pkg)}\n</prior_touches>`,
    openers.length && `<recent_openers note="don't open the same way">\n${openers.map((o) => `- ${o}`).join("\n")}\n</recent_openers>`,
    `<voice>\n${fmtVoice(ws)}\n</voice>`,
    plan.extra,
  );
}

async function draftEmail(ctx: WorkflowContext<ComposeArgs>, plan: EmailPlan, mode: OutreachPackage["mode"]): Promise<{ step: DraftStep; warnings: string[] }> {
  const { ws } = plan;
  const allowed = new Set(plan.evidence.map((e) => e.id));
  const task = emailTask(plan);
  const shell: OutreachPackage = {
    id: plan.pkg?.id ?? "pending",
    mode,
    personId: plan.person?.id,
    accountDomain: plan.account.domain,
    createdAt: nowISO(),
    steps: [],
    alternates: [],
    blockers: [],
    warnings: [],
  };

  const build = (d: EmailDraftT): { step: DraftStep; problems: string[] } => {
    const refs = sanitizeRefs(ws, allowed, d);
    const problems = [...refs.problems];
    let frame: DraftFrame = d.frame;
    if (!plan.frames.includes(frame)) {
      problems.push(`Frame ${frame} isn't allowed here. Use ${plan.frames.join(" or ")}.`);
      frame = plan.frames[0];
    }
    const step: DraftStep = {
      step: plan.step,
      personalizedSpans: refs.lintSpans,
      povId: refs.povId ?? undefined,
      credentialClaimId: refs.credentialClaimId ?? undefined,
      assetId: refs.assetId ?? undefined,
      sendOn: plan.sendOn,
      thread: plan.thread,
      subject: plan.thread === "reply" ? null : (d.subject?.trim() ?? null),
      body: d.body.trim(),
      frame,
      evidenceIds: [...new Set(refs.spans.map((s) => s.evidenceId))],
      claimIds: refs.claimIds,
      lint: { passed: true, violations: [], stats: { words: 0, fkGrade: 0, you: 0, iWe: 0, questionMarks: 0, links: 0 } },
      status: "draft",
      angleId: plan.angle?.id,
    };
    // Stamped for the learning reviews: which why-now signal this rests on, and the bet arm it was written for.
    const signalType = signalTypeFor(plan.account, plan.angle?.id, step.evidenceIds);
    if (signalType) step.signalType = signalType;
    if (plan.bet) step.bet = plan.bet;
    if (plan.step > 1 && plan.pkg) {
      const used = new Set(plan.pkg.steps.flatMap((s) => s.evidenceIds));
      if (step.evidenceIds.length && step.evidenceIds.every((id) => used.has(id)) && step.angleId === plan.pkg.angleId) {
        problems.push("This follow-up reuses the same angle and sources as before. Use a new implication or a source you haven't cited.");
      }
    }
    step.lint = lintStep(ws, shell, step);
    return { step, problems };
  };

  const status = plan.step > 1 ? `Drafting follow-up ${plan.step - 1}` : plan.angle ? `Drafting from “${plan.angle.title}”` : "Drafting the first email";
  ctx.emit({ type: "status", text: status });
  let gen = await generate<EmailDraftT>(ctx, ws, submitEmail, task, "medium");
  let { step, problems } = build(gen.data);

  ctx.emit({ type: "status", text: "Checking length, tone and sources" });
  if (problems.length || fixable(step.lint, ws)) {
    ctx.emit({ type: "status", text: `Fixing ${score({ step, problems }) === 1 ? "one issue" : `${score({ step, problems })} issues`}` });
    const again = await generate<EmailDraftT>(ctx, ws, submitEmail, task, "medium", { messages: gen.messages, feedback: [...problems, ...errorsOf(step.lint)].join("\n") });
    const next = build(again.data);
    if (score(next) <= score({ step, problems })) {
      gen = again;
      ({ step, problems } = next);
    }
  }

  if (mode === "cold" || mode === "follow_up") {
    ctx.emit({ type: "status", text: "Reading it the way a busy buyer would" });
    const verdict = await critique(ctx, ws, step, plan.person, plan.account);
    step.critic = verdict ?? undefined;
    if (verdict && !criticPassed(verdict)) {
      ctx.emit({ type: "status", text: "Sharpening the first line" });
      const again = await generate<EmailDraftT>(ctx, ws, submitEmail, task, "medium", { messages: gen.messages, feedback: criticFeedback(verdict) });
      const next = build(again.data);
      // A rewrite that leans on invented sources, claims or assets never replaces a cleaner draft.
      if (score(next) <= score({ step, problems })) {
        next.step.critic = verdict; // the verdict that prompted the rewrite (telemetry)
        ({ step, problems } = next);
      }
    }
  }
  return { step, warnings: problems.some((p) => p.startsWith("CLAIM_UNAPPROVED")) ? [CLAIM_WARNING] : [] };
}

/* ─────────────────────────────── Persistence helpers ─────────────────────────────── */

const MOVE_KIND: Record<Mode, MoveKind> = { cold: "first_touch", follow_up: "follow_up", reply: "reply", linkedin: "linkedin", warm_intro: "intro_ask" };

function finalize(ws: Workspace, pkg: OutreachPackage): OutreachPackage {
  const step = pkg.steps.find((s) => s.status === "draft") ?? pkg.steps[0];
  const pf = preflight(ws, pkg, step);
  return { ...pkg, blockers: pf.blockers.map((b) => b.text), warnings: pf.warnings };
}

/**
 * Gates no edit can fix (EU/UK guessed address, Canada without a first-party address), checked
 * before any tokens are spent. Caps stay out: those drafts queue until a slot opens.
 */
const CHANNEL_BLOCKS = new Set(["guess_blocked", "ca_unpublished"]);
function channelBlocker(ws: Workspace, pkg: OutreachPackage, stepNo: number) {
  return preflight(ws, pkg, { step: stepNo, status: "draft" } as DraftStep).blockers.find((b) => CHANNEL_BLOCKS.has(b.code));
}

/** What the referrer said, for a first touch that rests on their referral. `onCall`: their words from a debrief. */
export function referralBlock(ws: Workspace, referrer: Person, person: Person | undefined, onCall?: string): string {
  const newest = <T extends { at: string }>(xs: T[]) => xs.sort((x, y) => y.at.localeCompare(x.at))[0];
  const said =
    onCall?.trim() ||
    newest(
      Object.values(ws.outreach)
        .filter((p) => p.mode === "reply" && p.personId === referrer.id && p.reply?.intent === "referral")
        .map((p) => ({ at: p.createdAt, text: p.reply?.text ?? "" })),
    )?.text ||
    newest(ws.activities.filter((x) => x.kind === "reply_received" && x.personId === referrer.id && x.body))?.body ||
    "";
  const quote = said.replace(/\s+/g, " ").trim().slice(0, 300);
  const company = ws.accounts[referrer.accountDomain]?.name ?? referrer.accountDomain;
  return `<referral>${referrer.name}${referrer.title ? `, ${referrer.title}` : ""} at ${company}, suggested you write to ${person?.name ?? "this person"}.${quote ? ` Their words: "${quote}"` : ""}</referral>`;
}

/** Attaches the draft to the founder's open move for this person or company, if one is waiting for it. */
function linkMove(ws: Workspace, pkg: OutreachPackage, mode: Mode, step: number) {
  const kind = MOVE_KIND[mode];
  for (const move of Object.values(ws.moves)) {
    if (move.status !== "open" || move.kind !== kind || move.draft) continue;
    const ref = move.ref;
    const matches = (ref?.kind === "person" && ref.id === pkg.personId) || (ref?.kind === "account" && ref.id === pkg.accountDomain);
    if (matches) {
      move.draft = { packageId: pkg.id, step };
      return;
    }
  }
}

function notePovUse(ws: Workspace, step: DraftStep) {
  const pov = step.povId ? ws.povs.find((p) => p.id === step.povId) : undefined;
  if (pov) pov.uses += 1;
}

/* ─────────────────────────────── Modes ─────────────────────────────── */

async function runCold(ctx: WorkflowContext<ComposeArgs>, ws: Workspace, account: Account): Promise<ComposeResult> {
  const a = ctx.args;
  ctx.emit({ type: "status", text: "Choosing the strongest angle" });
  const angles = anglesFor(ws, account);
  // A referral is the reason to write, so it needs no dated signal.
  const referrer = a.referredBy ? ws.people[a.referredBy] : undefined;
  if (!angles.length && !referrer) {
    throw new AgentError(`I need a dated reason to write to ${account.name}. Research it first and I'll draft from what I find.`, "bad_request");
  }
  const existing = Object.values(ws.outreach).filter((p) => p.accountDomain === account.domain && p.mode === "cold");
  const used = new Set(existing.flatMap((p) => [p.angleId, ...p.alternates.map((s) => s.angleId)]).filter(Boolean));
  const angle: Angle | undefined = (a.angleId && angles.find((x) => x.id === a.angleId)) || angles.find((x) => !used.has(x.id)) || angles[0];
  const person = pickPerson(ws, account, a.personId, angle);

  // One first touch per person: reopen an open draft for free; never start a second cold thread to someone mid-sequence.
  if (person) {
    const theirs = Object.values(ws.outreach)
      .filter((p) => p.mode === "cold" && p.personId === person.id)
      .sort((x, y) => y.createdAt.localeCompare(x.createdAt));
    const open = theirs.find((p) => p.steps.some((s) => s.step === 1 && s.status === "draft"));
    if (open) return { drafts: 0, packageId: open.id };
    const sent = theirs.find((p) => recentFirstTouch(p));
    if (sent) {
      const next = nextFollowUp(sent, undefined, ws.activities);
      const then = next
        ? `The follow-up is due ${shortDate(next.dueOn)}.`
        : repliedSinceFirstTouch(sent, ws.activities)
          ? "They replied, so answer in that thread."
          : senderOwnsSequence(sent)
            ? `${sequenceOwnerName(sent)} sends the follow-ups. Give it 60 days and a new signal before another first touch.`
            : "Give it 60 days and a new signal before another first touch.";
      throw new AgentError(`You wrote to ${person.name.split(" ")[0]} on ${shortDate(recentFirstTouch(sent)?.sentAt ?? sent.createdAt)}. ${then}`, "bad_request");
    }
  }
  const pending: OutreachPackage = { id: "pending", mode: "cold", personId: person?.id, accountDomain: account.domain, createdAt: nowISO(), steps: [], alternates: [], blockers: [], warnings: [] };
  const blocked = channelBlocker(ws, pending, 1);
  if (blocked) throw new AgentError(blocked.text, "bad_request");

  const evidence = evidenceFor(ws, account, angle);
  for (const ev of evidence.slice(0, 3)) ctx.emit({ type: "read", url: ev.url, host: ev.host });

  const frames = allowedFrames(ws, person, 1);
  // A running message bet (writing variables): this draft goes to the arm with fewer drafts. Referrals stay out of it.
  const bet = activeBet(ws, todayISO());
  const arm = steerable(bet) && !referrer ? { bet, arm: nextArm(ws, bet) } : undefined;
  const steer = arm ? betSteer(arm.bet, arm.arm, frames) : undefined;
  const { step, warnings } = await draftEmail(
    ctx,
    {
      ws,
      account,
      person,
      angle,
      angles,
      evidence,
      step: 1,
      sendOn: todayISO(),
      thread: "new",
      frames: referrer ? ["referral", ...frames] : (steer?.frames ?? frames),
      extra: referrer ? referralBlock(ws, referrer, person, a.referralQuote) : steer?.block,
      bet: arm ? { id: arm.bet.id, arm: arm.arm } : undefined,
    },
    "cold",
  );

  ctx.emit({ type: "status", text: "Checking send rules" });
  const pkg = await ctx.mutate((draft) => {
    const p = finalize(draft, {
      id: newId("out"),
      mode: "cold",
      personId: person?.id,
      accountDomain: account.domain,
      angleId: angle?.id,
      angleOrder: angles.map((x) => x.id),
      createdAt: nowISO(),
      runId: ctx.runId,
      steps: [step],
      alternates: [],
      blockers: [],
      warnings: [],
    });
    p.warnings = [...p.warnings, ...warnings];
    draft.outreach[p.id] = p;
    notePovUse(draft, step);
    linkMove(draft, p, "cold", 1);
    return p;
  });
  return { drafts: 1, packageId: pkg.id };
}

async function runAlternate(ctx: WorkflowContext<ComposeArgs>, ws: Workspace, account: Account): Promise<ComposeResult> {
  const a = ctx.args;
  const pkg = a.packageId ? ws.outreach[a.packageId] : undefined;
  if (!pkg) throw new AgentError("I can't find that draft anymore.", "bad_request");
  const first = pkg.steps.find((s) => s.step === 1);
  if (!first || first.status !== "draft") throw new AgentError("That email already went out. Different angles are for drafts.", "bad_request");
  const blocked = channelBlocker(ws, pkg, 1);
  if (blocked) throw new AgentError(blocked.text, "bad_request");
  ctx.emit({ type: "status", text: "Looking for an angle I haven't used" });
  const angles = anglesFor(ws, account);
  const used = new Set([pkg.angleId, first.angleId, ...pkg.alternates.map((s) => s.angleId)].filter(Boolean));
  const angle = (a.angleId && angles.find((x) => x.id === a.angleId)) || angles.find((x) => !used.has(x.id));
  if (!angle) {
    throw new AgentError(`That's every angle I have for ${account.name}. Research it again for fresh signals, or edit this draft.`, "bad_request");
  }
  const person = pkg.personId ? ws.people[pkg.personId] : undefined;
  const usedEvidence = new Set([first, ...pkg.alternates].flatMap((s) => s.evidenceIds));
  const evidence = evidenceFor(ws, account, angle, usedEvidence);
  const sameAngle = used.has(angle.id);
  // A different angle for a bet draft stays in the same arm, so swapping it in keeps the bet balanced.
  const bet = activeBet(ws, todayISO());
  const steer = first.bet && steerable(bet) && bet.id === first.bet.id ? betSteer(bet, first.bet.arm, allowedFrames(ws, person, 1)) : undefined;
  const { step } = await draftEmail(
    ctx,
    {
      ws,
      account,
      person,
      angle,
      angles,
      evidence,
      step: 1,
      sendOn: first.sendOn,
      thread: "new",
      frames: steer?.frames ?? allowedFrames(ws, person, 1),
      extra: [
        sameAngle
          ? `<rewrite>Same angle, new draft: open a different way and use a different POV than before. Not a paraphrase.</rewrite>\n<previous_draft>\n${first.body}\n</previous_draft>`
          : `<different_angle>This replaces a draft built on another angle. Don't reuse its opening or question.</different_angle>\n<previous_draft>\n${first.body}\n</previous_draft>`,
        steer?.block,
      ]
        .filter(Boolean)
        .join("\n"),
      bet: steer ? first.bet : undefined,
    },
    "cold",
  );
  const index = await ctx.mutate((draft) => {
    const live = draft.outreach[pkg.id];
    if (!live) throw new AgentError("That draft was removed while I was writing.", "bad_request");
    live.alternates.push(step);
    live.angleOrder ??= angles.map((x) => x.id);
    notePovUse(draft, step);
    return live.alternates.length - 1;
  });
  return { drafts: 1, packageId: pkg.id, alternateIndex: index };
}

async function runFollowUp(ctx: WorkflowContext<ComposeArgs>, ws: Workspace, account: Account): Promise<ComposeResult> {
  const a = ctx.args;
  const pkg =
    (a.packageId ? ws.outreach[a.packageId] : undefined) ??
    Object.values(ws.outreach)
      .filter((p) => p.mode === "cold" && p.accountDomain === account.domain && (!a.personId || p.personId === a.personId))
      .sort((x, y) => y.createdAt.localeCompare(x.createdAt))[0];
  if (!pkg) throw new AgentError(`There's no first email to ${account.name} to follow up on yet.`, "bad_request");
  if (pkg.steps.some((s) => s.status === "cancelled_by_reply") || repliedSinceFirstTouch(pkg, ws.activities)) {
    throw new AgentError("They replied, so the sequence stopped. Paste their reply and I'll draft a response.", "bad_request");
  }
  if (senderOwnsSequence(pkg)) {
    throw new AgentError(`This lead is in ${sequenceOwnerName(pkg)}, so its campaign sends the follow-ups and stops them on a reply.`, "bad_request");
  }
  const next = nextFollowUp(pkg, undefined, ws.activities);
  if (!next) {
    const sentFirst = pkg.steps.some((s) => s.step === 1 && (s.status === "sent" || s.status === "approved"));
    throw new AgentError(
      sentFirst ? "This sequence is done: three emails is the limit. A blank LinkedIn invite is the next move." : "Send the first email before I write a follow-up.",
      "bad_request",
    );
  }
  if (next.drafted) return { drafts: 0, packageId: pkg.id };
  const blocked = channelBlocker(ws, pkg, next.step);
  if (blocked) throw new AgentError(blocked.text, "bad_request");

  const angles = anglesFor(ws, account);
  const usedAngles = new Set([pkg.angleId, ...pkg.steps.map((s) => s.angleId)].filter(Boolean));
  const angle = next.step === 2 ? (angles.find((x) => !usedAngles.has(x.id)) ?? angles.find((x) => x.id === pkg.angleId) ?? angles[0]) : undefined;
  const person = pkg.personId ? ws.people[pkg.personId] : undefined;
  const usedEvidence = new Set(pkg.steps.flatMap((s) => s.evidenceIds));
  const evidence = evidenceFor(ws, account, angle, usedEvidence);
  const { step, warnings } = await draftEmail(
    ctx,
    { ws, account, person, angle, angles, evidence, step: next.step, sendOn: next.dueOn, thread: "reply", frames: allowedFrames(ws, person, next.step), pkg },
    "follow_up",
  );
  await ctx.mutate((draft) => {
    const live = draft.outreach[pkg.id];
    if (!live) throw new AgentError("That sequence was removed while I was writing.", "bad_request");
    live.steps = [...live.steps.filter((s) => s.step !== step.step), step].sort((x, y) => x.step - y.step);
    const pf = preflight(draft, live, step);
    live.blockers = pf.blockers.map((b) => b.text);
    live.warnings = [...pf.warnings, ...warnings];
    linkMove(draft, live, "follow_up", step.step);
  });
  return { drafts: 1, packageId: pkg.id };
}

async function runLinkedIn(ctx: WorkflowContext<ComposeArgs>, ws: Workspace, account: Account): Promise<ComposeResult> {
  const a = ctx.args;
  ctx.emit({ type: "status", text: "Choosing the strongest angle" });
  const angles = anglesFor(ws, account);
  if (!angles.length) throw new AgentError(`I need a dated reason to write to ${account.name}. Research it first.`, "bad_request");
  const angle = (a.angleId && angles.find((x) => x.id === a.angleId)) || angles[0];
  const person = pickPerson(ws, account, a.personId, angle);
  const evidence = evidenceFor(ws, account, angle);
  const allowedEv = new Set(evidence.map((e) => e.id));

  // LinkedIn Help (a563153): free members get 3 personalized notes a month, 200 characters each.
  // Counted from invites the founder logged with a note (the DM goes out later, after they accept).
  const month = monthKey();
  const notesThisMonth = ws.activities.filter((x) => x.kind === "linkedin_connect" && x.body && x.at.startsWith(month)).length;
  const strongContext = evidence.some((e) => e.sourceType === "community" || e.sourceType === "podcast");
  const allowNote = ws.founder.linkedinPremium === true || (notesThisMonth < 3 && strongContext);
  const noteRule = allowNote
    ? "A note is allowed: write one ≤200 characters only if it rests on their own post, talk or community thread; otherwise set note null and recommendNoNote true."
    : ws.founder.linkedinPremium === false || notesThisMonth >= 3
      ? "No note: the founder's free notes for this month are used. Set note null and recommendNoNote true."
      : "No note: context isn't strong enough (no post, talk or community thread). Set note null and recommendNoNote true.";

  const task = lines(
    taskHeader(),
    `<task>Write a LinkedIn connection request and the message to send a day after ${person?.name ?? "they"} accept${person ? "s" : ""}. ${noteRule}</task>`,
    `<recipient>\n${fmtRecipient(person, personaFor(ws, person), account.name, account.domain)}\n</recipient>`,
    `<angle>\n${fmtAngle(angle)}\n</angle>`,
    `<evidence>\n${evidence.map(fmtEvidence).join("\n")}\n</evidence>`,
    `<voice>\n${fmtVoice(ws)}\n</voice>`,
  );
  const shell: OutreachPackage = { id: "pending", mode: "linkedin", personId: person?.id, accountDomain: account.domain, createdAt: nowISO(), steps: [], alternates: [], blockers: [], warnings: [] };
  const build = (d: LinkedInDraftT) => {
    const refs = sanitizeRefs(ws, allowedEv, d);
    const note = allowNote && d.note?.trim() ? d.note.trim() : null;
    const step: DraftStep = {
      step: 1,
      personalizedSpans: refs.lintSpans,
      povId: refs.povId ?? undefined,
      credentialClaimId: refs.credentialClaimId ?? undefined,
      sendOn: todayISO(),
      thread: "new",
      subject: null,
      body: d.message.trim(),
      frame: "mouse_trap",
      evidenceIds: [...new Set(refs.spans.map((s) => s.evidenceId))],
      claimIds: [],
      lint: { passed: true, violations: [], stats: { words: 0, fkGrade: 0, you: 0, iWe: 0, questionMarks: 0, links: 0 } },
      status: "draft",
      angleId: angle.id,
    };
    const linkedin = { note, recommendNoNote: note ? d.recommendNoNote : true, postAcceptDm: step.body };
    step.lint = lintStep(ws, { ...shell, linkedin }, step);
    return { step, linkedin, problems: refs.problems };
  };

  ctx.emit({ type: "status", text: "Drafting the invite and first message" });
  const gen = await generate<LinkedInDraftT>(ctx, ws, submitLinkedIn, task, "low");
  let built = build(gen.data);
  if (built.problems.length || fixable(built.step.lint, ws)) {
    ctx.emit({ type: "status", text: "Tightening it" });
    const again = await generate<LinkedInDraftT>(ctx, ws, submitLinkedIn, task, "low", {
      messages: gen.messages,
      feedback: [...built.problems, ...errorsOf(built.step.lint)].join("\n"),
    });
    const next = build(again.data);
    if (score(next) <= score(built)) built = next;
  }
  const pkg = await ctx.mutate((draft) => {
    const p = finalize(draft, {
      id: newId("out"),
      mode: "linkedin",
      personId: person?.id,
      accountDomain: account.domain,
      angleId: angle.id,
      angleOrder: angles.map((x) => x.id),
      createdAt: nowISO(),
      runId: ctx.runId,
      steps: [built.step],
      alternates: [],
      linkedin: built.linkedin,
      blockers: [],
      warnings: [],
    });
    draft.outreach[p.id] = p;
    notePovUse(draft, built.step);
    linkMove(draft, p, "linkedin", 1);
    return p;
  });
  return { drafts: 1, packageId: pkg.id };
}

async function runWarmIntro(ctx: WorkflowContext<ComposeArgs>, ws: Workspace, account: Account): Promise<ComposeResult> {
  const a = ctx.args;
  const rank: Record<string, number> = { investor: 0, angel: 1, advisor: 2, customer: 3, ex_colleague: 4, friend: 5, connection: 6 };
  const connector =
    (a.connectorId ? ws.connectors.find((c) => c.id === a.connectorId) : undefined) ??
    [...ws.connectors].sort((x, y) => rank[x.relationship] - rank[y.relationship] || (x.lastAskedOn ?? "").localeCompare(y.lastAskedOn ?? ""))[0];
  const angles = anglesFor(ws, account);
  const angle = (a.angleId && angles.find((x) => x.id === a.angleId)) || angles[0];
  const person = pickPerson(ws, account, a.personId, angle);
  const evidence = evidenceFor(ws, account, angle);
  const allowedEv = new Set(evidence.map((e) => e.id));
  const target = person ? `${person.name}, ${person.title}` : `the ${angle?.bestFor.replace("_", " ") ?? "right person"} at ${account.name}`;

  const task = lines(
    taskHeader(),
    `<task>Ask ${connector ? `${connector.name} (${connector.relationship === "connection" ? "a LinkedIn connection" : connector.relationship.replace("_", " ")}${connector.company ? `, works at ${connector.company}` : ""})` : "a mutual connection"} for a double opt-in intro to ${target} at ${account.name}. Write the short note to the connector and the forwardable note they can pass on.</task>`,
    `<recipient>\n${fmtRecipient(person, personaFor(ws, person), account.name, account.domain)}\n</recipient>`,
    angle && `<angle>\n${fmtAngle(angle)}\n</angle>`,
    evidence.length ? `<evidence>\n${evidence.map(fmtEvidence).join("\n")}\n</evidence>` : "<evidence>none usable</evidence>",
    `<voice>\n${fmtVoice(ws)}\n</voice>`,
  );
  const shell: OutreachPackage = { id: "pending", mode: "warm_intro", personId: person?.id, accountDomain: account.domain, createdAt: nowISO(), steps: [], alternates: [], blockers: [], warnings: [] };
  const build = (d: IntroDraftT) => {
    const refs = sanitizeRefs(ws, allowedEv, d);
    const step: DraftStep = {
      step: 1,
      personalizedSpans: refs.lintSpans,
      povId: refs.povId ?? undefined,
      credentialClaimId: refs.credentialClaimId ?? undefined,
      sendOn: todayISO(),
      thread: "new",
      subject: d.subject.trim(),
      body: d.forwardable.trim(),
      frame: "intro",
      evidenceIds: [...new Set(refs.spans.map((s) => s.evidenceId))],
      claimIds: refs.claimIds,
      lint: { passed: true, violations: [], stats: { words: 0, fkGrade: 0, you: 0, iWe: 0, questionMarks: 0, links: 0 } },
      status: "draft",
      angleId: angle?.id,
    };
    const intro = { connectorName: connector?.name ?? "", wrapper: d.wrapper.trim(), forwardable: { subject: step.subject ?? "", body: step.body } };
    step.lint = lintStep(ws, { ...shell, intro }, step);
    return { step, intro, problems: refs.problems };
  };

  ctx.emit({ type: "status", text: connector ? `Drafting the ask to ${connector.name}` : "Drafting the intro ask" });
  const gen = await generate<IntroDraftT>(ctx, ws, submitIntro, task, "medium");
  let built = build(gen.data);
  if (built.problems.length || fixable(built.step.lint, ws)) {
    ctx.emit({ type: "status", text: "Tightening it" });
    const again = await generate<IntroDraftT>(ctx, ws, submitIntro, task, "medium", {
      messages: gen.messages,
      feedback: [...built.problems, ...errorsOf(built.step.lint)].join("\n"),
    });
    const next = build(again.data);
    if (score(next) <= score(built)) built = next;
  }
  const pkg = await ctx.mutate((draft) => {
    const p = finalize(draft, {
      id: newId("out"),
      mode: "warm_intro",
      personId: person?.id,
      accountDomain: account.domain,
      angleId: angle?.id,
      connectorId: connector?.id,
      createdAt: nowISO(),
      runId: ctx.runId,
      steps: [built.step],
      alternates: [],
      intro: built.intro,
      blockers: [],
      warnings: [],
    });
    draft.outreach[p.id] = p;
    notePovUse(draft, built.step);
    linkMove(draft, p, "warm_intro", 1);
    return p;
  });
  return { drafts: 1, packageId: pkg.id };
}

/* ─────────────────────────────── Replies: read in code first, Haiku only when unclear ─────────────────────────────── */

// Code only short-circuits replies that are clearly an opt-out or an auto-responder; a person who
// says "away until Thursday, but yes" or "remove me from the CC and loop in Priya" goes to Haiku.
const UNSUB =
  /\b(unsubscribe( me)?|remove me from (your|the|this) (list|mailing list|emails?|sequence|database)|take me off (your|the|this) (list|mailing list)|opt me out|stop (emailing|contacting|messaging) me|(do not|don'?t) (contact|email|message) me)\b|^\s*(stop|remove( me)?)\.?\s*$/i;
// Phrases auto-responders use and people rarely write by hand.
const OOO = /\b(automatic reply|auto-?reply|autoreply|this is an automated|limited access to (my )?e-?mail|(respond|reply|get back to you) (when|upon|on) (my |I )?return)/i;
// Words a person adds to an auto-reply when they're actually answering.
const LIVE_CUE = /\b(yes|yeah|sure|let'?s (talk|chat|meet)|interested|relevant|happy to (chat|talk|meet)|works for me)\b/i;

export function readInCode(text: string): ReplyIntent | null {
  if (text.includes("?")) return null; // a question means a person is talking: let Haiku read it
  if (!text.includes("@") && countWords(text) <= 25 && UNSUB.test(text)) return "unsubscribe";
  // "Automatic reply: away until Thursday. Actually yes, let's talk" is a person answering: the model reads it.
  if (countWords(text) < 120 && OOO.test(text) && !LIVE_CUE.test(text)) return "ooo";
  return null;
}

const SENTIMENT: Record<ReplyIntent, Activity["sentiment"]> = {
  positive: "positive",
  info_request: "neutral",
  referral: "referral",
  not_now: "neutral",
  objection: "neutral",
  negative: "negative",
  unsubscribe: "unsubscribe",
  ooo: "ooo",
};

const REPLY_ACTION: Record<ReplyIntent, NonNullable<OutreachPackage["replyAction"]>> = {
  positive: "book",
  info_request: "draft",
  referral: "draft",
  not_now: "nurture",
  objection: "draft",
  negative: "draft",
  unsubscribe: "suppress",
  ooo: "nurture",
};

async function runReply(ctx: WorkflowContext<ComposeArgs>, ws: Workspace, account: Account): Promise<ComposeResult> {
  const a = ctx.args;
  const person = a.personId ? ws.people[a.personId] : undefined;
  // No text passed: use the reply the founder already logged for this person (Check replies, timeline).
  const logged = !a.replyText?.trim()
    ? ws.activities
        .filter((x) => x.kind === "reply_received" && x.body && (person ? x.personId === person.id : x.accountDomain === account.domain))
        .sort((x, y) => y.at.localeCompare(x.at))[0]
    : undefined;
  const text = (a.replyText ?? logged?.body ?? "").trim();
  if (!text) throw new AgentError("Paste their reply and I'll read it.", "bad_request");
  const thread = Object.values(ws.outreach)
    .filter((p) => p.accountDomain === account.domain && (!person || p.personId === person.id) && p.steps.some((s) => s.status === "sent" || s.status === "approved"))
    .sort((x, y) => y.createdAt.localeCompare(x.createdAt))[0];

  ctx.emit({ type: "status", text: `Reading ${person?.name.split(" ")[0] ?? "their"}${person ? "'s" : ""} reply` });
  let intent = readInCode(text);
  let summary = intent === "unsubscribe" ? "Asked not to be contacted again." : intent === "ooo" ? "Automatic out-of-office reply." : "";
  let referral: { name?: string; email?: string } | undefined;
  let checkBackOn: string | null = null;
  if (!intent) {
    const read = await ctx.agent<z.infer<typeof ReplyRead>>({
      tier: "fast",
      system: REPLY_READ_RULES,
      messages: [{ role: "user", content: lines(taskHeader(), `<reply from="${person?.name ?? "the prospect"}">\n${text.slice(0, 4000)}\n</reply>`) }],
      tools: [submitRead],
      effort: "low",
      maxTokens: 2000,
      requireTerminal: true,
    });
    const r = read.result;
    intent = r?.intent ?? "positive";
    summary = r?.summary ?? "";
    if (r?.referralName || r?.referralEmail) referral = { name: r.referralName ?? undefined, email: r.referralEmail ?? undefined };
    checkBackOn = r?.checkBackOn && /^\d{4}-\d{2}-\d{2}$/.test(r.checkBackOn) ? r.checkBackOn : null;
  }
  const kind: ReplyIntent = intent ?? "positive";
  const receivedAt = a.receivedAt ?? logged?.at ?? nowISO();

  // A reply is founder-logged data (they pasted it). Logging it cancels the rest of the sequence,
  // except auto-replies, which leave it running. Skip if Check replies already logged this one.
  const logReply = (draft: Workspace) => {
    // Check replies may have logged this reply already (R key, before the text was pasted): fill it in,
    // auto-replies included, so Today stops asking for a reply to one.
    const dup = draft.activities.find(
      (x) =>
        x.kind === "reply_received" &&
        x.personId === person?.id &&
        (x.body === text || (!x.body && Math.abs(Date.parse(x.at) - Date.now()) < 30 * 60_000)),
    );
    if (dup) {
      dup.body ??= text.slice(0, 4000);
      dup.sentiment = SENTIMENT[kind];
      return;
    }
    if (kind === "ooo") return;
    applyAction(draft, {
      type: "activity.log",
      activity: {
        id: newId("act"),
        at: receivedAt,
        kind: "reply_received",
        personId: person?.id,
        accountDomain: account.domain,
        dealId: account.dealId,
        channel: "email",
        summary: `${person?.name ?? account.name} replied: ${summary || kind}`.slice(0, 200),
        body: text.slice(0, 4000),
        sentiment: SENTIMENT[kind],
        source: "founder",
      },
    });
  };

  const basePkg = (steps: DraftStep[]): OutreachPackage => ({
    id: newId("out"),
    mode: "reply",
    personId: person?.id,
    accountDomain: account.domain,
    angleId: thread?.angleId,
    createdAt: nowISO(),
    runId: ctx.runId,
    steps,
    alternates: [],
    blockers: [],
    warnings: [],
    reply: { text: text.slice(0, 4000), intent: kind, summary, receivedAt, referral },
    replyAction: REPLY_ACTION[kind],
    nurtureUntil: kind === "not_now" ? (checkBackOn ?? addDays(todayISO(), 60)) : undefined,
  });

  if (kind === "unsubscribe" || kind === "ooo") {
    const pkg = await ctx.mutate((draft) => {
      const p = basePkg([]);
      logReply(draft);
      draft.outreach[p.id] = p;
      return p;
    });
    return {
      drafts: 0,
      packageId: pkg.id,
      suppress: kind === "unsubscribe" ? { email: resolveEmail(person).to ?? undefined, domain: account.domain, personId: person?.id } : undefined,
    };
  }

  const objections = ws.objections.filter((o) => o.approved).slice(0, 6);
  const availability = ws.founder.availability?.trim();
  const scheduling = ws.founder.schedulingUrl?.trim();
  const task = lines(
    taskHeader(),
    `<task>Draft the founder's reply. They read it as: ${kind}${summary ? ` (${summary})` : ""}. Follow the REPLIES rule for ${kind}.</task>`,
    `<their_reply from="${person?.name ?? "the prospect"}${person ? `, ${person.title}` : ""} at ${account.name}">\n${text.slice(0, 3000)}\n</their_reply>`,
    thread && priorTouches(ws, thread) && `<our_emails>\n${priorTouches(ws, thread)}\n</our_emails>`,
    kind === "positive" &&
      (availability || scheduling
        ? `<scheduling>${availability ? `Availability: ${availability}.` : ""}${scheduling ? ` Scheduling link (use only if no availability, or as a fallback after the two times): ${scheduling}` : ""}</scheduling>`
        : "<scheduling>No availability on file. Offer two half-days next week by weekday (e.g. Tuesday or Wednesday afternoon) and ask which suits them.</scheduling>"),
    kind === "objection" && objections.length && `<approved_objection_responses>\n${objections.map((o) => `- "${o.objection}" → ${o.response}`).join("\n")}\n</approved_objection_responses>`,
    kind === "not_now" && `<check_in>Propose checking back on ${checkBackOn ?? addDays(todayISO(), 60)} unless they named a time.</check_in>`,
    `<voice>\n${fmtVoice(ws)}\n</voice>`,
  );
  const shell = basePkg([]);
  const build = (d: ReplyDraftT) => {
    const refs = sanitizeRefs(ws, new Set(), { personalizedSpans: [], povId: null, credentialClaimId: null, claimIds: d.claimIds, assetId: d.assetId });
    const step: DraftStep = {
      step: 1,
      personalizedSpans: [],
      assetId: refs.assetId ?? undefined,
      sendOn: todayISO(),
      thread: "reply",
      subject: null,
      body: d.body.trim(),
      frame: "reply",
      evidenceIds: [],
      claimIds: refs.claimIds,
      lint: { passed: true, violations: [], stats: { words: 0, fkGrade: 0, you: 0, iWe: 0, questionMarks: 0, links: 0 } },
      status: "draft",
    };
    step.lint = lintStep(ws, shell, step);
    return { step, problems: refs.problems, checkBackOn: d.checkBackOn };
  };

  ctx.emit({ type: "status", text: kind === "positive" ? "Offering two times" : "Drafting your reply" });
  const gen = await generate<ReplyDraftT>(ctx, ws, submitReply, task, "low");
  let built = build(gen.data);
  if (built.problems.length || fixable(built.step.lint, ws)) {
    const again = await generate<ReplyDraftT>(ctx, ws, submitReply, task, "low", { messages: gen.messages, feedback: [...built.problems, ...errorsOf(built.step.lint)].join("\n") });
    const next = build(again.data);
    if (score(next) <= score(built)) built = next;
  }
  const pkg = await ctx.mutate((draft) => {
    const p = basePkg([built.step]);
    p.id = shell.id;
    if (kind === "not_now" && built.checkBackOn && /^\d{4}-\d{2}-\d{2}$/.test(built.checkBackOn)) p.nurtureUntil = built.checkBackOn;
    if (kind === "positive" && !availability && !scheduling) p.warnings = ["Add your availability in Settings so I can offer exact times."];
    const pf = preflight(draft, p, built.step);
    p.blockers = pf.blockers.map((b) => b.text);
    p.warnings = [...p.warnings, ...pf.warnings];
    // Log first: a logged reply cancels this person's open drafts, and this one must survive.
    logReply(draft);
    draft.outreach[p.id] = p;
    linkMove(draft, p, "reply", 1);
    return p;
  });
  return { drafts: 1, packageId: pkg.id };
}

/* ─────────────────────────────── Workflow ─────────────────────────────── */

function titleFor(a: ComposeArgs, ws: Workspace): string {
  const account = ws.accounts[a.domain];
  const company = account?.name ?? a.domain;
  const person = a.personId ? ws.people[a.personId] : undefined;
  const who = person?.name ?? company;
  if (a.alternate) return `Trying another angle for ${company}`;
  switch (a.mode ?? (a.replyText ? "reply" : "cold")) {
    case "follow_up":
      return `Writing a follow-up to ${who}`;
    case "linkedin":
      return `Writing a LinkedIn note to ${who}`;
    case "warm_intro":
      return `Writing an intro ask for ${company}`;
    case "reply":
      return `Reading ${person ? `${person.name.split(" ")[0]}'s` : "their"} reply`;
    default:
      return `Writing to ${who}`;
  }
}

export default defineWorkflow({
  id: "compose",
  args: Args,
  title: titleFor,
  ref: (a) => ({ kind: "account", id: a.domain }),
  heavy: false,
  run: async (ctx): Promise<ComposeResult> => {
    const a = ctx.args;
    const ws = ctx.read();
    const account = ws.accounts[a.domain];
    if (!account) throw new AgentError(`I don't have ${a.domain} in Companies yet. Add it first.`, "bad_request");
    if (a.personId && !ws.people[a.personId]) throw new AgentError("I can't find that person anymore.", "bad_request");
    ctx.emit({ type: "status", text: "Reading what I know about them" });
    const mode: Mode = a.mode ?? (a.replyText ? "reply" : "cold");
    // Suppression is checked before any tokens are spent. Replies stay readable.
    if (mode !== "reply") {
      const person = a.personId ? ws.people[a.personId] : undefined;
      const email = resolveEmail(person).to?.toLowerCase();
      const suppressed = ws.suppression.some((s) => (email && s.email?.toLowerCase() === email) || s.domain?.toLowerCase() === account.domain.toLowerCase());
      if (person?.doNotContact || suppressed) {
        throw new AgentError(`${person?.name ?? account.name} ${person?.doNotContact ? "asked not to be contacted" : "is on your suppression list"}, so I won't draft to them.`, "bad_request");
      }
    }
    if (a.alternate) return runAlternate(ctx, ws, account);
    switch (mode) {
      case "follow_up":
        return runFollowUp(ctx, ws, account);
      case "linkedin":
        return runLinkedIn(ctx, ws, account);
      case "warm_intro":
        return runWarmIntro(ctx, ws, account);
      case "reply":
        return runReply(ctx, ws, account);
      default:
        return runCold(ctx, ws, account);
    }
  },
});
