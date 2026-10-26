import "server-only";
import { z } from "zod";
import { defineTool } from "@/lib/ai/engine";
import { EMBER_CORE, companyContext, coreFor, taskHeader } from "@/lib/ai/prompts/core";
import { dealContext } from "@/lib/deals/context";
import { cleanDate, corpus, firstAttemptOnly, quoteIn } from "@/lib/deals/ledger";
import { structuredReferrals } from "@/lib/deals/referrals";
import {
  RECAP_CLOSE,
  SCORED_FIELDS,
  STAGE_RANK,
  clampScore,
  computeQualification,
  emptyCard,
  hasDatedNextStep,
  looksLikeTranscript,
  missingCriteria,
  newDeal,
  scoresFrom,
  wordCount,
  type CardField,
  type ScoredField,
} from "@/lib/deals/rules";
import { addDays, newId, nowISO, todayISO } from "@/lib/domain/ids";
import { localDate } from "@/lib/moves/util";
import type { Account, Deal, Debrief, Field, Meeting, MutualActionPlan, ObjectionCard, QualificationCard, Stage, Workspace } from "@/lib/domain/types";
import { accountData, dealData, emitHubEvent } from "@/lib/hub";
import { toDomain } from "@/lib/signals";
import { defineWorkflow } from "./types";

/**
 * W8 · Post-call debrief. No web, local data only. Quotes first: every qualification field must
 * trace to a quote from the call, and code verifies transcript quotes are verbatim. The model
 * scores and suggests; code clamps scores, sums the card, checks the stage criteria and the next
 * step, and never changes the deal itself. The founder applies changes from the review block.
 */

const DEBRIEF_RULES = `DEBRIEF RULES
You are debriefing a sales call for the founder. Only facts that appear in the input. Inferences go to toConfirm. Never
write a commitment that wasn't made on the call.

QUOTES FIRST
- Start by extracting quotes (up to 30) about situation, pain, impact, spend, dates, decision, people, pricing,
  objections and next steps. id "q1", "q2"…; speaker as labeled (null if unknown).
- Transcript: quotes are VERBATIM spans copied from the transcript (code checks; paraphrases are discarded).
- Founder notes: the notes are the founder's words, not the buyer's. Quote the notes as written and never present them
  as something the buyer said. The recap says "my understanding" instead of quoting them.
- Every qualification field cites quoteIds. A field with no supporting quote is status "not_covered", value null, score 0.

QUALIFICATION CARD (report only what THIS call covered; code merges it with the card on file)
- pain 0 vague / 1 clear but not urgent / 2 quantified and urgent. impact: the number they gave (hours, $, deals), or null.
- spend 0 none / 1 some / 2 significant money or headcount on this today.
- criticalEvent 0 none / 1 soft date / 2 hard date WITH a consequence of missing it. date YYYY-MM-DD if stated.
- champion 0 none / 1 coach (friendly, no power, or untested) / 2 tested (they agreed to a real ask: an intro to the buyer,
  sharing an internal doc, walking the buyer through it). championStatus: none | coach | untested | tested.
- economicBuyer 0 unknown / 1 identified / 2 engaged (on a call or replied). engaged true only if so.
- fit 0 poor / 1 partial / 2 strong, against the ICP in the context.
- decisionProcess (not scored): criteria, steps between yes and signature, paper process, budget source, alternatives
  considered (including building it themselves), in ≤60 words.
- status: captured (clearly answered), partial (touched on), not_covered.

STAGE SUGGESTION (never applied by you; the founder decides)
- Stages: talking · qualified · pilot · proposal · won · lost · nurture. Suggest a later stage only when its exit
  criteria are all met; otherwise null. List criteriaMet and criteriaMissing in plain words.
  qualified = pain + impact + critical event captured, champion identified, total ≥8/12, dated next step.
  pilot = success criteria agreed in writing, fee agreed (or design-partner terms signed), ROI review booked.
  proposal = proposal or order form sent, economic buyer engaged, MAP agreed.
  won = signed or paid. lost = a clear no, with the reason. nurture = not now, with a re-engage date.

NEXT STEP
- nextStep: what, date (YYYY-MM-DD, resolved against the call date), owner, buyerAgreed (true only if the buyer said yes
  to it on the call). "I'll email you" or "let's stay in touch" is not a next step.
- No dated, buyer-agreed next step → this call has no real next step. Treat it as a soft no until one is booked: write
  schedulingEmail (≤90 words, plain, two specific times from the founder's availability, or the scheduling link, one ask).

RECAP (send the same day; ≤180 words; bullets are fine; code sets the subject)
- One line of thanks. "What I heard": from a transcript, THEIR words (situation, top 1–2 pains, quantified impact,
  critical event); from notes, a short paraphrase labeled as your understanding. What we agreed (next step, date/time, who
  joins). Open items, each with an owner and a due date. Anything promised on the call. End with exactly:
  "${RECAP_CLOSE}"
- No hype, no "as discussed", "circling back", "just following up", "hope this finds you well", no exclamation marks.

COMMITTEE: people named on the call with title and likely role. A single-threaded deal at Qualified or later is a risk.

MAP (only when the deal is qualified after this call): work backward from their go-live or decision date. 5–8 milestones
(SMB/mid-market) or 8–12 (enterprise), one owner each, YYYY-MM-DD dates. Include as relevant: discovery recap
confirmed; technical deep-dive; security questionnaire + DPA; pilot success criteria signed; pilot kickoff; mid-pilot
check-in; ROI review (booked at kickoff); proposal/order form; legal/procurement; signature; go-live plan. It is a draft
to review WITH the buyer, never sent as final.

PILOT: when a pilot came up, write pilotCriteria with this template, using only what was said (leave a bracketed gap for
anything unknown): "By {date}, using {product} on {scope}, {customer} will move {metric} from {baseline} to {target},
measured by {method/owner}. If met, {customer} moves to {plan} at {price} starting {date}." Pilots are paid by default; if
they asked for a free pilot, say so in coaching. offerProposal = true when a pilot or proposal was discussed.

ALSO
- tasks (up to 8): what, due date, owner (founder | buyer). Only things agreed or clearly needed.
- newObjections (up to 5): concerns they raised, with a category and the quote.
- customerWords (up to 6, transcripts only): short phrases THEY used for the problem, verbatim.
- povCandidates (up to 2): only opinions the founder stated on the call, with the basis written plainly.
- priceQuoted: only if the founder stated a price on the call.
- referrals: people or companies they suggested talking to.
- coaching (up to 3, evidence only): talk ratio if speaker-labeled; how many questions the founder asked (won calls
  average ~15–16, lost ~20); whether alternatives came up early; whether a next step was booked; whether "about us" ran
  long. No generic advice.`;

