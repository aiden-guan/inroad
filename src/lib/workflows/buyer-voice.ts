import "server-only";
import { z } from "zod";
import { defineTool } from "@/lib/ai/engine";
import { coreFor, taskHeader } from "@/lib/ai/prompts/core";
import { firstAttemptOnly } from "@/lib/deals/ledger";
import { nowISO, todayISO } from "@/lib/domain/ids";
import { plural } from "@/lib/moves/util";
import { buyerVoice } from "@/lib/voice";
import { BATTLECARD_RULES, battlecardInput, battlecardProblems, toBattlecard, type BattlecardOut } from "@/lib/voice/battlecard";
import { debriefedCalls } from "@/lib/voice/corpus";
import { NAME_RULES, applyNaming, namingInput, namingProblems, type NamingOut } from "@/lib/voice/naming";
import { defineWorkflow } from "./types";

/**
 * Buyer voice's two model calls, both small and both started by the founder:
 *  - name: one fast-tier pass names the clusters code built, merges duplicates and drops misfits. Cached against
 *    the debriefs it read; the Playbook offers it again only when new debriefs arrive.
 *  - battlecard: the operator tier at low effort drafts the answer to one alternative or objection, only from the
 *    quotes and approved claims. Code checks every id and number; the founder saves it into Objections.
 * Every count on the page is computed in code before and after; neither pass sees or writes a number of its own.
 */

const CATEGORY = z.enum(["timing", "budget", "status_quo", "build", "competitor", "startup_risk", "security", "priority", "info_request", "team"]);

const Args = z.discriminatedUnion("mode", [z.object({ mode: z.literal("name") }), z.object({ mode: z.literal("battlecard"), key: z.string().min(3).max(200) })]);
type Args = z.infer<typeof Args>;

function namesSchema(check: (v: NamingOut) => string[]) {
  return z
    .object({
      clusters: z
        .array(
          z.object({
            id: z.string(),
            name: z.string().max(80).describe("≤6 words, sentence case, in buyers' words."),
            gist: z.string().max(200).describe("≤18 words: what buyers mean."),
            mergeInto: z.string().nullable().describe("Another cluster id of the same kind, or null."),
            outliers: z.array(z.string()).max(10).describe("Quote ids that plainly don't belong. Usually empty."),
          }),
        )
        .max(40),
    })
    .superRefine(firstAttemptOnly(check));
}

function battlecardSchema(check: (v: BattlecardOut) => string[]) {
  return z
    .object({
      objection: z.string().max(200).describe("≤20 words, how buyers put it."),
      category: CATEGORY,
      underlyingConcern: z.string().max(300).describe("≤25 words."),
      clarifyingQ: z.string().max(300).describe("≤25 words: the question to ask first."),
      response: z.string().max(700).describe("≤70 words. Facts about us only from approved claims."),
      walkAwayIf: z.string().max(300).describe("≤25 words."),
      landmines: z.array(z.string().max(240)).max(3).describe("Up to 3 questions, ≤22 words each."),
      whenWeWin: z.string().max(300).nullable().describe("≤30 words or null."),
      whenWeLose: z.string().max(300).nullable().describe("≤30 words or null."),
      quoteIds: z.array(z.string()).max(10).describe("The quote ids it rests on, at least one."),
      claimIds: z.array(z.string()).max(10).describe("Approved claim ids it uses."),
    })
    .superRefine(firstAttemptOnly(check));
}

export default defineWorkflow<Args>({
  id: "buyer_voice",
  args: Args,
  title: (a, ws) => {
    if (a.mode === "name") return "Naming what buyers say";
    const subject = buyerVoice(ws).alternatives.find((x) => x.key === a.key)?.name;
    return subject ? `Drafting a battlecard for ${subject}` : "Drafting an answer from buyer quotes";
  },
  // The section's id for naming; "buyers:<key>" per battlecard, so each row shows only its own work log.
  ref: (a) => ({ kind: "playbook", id: a.mode === "name" ? "buyers" : `buyers:${a.key}` }),
  heavy: false,
  run: async (ctx) => {
    const ws = ctx.read();
    const voice = buyerVoice(ws, todayISO());

    if (ctx.args.mode === "name") {
      if (!voice.themes.length) throw new Error("There's nothing to name yet. Debrief a call or log a reply first.");
      const input = namingInput(voice);
      ctx.emit({ type: "status", text: `Reading ${plural(input.count, "theme")} from ${plural(voice.summary.calls, "call")}` });
      const submit = defineTool({ name: "submit_voice_names", description: "Submit a name for every cluster once.", terminal: true, schema: namesSchema((v) => namingProblems(v, input)) });
      const res = await ctx.agent<NamingOut>({
        tier: "fast",
        effort: "low",
        maxTokens: 4000,
        system: [coreFor(ws), NAME_RULES],
        messages: [{ role: "user", content: `${taskHeader()}\n\n<clusters>\n${input.block}\n</clusters>\n\nName every cluster, then call submit_voice_names once.` }],
        tools: [submit],
        requireTerminal: true,
      });
      if (!res.result) throw new Error("The names didn't come back. Nothing changed; try again.");
      const names = applyNaming(res.result, input, { fingerprint: voice.fingerprint, calls: debriefedCalls(ws), at: nowISO(), runId: ctx.runId, costUsd: res.costUsd });
      await ctx.mutate((w) => {
        w.buyerVoice = { ...(w.buyerVoice ?? {}), names };
      });
      const merged = Object.keys(names.merges).length;
      ctx.emit({ type: "action", text: `Named ${plural(Object.keys(names.entries).length, "theme")}${merged ? ` · merged ${merged}` : ""}` });
      return { named: Object.keys(names.entries).length, merged };
    }

    const key = ctx.args.key;
    const input = battlecardInput(ws, voice, key, taskHeader());
    if (!input) throw new Error("That no longer comes up in your calls. Reload the Playbook and try again.");
    ctx.emit({ type: "status", text: `Reading ${plural(input.quotes.size, "quote")} about ${input.target.subject}` });
    const submit = defineTool({ name: "submit_battlecard", description: "Submit the battlecard once.", terminal: true, schema: battlecardSchema((v) => battlecardProblems(v, input)) });
    const res = await ctx.agent<BattlecardOut>({
      tier: "operator",
      effort: "low",
      maxTokens: 3000,
      system: [coreFor(ws), BATTLECARD_RULES],
      messages: [{ role: "user", content: input.message }],
      tools: [submit],
      requireTerminal: true,
    });
    if (!res.result) throw new Error("The battlecard didn't come back. Nothing changed; try again.");
    const card = toBattlecard(res.result, input, { at: nowISO(), runId: ctx.runId, costUsd: res.costUsd });
    await ctx.mutate((w) => {
      w.buyerVoice = { ...(w.buyerVoice ?? {}), battlecards: { ...(w.buyerVoice?.battlecards ?? {}), [key]: card } };
    });
    ctx.emit({ type: "action", text: `Battlecard drafted from ${plural(card.quoteIds.length, "quote")}${card.claimIds.length ? ` and ${plural(card.claimIds.length, "approved claim")}` : ""}` });
    return { key };
  },
});
