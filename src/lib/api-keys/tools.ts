import "server-only";
import { z } from "zod";
import { ActionError } from "@/lib/domain/actions";
import type { SignalType, StudioFormatId, StudioOccasion } from "@/lib/domain/types";
import { todayISO } from "@/lib/domain/ids";
import { normalizeDomain } from "@/lib/hub/records";
import { isOpenIntro, nextStep, openIntroFor, waysIn } from "@/lib/intros/rules";
import { readConnections } from "@/lib/network/store";
import { AgentError } from "@/lib/ai/errors";
import { MODEL_LABELS } from "@/lib/ai/models";
import { startRun, stopRun, subscribe } from "@/lib/runs/registry";
import { readWorkspace } from "@/lib/store/workspace";
import { FORMAT_IDS, FORMATS, OCCASIONS } from "@/lib/studio/formats";
import { checkCopy, checkGraphic, copyGuide } from "@/lib/studio/guide";
import agentAsk from "@/lib/workflows/agent-ask";
import { scoreAccount, scoringContext } from "./scoring";
import { askBudget, logCall, recordBudget, type ApiKey } from "./store";
import { ACCESS, keyModelOf, type Scope } from "./types";
import { accountView, forecastView, growthView, icpView, nextActionsView, playbookView, playsView, searchView } from "./views";
import { ToolError, addAccounts, addPartners, completeAction, logActivity, logGrowthWeek, submitDraft } from "./writes";

/**
 * The tools other agents call, defined once and served twice: over MCP at /api/mcp and as
 * REST at /api/v1 (with an OpenAPI spec). Plain reads and writes; Inroad spends zero tokens on
 * this traffic because the calling agent pays for its own inference. Order is fixed so callers'
 * prompt caches keep hitting; descriptions are short because callers pay for them on every turn.
 */

export interface CallContext {
  key: ApiKey;
  via: "mcp" | "rest";
  /** The app's origin, for review links. */
  base: string;
}

interface Output {
  data: Record<string, unknown>;
  summary: string;
  records?: number;
}

export interface ToolDef {
  name: string;
  title: string;
  description: string;
  scope: Scope;
  schema: z.ZodType;
  readOnly: boolean;
  idempotent: boolean;
  rest: { method: "GET" | "POST"; path: string };
  run: (input: never, ctx: CallContext) => Promise<Output> | Output;
}

function tool<S extends z.ZodType>(def: Omit<ToolDef, "schema" | "run"> & { schema: S; run: (input: z.infer<S>, ctx: CallContext) => Promise<Output> | Output }): ToolDef {
  return def as unknown as ToolDef;
}

const SIGNAL_TYPES = [
  "champion_job_change",
  "first_hire",
  "jd_names_pain",
  "community_request",
  "new_leader",
  "funding",
  "stack_change",
  "launch",
  "compliance_deadline",
  "persona_post",
  "public_pain",
  "filing",
  "hiring",
] as const satisfies readonly SignalType[];

