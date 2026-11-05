import "server-only";
import { z } from "zod";
import { defineTool, type RunOptions, type RunResult } from "@/lib/ai/engine";
import { AgentError } from "@/lib/ai/errors";
import { EMBER_CORE, taskHeader } from "@/lib/ai/prompts/core";
import { newId, nowISO, todayISO } from "@/lib/domain/ids";
import type { Workspace } from "@/lib/domain/types";
import { clip } from "@/lib/moves/util";
import { applyCustomPlayAction, normalizePlay } from "@/lib/plays/custom";
import type { Recipe } from "@/lib/plays/recipe-types";
import { ACTION_KINDS, dryRun, MEASURES, normalizeRecipe, PERSONA_ROLES, RECIPE_SIGNALS, SIGNAL_INFO, withUnsupported } from "@/lib/plays/recipes";
import { defineWorkflow, type WorkflowContext } from "./types";

/**
 * "Describe a play": one sentence in, an editable recipe out. Haiku only chooses fields from a strict schema
 * built from the real signal types and this workspace's personas and ICP criteria; code normalizes the recipe,
 * adds anything it can't run that the model didn't name, and dry-runs it. Running the play costs nothing.
 */

const SIGNAL_LINES = RECIPE_SIGNALS.map((s) => `  ${s}: ${SIGNAL_INFO[s].phrase} (from ${SIGNAL_INFO[s].source}; usually fresh for ${SIGNAL_INFO[s].window} days)`).join("\n");

/** Three worked examples, built from recipes so they always match the schema. Criterion ids in them are illustrations. */
const EXAMPLES: { sentence: string; recipe: Recipe; unsupported: { phrase: string; why: string; nearest: string }[]; assumptions: string[] }[] = [
  {
    sentence: "When a company in our ICP posts a RevOps or billing role and we have no open deal, draft a note to the hiring manager that references the role.",
    recipe: normalizeRecipe({
      name: "RevOps or billing hire, no open deal",
      trigger: { signals: ["jd_names_pain", "first_hire", "hiring"], withinDays: 45, keywords: ["revops", "revenue operations", "billing"], minStrength: 1, stack: 1 },
      audience: { tiers: ["A", "B"], minFit: 60, deal: "none", personas: ["champion"] },
      guardrails: { cooldownDays: 30, maxPerWeek: 5 },
      action: { kind: "write", angle: "Reference the role they posted and the work that role will take on." },
      measure: "reply",
    }),
    unsupported: [],
    assumptions: ["Read “the hiring manager” as your champion persona: job posts don't say who hires."],
  },
  {
    sentence: "Series A or B fintechs that just raised and visited our pricing page: VP Sales within 14 days, skip anyone touched in the last 90 days, at most 20 a week.",
    recipe: normalizeRecipe({
      name: "Fresh Series A or B fintech",
      trigger: { signals: ["funding", "filing"], withinDays: 14, keywords: ["series a", "series b"], minStrength: 1, stack: 1 },
      audience: { deal: "any", personas: ["economic_buyer"], keywords: ["fintech", "payments", "banking"] },
      guardrails: { cooldownDays: 90, maxPerWeek: 20 },
      action: { kind: "write", angle: "Name what the round makes harder for sales, and ask how they're handling it." },
      measure: "meeting",
    }),
    unsupported: [{ phrase: "visited our pricing page", why: "Website visits need visitor identification, which InRoad doesn't buy.", nearest: "A launch or pricing change on their site, or a page monitor in Research." }],
    assumptions: ["Read “VP Sales” as the economic buyer persona.", "Read “fintechs” as companies whose facts mention fintech, payments or banking."],
  },
  {
    sentence: "When a proposal-stage deal goes 10 days silent and the champion posted about the problem, draft a check-in.",
    recipe: normalizeRecipe({
      name: "Proposal out, champion posted",
      trigger: { signals: ["persona_post"], withinDays: 30, keywords: [], minStrength: 1, stack: 1 },
      audience: { deal: "open", stages: ["proposal"], personas: ["champion"] },
      guardrails: { cooldownDays: 14, maxPerWeek: 5 },
      action: { kind: "deal", angle: "Check in on the proposal through what they posted about the problem." },
      measure: "won",
    }),
    unsupported: [{ phrase: "goes 10 days silent", why: "Deal silence isn't a signal a custom play can fire on.", nearest: "The built-in play Rescue a stalled deal (21 days quiet)." }],
    assumptions: [],
  },
];