const STAGE = z.enum(["talking", "qualified", "pilot", "proposal", "won", "lost", "nurture"]);
const ROLE = z.enum(["economic_buyer", "champion", "technical_approver", "user", "blocker"]);
const STATUS = z.enum(["captured", "partial", "not_covered"]);
const SCORE = z.literal([0, 1, 2]);
const OBJECTION_CATEGORY = z.enum(["timing", "budget", "status_quo", "build", "competitor", "startup_risk", "security", "priority", "info_request", "team"]);

const field = (desc: string) =>
  z.object({
    value: z.string().nullable().describe(`${desc} ≤40 words, or null.`),
    quoteIds: z.array(z.string()),
    status: STATUS,
    score: SCORE,
  });

function debriefSchema(check: (v: DebriefSubmit) => string[]) {
  return z
    .object({
      quotes: z
        .array(z.object({ id: z.string(), speaker: z.string().nullable(), text: z.string().max(400).describe("≤300 chars.") }))
        .max(40)
        .describe("Up to 30 quotes, extracted first."),
      card: z.object({
        pain: field("The pain in their words.").extend({ impact: z.string().nullable().describe("Quantified impact as stated, ≤15 words, or null.") }),
        spend: field("What they spend on it today (money or headcount)."),
        criticalEvent: field("The date-driven event.").extend({
          date: z.string().nullable().describe("YYYY-MM-DD or null."),
          consequence: z.string().nullable().describe("What happens if they miss it, ≤20 words, or null."),
        }),
        champion: field("Who champions it and why.").extend({
          name: z.string().nullable(),
          championStatus: z.enum(["none", "coach", "untested", "tested"]),
        }),
        economicBuyer: field("Who owns the budget.").extend({ name: z.string().nullable(), engaged: z.boolean() }),
        fit: field("How they match the ICP."),
        decisionProcess: z.object({ value: z.string().nullable().describe("≤60 words or null."), quoteIds: z.array(z.string()), status: STATUS }),
      }),
      stageSuggestion: z.object({ to: STAGE, criteriaMet: z.array(z.string()).max(6), criteriaMissing: z.array(z.string()).max(6) }).nullable(),
      nextStep: z
        .object({
          what: z.string().describe("≤20 words."),
          date: z.string().nullable().describe("YYYY-MM-DD or null."),
          owner: z.enum(["buyer", "founder", "both"]),
          buyerAgreed: z.boolean(),
        })
        .nullable(),
      recap: z.object({ body: z.string().describe(`Plain text, ≤180 words, ends with "${RECAP_CLOSE}".`) }),
      schedulingEmail: z.object({ subject: z.string().describe("≤6 words."), body: z.string().describe("≤90 words.") }).nullable(),
      committeeUpdates: z.array(z.object({ name: z.string(), title: z.string().nullable(), role: ROLE.nullable(), quoteId: z.string().nullable() })).max(6),
      map: z
        .object({
          targetDate: z.string().describe("YYYY-MM-DD go-live or decision date."),
          goal: z.string().describe("≤20 words."),
          milestones: z
            .array(z.object({ step: z.string().describe("≤12 words."), ownerSide: z.enum(["buyer", "seller", "both"]), ownerName: z.string().nullable(), dueDate: z.string().describe("YYYY-MM-DD") }))
            .max(12),
        })
        .nullable(),
      pilotCriteria: z.string().nullable().describe("≤80 words, or null."),
      offerProposal: z.boolean(),
      tasks: z.array(z.object({ what: z.string().describe("≤15 words."), dueDate: z.string().nullable(), owner: z.enum(["founder", "buyer"]) })).max(8),
      newObjections: z.array(z.object({ text: z.string().describe("≤20 words."), category: OBJECTION_CATEGORY, quoteId: z.string().nullable() })).max(5),
      customerWords: z.array(z.object({ phrase: z.string().describe("≤8 words, verbatim."), quoteId: z.string().nullable() })).max(6),
      povCandidates: z.array(z.object({ text: z.string().describe("≤25 words."), basis: z.string().describe("≤20 words.") })).max(3).describe("Up to 2."),
      priceQuoted: z.object({ amountUsd: z.number(), quoteId: z.string().nullable() }).nullable(),
      referrals: z.array(z.object({ name: z.string().nullable(), company: z.string().nullable(), quoteId: z.string().nullable() })).max(5),
      toConfirm: z.array(z.string().describe("≤20 words.")).max(6),
      coaching: z.array(z.string().describe("≤30 words.")).max(3),
    })
    .superRefine(firstAttemptOnly(check));
}