const domain = z.string().trim().max(253).describe("Company website or domain, e.g. acme.com");
const company = {
  domain: domain.optional(),
  name: z.string().trim().max(120).optional(),
  description: z.string().max(600).optional().describe("What the company does"),
  industry: z.string().max(120).optional(),
  employees: z.number().int().min(0).max(10_000_000).optional(),
  location: z.string().max(120).optional(),
  tags: z.array(z.string().max(40)).max(10).optional(),
};
const person = z.object({
  name: z.string().max(120).optional(),
  first_name: z.string().max(60).optional(),
  last_name: z.string().max(60).optional(),
  title: z.string().max(120).optional(),
  email: z.string().max(254).optional(),
  linkedin_url: z.string().max(300).optional(),
  location: z.string().max(120).optional(),
});

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const TOOLS: ToolDef[] = [
  tool({
    name: "get_icp",
    title: "Get the ICP",
    description: "The founder's ideal customer profile: segment, criteria, disqualifiers, personas and tier rules. Read before prospecting.",
    scope: "read",
    readOnly: true,
    idempotent: true,
    rest: { method: "GET", path: "/icp" },
    schema: z.object({}),
    run: () => ({ data: icpView(readWorkspace()), summary: "Read the ICP" }),
  }),
  tool({
    name: "get_playbook",
    title: "Get the playbook",
    description: "Positioning, approved claims, founder points of view, objection answers and the writing rules for a channel. Read before writing anything.",
    scope: "read",
    readOnly: true,
    idempotent: true,
    rest: { method: "GET", path: "/playbook" },
    schema: z.object({
      channel: z.enum(["email", "linkedin", "call"]).optional().describe("Default email"),
      persona: z.string().max(80).optional().describe("Persona id, role (economic_buyer, champion…) or a title word"),
    }),
    run: (a) => ({
      data: playbookView(readWorkspace(), a),
      summary: `Read the playbook${a.channel ? ` for ${a.channel}` : ""}${a.persona ? ` (${a.persona})` : ""}`,
    }),
  }),
  tool({
    name: "score_accounts",
    title: "Score accounts",
    description: "Score up to 100 companies against the ICP with fixed rules (no AI). Returns tier A/B/C/none, fit 0–100, why-now 0–4 and reasons. Use before spending enrichment credits.",
    scope: "read",
    readOnly: true,
    idempotent: true,
    rest: { method: "POST", path: "/accounts/score" },
    schema: z.object({
      accounts: z
        .array(
          z.object({
            ...company,
            signals: z
              .array(z.object({ type: z.enum(SIGNAL_TYPES), date: z.string().regex(/^\d{4}-\d{2}-\d{2}/).describe("YYYY-MM-DD"), url: z.string().max(500).optional() }))
              .max(10)
              .optional()
              .describe("Dated why-now signals you found"),
          }),
        )
        .min(1)
        .max(100),
    }),
    run: (a) => {
      const ctx = scoringContext(readWorkspace());
      const results = a.accounts.map((x) => scoreAccount(ctx, x));
      const tiers = { A: 0, B: 0, C: 0, none: 0 };
      for (const r of results) tiers[r.tier]++;
      return {
        data: { results, icp_ready: ctx.ready },
        summary: `Scored ${plural(results.length, "company", "companies")}: ${tiers.A} A, ${tiers.B} B, ${tiers.C} C`,
      };
    },
  }),
  tool({
    name: "search_records",
    title: "Search records",
    description:
      "Look up companies, people and deals by text, domain, email or LinkedIn URL. Use it to dedupe and to check do-not-contact before outreach. Top-level do_not_contact is true when the email or domain is on the founder's suppression list, even with no record.",
    scope: "read",
    readOnly: true,
    idempotent: true,
    rest: { method: "GET", path: "/records" },
    schema: z
      .object({
        query: z.string().max(120).optional(),
        domain: z.string().max(253).optional(),
        email: z.string().max(254).optional(),
        linkedin_url: z.string().max(300).optional(),
        limit: z.number().int().min(1).max(25).optional().describe("Default 10"),
      })
      .refine((a) => a.query || a.domain || a.email || a.linkedin_url, { message: "Send query, domain, email or linkedin_url." }),
    run: (a) => {
      const data = searchView(readWorkspace(), a);
      const what = a.domain ?? a.email ?? a.linkedin_url ?? a.query ?? "";
      return { data, summary: `Searched for ${what.slice(0, 50)} · ${data.exists ? `${plural(data.accounts.length, "company", "companies")}, ${plural(data.people.length, "person", "people")}` : "no match"}` };
    },
  }),
  tool({
    name: "get_next_actions",
    title: "Get next actions",
    description: "The founder's next moves, ranked as they see them today. Each has an action_id.",
    scope: "read",
    readOnly: true,
    idempotent: true,
    rest: { method: "GET", path: "/actions" },
    schema: z.object({
      limit: z.number().int().min(1).max(25).optional().describe("Default 10"),
      channel: z.enum(["email", "linkedin", "any"]).optional(),
    }),
    run: (a, ctx) => {
      const data = nextActionsView(readWorkspace(), a, ctx.base);
      return { data, summary: `Read ${plural(data.actions.length, "next action")}` };
    },
  }),
  tool({
    name: "add_accounts",
    title: "Add accounts",
    description: "Upsert up to 200 companies, each with up to 10 people, keyed on domain, email or LinkedIn URL. Only fills empty fields. Safe to retry.",
    scope: "write_records",
    readOnly: false,
    idempotent: true,
    rest: { method: "POST", path: "/accounts" },
    schema: z.object({
      source: z.string().trim().min(1).max(40).describe("Where these came from, e.g. muse, clay, apollo"),
      external_id: z.string().max(120).optional().describe("Your id for this batch"),
      accounts: z
        .array(z.object({ ...company, linkedin_url: z.string().max(300).optional(), external_id: z.string().max(120).optional(), people: z.array(person).max(10).optional() }))
        .min(1)
        .max(200),
    }),
    run: (a, ctx) => addAccounts(ctx.key, a),
  }),
  tool({
    name: "log_activity",
    title: "Log activity",
    description: "Record an email sent, reply, LinkedIn message, call, meeting, note, bounce or unsubscribe for a person or company. Idempotent on source_tool + external_id.",
    scope: "write_records",
    readOnly: false,
    idempotent: true,
    rest: { method: "POST", path: "/activities" },
    schema: z
      .object({
        type: z.enum(["email_sent", "reply", "linkedin", "call", "meeting", "note", "bounce", "unsubscribe"]),
        email: z.string().max(254).optional(),
        linkedin_url: z.string().max(300).optional(),
        domain: z.string().max(253).optional(),
        person_name: z.string().max(120).optional(),
        occurred_at: z.string().max(40).optional().describe("ISO 8601; default now"),
        summary: z.string().trim().min(1).max(200),
        body: z.string().max(4000).optional().describe("The message text, if any"),
        sentiment: z.enum(["positive", "neutral", "negative", "referral", "ooo", "unsubscribe"]).optional().describe("For replies"),
        source_tool: z.string().trim().min(1).max(40),
        external_id: z.string().trim().min(1).max(120).describe("Your id for this event, so retries don't duplicate it"),
      })
      .refine((a) => a.email || a.linkedin_url || a.domain, { message: "Send email, linkedin_url or domain." }),
    run: (a, ctx) => logActivity(ctx.key, a),
  }),
  tool({
    name: "submit_draft",
    title: "Submit a draft",
    description: "Put a message you wrote in the founder's approval queue, with Inroad's quality checks. Never sends. Read get_playbook first.",
    scope: "submit_drafts",
    readOnly: false,
    idempotent: false,
    rest: { method: "POST", path: "/drafts" },
    schema: z.object({
      to: z
        .object({
          email: z.string().max(254).optional(),
          linkedin_url: z.string().max(300).optional(),
          name: z.string().max(120).optional(),
          title: z.string().max(120).optional(),
          domain: z.string().max(253).optional(),
        })
        .refine((t) => t.email || t.linkedin_url || (t.name && t.domain), { message: "Give a work email, a LinkedIn URL, or a name plus the company domain." }),
      channel: z.enum(["email", "linkedin"]).default("email"),
      kind: z.enum(["cold", "follow_up", "reply"]).default("cold"),
      subject: z.string().max(120).optional(),
      body: z.string().trim().min(1).max(3000).describe("Plain text, no signature"),
      note: z.string().max(300).optional().describe("Why this person and why now, for the founder"),
      external_id: z.string().max(120).optional(),
      evidence_ids: z.array(z.string().max(64)).max(10).optional().describe("Evidence ids from get_account the draft cites"),
      pov_id: z.string().max(64).optional().describe("The get_playbook pov the draft rests on"),
    }),
    run: (a, ctx) => submitDraft(ctx.key, a, ctx.base),
  }),
  tool({
    name: "complete_action",
    title: "Complete an action",
    description: "Record what happened with an action from get_next_actions.",
    scope: "write_records",
    readOnly: false,
    idempotent: false,
    rest: { method: "POST", path: "/actions/complete" },
    schema: z.object({
      action_id: z.string().trim().min(1).max(160),
      outcome: z.enum(["done", "booked", "replied", "skipped", "not_relevant"]),
      note: z.string().max(300).optional(),
    }),
    run: (a, ctx) => completeAction(ctx.key, a),
  }),
  // Appended, not inserted, so callers' prompt-cache prefix for the tools above keeps hitting.
  tool({
    name: "get_account",
    title: "Get an account",
    description: "One company's research: dated signals with URLs, evidence quotes, angles and people. Read before writing to someone there.",
    scope: "read",
    readOnly: true,
    idempotent: true,
    rest: { method: "GET", path: "/accounts" },
    schema: z.object({ domain }),
    run: (a, ctx) => {
      const data = accountView(readWorkspace(), a.domain, ctx.base);
      if (!data) throw new ToolError("No company with that domain. Use search_records.", 404);
      return { data, summary: `Read ${data.domain}` };
    },
  }),
  tool({
    name: "find_warm_paths",
    title: "Find warm paths",
    description:
      "Who can introduce the founder to a company: people they know there, connectors who can reach it, alumni, customers, investors. Ranked, each with why and concerns. Check before any cold outreach.",
    scope: "read",
    readOnly: true,
    idempotent: true,
    rest: { method: "GET", path: "/warm-paths" },
    schema: z.object({ domain }),
    run: (a, ctx) => {
      const ws = readWorkspace();
      const d = normalizeDomain(a.domain);
      if (!d || !ws.accounts[d]) throw new ToolError("No company with that domain. Add it with add_accounts first.", 404);
      const today = todayISO();
      const open = openIntroFor(ws, d);
      const paths = waysIn(ws, d, readConnections(), today).map((w) => ({
        kind: w.kind,
        via: { name: w.via.name, title: w.via.title ?? null, company: w.via.company ?? null },
        to: w.target?.name ?? null,
        why: w.why,
        concerns: w.concerns,
        ready: w.ready,
      }));
      return {
        data: {
          domain: d,
          intro_in_flight: open ? { with: open.connectorName ?? null, to: open.targetName, stage: open.stage, next: nextStep(open, ws, today).line } : null,
          paths,
          rule: "The founder sends every ask. Don't contact these people yourself; suggest the ask, and Inroad drafts it for approval.",
          review_url: `${ctx.base}/companies?c=${encodeURIComponent(d)}`,
        },
        summary: `Warm paths into ${d}: ${plural(paths.length, "path")}`,
        records: paths.length,
      };
    },
  }),
  tool({
    name: "list_intros",
    title: "List intros",
    description: "Intros in flight and whose move each one is (the founder's, the connector's, or the other person's), with the next step and when it's due.",
    scope: "read",
    readOnly: true,
    idempotent: true,
    rest: { method: "GET", path: "/intros" },
    schema: z.object({ include_closed: z.boolean().optional().describe("Also return finished, passed and unanswered intros") }),
    run: (a, ctx) => {
      const ws = readWorkspace();
      const today = todayISO();
      const intros = Object.values(ws.intros ?? {})
        .filter((i) => a.include_closed || isOpenIntro(i) || nextStep(i, ws, today).owner === "you")
        .sort((x, y) => y.updatedAt.localeCompare(x.updatedAt))
        .slice(0, 50)
        .map((i) => {
          const next = nextStep(i, ws, today);
          return {
            id: i.id,
            kind: i.kind,
            connector: i.connectorName ?? null,
            to: i.kind === "give" ? (i.sides ?? []).map((s) => s.name) : i.targetName,
            domain: i.accountDomain ?? null,
            stage: i.stage,
            asked_on: i.askedOn,
            whose_move: next.owner,
            next: next.line,
            due: next.due ?? null,
          };
        });
      return {
        data: { intros, review_url: `${ctx.base}/intros` },
        summary: `${plural(intros.length, "intro")}, ${intros.filter((i) => i.whose_move === "you").length} the founder's move`,
        records: intros.length,
      };
    },
  }),
  // Consumer companies (appended, so earlier tools keep their place).
  tool({
    name: "get_growth",
    title: "Get growth numbers",
    description: "Consumer companies: weekly numbers, what they say (computed in code, no AI), whether paid acquisition is on hold, and the creator and community list.",
    scope: "read",
    readOnly: true,
    idempotent: true,
    rest: { method: "GET", path: "/growth" },
    schema: z.object({}),
    run: (_a, ctx) => ({ data: growthView(readWorkspace(), ctx.base), summary: "Read the growth numbers" }),
  }),
  tool({
    name: "log_growth_week",
    title: "Log a week of numbers",
    description: "Send one week's consumer numbers from analytics or billing (PostHog, Amplitude, RevenueCat, Shopify). Merges onto the week; the founder's own entries win.",
    scope: "write_records",
    readOnly: false,
    idempotent: true,
    rest: { method: "POST", path: "/growth" },
    schema: z.object({
      week_of: z.string().max(10).optional().describe("Any date in the week, YYYY-MM-DD; default this week"),
      signups: z.number().int().min(0).max(100_000_000).optional().describe("New users, or first-time buyers for DTC. Required the first time a week is sent."),
      activated: z.number().int().min(0).max(100_000_000).optional().describe("Of those signups, how many reached the activation event"),
      active: z.number().int().min(0).max(1_000_000_000).optional().describe("Distinct users active that week"),
      retained_pct: z.number().min(0).max(100).optional().describe("Percent of the cohort from 4 weeks earlier active that week (90-day repeat for DTC)"),
      paying: z.number().int().min(0).max(1_000_000_000).optional(),
      new_paying: z.number().int().min(0).max(100_000_000).optional(),
      churned_paying: z.number().int().min(0).max(100_000_000).optional(),
      revenue_usd: z.number().min(0).max(10_000_000_000).optional(),
      spend_usd: z.number().min(0).max(10_000_000_000).optional().describe("Paid acquisition spend"),
      referred: z.number().int().min(0).max(100_000_000).optional().describe("Signups from invites or referral links"),
      top_channel: z.string().max(60).optional(),
      source_tool: z.string().trim().min(1).max(40).describe("e.g. posthog, revenuecat, shopify"),
    }),
    run: (a, ctx) => logGrowthWeek(ctx.key, a, ctx.via),
  }),
  tool({
    name: "add_partners",
    title: "Add creators and communities",
    description: "Consumer companies: add up to 50 creators, communities, newsletters or podcasts (from a creator tool or your own search) to the founder's shortlist. Never contacts anyone.",
    scope: "write_records",
    readOnly: false,
    idempotent: true,
    rest: { method: "POST", path: "/partners" },
    schema: z.object({
      source: z.string().trim().min(1).max(40).describe("Where these came from, e.g. modash, upfluence"),
      partners: z
        .array(
          z.object({
            kind: z.enum(["creator", "community", "newsletter", "podcast", "press", "brand"]),
            name: z.string().trim().min(1).max(80),
            platform: z.enum(["tiktok", "instagram", "youtube", "x", "reddit", "discord", "facebook", "substack", "podcast", "web", "other"]).optional(),
            handle: z.string().max(60).optional(),
            url: z.string().max(400).optional(),
            audience: z.string().max(80).optional().describe("Who follows them, in words"),
            followers: z.number().int().min(0).max(10_000_000_000).optional(),
            engagement_rate: z.number().min(0).max(1).optional().describe("0–1, as your tool computes it"),
            fit: z.string().trim().min(5).max(160).describe("Why their audience is the founder's"),
          }),
        )
        .min(1)
        .max(50),
    }),
    run: (a, ctx) => addPartners(ctx.key, a),
  }),
  // Studio: the same format specs, moves, receipts and lint the in-app copy writer uses.
  tool({
    name: "get_copy_guide",
    title: "Get the copy guide",
    description:
      "How to write one marketing format (launch post, ad, homepage hero, Show HN, store listing…) for this founder: its parts and real platform limits, moves that fit with sourced examples, the founder's receipts (the only specifics allowed) and what fails. Read before writing marketing copy.",
    scope: "read",
    readOnly: true,
    idempotent: true,
    rest: { method: "GET", path: "/copy/guide" },
    schema: z.object({
      format: z.enum(FORMAT_IDS as [StudioFormatId, ...StudioFormatId[]]).describe(`One of: ${FORMAT_IDS.join(", ")}`),
      occasion: z.enum(Object.keys(OCCASIONS) as [StudioOccasion, ...StudioOccasion[]]).optional().describe("Why now: launch, feature, funding, milestone, customer_win, lesson, data_drop, hiring, event or evergreen"),
    }),
    run: (a) => ({ data: copyGuide(readWorkspace(), a), summary: `Read the copy guide for ${FORMATS[a.format].label}` }),
  }),
  tool({
    name: "check_copy",
    title: "Check copy",
    description:
      "Lint marketing copy for one format, in code: platform limits, AI tells, numbers and superlatives without a receipt, never-say words. Returns errors to fix. Run on every draft.",
    scope: "read",
    readOnly: true,
    idempotent: true,
    rest: { method: "POST", path: "/copy/check" },
    schema: z.object({
      format: z.enum(FORMAT_IDS as [StudioFormatId, ...StudioFormatId[]]),
      parts: z.record(z.string().max(40), z.string().max(6000)).describe("The copy by part key, from get_copy_guide (e.g. {\"headline\": \"…\", \"subhead\": \"…\"})"),
    }),
    run: (a) => {
      const data = checkCopy(readWorkspace(), a);
      return { data, summary: data.passed ? `Checked ${FORMATS[a.format].label}: ready` : `Checked ${FORMATS[a.format].label}: ${plural(data.errors.length, "issue")}` };
    },
  }),
  tool({
    name: "check_graphic",
    title: "Check a graphic",
    description:
      "Check an SVG graphic for one format the way Inroad checks its own: every word must come from the copy or the founder's receipts, plus contrast, safe zones, type size and text share. Returns errors to fix. get_copy_guide's visual block has the sizes and rules.",
    scope: "read",
    readOnly: true,
    idempotent: true,
    rest: { method: "POST", path: "/copy/graphic" },
    schema: z.object({
      format: z.enum(FORMAT_IDS as [StudioFormatId, ...StudioFormatId[]]),
      preset: z.string().max(30).optional().describe("A size id from get_copy_guide's visual.sizes (e.g. linkedin, portrait, story)"),
      svg: z.string().max(60000).describe("The complete SVG document"),
      parts: z.record(z.string().max(40), z.string().max(6000)).describe("The checked copy the graphic carries, by part key"),
    }),
    run: (a) => {
      const data = checkGraphic(readWorkspace(), a);
      return { data, summary: data.passed ? `Checked a ${FORMATS[a.format].label} graphic: ready` : `Checked a ${FORMATS[a.format].label} graphic: ${plural(data.errors.length, "issue")}` };
    },
  }),
  tool({
    name: "ask_inroad",
    title: "Ask Inroad",
    description:
      "Ask the founder's Head of GTM a question about their accounts, pipeline, next moves or positioning. Read-only. Unlike the other tools this runs AI on the founder's credits, so call the plain read tools first and ask only for judgment.",
    scope: "read",
    readOnly: true,
    idempotent: false,
    rest: { method: "POST", path: "/ask" },
    schema: z.object({
      question: z.string().trim().min(1).max(4000).describe("One question, at most 4,000 characters"),
      domain: domain.optional().describe("The company the question is about, if any"),
    }),
    run: async (a, ctx) => {
      const limit = askBudget(ctx.key.id);
      if (!limit.ok) throw new ToolError(`This key has used its 30 questions this hour. Try again in ${limit.retryInMin} min.`, 429);
      const { model, effort } = keyModelOf(ctx.key);
      const answer = await askAndWait({ keyId: ctx.key.id, keyName: ctx.key.name, question: a.question, domain: a.domain ? normalizeDomain(a.domain) ?? undefined : undefined, model, effort, base: ctx.base });
      const cost = answer.costUsd < 0.01 ? "<$0.01" : `$${answer.costUsd.toFixed(2)}`;
      return {
        data: { answer: answer.text, model: MODEL_LABELS[model], effort, cost_usd: Number(answer.costUsd.toFixed(4)) },
        summary: `Answered a question on ${MODEL_LABELS[model]}, ${effort} effort · ${cost}`,
      };
    },
  }),
  tool({
    name: "get_forecast",
    title: "Get the forecast",
    description:
      "The revenue forecast, called in code (no AI): target, closed won, commit, best case, pipeline and coverage; the plan behind the gap (deals, qualified deals and first meetings it takes, and the last date new pipeline can still close); what changed since last week; and every open deal's call, health and risks with the fix for each.",
    scope: "read",
    readOnly: true,
    idempotent: true,
    rest: { method: "GET", path: "/forecast" },
    schema: z.object({ deal_id: z.string().max(40).optional().describe("Only this deal's call and risks") }),
    run: (a, ctx) => {
      const data = forecastView(readWorkspace(), new Date(), ctx.base, a.deal_id);
      return { data, summary: `Read the forecast: commit ${data.commit_usd}, best case ${data.best_case_usd}${data.target_usd ? ` of ${data.target_usd}` : ""}`, records: data.deals.length };
    },
  }),
  tool({
    name: "list_plays",
    title: "List plays",
    description: "The signal-based plays Inroad runs (trigger, why, running or paused), each with its live matches (the triggering fact, dated and sourced) and its results so far. Use it to decide which accounts to work and why now.",
    scope: "read",
    readOnly: true,
    idempotent: true,
    rest: { method: "GET", path: "/plays" },
    schema: z.object({ play_id: z.string().max(40).optional().describe("Only this play"), limit: z.number().int().min(1).max(25).optional().describe("Matches per play, default 5") }),
    run: (a, ctx) => {
      const data = playsView(readWorkspace(), todayISO(), ctx.base, a);
      return { data, summary: `Read ${plural(data.plays.length, "play")}, ${data.plays.reduce((n, p) => n + p.live_matches, 0)} live matches`, records: data.plays.length };
    },
  }),
];

