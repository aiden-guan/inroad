import "server-only";
import { z } from "zod";
import { defineTool } from "@/lib/ai/engine";
import { companyContext, coreFor, taskHeader } from "@/lib/ai/prompts/core";
import { dealContext } from "@/lib/deals/context";
import { cleanDate, firstAttemptOnly, normUrl, seenWebUrls } from "@/lib/deals/ledger";
import { CALL_TYPE_LABEL, detectCallType, type CallType } from "@/lib/deals/rules";
import { daysBetween, nowISO, todayISO } from "@/lib/domain/ids";
import { clockTime, localDate } from "@/lib/moves/util";
import type { Evidence, MeetingBrief, Person } from "@/lib/domain/types";
import { gatherSignals } from "@/lib/signals";
import { defineWorkflow } from "./types";

/**
 * W7 · Meeting prep. A 5-minute read built from what's already on file (dossier, evidence, the
 * card, earlier debriefs, approved objections). Sonnet writes it in one call; web search (≤2)
 * only runs when the dossier is stale or missing and the free refresh comes back thin. Code fixes the call type, guarantees the
 * mandatory discovery questions, and keeps only citations that resolve.
 */

const PREP_RULES = `MEETING PREP RULES
You are preparing the founder for one sales call. A 5-minute read. Professional, cited facts only; nothing personal.

CALL GOALS BY TYPE (the call type is decided in code; use it)
- first_discovery: diagnose, don't pitch. Confirm or kill the pain hypothesis, quantify impact, find the critical event,
  map the decision and paper process. Demo only if the pain is confirmed AND they ask. Disqualifying is a good outcome.
- follow_up / demo: a story with the buyer as the protagonist, on their data and terms; 2–3 value themes shown as
  outcomes, not a feature tour; keep "about us" under 2 minutes.
- technical: architecture, integration effort, security; start the security questionnaire this week.
- pilot_review: success criteria vs baseline → the conversion decision with the economic buyer.
- negotiation: value recap → 2–3 options anchored on value → give-get only (a discount only in exchange for a case study,
  multi-year, a reference or signing by a date).

AGENDA: for a 30-minute first_discovery use upfront contract 2 · situation 5 · pain 8 · impact 5 · critical event 3 ·
decision & paper 4 · summary or tailored demo 2 · book the next step on the calendar 1. Other types: same discipline, ≤6 blocks.
UPFRONT CONTRACT (≤40 words): purpose, time, agenda, and "by the end we'll both know if a next step makes sense, and
it's fine if it doesn't."

QUESTIONS: 8–12, not 20. Won calls average ~15–16 questions vs ~20 in lost ones; top reps talk 43–57% of the time.
- Each question: the hypothesis it tests, the evidence it rests on (evidenceId when one fits), what a good answer sounds
  like, and one follow-up probe. priority 1 = must ask.
- Mandatory in first_discovery (adapt the wording to their process, keep the intent, set mandatory=true):
  "Walk me through the last time you did {process}, start to finish." ·
  "Are you spending money or headcount on this today?" (no → low priority) ·
  "Is there a date this has to be fixed by? What happens if you miss it?" ·
  "If you decided this was worth solving, what happens between yes and a signed contract?" ·
  "Who else should I talk to?"
- Mom Test: past specifics, never hypotheticals or "would you use…". Compliments are not data.
- Raise alternatives and competitors (including building it in-house) early; take pricing late, but learn what they can
  approve alone ("What can you approve without procurement?").
- Champion test: "Would you walk {economic buyer} through this with me?" A vague answer means coach, not champion.
- Reference evidence in questions: "You're hiring 3 data engineers. Is that to build X in-house?"

OBJECTIONS (up to 3): the ones most likely on THIS call. Use the approved library (set objectionId) when one fits;
otherwise write a draft response (objectionId null) using only approved claims. Pattern: acknowledge → clarify and
isolate → respond with evidence or a reframe → confirm → advance. "Too early / no logos" → risk reversal: a paid pilot with
written success criteria, an opt-out window, a founder-level SLA.

ABOUT US (≤150 words, 60 seconds out loud): only approved claims, POVs and founder credentials. No invented customers,
numbers or logos.
ATTENDEES: background bullets must cite an evidence id or a URL you saw; likelyWants is a labeled guess.
WHAT'S NEW: only items dated after the last touch or dossier, each cited.
LANDMINES (up to 4): topics or claims to avoid with these people (competitor under contract, a recent layoff, an
unapproved claim). COACHING (up to 4): listen more than you talk; pause before answering; restate their words; never leave
without a calendared next step ("I'll email you" is a soft no).
DESIRED NEXT STEP: specific, dated, who joins ("Technical deep-dive with their CTO by Nov 4").`;