const example = (e: (typeof EXAMPLES)[number]) => {
  const { name, trigger, audience, guardrails, action, measure } = e.recipe;
  return `Sentence: ${e.sentence}\nsubmit_recipe: ${JSON.stringify({ name, trigger, audience, guardrails, action, measure, unsupported: e.unsupported, assumptions: e.assumptions })}`;
};

const RULES = `PLAY COMPILER RULES
You turn one sentence from the founder into a play recipe that code runs against their accounts every day. You only
choose fields. Code finds the companies, dates the signals and counts the results; never invent a company, a number or
a fact, and never claim a match.

SIGNAL TYPES (trigger.signals may use only these):
${SIGNAL_LINES}

FIELDS
- name: at most 6 words, the trigger and the audience ("RevOps or billing hire, no open deal").
- trigger.signals: the types the sentence describes, any of them fires it. A hire that names the problem is jd_names_pain;
  add first_hire for "first" or "founding" roles and hiring for any post with that title.
- trigger.withinDays: the sentence's number ("within 14 days" = 14); else the type's usual window, 45 for hiring.
- trigger.keywords: words the signal itself must mention, lowercase, with common variants ("revops", "revenue
  operations"). Empty when the sentence names no topic for the signal.
- trigger.minStrength: 1, or 2 to 3 when the sentence asks for strong or clear signals.
- trigger.stack: 1, or 2 to 3 when it wants several different signals at once ("hiring and just raised").
- audience.tiers: ["A","B"] for "our ICP", "target accounts" or "good fit"; ["A"] for "best" or "tier A"; else [].
- audience.minFit: the sentence's number; 60 for "in our ICP"; else 0.
- audience.statuses: [] unless it limits to new, tracked or in-pipeline companies.
- audience.deal: "none" for no open deal, not in pipeline, or not talking yet; "open" for an open deal or a deal stage;
  else "any".
- audience.stages: with deal "open", the stages named (talking, qualified, pilot, proposal); else [].
- audience.personas: who to contact, by role from PERSONAS, in order. A title belongs to the persona whose titles hold it.
- audience.excludePersonas: roles the sentence says never to contact.
- audience.criteria: ids from CRITERIA the sentence requires ("usage-priced companies" → the usage-pricing criterion).
- audience.keywords: words the company's own facts must mention: market, stack, location ("fintech", "dbt").
- guardrails.cooldownDays: the sentence's "skip if touched in the last N days"; else 30.
- guardrails.maxPerWeek: the sentence's weekly cap; else 5.
- action.kind: write (a note or an email), research (look into it, a dossier), intro (a warm introduction), deal (work
  an open deal). action.angle: one sentence, at most 25 words, the reason to write, from the sentence. No new facts.
- measure: meeting when the sentence talks about meetings or calls, won for closed deals, else reply.

NEVER DROP A CONDITION
Every condition in the sentence becomes a field, an assumption or an unsupported item:
- unsupported: a part InRoad can't detect (website visits, intent data, LinkedIn engagement, email opens or clicks,
  product usage, deal silence, headcount growth, round size, sending by itself). phrase: the founder's exact words.
  why: plain words. nearest: the closest signal type above or built-in play (Rescue a stalled deal, Revisit closed-lost).
- assumptions: each place you read the sentence one way when it could mean another. At most 3, under 25 words each.
InRoad never sends, posts or contacts anyone by itself; a request to do that is unsupported.

EXAMPLES (their criterion ids are illustrations; use ids from CRITERIA)
${EXAMPLES.map(example).join("\n\n")}

Plain words; no hype, no exclamation marks.`;