const ASK_TIMEOUT_MS = 120_000;

/** Starts an agent_ask run (so it shows in the sidebar, receipts and the monthly budget) and waits for its answer. */
async function askAndWait(args: Parameters<typeof agentAsk.run>[0]["args"]): Promise<{ text: string; costUsd: number }> {
  let run;
  try {
    run = await startRun(agentAsk, args);
  } catch (err) {
    if (err instanceof AgentError) throw new ToolError(err.message, 429);
    throw err;
  }
  return new Promise((resolve, reject) => {
    let text = "";
    let error: string | null = null;
    let costUsd = 0;
    const timer = setTimeout(() => {
      unsubscribe();
      stopRun(run.id);
      reject(new ToolError("Inroad took too long to answer (over 2 minutes). Ask a narrower question.", 504));
    }, ASK_TIMEOUT_MS);
    const unsubscribe = subscribe(run.id, (event) => {
      if (event.type === "result") text = String((event.data as { answer?: unknown } | null)?.answer ?? "");
      else if (event.type === "error") error = event.message;
      else if (event.type === "usage") costUsd = event.costUsd;
      else if (event.type === "done") {
        clearTimeout(timer);
        queueMicrotask(() => unsubscribe());
        if (error) reject(new ToolError(`Inroad couldn't answer: ${error}`, 502));
        else if (!text) reject(new ToolError("No answer came back. Try again.", 502));
        else resolve({ text, costUsd });
      }
    });
  });
}