const CATEGORY = z.enum(["situation", "pain", "impact", "critical_event", "decision", "champion", "pricing", "close"]);

function briefSchema(check: (v: BriefSubmit) => string[]) {
  return z
    .object({
      fiveMinuteSummary: z.string().describe("Where this deal stands and what this call must do. ≤80 words."),
      oneThingToLearn: z.string().describe("≤20 words."),
      whatsNew: z.array(z.object({ text: z.string().describe("≤25 words."), evidenceId: z.string().nullable(), url: z.string().nullable() })).max(4),
      attendees: z
        .array(
          z.object({
            name: z.string(),
            title: z.string().nullable(),
            background: z.array(z.object({ text: z.string().describe("≤20 words."), evidenceId: z.string().nullable(), url: z.string().nullable() })).max(3),
            likelyWants: z.string().describe("A labeled guess. ≤20 words."),
          }),
        )
        .max(6),
      goals: z.array(z.string().describe("≤15 words.")).max(3),
      upfrontContract: z.string().describe("≤40 words, said out loud."),
      agenda: z.array(z.object({ minutes: z.number().int().min(1).max(60), block: z.string().describe("≤8 words.") })).max(9),
      questions: z
        .array(
          z.object({
            q: z.string().describe("≤30 words."),
            category: CATEGORY,
            hypothesis: z.string().describe("What it tests. ≤20 words."),
            evidenceId: z.string().nullable(),
            goodAnswer: z.string().describe("≤20 words."),
            probe: z.string().describe("One follow-up. ≤20 words."),
            priority: z.number().int().min(1).max(3),
            mandatory: z.boolean(),
          }),
        )
        .max(12)
        .describe("8–12 questions."),
      objections: z.array(z.object({ objectionId: z.string().nullable(), objection: z.string().describe("≤15 words."), response: z.string().describe("≤60 words.") })).max(3),
      aboutUs60s: z.string().describe("≤150 words."),
      landmines: z.array(z.string().describe("≤20 words.")).max(4),
      coaching: z.array(z.string().describe("≤20 words.")).max(4),
      desiredNextStep: z.string().describe("Specific and dated. ≤20 words."),
    })
    .superRefine(firstAttemptOnly(check));
}

type BriefSubmit = {
  fiveMinuteSummary: string;
  oneThingToLearn: string;
  whatsNew: { text: string; evidenceId: string | null; url: string | null }[];
  attendees: { name: string; title: string | null; background: { text: string; evidenceId: string | null; url: string | null }[]; likelyWants: string }[];
  goals: string[];
  upfrontContract: string;
  agenda: { minutes: number; block: string }[];
  questions: { q: string; category: z.infer<typeof CATEGORY>; hypothesis: string; evidenceId: string | null; goodAnswer: string; probe: string; priority: number; mandatory: boolean }[];
  objections: { objectionId: string | null; objection: string; response: string }[];
  aboutUs60s: string;
  landmines: string[];
  coaching: string[];
  desiredNextStep: string;
};

