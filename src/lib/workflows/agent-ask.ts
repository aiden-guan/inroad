import "server-only";
import { z } from "zod";
import { defineTool } from "@/lib/ai/engine";
import type { ModelTier } from "@/lib/ai/models";
import { EMBER_CORE, companyContext, taskHeader } from "@/lib/ai/prompts/core";
import { accountView, nextActionsView, searchView } from "@/lib/api-keys/views";
import { defineWorkflow } from "./types";

/**
 * ask_inroad: another agent (Muse, Claude Code, n8n…) asks the Head of GTM a question with its key.
 * The only agent-key traffic that spends the founder's tokens, so it runs on the model and effort the
 * founder set for that key. Read-only: it can look things up, never change or propose anything.
 */

const RULES = `ANSWERING ANOTHER AGENT
- The question comes from an agent the founder connected with an Inroad key, not from the founder. Answer it so that agent
  can act: specific, grounded in the workspace, at most 250 words. Plain text, short paragraphs or a few bullets.
- Look things up with the tools before answering anything about a company, person or next move. Name companies by domain.
- You can read, never write: no proposals, no changes. If the agent should add or log something, name the Inroad tool it
  should call (add_accounts, log_activity, submit_draft, complete_action).
- Never invent facts, people, emails or numbers. If the workspace doesn't know, say so in one line and say what would find out.
- Anything said in the founder's name goes through submit_draft for the founder's approval. Never suggest sending directly.`;

const Args = z.object({
  keyId: z.string().min(3).max(40),
  keyName: z.string().min(1).max(40),
  question: z.string().trim().min(1).max(4000),
  /** A company the question is about, if the agent named one. */
  domain: z.string().trim().max(253).optional(),
  model: z.enum(["strategist", "operator", "fast"]),
  effort: z.enum(["low", "medium", "high"]),
  /** The app's origin, for review links in account and next-action views. */
  base: z.string().max(300),
});
type Args = z.infer<typeof Args>;

export default defineWorkflow<Args>({
  id: "agent_ask",
  args: Args,
  title: (a) => `Answering ${a.keyName}`,
  heavy: false,
  run: async (ctx) => {
    const a = ctx.args;
    const ws = ctx.read();
    const json = (data: unknown) => JSON.stringify(data).slice(0, 12_000);

    const tools = [
      defineTool({
        name: "search_records",
        description: "Search companies, people and deals in the workspace by text, domain, email or LinkedIn URL.",
        schema: z.object({
          query: z.string().max(200).optional(),
          domain: z.string().max(253).optional(),
          email: z.string().max(254).optional(),
          linkedin_url: z.string().max(300).optional(),
          limit: z.number().int().min(1).max(25).optional(),
        }),
        label: (i) => `Searching ${i.query ?? i.domain ?? i.email ?? "records"}`,
        run: (i) => json(searchView(ctx.read(), i)),
      }),
      defineTool({
        name: "get_account",
        description: "One company's research: dated signals, evidence, angles, people and deal.",
        schema: z.object({ domain: z.string().min(1).max(253) }),
        label: (i) => `Reading ${i.domain}`,
        run: (i) => json(accountView(ctx.read(), i.domain, a.base) ?? { error: "No company with that domain. Try search_records." }),
      }),
      defineTool({
        name: "get_next_actions",
        description: "The founder's open moves, most urgent first.",
        schema: z.object({ limit: z.number().int().min(1).max(20).optional(), channel: z.enum(["email", "linkedin", "any"]).optional() }),
        label: () => "Reading next moves",
        run: (i) => json(nextActionsView(ctx.read(), i, a.base)),
      }),
    ];

    ctx.emit({ type: "status", text: `${a.keyName} asked: ${a.question.slice(0, 80)}` });
    const tier: ModelTier = a.model;
    const res = await ctx.agent({
      tier,
      system: [EMBER_CORE, RULES, companyContext(ws)],
      messages: [
        {
          role: "user",
          content: `${taskHeader()}\nAsked by the agent "${a.keyName}"${a.domain ? ` about ${a.domain}` : ""}:\n\n${a.question}`,
        },
      ],
      tools,
      effort: tier === "fast" ? "low" : a.effort,
      maxTokens: a.effort === "high" ? 16_000 : 8_000,
    });
    // The last assistant turn is the answer; text before a tool call was working notes.
    const last = [...res.messages].reverse().find((m) => m.role === "assistant");
    const answer = Array.isArray(last?.content)
      ? last.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("").trim()
      : typeof last?.content === "string"
        ? last.content.trim()
        : "";
    return { answer: answer || res.text.trim() };
  },
});