const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

export function getTool(name: string): ToolDef | undefined {
  return BY_NAME.get(name);
}

export function toolsFor(scopes: Scope[]): ToolDef[] {
  return TOOLS.filter((t) => scopes.includes(t.scope));
}

/** JSON Schema for a tool's input (what MCP and OpenAPI publish). */
export function inputSchema(t: ToolDef): Record<string, unknown> {
  const json = z.toJSONSchema(t.schema, { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
  delete json.$schema;
  return json;
}

export type CallResult = { ok: true; data: Record<string, unknown> } | { ok: false; status: number; message: string };

function issues(err: z.ZodError): string {
  return err.issues
    .slice(0, 6)
    .map((i) => `${i.path.join(".") || "input"}: ${i.message}`)
    .join("; ");
}

function recordsWanted(name: string, input: Record<string, unknown>): number {
  if (name === "add_partners") return ((input.partners as unknown[] | undefined) ?? []).length;
  if (name !== "add_accounts") return 1;
  const accounts = (input.accounts as { people?: unknown[] }[] | undefined) ?? [];
  return accounts.reduce((n, a) => n + 1 + (a.people?.length ?? 0), 0);
}

/** Validates scope and input, runs the tool, and logs the call to the key's feed. */
export async function callTool(name: string, raw: unknown, ctx: CallContext): Promise<CallResult> {
  const t = getTool(name);
  if (!t) return { ok: false, status: 404, message: `Unknown tool: ${name}` };
  const started = Date.now();
  const fail = async (status: number, message: string): Promise<CallResult> => {
    await logCall(ctx.key.id, { tool: name, via: ctx.via, ok: false, summary: message, ms: Date.now() - started });
    return { ok: false, status, message };
  };
  if (!ctx.key.scopes.includes(t.scope)) {
    const level = ACCESS.find((a) => a.scopes.includes(t.scope))?.label ?? t.scope;
    return fail(403, `This key can't use ${name}. Ask the founder for a key with "${level}" access.`);
  }
  const parsed = t.schema.safeParse(raw ?? {});
  if (!parsed.success) return fail(400, `Invalid input. ${issues(parsed.error)}`);
  if (!t.readOnly) {
    const budget = recordBudget(ctx.key.id, recordsWanted(name, parsed.data as Record<string, unknown>));
    if (!budget.ok) return fail(429, `This key has written its hourly limit of records (${budget.left} left). Try again later or send fewer.`);
  }
  try {
    const out = await t.run(parsed.data as never, ctx);
    await logCall(ctx.key.id, { tool: name, via: ctx.via, ok: true, summary: out.summary, ms: Date.now() - started });
    return { ok: true, data: out.data };
  } catch (err) {
    if (err instanceof ToolError) return fail(err.status, err.message);
    if (err instanceof ActionError) return fail(400, err.message);
    console.error("[agents]", name, err);
    return fail(500, "Something went wrong inside Inroad. Try again.");
  }
}
