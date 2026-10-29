import "server-only";
import { z } from "zod";
import { defineTool } from "@/lib/ai/engine";
import { EMBER_CORE, taskHeader } from "@/lib/ai/prompts/core";
import { todayISO, weekOf } from "@/lib/domain/ids";
import type { GtmUpdate } from "@/lib/domain/types";
import { clip } from "@/lib/moves/util";
import { computeForecast, computePlan } from "@/lib/revenue/forecast";
import { updateBody, updateFacts } from "@/lib/revenue/update";
import { defineWorkflow } from "./types";

/**
 * The weekly GTM update (for the CEO, the board or the team). Code computes every number, the
 * forecast call, what changed since last week and the risks; Sonnet at low effort only writes the
 * story around them, and the numbers table in the update is built in code, so it can't drift.
 */

const AUDIENCE = {
  ceo: "the CEO: direct, decision-oriented; what needs their help",
  board: "the board and investors: the number first, honest about risk, two asks at most",
  team: "the GTM team: what we're focused on this week and why",
} as const;

const RULES = `WEEKLY GTM UPDATE RULES
You write the weekly update a strong Head of GTM sends. Lead with the number and the call, then what changed and why,
the risks with a named owner action, what is working, and next week's focus.
- Every number you mention must appear in the FACTS list exactly as written. Never compute, round, estimate or invent a
  number, a date, a name or a percentage. If a rate's n is below 20, call it early ("2 of 3, too early to call").
- headline: at most 30 words. The forecast call in plain words: commit vs target, and whether you'll hit it.
- forecast: at most 70 words. Commit, best case, coverage and the gap, using the FACTS. Say what would change the call.
- changes: up to 4 lines, at most 22 words each, from the CHANGES list only. Empty when nothing changed.
- risks: up to 3 lines, at most 28 words each: deal, the specific risk from the list, and the action this week.
- working: up to 3 lines, at most 25 words each, from WHAT'S WORKING, each with its n. Don't claim a cause.
- focus: up to 3 lines, at most 18 words each: outcomes for next week aimed at the gap ("Get Rowanstack's
  redlines back by Thursday"), never volume ("send more emails").
- asks: up to 2 lines, at most 22 words each: what the reader can do (an intro, a decision, a reference). Empty if none.
- subject: at most 10 words, with the week and the commit number.
- Plain, specific sentences. No exclamation marks, emoji, hype or filler ("exciting", "crushing", "great week").`;

const Line = z.string().min(3).max(240);
const UpdateSchema = z.object({
  subject: z.string().min(3).max(90).describe("At most 10 words, with the week and the commit number."),
  headline: z.string().min(3).max(240).describe("At most 30 words: the forecast call in plain words."),
  forecast: z.string().min(3).max(600).describe("At most 70 words, using only numbers from FACTS."),
  changes: z.array(Line).max(4).describe("Up to 4 lines from CHANGES, at most 22 words each. Empty if nothing changed."),
  risks: z.array(Line).max(3).describe("Up to 3 lines, at most 28 words each: deal, risk, this week's action."),
  working: z.array(Line).max(3).describe("Up to 3 lines from WHAT'S WORKING with their n, at most 25 words each."),
  focus: z.array(Line).max(3).describe("Up to 3 outcome lines for next week, at most 18 words each."),
  // The rules ask for two; a third is trimmed in code rather than failing the whole update.
  asks: z.array(Line).max(3).describe("Up to 2 asks of the reader, at most 22 words each. Empty if none."),
});
type UpdateOut = z.infer<typeof UpdateSchema>;

const submitUpdate = defineTool({ name: "submit_update", description: "Submit the weekly GTM update.", terminal: true, schema: UpdateSchema });

export default defineWorkflow({
  id: "gtm_update",
  args: z.object({ audience: z.enum(["ceo", "board", "team"]).default("ceo") }),
  title: (a) => `Writing the weekly update for the ${a.audience === "ceo" ? "CEO" : a.audience}`,
  heavy: false,
  run: async (ctx) => {
    const now = new Date();
    const today = todayISO(now);
    const ws = ctx.read();
    ctx.emit({ type: "status", text: "Calling the forecast from your deals" });
    const f = computeForecast(ws, today);
    const plan = computePlan(ws, f, now);
    const data = updateFacts(ws, f, plan, now);
    ctx.emit({ type: "action", text: `${f.calls.length} open ${f.calls.length === 1 ? "deal" : "deals"} called · ${data.changes.length} ${data.changes.length === 1 ? "change" : "changes"} since last week` });

    const list = (items: string[]) => (items.length ? items.map((x, i) => `${i + 1}. ${clip(x, 400)}`).join("\n") : "(none)");
    const message = [
      taskHeader(),
      `From: ${ws.founder.name || "the GTM lead"}${ws.founder.title ? `, ${ws.founder.title}` : ""}, at ${ws.company?.name ?? "the company"}.`,
      `Audience: ${AUDIENCE[ctx.args.audience]}.`,
      `\nFACTS:\n${list(data.facts)}`,
      `\nCHANGES since last week:\n${list(data.changes)}`,
      `\nRISKS on open deals:\n${list(data.risks)}`,
      `\nWHAT'S WORKING:\n${list(data.working)}`,
      `\nCall submit_update once.`,
    ].join("\n");

    ctx.emit({ type: "status", text: "Writing the update" });
    const res = await ctx.agent<UpdateOut>({
      tier: "operator",
      effort: "low",
      maxTokens: 3000,
      system: [EMBER_CORE, RULES],
      messages: [{ role: "user", content: message }],
      tools: [submitUpdate],
      requireTerminal: true,
    });
    const out = res.result;
    if (!out) throw new Error("The update didn't come back. Try again.");

    const body = updateBody({ ...out, asks: out.asks.slice(0, 2) }, data.table);

    const update: GtmUpdate = { weekOf: weekOf(today), generatedAt: new Date().toISOString(), audience: ctx.args.audience, subject: out.subject.trim(), body, runId: ctx.runId };
    await ctx.mutate((draft) => {
      draft.revenue ??= {};
      draft.revenue.updates = [...(draft.revenue.updates ?? []).filter((u) => !(u.weekOf === update.weekOf && u.audience === update.audience)), update].slice(-12);
    });
    ctx.emit({ type: "action", text: "Update ready to review" });
    return { weekOf: update.weekOf, audience: update.audience };
  },
});