type FieldSubmit = { value: string | null; quoteIds: string[]; status: "captured" | "partial" | "not_covered"; score: 0 | 1 | 2 };
type DebriefSubmit = {
  quotes: { id: string; speaker: string | null; text: string }[];
  card: {
    pain: FieldSubmit & { impact: string | null };
    spend: FieldSubmit;
    criticalEvent: FieldSubmit & { date: string | null; consequence: string | null };
    champion: FieldSubmit & { name: string | null; championStatus: "none" | "coach" | "untested" | "tested" };
    economicBuyer: FieldSubmit & { name: string | null; engaged: boolean };
    fit: FieldSubmit;
    decisionProcess: { value: string | null; quoteIds: string[]; status: "captured" | "partial" | "not_covered" };
  };
  stageSuggestion: { to: Stage; criteriaMet: string[]; criteriaMissing: string[] } | null;
  nextStep: { what: string; date: string | null; owner: "buyer" | "founder" | "both"; buyerAgreed: boolean } | null;
  recap: { body: string };
  schedulingEmail: { subject: string; body: string } | null;
  committeeUpdates: { name: string; title: string | null; role: z.infer<typeof ROLE> | null; quoteId: string | null }[];
  map: { targetDate: string; goal: string; milestones: { step: string; ownerSide: "buyer" | "seller" | "both"; ownerName: string | null; dueDate: string }[] } | null;
  pilotCriteria: string | null;
  offerProposal: boolean;
  tasks: { what: string; dueDate: string | null; owner: "founder" | "buyer" }[];
  newObjections: { text: string; category: z.infer<typeof OBJECTION_CATEGORY>; quoteId: string | null }[];
  customerWords: { phrase: string; quoteId: string | null }[];
  povCandidates: { text: string; basis: string }[];
  priceQuoted: { amountUsd: number; quoteId: string | null } | null;
  referrals: { name: string | null; company: string | null; quoteId: string | null }[];
  toConfirm: string[];
  coaching: string[];
};

/** Above ~15K tokens, Haiku pulls verbatim excerpts first so Sonnet reads a fraction of the call. */
const LONG_TRANSCRIPT = 60_000;

/** The first ~n chars, cut at a line break so a speaker turn isn't split. */
function headOf(text: string, n: number): string {
  if (text.length <= n) return text;
  const cut = text.lastIndexOf("\n", n);
  return text.slice(0, cut > n * 0.8 ? cut : n);
}