/** The five questions every first discovery call needs; added in code if the model drops one. */
const MANDATORY: { test: RegExp; q: MeetingBrief["questions"][number] }[] = [
  {
    test: /\b(last time|walk me through)\b/i,
    q: { q: "Walk me through the last time this came up, start to finish. Who was involved, and what tools?", category: "situation", why: "Past specifics, not opinions", probe: "What happened next?", mandatory: true, priority: 1 },
  },
  {
    test: /\b(spend\w*|headcount|budget\w*)\b/i,
    q: { q: "Are you spending money or headcount on this today?", category: "impact", why: "No spend usually means low priority", probe: "Roughly how much, per month?", mandatory: true, priority: 1 },
  },
  {
    test: /\b(date|deadline|by when|miss it)\b/i,
    q: { q: "Is there a date this has to be fixed by? What happens if you miss it?", category: "critical_event", why: "A critical event drives timing", probe: "Who set that date?", mandatory: true, priority: 1 },
  },
  {
    test: /\b(signed|contracts?|between yes)\b/i,
    q: { q: "If you decided this was worth solving, what happens between yes and a signed contract?", category: "decision", why: "Maps the decision and paper process", probe: "How long did the last tool like this take?", mandatory: true, priority: 1 },
  },
  {
    test: /\bwho else\b/i,
    q: { q: "Who else should I talk to?", category: "close", why: "Multi-threads the deal", probe: "Would you introduce us?", mandatory: true, priority: 1 },
  },
];

const DISCOVERY_AGENDA: MeetingBrief["agenda"] = [
  { minutes: 2, block: "Upfront contract" },
  { minutes: 5, block: "Situation" },
  { minutes: 8, block: "Pain" },
  { minutes: 5, block: "Impact" },
  { minutes: 3, block: "Critical event" },
  { minutes: 4, block: "Decision and paper process" },
  { minutes: 2, block: "Summary or tailored demo" },
  { minutes: 1, block: "Book the next step" },
];