const Phrase = z.string().min(2).max(120);
const Word = z.string().min(2).max(40);

function recipeSchema(criteria: string[]) {
  return z.object({
    name: z.string().min(3).max(60).describe("At most 6 words: the trigger and the audience."),
    trigger: z.object({
      signals: z.array(z.enum(RECIPE_SIGNALS)).min(1).max(6),
      withinDays: z.number().int().min(1).max(365),
      keywords: z.array(Word).max(8).describe("Words the signal must mention, lowercase. Empty when the sentence names none."),
      minStrength: z.number().int().min(1).max(3),
      stack: z.number().int().min(1).max(3),
    }),
    audience: z.object({
      tiers: z.array(z.enum(["A", "B", "C"])).max(3),
      minFit: z.number().int().min(0).max(100),
      statuses: z.array(z.enum(["new", "tracked", "in_pipeline"])).max(3),
      deal: z.enum(["none", "open", "any"]),
      stages: z.array(z.enum(["talking", "qualified", "pilot", "proposal"])).max(4),
      personas: z.array(z.enum(PERSONA_ROLES)).max(4),
      excludePersonas: z.array(z.enum(PERSONA_ROLES)).max(4),
      criteria: criteria.length ? z.array(z.enum(criteria as [string, ...string[]])).max(6) : z.array(z.string()).max(0).describe("No ICP criteria on file: always empty."),
      keywords: z.array(Word).max(8).describe("Words the company's own facts must mention. Empty when the sentence names none."),
    }),
    guardrails: z.object({ cooldownDays: z.number().int().min(0).max(365), maxPerWeek: z.number().int().min(1).max(50) }),
    action: z.object({ kind: z.enum(ACTION_KINDS), angle: z.string().min(8).max(240).describe("One sentence, at most 25 words.") }),
    measure: z.enum(MEASURES),
    unsupported: z.array(z.object({ phrase: Phrase, why: z.string().min(5).max(200), nearest: z.string().min(5).max(200) })).max(5),
    assumptions: z.array(z.string().min(5).max(200)).max(3),
  });
}
type Compiled = z.infer<ReturnType<typeof recipeSchema>>;

/** What the model needs from this workspace, compactly: the company, the personas and their titles, the ICP criteria. */
function workspaceLines(ws: Workspace): string {
  const f = ws.foundation;
  const lines = [
    ws.company ? `<company>${ws.company.name}: ${clip(ws.company.plainOneLiner, 200)}. For ${clip(ws.company.whoItsFor, 160)}.</company>` : "<company>Unknown yet</company>",
    `<personas>\n${(f?.personas ?? []).filter((p) => (PERSONA_ROLES as readonly string[]).includes(p.role)).map((p) => `${p.role}: ${p.titles.slice(0, 6).join(", ")}`).join("\n") || "(none yet: use champion and economic_buyer)"}\n</personas>`,
    `<criteria>\n${(f?.icp.criteria ?? []).map((c) => `${c.id} · ${c.mustHave ? "must" : "nice"} · ${clip(c.text, 120)}`).join("\n") || "(none yet)"}\n</criteria>`,
  ];
  const triggers = f?.icp.triggers ?? [];
  if (triggers.length) lines.push(`<playbook_triggers>\n${triggers.map((t) => `${t.type} · ${t.windowDays} days · ${clip(t.implication, 120)}`).join("\n")}\n</playbook_triggers>`);
  const own = Object.values(ws.customPlays ?? {}).filter((p) => !p.archivedAt);
  if (own.length) lines.push(`<existing_plays>\n${own.map((p) => `- ${p.draft?.name ?? p.versions.at(-1)?.recipe.name ?? "Untitled"}`).join("\n")}\n</existing_plays>`);
  return lines.join("\n");
}