/** The last ~n chars, starting at a line break. */
function tailOf(text: string, n: number): string {
  if (text.length <= n) return text;
  const start = text.length - n;
  const cut = text.indexOf("\n", start);
  return text.slice(cut !== -1 && cut < start + n * 0.2 ? cut + 1 : start);
}

const excerptsTool = defineTool({
  name: "submit_excerpts",
  description: "Submit the verbatim excerpts once.",
  terminal: true,
  schema: z.object({
    excerpts: z
      .array(z.object({ speaker: z.string().nullable(), text: z.string().max(600).describe("Verbatim, ≤400 chars.") }))
      .max(80)
      .describe("Up to 60 verbatim passages."),
  }),
});

export default defineWorkflow({
  id: "debrief",
  args: z
    .object({
      meetingId: z.string().optional(),
      dealId: z.string().optional(),
      domain: z.string().optional(),
      notes: z.string().min(20, "Paste at least a few lines from the call.").max(200_000),
      source: z.enum(["transcript", "founder_notes"]).optional(),
    })
    .refine((a) => a.meetingId || a.dealId || a.domain, "Say which call, deal or company this is for."),
  title: (a, ws) => {
    const m = a.meetingId ? ws.meetings[a.meetingId] : undefined;
    const deal = m ? ws.deals[m.dealId] : a.dealId ? ws.deals[a.dealId] : undefined;
    const name = deal?.name ?? (a.domain ? ws.accounts[toDomain(a.domain) ?? a.domain]?.name : undefined);
    return name ? `Debriefing the ${name} call` : "Debriefing your call";
  },
  ref: (a) => (a.meetingId ? { kind: "meeting", id: a.meetingId } : a.dealId ? { kind: "deal", id: a.dealId } : { kind: "account", id: toDomain(a.domain ?? "") ?? a.domain ?? "" }),
  heavy: false,
  run: async (ctx) => {
    const today = todayISO();
    const notes = ctx.args.notes.trim();
    const source: Debrief["source"] = ctx.args.source ?? (looksLikeTranscript(notes) ? "transcript" : "founder_notes");

    // Resolve (or create) the deal and the meeting this call belongs to.
    const { meetingId, dealId } = await ctx.mutate((w) => resolveTarget(w, ctx.args, today));
    const ws = ctx.read();
    const meeting = ws.meetings[meetingId];
    const deal = ws.deals[dealId];
    const account = ws.accounts[deal.accountDomain];
    ctx.emit({ type: "status", text: source === "transcript" ? "Reading the transcript" : "Reading your notes" });

    // Long calls: cheap verbatim extraction first.
    let material = notes;
    let omittedMiddle = false;
    if (notes.length > LONG_TRANSCRIPT) {
      ctx.emit({ type: "status", text: "Long call; pulling the parts that matter first" });
      const haystack = corpus(notes);
      const ex = await ctx.agent<{ excerpts: { speaker: string | null; text: string }[] }>({
        tier: "fast",
        effort: "low",
        system: [EMBER_CORE, "EXCERPT RULES\nCopy, never paraphrase. Pick the passages about the situation, pain, impact (numbers), spend, dates and deadlines, decision process and people, budget, pricing, competitors or building in-house, objections, and agreed next steps. Keep speaker labels."],
        messages: [{ role: "user", content: `${taskHeader()}\n\n<transcript>\n${notes.slice(0, 400_000)}\n</transcript>\n\nSubmit up to 60 verbatim excerpts.` }],
        tools: [excerptsTool],
        requireTerminal: true,
        // No excerpts falls back to the head and tail of the transcript.
        optionalResult: true,
        maxTokens: 12_000,
      });
      const kept = (ex.result?.excerpts ?? []).filter((e) => quoteIn(e.text, haystack));
      if (kept.length >= 5) material = kept.map((e) => `${e.speaker ? `${e.speaker}: ` : ""}${e.text}`).join("\n\n");
      else {
        // Keep the opening and the close: pricing, the next step and who joins come at the end.
        omittedMiddle = true;
        material = `${headOf(notes, 25_000)}\n\n[…middle of the call omitted…]\n\n${tailOf(notes, LONG_TRANSCRIPT - 25_000)}`;
      }
      ctx.emit({ type: "action", text: `Kept ${kept.length} verbatim excerpts` });
    }

    const brief = meeting.brief;
    const starred = (meeting.starred ?? []).map((i) => brief?.questions[i]?.q).filter(Boolean);
    const available = [ws.founder.availability && `Founder availability: ${ws.founder.availability}`, ws.founder.schedulingUrl && `Scheduling link: ${ws.founder.schedulingUrl}`].filter(Boolean).join("\n");
    const tag = source === "transcript" ? (material === notes ? "transcript" : "transcript_excerpts") : "founder_notes";
    const message = [
      taskHeader(),
      "",
      `Debrief the call "${meeting.title}" with ${account?.name ?? deal.name} on ${localDate(meeting.startsAt)}. Resolve relative dates ("next Tuesday") against that call date.`,
      `Source: ${source === "transcript" ? "a transcript (quote verbatim)" : "the founder's own notes (never present them as buyer quotes)"}.`,
      omittedMiddle ? "The middle of this long call is omitted. A topic missing from what you see may have come up there: put it in toConfirm, don't treat it as not discussed." : null,
      meeting.attendees.length ? `Attendees: ${meeting.attendees.map((a) => `${a.name}${a.title ? `, ${a.title}` : ""}`).join("; ")}` : null,
      "",
      "<deal>",
      dealContext(ws, deal, account, { excludeMeetingId: meeting.id }),
      brief ? `Call type: ${brief.callType}. Goal: ${brief.oneThingToLearn}. Desired next step: ${brief.desiredNextStep}` : null,
      starred.length ? `Questions the founder starred:\n${starred.map((q) => `- ${q}`).join("\n")}` : null,
      "</deal>",
      available ? `\n${available}` : "\nNo availability or scheduling link on file: propose two specific weekday times next week, business hours.",
      "",
      `<${tag}>\n${material}\n</${tag}>`,
      "",
      "Extract quotes first, then call submit_debrief once.",
    ]
      .filter((l) => l !== null)
      .join("\n");

    const check = (v: DebriefSubmit): string[] => {
      const ids = new Set(v.quotes.map((q) => q.id));
      const bad = new Set<string>();
      const ref = (id: string | null) => {
        if (id && !ids.has(id)) bad.add(id);
      };
      for (const f of [...SCORED_FIELDS, "decisionProcess"] as const) v.card[f].quoteIds.forEach(ref);
      v.committeeUpdates.forEach((c) => ref(c.quoteId));
      v.newObjections.forEach((o) => ref(o.quoteId));
      v.customerWords.forEach((c) => ref(c.quoteId));
      v.referrals.forEach((r) => ref(r.quoteId));
      ref(v.priceQuoted?.quoteId ?? null);
      const problems: string[] = [];
      if (bad.size) problems.push(`Unknown quote ids: ${[...bad].slice(0, 10).join(", ")}. Every quoteId must be an id in quotes`);
      const words = wordCount(v.recap.body);
      if (words > 190) problems.push(`recap.body is ${words} words; keep it ≤180`);
      return problems;
    };

    const submit = defineTool({ name: "submit_debrief", description: "Submit the debrief once. Quotes first; fields cite quote ids.", schema: debriefSchema(check), terminal: true });
    ctx.emit({ type: "status", text: "Pulling quotes and updating the qualification card" });
    const res = await ctx.agent<DebriefSubmit>({
      tier: "operator",
      effort: "medium",
      system: [coreFor(ws), DEBRIEF_RULES, companyContext(ws)],
      messages: [{ role: "user", content: message }],
      tools: [submit],
      requireTerminal: true,
      maxTokens: 16_000,
    });
    const out = res.result;
    if (!out) throw new Error("I couldn't finish the debrief. Try again, or paste a shorter excerpt.");

    const result = await ctx.mutate((w) => persist(w, { out, notes, source, meetingId, dealId, today, runId: ctx.runId }));
    ctx.emit({ type: "action", text: `Card ${result.score}/12${result.qualified ? " · qualified" : ""}${result.noNextStep ? " · no dated next step" : ""}` });
    announce(ctx.read(), result.meetingId, result.dealId);
    return result;
  },
});