export default defineWorkflow({
  id: "prep",
  args: z.object({ meetingId: z.string() }),
  title: (a, ws) => {
    const m = ws.meetings[a.meetingId];
    const deal = m ? ws.deals[m.dealId] : undefined;
    return deal ? `Preparing for ${deal.name}` : "Preparing your call brief";
  },
  ref: (a) => ({ kind: "meeting", id: a.meetingId }),
  // One Sonnet call; it shouldn't wait behind research runs when the call is in 10 minutes.
  heavy: false,
  run: async (ctx) => {
    const today = todayISO();
    const ws = ctx.read();
    const meeting = ws.meetings[ctx.args.meetingId];
    if (!meeting) throw new Error("That meeting no longer exists.");
    const deal = ws.deals[meeting.dealId];
    if (!deal) throw new Error("That deal no longer exists.");
    const account = ws.accounts[deal.accountDomain];
    const dossier = account?.dossier;
    const priorDebriefs = deal.meetingIds.filter((id) => id !== meeting.id && ws.meetings[id]?.debrief).length;
    const callType: CallType = detectCallType(meeting.title, deal.stage, priorDebriefs);
    ctx.emit({ type: "status", text: `${CALL_TYPE_LABEL[callType]} call · reading the deal` });

    // Evidence on file for this account (dossier + people), newest first. Claude cites these by id.
    const accountPeople = (account?.peopleIds ?? []).map((id) => ws.people[id]).filter((p): p is Person => !!p);
    const evidenceIds = new Set<string>([
      ...(dossier ? [...dossier.facts.flatMap((f) => f.evidenceIds), ...dossier.painHypotheses.flatMap((p) => p.evidenceIds), ...dossier.angles.flatMap((a) => a.evidenceIds)] : []),
      ...(account?.signals.map((s) => s.evidenceId).filter((x): x is string => !!x) ?? []),
      ...accountPeople.flatMap((p) => p.evidenceIds),
    ]);
    const evidence = [...evidenceIds]
      .map((id) => ws.evidence[id])
      .filter((e): e is Evidence => !!e && !e.flaggedWrong)
      .sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""))
      .slice(0, 30);
    const known = new Set(evidence.map((e) => e.id));

    // Stale or missing dossier: refresh free signals (cached); allow ≤2 web searches only when that comes back thin.
    const stale = !dossier || dossier.staleAfter < today;
    const since = [dossier?.generatedAt.slice(0, 10), ws.activities.filter((a) => a.accountDomain === deal.accountDomain).map((a) => a.at.slice(0, 10)).sort().at(-1)].filter(Boolean).sort().at(-1);
    const newItems: { line: string; url: string }[] = [];
    if (stale && account) {
      ctx.emit({ type: "status", text: `Checking what's new at ${account.name}` });
      const sig = await gatherSignals(account.domain, { name: account.name, includeSite: false });
      ctx.noteFreeSignals(sig.lookups);
      for (const j of sig.jobs) if (j.url && j.postedAt && (!since || j.postedAt.slice(0, 10) > since) && daysBetween(j.postedAt.slice(0, 10), today) <= 60) newItems.push({ line: `${j.postedAt.slice(0, 10)} · job post · ${j.title}`, url: j.url });
      for (const n of [...sig.news, ...sig.hn]) if (n.publishedAt && (!since || n.publishedAt.slice(0, 10) > since)) newItems.push({ line: `${n.publishedAt.slice(0, 10)} · ${n.source} · ${n.title}`, url: n.url });
      ctx.emit({ type: "action", text: `${newItems.length} new items since ${since ?? "the start"}` });
    }
    const webSearch = stale && newItems.length < 2 ? 2 : 0;
    const candidateUrls = new Set(newItems.map((n) => normUrl(n.url)));

    const attendees = meeting.attendees.map((a) => {
      const p = (a.personId && ws.people[a.personId]) || accountPeople.find((x) => x.name.toLowerCase() === a.name.toLowerCase());
      const ev = p ? p.evidenceIds.filter((id) => known.has(id)) : [];
      return `- ${a.name}${a.title || p?.title ? `, ${a.title || p?.title}` : ""}${p?.role ? ` (${p.role})` : ""}${p?.champion ? ` [champion: ${p.champion}]` : ""}${ev.length ? ` · evidence: ${ev.join(", ")}` : ""}`;
    });
    const objections = ws.objections.filter((o) => o.approved).slice(0, 12);

    const message = [
      taskHeader(),
      "",
      `Prepare the founder for "${meeting.title}" with ${account?.name ?? deal.name} on ${localDate(meeting.startsAt)} at ${clockTime(meeting.startsAt)}.`,
      `Call type (decided in code): ${callType}.`,
      "",
      "<attendees>",
      attendees.length ? attendees.join("\n") : "Not listed. Plan for the champion persona.",
      "</attendees>",
      "",
      "<deal>",
      dealContext(ws, deal, account, { excludeMeetingId: meeting.id }),
      "</deal>",
      dossier
        ? [
            "",
            `<dossier generated="${dossier.generatedAt.slice(0, 10)}"${stale ? ' stale="true"' : ""}>`,
            dossier.snapshot.plainDescription,
            account?.signals.length ? `Signals:\n${account.signals.slice(0, 5).map((s) => `- ${s.date} · ${s.headline} (strength ${s.strength})${s.evidenceId ? ` [${s.evidenceId}]` : ""}`).join("\n")}` : null,
            dossier.painHypotheses.length ? `Pain hypotheses:\n${dossier.painHypotheses.map((p) => `- ${p.pain} [${p.evidenceIds.join(", ")}]`).join("\n")}` : null,
            dossier.angles.length ? `Angles: ${dossier.angles.map((a) => a.title).join("; ")}` : null,
            dossier.discoveryOpeners.length ? `Openers:\n${dossier.discoveryOpeners.map((o) => `- ${o.q}${o.evidenceId ? ` [${o.evidenceId}]` : ""}`).join("\n")}` : null,
            dossier.risks.length ? `Risks: ${dossier.risks.join("; ")}` : null,
            dossier.unknowns.length ? `Unknowns: ${dossier.unknowns.join("; ")}` : null,
            "</dossier>",
          ]
            .filter(Boolean)
            .join("\n")
        : "\nNo dossier on file.",
      "",
      evidence.length ? `<evidence>\n${evidence.map((e) => `[${e.id}] ${e.claim} — "${e.quote.slice(0, 160)}" (${e.host}${e.publishedAt ? `, ${e.publishedAt}` : ""})`).join("\n")}\n</evidence>` : "<evidence>none on file</evidence>",
      newItems.length ? `\n<new_since_last_touch>\n${newItems.slice(0, 10).map((n) => `- ${n.line} · ${n.url}`).join("\n")}\n</new_since_last_touch>` : null,
      objections.length ? `\nApproved objection library:\n${objections.map((o) => `[${o.id}] "${o.objection}" → ${o.response}`).join("\n")}` : "\nNo approved objection responses yet; any response you write is a draft.",
      "",
      webSearch > 0
        ? `The dossier is ${dossier ? "stale" : "missing"} and free sources found little new. You may run up to ${webSearch} web searches for news about the company or the attendees' public talks and posts. Cite those by url. Never search the founder's private details.`
        : "Do not search. Cite evidence ids from the list above, or urls from new_since_last_touch.",
      "Then call submit_brief once.",
    ]
      .filter((l) => l !== null)
      .join("\n");

    const approvedObjections = new Set(objections.map((o) => o.id));
    const check = (v: BriefSubmit): string[] => {
      const ids = [...v.whatsNew.map((x) => x.evidenceId), ...v.attendees.flatMap((a) => a.background.map((b) => b.evidenceId)), ...v.questions.map((q) => q.evidenceId)].filter(
        (id): id is string => !!id && !known.has(id),
      );
      const problems: string[] = [];
      if (ids.length) problems.push(`Unknown evidence ids: ${[...new Set(ids)].slice(0, 8).join(", ")}. Use ids from the evidence list or null`);
      const objIds = v.objections.map((o) => o.objectionId).filter((id): id is string => !!id && !approvedObjections.has(id));
      if (objIds.length) problems.push(`objectionId must be an approved objection id or null: ${objIds.join(", ")}`);
      if (callType === "first_discovery" && v.questions.filter((q) => q.mandatory).length < 5) problems.push("first_discovery needs the 5 mandatory questions, marked mandatory=true");
      if (v.questions.length > 12) problems.push("Keep to 8–12 questions");
      return problems;
    };

    const submit = defineTool({ name: "submit_brief", description: "Submit the call brief once.", schema: briefSchema(check), terminal: true });
    ctx.emit({ type: "status", text: "Writing the brief" });
    const res = await ctx.agent<BriefSubmit>({
      tier: "operator",
      effort: "medium",
      system: [coreFor(ws), PREP_RULES, companyContext(ws)],
      messages: [{ role: "user", content: message }],
      tools: [submit],
      webSearch,
      webFetch: 0,
      requireTerminal: true,
      maxTokens: 12_000,
    });
    const out = res.result;
    if (!out) throw new Error("I couldn't finish the brief. Try again.");

    // Citations must resolve: an evidence id on file, a URL we handed over, or a URL from its own search.
    const searched = webSearch ? seenWebUrls(res.messages) : new Set<string>();
    const okUrl = (url: string | null) => !!url && /^https?:\/\//.test(url) && !/linkedin\.com/i.test(url) && (candidateUrls.has(normUrl(url)) || searched.has(normUrl(url)));
    const cite = (x: { evidenceId: string | null; url: string | null }) =>
      x.evidenceId && known.has(x.evidenceId) ? { evidenceId: x.evidenceId } : okUrl(x.url) ? { url: x.url! } : null;

    const whatsNew: MeetingBrief["whatsNew"] = [];
    for (const n of out.whatsNew) {
      const c = cite(n);
      if (!c) continue;
      const e = c.evidenceId ? ws.evidence[c.evidenceId] : undefined;
      const item = newItems.find((x) => c.url && normUrl(x.url) === normUrl(c.url));
      whatsNew.push({ text: n.text, url: e?.url ?? c.url, date: e?.publishedAt ?? cleanDate(item?.line.slice(0, 10)), evidenceId: c.evidenceId });
    }

    const attendeesOut: MeetingBrief["attendees"] = out.attendees.map((a) => {
      const bullets = a.background.map((b) => ({ text: b.text, c: cite(b) })).filter((b) => b.c);
      const person = accountPeople.find((p) => p.name.toLowerCase() === a.name.toLowerCase());
      return {
        name: a.name,
        title: a.title ?? person?.title,
        personId: person?.id,
        background: bullets.map((b) => b.text),
        sources: bullets.map((b) => b.c!),
        likelyWants: a.likelyWants,
      };
    });

    let questions: MeetingBrief["questions"] = out.questions.map((q) => ({
      q: q.q,
      category: q.category,
      why: q.hypothesis,
      probe: q.probe,
      mandatory: q.mandatory,
      goodAnswer: q.goodAnswer,
      priority: Math.max(1, Math.min(3, Math.round(q.priority))) as 1 | 2 | 3,
      evidenceId: q.evidenceId && known.has(q.evidenceId) ? q.evidenceId : undefined,
    }));
    if (callType === "first_discovery") {
      // Whole-word matches, the matching category first, and one question never fills two slots.
      const claimed = new Set<(typeof questions)[number]>();
      for (const m of MANDATORY) {
        const pool = questions.filter((q) => !claimed.has(q) && m.test.test(q.q));
        const hit = pool.find((q) => q.category === m.q.category) ?? pool.find((q) => q.mandatory) ?? pool[0];
        if (hit) {
          hit.mandatory = true;
          claimed.add(hit);
        } else {
          const q = { ...m.q };
          questions.push(q);
          claimed.add(q);
        }
      }
      // 8–12, not 20: drop the lowest-priority optional questions first.
      const optional = questions.filter((q) => !q.mandatory).sort((a, b) => (a.priority ?? 2) - (b.priority ?? 2));
      const keep = new Set([...questions.filter((q) => q.mandatory), ...optional].slice(0, 12));
      questions = questions.filter((q) => keep.has(q));
    }
    questions = questions.slice(0, 12);

    const agenda = callType === "first_discovery" && (out.agenda.length < 4 || out.agenda.reduce((n, a) => n + a.minutes, 0) > 45) ? DISCOVERY_AGENDA : out.agenda;

    const brief: MeetingBrief = {
      callType,
      fiveMinuteSummary: out.fiveMinuteSummary.trim(),
      oneThingToLearn: out.oneThingToLearn.trim(),
      whatsNew,
      attendees: attendeesOut,
      goals: out.goals.slice(0, 3),
      upfrontContract: out.upfrontContract.trim(),
      agenda,
      questions,
      objections: out.objections.map((o) => ({ objection: o.objection, response: o.response, approved: !!o.objectionId && approvedObjections.has(o.objectionId) })),
      aboutUs60s: out.aboutUs60s.trim(),
      landmines: out.landmines.slice(0, 4),
      coaching: out.coaching.slice(0, 4),
      desiredNextStep: out.desiredNextStep.trim(),
      generatedAt: nowISO(),
    };

    await ctx.mutate((w) => {
      const m = w.meetings[meeting.id];
      if (!m) return;
      // Starred questions refer to indexes in the old brief; they don't carry over.
      m.brief = brief;
      m.starred = [];
    });
    return { meetingId: meeting.id, callType, questions: questions.length };
  },
});