/** Cheap tier first; one step up only when the cheap model fails for a reason a better one could fix. */
async function compile<A>(ctx: WorkflowContext<A>, opts: Omit<RunOptions, "emit" | "signal">): Promise<RunResult<Compiled>> {
  try {
    return await ctx.agent<Compiled>({ ...opts, tier: "fast" });
  } catch (err) {
    if (err instanceof AgentError && ["stopped", "no_key", "auth", "no_credit", "rate_limit"].includes(err.code)) throw err;
    ctx.emit({ type: "status", text: "Trying once more with a stronger model" });
    return await ctx.agent<Compiled>({ ...opts, tier: "operator" });
  }
}

export default defineWorkflow({
  id: "play_compile",
  args: z.object({
    sentence: z.string().trim().min(12, "Describe the play in a sentence (at least a few words).").max(500),
    /** Recompile into this play: its draft, or unsaved changes when it has run. */
    id: z.string().max(60).optional(),
  }),
  title: () => "Turning your sentence into a play",
  heavy: false,
  run: async (ctx) => {
    const ws = ctx.read();
    const sentence = ctx.args.sentence.replace(/\s+/g, " ").trim();
    const criteria = (ws.foundation?.icp.criteria ?? []).map((c) => c.id);
    ctx.emit({ type: "status", text: "Reading your sentence against the signals I can see" });

    const submit = defineTool({ name: "submit_recipe", description: "Submit the play recipe for the founder's sentence.", terminal: true, schema: recipeSchema(criteria) });
    const res = await compile(ctx, {
      effort: "low",
      maxTokens: 3000,
      system: [EMBER_CORE, RULES],
      messages: [{ role: "user", content: `${taskHeader()}\n\n${workspaceLines(ws)}\n\n<sentence>\n${sentence}\n</sentence>\n\nCall submit_recipe once.` }],
      tools: [submit],
      requireTerminal: true,
    });
    const out = res.result;
    if (!out) throw new Error("The play didn't come back. Try again.");

    const recipe = normalizeRecipe({ name: out.name, trigger: out.trigger, audience: out.audience, guardrails: out.guardrails, action: out.action, measure: out.measure });
    // The model names what it can't run; code adds anything it missed, so no condition disappears without a word.
    const unsupported = withUnsupported(sentence, out.unsupported);
    const assumptions = out.assumptions.map((a) => clip(a, 200)).slice(0, 3);
    const at = nowISO();
    const target = ctx.args.id ? ws.customPlays?.[ctx.args.id] : undefined;
    const id = target && !target.archivedAt ? target.id : newId("cp");

    await ctx.mutate((draft) => {
      const prev = draft.customPlays?.[id];
      if (prev) {
        applyCustomPlayAction(draft, { type: "customPlay.edit", id, recipe, at });
        Object.assign(prev, { sentence, unsupported, assumptions, runId: ctx.runId });
        return;
      }
      draft.customPlays ??= {};
      draft.customPlays[id] = normalizePlay({ id, createdAt: at, sentence, origin: "sentence", versions: [], history: [], draft: recipe, unsupported, assumptions, dismissed: [], runId: ctx.runId });
    });

    const dry = dryRun(ctx.read(), recipe, id, todayISO());
    const fires = dry.fire.length + dry.waiting.length;
    ctx.emit({ type: "action", text: `${recipe.name}: would fire on ${fires} ${fires === 1 ? "company" : "companies"} today${dry.handled.length ? `, ${dry.handled.length} already in motion` : ""}` });
    if (unsupported.length) ctx.emit({ type: "action", text: `${unsupported.length === 1 ? "One part" : `${unsupported.length} parts`} I can't detect: ${clip(unsupported.map((u) => u.phrase).join("; "), 120)}` });
    return { id, fires, handled: dry.handled.length, unsupported: unsupported.length };
  },
});