/** Finds the meeting for this call, creating the deal (at Talking) and/or the meeting when missing. */
/** `meeting.debriefed` for webhooks: the outcome, never the raw notes or quotes. */
function announce(w: Workspace, meetingId: string, dealId: string) {
  const m = w.meetings[meetingId];
  const d = m?.debrief;
  if (!m || !d) return;
  const deal = w.deals[dealId];
  void emitHubEvent("meeting.debriefed", {
    meeting: { id: m.id, title: m.title, starts_at: m.startsAt },
    debrief: {
      score: d.qualification.total,
      qualified: d.qualification.qualified,
      next_step: d.nextStep ? { what: d.nextStep.what, date: d.nextStep.date ?? null, buyer_agreed: d.nextStep.buyerAgreed } : null,
      stage_suggestion: d.stageSuggestion?.to ?? null,
    },
    deal: dealData(w, dealId),
    account: accountData(w, deal?.accountDomain),
  });
}

function resolveTarget(w: Workspace, args: { meetingId?: string; dealId?: string; domain?: string }, today: string): { meetingId: string; dealId: string } {
  if (args.meetingId) {
    const m = w.meetings[args.meetingId];
    if (!m) throw new Error("That meeting no longer exists.");
    return { meetingId: m.id, dealId: m.dealId };
  }
  const at = nowISO();
  let deal = args.dealId ? w.deals[args.dealId] : undefined;
  if (!deal && args.domain) {
    const domain = toDomain(args.domain) ?? args.domain;
    const acc: Account | undefined = w.accounts[domain];
    if (!acc) throw new Error(`I don't have ${domain} yet. Add the company first.`);
    deal = acc.dealId ? w.deals[acc.dealId] : undefined;
    if (!deal) {
      // A deal starts at the first real conversation.
      deal = newDeal(acc, newId("deal"), at);
      w.deals[deal.id] = deal;
      acc.dealId = deal.id;
      acc.status = "in_pipeline";
    }
  }
  if (!deal) throw new Error("That deal no longer exists.");
  // Reuse today's (or yesterday's) undebriefed meeting if there is one, else log this call as a new meeting.
  const todays = deal.meetingIds
    .map((id) => w.meetings[id])
    .find((m) => {
      if (!m || m.debrief) return false;
      const d = localDate(m.startsAt);
      return d <= today && d >= addDays(today, -1);
    });
  if (todays) return { meetingId: todays.id, dealId: deal.id };
  const meeting: Meeting = { id: newId("mtg"), dealId: deal.id, title: `Call with ${deal.name}`, startsAt: at, attendees: [] };
  w.meetings[meeting.id] = meeting;
  deal.meetingIds.push(meeting.id);
  return { meetingId: meeting.id, dealId: deal.id };
}

function persist(
  w: Workspace,
  { out, notes, source, meetingId, dealId, today, runId }: { out: DebriefSubmit; notes: string; source: Debrief["source"]; meetingId: string; dealId: string; today: string; runId: string },
) {
  const meeting = w.meetings[meetingId];
  const deal = w.deals[dealId];
  const account = w.accounts[deal.accountDomain];
  const haystack = corpus(notes);

  // 1. Quotes must be copied from the input (transcript or notes); anything else is discarded.
  //    Notes stay labeled as the founder's words, never shown as the buyer's.
  const quotes: Debrief["quotes"] = [];
  const quoteText = new Map<string, string>();
  for (const q of out.quotes.slice(0, 40)) {
    const text = q.text.trim().replace(/^["“]|["”]$/g, "").slice(0, 400);
    if (!text) continue;
    if (!quoteIn(text, haystack)) continue;
    quotes.push({ id: q.id, speaker: source === "transcript" ? q.speaker ?? undefined : "Your notes", text, kind: source === "transcript" ? "verbatim" : "note" });
    quoteText.set(q.id, text);
  }
  const texts = (ids: string[]) => [...new Set(ids.map((id) => quoteText.get(id)).filter((t): t is string => !!t))];

  // 2. Card fields: no quote → not covered. Then merge with the card on file (new evidence wins).
  const toField = (f: { value: string | null; quoteIds: string[]; status: Field["status"] }): Field => {
    const qs = texts(f.quoteIds);
    if (!qs.length || f.status === "not_covered" || !f.value?.trim()) return { value: null, quotes: [], status: "not_covered" };
    return { value: f.value.trim(), quotes: qs.slice(0, 4), status: f.status };
  };
  const c = out.card;
  const fresh: QualificationCard = {
    pain: { ...toField(c.pain), impact: c.pain.impact?.trim() || undefined },
    spend: toField(c.spend),
    criticalEvent: { ...toField(c.criticalEvent), date: cleanDate(c.criticalEvent.date), consequence: c.criticalEvent.consequence?.trim() || undefined },
    champion: { ...toField(c.champion), name: c.champion.name?.trim() || undefined, championStatus: c.champion.championStatus },
    economicBuyer: { ...toField(c.economicBuyer), name: c.economicBuyer.name?.trim() || undefined, engaged: c.economicBuyer.engaged },
    fit: toField(c.fit),
    decisionProcess: toField(c.decisionProcess),
  };
  if (fresh.pain.status === "not_covered") fresh.pain.impact = undefined;
  if (fresh.champion.status === "not_covered") fresh.champion = { ...fresh.champion, name: undefined, championStatus: "none" };
  if (fresh.economicBuyer.status === "not_covered") fresh.economicBuyer.engaged = false;

  const prior = deal.card ?? emptyCard();
  const priorScores = scoresFrom(deal.qualification);
  const merged: QualificationCard = { ...prior };
  const scores = { ...priorScores };
  // What this call covered, so Apply can merge it onto the card as it is then (not as it was now).
  const covered: CardField[] = [];
  const fieldScores: NonNullable<Debrief["fieldScores"]> = {};
  for (const f of SCORED_FIELDS) {
    if (fresh[f].status === "not_covered") continue;
    (merged as unknown as Record<string, Field>)[f] = fresh[f];
    scores[f] = clampScore(f, fresh, c[f as ScoredField].score);
    covered.push(f);
    fieldScores[f] = scores[f];
  }
  if (fresh.decisionProcess.status !== "not_covered") {
    merged.decisionProcess = fresh.decisionProcess;
    covered.push("decisionProcess");
  }

  // 3. Next step: only a dated, buyer-agreed step counts.
  const nsDate = cleanDate(out.nextStep?.date ?? null);
  const nextStep = out.nextStep?.what.trim() ? { what: out.nextStep.what.trim(), date: nsDate, buyerAgreed: out.nextStep.buyerAgreed, owner: out.nextStep.owner } : null;
  const realNextStep = !!nextStep && !!nsDate && nsDate >= today && nextStep.buyerAgreed;
  const qualification = computeQualification(scores, realNextStep || hasDatedNextStep(deal.nextStep, today));

  // 4. Stage suggestion: re-check every criterion against the deal as it would be after applying;
  //    manual ones count only if the founder already ticked them.
  let stageSuggestion: Debrief["stageSuggestion"] = null;
  const s = out.stageSuggestion;
  if (s && s.to !== deal.stage && (STAGE_RANK[s.to] > STAGE_RANK[deal.stage] || s.to === "lost" || s.to === "nurture")) {
    const after: Deal = { ...deal, card: merged, qualification, nextStep: realNextStep && nsDate ? { what: nextStep!.what, date: nsDate, buyerAgreed: true } : deal.nextStep };
    const derivedMissing = missingCriteria(s.to, after, today).map((x) => x.label);
    // Code-derived labels first so they survive the slice.
    const missing = [...new Set([...derivedMissing, ...s.criteriaMissing])].slice(0, 6);
    stageSuggestion = { to: s.to, criteriaMet: s.criteriaMet.filter((m) => !derivedMissing.includes(m)).slice(0, 6), criteriaMissing: missing };
  }

  // 5. Recap: code-built subject; always closes with the correction question.
  let body = out.recap.body.trim();
  if (!body.endsWith(RECAP_CLOSE)) body = `${body.replace(/\s*(Did I miss[^\n]*)?$/i, "").trim()}\n\n${RECAP_CLOSE}`;
  const ours = w.company?.name ?? w.sender?.company ?? "us";
  const recap = { subject: `${account?.name ?? deal.name} + ${ours}: recap and next steps`, body };

  // 6. Committee, single-threading, MAP, tasks.
  const committeeUpdates = out.committeeUpdates
    .filter((p) => p.name.trim())
    .map((p) => ({ name: p.name.trim(), title: p.title?.trim() || undefined, role: p.role ?? undefined }))
    .slice(0, 6);
  const atOrPastQualified = STAGE_RANK[deal.stage] >= 1 || stageSuggestion?.to === "qualified" || qualification.qualified;
  const knownPeople = new Set([...deal.contacts.map((x) => w.people[x.personId]?.name.toLowerCase()), ...committeeUpdates.map((p) => p.name.toLowerCase())].filter(Boolean));
  let singleThreadWarning: string | undefined;
  if (atOrPastQualified && knownPeople.size < 2) {
    const personas = w.foundation?.personas ?? [];
    const titles = personas
      .filter((p) => p.role === "economic_buyer" || p.role === "technical_approver")
      .flatMap((p) => p.titles.slice(0, 1))
      .slice(0, 3);
    singleThreadWarning = `Only one person on this deal. Won deals involve more of the committee${titles.length ? `: try to meet the ${titles.join(", the ")}` : ""}.`;
  }

  let map: MutualActionPlan | undefined;
  if (out.map && qualification.qualified) {
    const milestones = out.map.milestones
      .map((m) => ({ id: newId("ms"), step: m.step.trim(), ownerSide: m.ownerSide, ownerName: m.ownerName?.trim() || undefined, due: cleanDate(m.dueDate) ?? "", status: "todo" as const }))
      .filter((m) => m.step && m.due)
      .sort((a, b) => a.due.localeCompare(b.due))
      .slice(0, 12);
    const target = cleanDate(out.map.targetDate) ?? milestones.at(-1)?.due;
    if (milestones.length && target) map = { targetDate: target, goal: out.map.goal.trim(), milestones };
  }

  const tasks = out.tasks.filter((t) => t.what.trim()).map((t) => ({ what: t.what.trim(), due: cleanDate(t.dueDate), owner: t.owner }));

  // 7. Playbook feedback: objections become unapproved drafts; customer words feed messaging.
  //    Re-debriefing the same call doesn't count an objection it already counted.
  const prev = meeting.debrief;
  const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9 ]/g, "");
  const heardHere = new Set((prev?.newObjections ?? []).map(norm));
  for (const o of out.newObjections) {
    const text = o.text.trim();
    if (!text) continue;
    const key = norm(text);
    const existing = w.objections.find((x) => norm(x.objection) === key);
    if (existing) {
      if (!heardHere.has(key)) existing.timesHeard += 1;
      existing.lastHeard = today;
      continue;
    }
    const card: ObjectionCard = { id: newId("obj"), objection: text, category: o.category, underlyingConcern: "", clarifyingQ: "", response: "", walkAwayIf: "", approved: false, timesHeard: 1, lastHeard: today };
    w.objections.push(card);
  }
  const customerWords = source === "transcript" ? out.customerWords.map((c) => c.phrase.trim()).filter((p) => p && quoteIn(p, haystack)) : [];
  if (w.foundation && customerWords.length) {
    const have = new Set(w.foundation.messaging.customerWords.map((x) => x.phrase.toLowerCase()));
    for (const phrase of customerWords) if (!have.has(phrase.toLowerCase())) w.foundation.messaging.customerWords.push({ phrase, source: "call" });
    w.foundation.messaging.customerWords = w.foundation.messaging.customerWords.slice(-40);
  }

  const debrief: Debrief = {
    source,
    quotes,
    card: merged,
    qualification,
    stageSuggestion,
    nextStep: nextStep ? { what: nextStep.what, date: nsDate, buyerAgreed: nextStep.buyerAgreed, owner: nextStep.owner } : null,
    noNextStepWarning: !realNextStep,
    recap,
    schedulingEmail: !realNextStep && out.schedulingEmail ? { subject: out.schedulingEmail.subject.trim(), body: out.schedulingEmail.body.trim() } : undefined,
    committeeUpdates,
    singleThreadWarning,
    map,
    pilotCriteria: out.pilotCriteria?.trim() || undefined,
    tasks,
    newObjections: out.newObjections.map((o) => o.text.trim()).filter(Boolean),
    customerWords,
    referrals: out.referrals.map((r) => [r.name, r.company].filter(Boolean).join(" at ")).filter(Boolean),
    // Kept structured so each one becomes a lead: add the company, write to them, say who sent you.
    referralPeople: structuredReferrals(out.referrals, quoteText),
    toConfirm: out.toConfirm.filter(Boolean),
    coaching: out.coaching.filter(Boolean).slice(0, 3),
    generatedAt: nowISO(),
    priceQuoted: out.priceQuoted && out.priceQuoted.amountUsd > 0 ? { amountUsd: Math.round(out.priceQuoted.amountUsd), quote: out.priceQuoted.quoteId ? quoteText.get(out.priceQuoted.quoteId) : undefined } : undefined,
    povCandidates: out.povCandidates.filter((p) => p.text.trim()).slice(0, 2),
    offerProposal: out.offerProposal,
    covered,
    fieldScores,
    runId,
  };
  meeting.debrief = debrief;
  meeting.notesRaw = notes.slice(0, 100_000);

  const at = nowISO();
  // One "call held" per meeting, however many times it's debriefed.
  if (!prev) {
    w.activities.push({
      id: newId("act"),
      at,
      kind: "meeting_held",
      accountDomain: deal.accountDomain,
      dealId: deal.id,
      meetingId: meeting.id,
      channel: "phone",
      summary: `Call debriefed: ${meeting.title}`,
      source: "ember",
    });
  }
  deal.lastActivityAt = at;

  return { meetingId, dealId, score: qualification.total, qualified: qualification.qualified, noNextStep: !realNextStep, quotes: quotes.length };
}
