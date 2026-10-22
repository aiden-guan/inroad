import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { getAnthropicClient } from "./client";
import type { AgentEvent, Source } from "./events";
import { apiErrorParts, droppableFeatures, toAgentError, type CompatFeature } from "./api-errors";
import { AgentError } from "./errors";
import { MODEL_IDS, addUsage, emptyUsage, requestCost, webToolTypes, type ModelTier, type Usage } from "./models";

export { AgentError };

/**
 * The agent engine: one streaming loop that every workflow and the Ask panel run through.
 *
 * - Routed per task to Opus 5.5 / Sonnet 5.5 / Haiku 5.5 (see models.ts) with adaptive
 *   thinking (summaries surface as live "thinking" lines)
 * - Server-side web search + web fetch (Anthropic runs them; we narrate them to the UI)
 * - App tools validated with zod before they run; "terminal" tools end the run and their
 *   input becomes the structured result (e.g. `submit_playbook`)
 * - Handles pause_turn, refusal, max_tokens and unparseable tool JSON explicitly
 */

/** Optional request features. If the API rejects one we retry without it (compat mode). */
const OPTIONAL_BETAS: Anthropic.Beta.AnthropicBeta[] = [
  "server-side-fallback-2026-07-01",
  "thinking-binding-controls-2026-08-01",
];

/**
 * Features the API rejected, remembered for the life of the process: every later run leaves them out
 * from its first request instead of sending a request that's bound to fail. Each run that ran without
 * one says so on its receipt (Settings → Usage shows a health warning).
 */
const rejected = (() => {
  const g = globalThis as unknown as { __inroadCompat?: Map<CompatFeature, { at: string; message: string }> };
  g.__inroadCompat ??= new Map();
  return g.__inroadCompat;
})();

export function compatState(): { feature: CompatFeature; at: string; message: string }[] {
  return [...rejected.entries()].map(([feature, v]) => ({ feature, ...v }));
}

/** Tests only: forget rejected features. */
export function resetCompat() {
  rejected.clear();
}

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface AgentTool<S extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  schema: S;
  /** Human label for the activity feed, e.g. "Adding Ramp to pipeline". */
  label?: (input: z.infer<S>) => string;
  /** Runs the tool. The returned string goes back to Claude as the tool result. */
  run?: (input: z.infer<S>) => Promise<string> | string;
  /** A terminal tool ends the run once called with valid input; that input is the run's result. */
  terminal?: boolean;
}

// Helper that keeps the schema/handler types connected at the call site.
export function defineTool<S extends z.ZodType>(tool: AgentTool<S>): AgentTool {
  return tool as unknown as AgentTool;
}

export interface RunOptions {
  /** Which model does the work. Defaults to the operator tier (Sonnet 5.5). */
  tier?: ModelTier;
  /**
   * System prompt blocks, most stable first. The last block carries a cache breakpoint (and, with 3+
   * blocks, the one before it too, so editing the last block, e.g. companyContext, keeps the rest
   * cached). Keep per-request details (today's date, the specific account) in `messages`, never here.
   * The conversation itself is cached automatically (top-level `cache_control`), so each tool turn
   * reads the previous turn's prefix instead of re-billing it.
   */
  system: string | string[];
  messages: Anthropic.Beta.BetaMessageParam[];
  tools?: AgentTool[];
  /** Max uses per request for the server-side web tools. 0 disables the tool. */
  webSearch?: number;
  webFetch?: number;
  effort?: Effort;
  maxTokens?: number;
  /** When set, the run is expected to end by calling a terminal tool; Claude is nudged once if it doesn't. */
  requireTerminal?: boolean;
  emit: (event: AgentEvent) => void;
  signal?: AbortSignal;
}

export interface RunResult<T = unknown> {
  result: T | undefined;
  /** Set when this run left out optional features the API rejected (compat mode), with what the API said. */
  compat?: { features: CompatFeature[]; reason: string };
  /** All assistant text produced across turns (for chat replies). */
  text: string;
  /** Full conversation, append-only, safe to persist and continue later. */
  messages: Anthropic.Beta.BetaMessageParam[];
  stopReason: string | null;
  usage: Usage;
  costUsd: number;
}


const MAX_TURNS = 24;
const MAX_PAUSE_CONTINUATIONS = 6;

function toInputSchema(schema: z.ZodType, strict: boolean): Anthropic.Beta.BetaTool.InputSchema {
  const json = z.toJSONSchema(schema, { target: "draft-7" }) as Record<string, unknown>;
  delete json.$schema;
  return (strict ? strictSafe(json) : json) as Anthropic.Beta.BetaTool.InputSchema;
}

/**
 * Strict tool schemas reject numeric/string/array size constraints. Move them into the field's
 * description (so the model still sees them) and let zod enforce them after the call.
 */
const UNSUPPORTED = ["minLength", "maxLength", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minItems", "maxItems", "pattern", "uniqueItems"];
function strictSafe(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strictSafe);
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  const notes: string[] = [];
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (UNSUPPORTED.includes(k)) {
      notes.push(`${k} ${JSON.stringify(v)}`);
      continue;
    }
    if (k === "format" && typeof v === "string" && !["date-time", "time", "date", "duration", "email", "hostname", "uri", "ipv4", "ipv6", "uuid"].includes(v)) continue;
    out[k] = strictSafe(v);
  }
  if (notes.length) out.description = [out.description, `(${notes.join(", ")})`].filter(Boolean).join(" ");
  return out;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function summarizeIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 8)
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
}

export async function runAgent<T = unknown>(opts: RunOptions): Promise<RunResult<T>> {
  const client = getAnthropicClient();
  const tier = opts.tier ?? "operator";
  const model = MODEL_IDS[tier];
  const web = webToolTypes(tier);
  // Server-side refusal fallback exists for Opus and Sonnet; Haiku has none.
  const supportsFallback = tier !== "fast";
  const { emit, signal } = opts;
  const appTools = opts.tools ?? [];
  const toolByName = new Map(appTools.map((t) => [t.name, t]));

  // Terminal (submit_*) tools use strict schemas so structured output is guaranteed; other app tools
  // stream their input eagerly. Compat mode (after a 400 about strict) drops strict; zod still checks.
  const buildTools = (strict: boolean): Anthropic.Beta.BetaToolUnion[] => [
    ...appTools.map(
      (t): Anthropic.Beta.BetaTool =>
        t.terminal && strict
          ? { name: t.name, description: t.description, input_schema: toInputSchema(t.schema, true), strict: true }
          : { name: t.name, description: t.description, input_schema: toInputSchema(t.schema, false), eager_input_streaming: true },
    ),
  ];
  const tools: Anthropic.Beta.BetaToolUnion[] = buildTools(true);
  if ((opts.webSearch ?? 0) > 0) {
    tools.push({ type: web.search, name: "web_search", max_uses: opts.webSearch });
  }
  if ((opts.webFetch ?? 0) > 0) {
    tools.push({ type: web.fetch, name: "web_fetch", max_uses: opts.webFetch });
  }

  const systemTexts = (Array.isArray(opts.system) ? opts.system : [opts.system]).filter(Boolean);
  const breakpoints = new Set([systemTexts.length - 1, ...(systemTexts.length >= 3 ? [systemTexts.length - 2] : [])]);
  const systemBlocks: Anthropic.Beta.BetaTextBlockParam[] = systemTexts.map((text, i) =>
    breakpoints.has(i) ? { type: "text", text, cache_control: { type: "ephemeral" } } : { type: "text", text },
  );
  const messages: Anthropic.Beta.BetaMessageParam[] = [...opts.messages];
  let text = "";
  // Where the answer starts in `text`: what came before the latest tool call was working notes.
  let answerStart = 0;
  let result: T | undefined;
  let stopReason: string | null = null;
  const dropped = new Set<CompatFeature>(rejected.keys());
  let jsonRetries = 0;
  let pauses = 0;
  let nudged = false;
  let emittedAnything = false;
  let usage = emptyUsage();
  // Priced per request by the model that served it (a fallback bills at its own rates).
  let spent = 0;
  const seenSources = new Set<string>();

  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      if (signal?.aborted) throw new AgentError("Stopped.", "stopped");

      const noBetas = dropped.has("betas");
      const params: Anthropic.Beta.Messages.MessageCreateParams = {
        model,
        max_tokens: opts.maxTokens ?? 32000,
        thinking: noBetas
          ? { type: "adaptive", display: "summarized" }
          : { type: "adaptive", display: "summarized", block_binding: { prefix_mismatch_behavior: "drop_block" } },
        output_config: { effort: opts.effort ?? "medium" },
        system: systemBlocks,
        // Automatic caching: the breakpoint follows the last block each turn, so turn N reads what
        // turn N-1 wrote. Never mark `messages` itself: it is returned and persisted, and markers
        // would pile up past the 4-breakpoint limit. Worst case here: 2 system + Ask's turn + this.
        cache_control: { type: "ephemeral" },
        tools: tools.length ? (dropped.has("strict") ? [...buildTools(false), ...tools.slice(appTools.length)] : tools) : undefined,
        messages,
        ...(noBetas
          ? {}
          : supportsFallback
            ? { betas: OPTIONAL_BETAS, fallbacks: "default" as const }
            : { betas: OPTIONAL_BETAS.filter((b) => !b.startsWith("server-side-fallback")) }),
      };

      // Per-turn streaming state, keyed by content block index.
      const blocks = new Map<number, { kind: "server" | "client"; name: string; json: string }>();
      let thinkingBuffer = "";
      let lastThinking = "";

      const textStart = text.length;
      let message: Anthropic.Beta.BetaMessage;
      try {
        const stream = client.beta.messages.stream(params, { signal });

        for await (const event of stream) {
          switch (event.type) {
            case "content_block_start": {
              const block = event.content_block;
              if (block.type === "server_tool_use") {
                blocks.set(event.index, { kind: "server", name: block.name, json: "" });
                const input = block.input as Record<string, unknown> | undefined;
                if (input && Object.keys(input).length) {
                  announceServerTool(block.name, input);
                  blocks.delete(event.index);
                }
              } else if (block.type === "tool_use") {
                blocks.set(event.index, { kind: "client", name: block.name, json: "" });
                const tool = toolByName.get(block.name);
                if (tool?.terminal) emit({ type: "status", text: "Writing it up" });
              } else if (block.type === "web_search_tool_result") {
                if (Array.isArray(block.content)) {
                  const sources: Source[] = [];
                  for (const r of block.content) {
                    if (r.type === "web_search_result" && !seenSources.has(r.url)) {
                      seenSources.add(r.url);
                      sources.push({ title: r.title, url: r.url, host: hostOf(r.url) });
                    }
                  }
                  if (sources.length) emit({ type: "sources", sources });
                }
              } else if (block.type === "thinking") {
                thinkingBuffer = "";
              }
              emittedAnything = true;
              break;
            }
            case "content_block_delta": {
              const delta = event.delta;
              if (delta.type === "text_delta") {
                text += delta.text;
                emit({ type: "text", text: delta.text });
              } else if (delta.type === "thinking_delta") {
                thinkingBuffer += delta.thinking;
                // Surface the latest complete sentence of the reasoning summary as a live status line.
                const line = latestLine(thinkingBuffer);
                if (line && line !== lastThinking) {
                  lastThinking = line;
                  emit({ type: "thinking", text: line });
                }
              } else if (delta.type === "input_json_delta") {
                const b = blocks.get(event.index);
                if (b) {
                  b.json += delta.partial_json;
                  if (b.kind === "client" && toolByName.get(b.name)?.terminal) {
                    emit({ type: "writing", chars: b.json.length });
                  }
                }
              }
              break;
            }
            case "content_block_stop": {
              const b = blocks.get(event.index);
              if (b?.kind === "server") {
                try {
                  announceServerTool(b.name, b.json ? JSON.parse(b.json) : {});
                } catch {
                  announceServerTool(b.name, {});
                }
              }
              blocks.delete(event.index);
              break;
            }
          }
        }
        message = await stream.finalMessage();
        jsonRetries = 0;
      } catch (err) {
        if (signal?.aborted) throw new AgentError("Stopped.", "stopped");
        // Retry without an optional feature only when the 400 is about that feature (never billing or size).
        const fixable = err instanceof Anthropic.APIError && !emittedAnything ? droppableFeatures(err).filter((f) => !dropped.has(f)) : [];
        if (fixable.length) {
          const apiErr = err as InstanceType<typeof Anthropic.APIError>;
          const message = apiErrorParts(apiErr).message || apiErr.message;
          console.warn(`[agent] the API rejected ${fixable.join(" and ")}; retrying without (compat mode): ${message}`);
          for (const f of fixable) {
            dropped.add(f);
            rejected.set(f, { at: new Date().toISOString(), message });
          }
          turn--;
          continue;
        }
        // APIConnectionError (and its timeout subclass) extends APIError, so check it first.
        if (err instanceof Anthropic.APIConnectionError) throw new AgentError("Couldn't reach Claude. Check your connection.", "network");
        if (err instanceof Anthropic.APIError) throw toAgentError(err, tier);
        // SDK stream errors (unparseable tool JSON from eager input streaming, a mid-stream drop):
        // re-issue the turn (capped) and drop the text the failed attempt streamed. Errors from our
        // own code are not retried.
        if (err instanceof Anthropic.AnthropicError && jsonRetries++ < 2) {
          if (text.length > textStart) emit({ type: "text_reset", text: text.slice(answerStart, textStart) });
          text = text.slice(0, textStart);
          console.warn("[agent] stream failed mid-turn, re-issuing the turn:", err.message);
          turn--;
          continue;
        }
        throw new AgentError(err instanceof Error ? err.message : "Something went wrong.", "unknown");
      }

      stopReason = message.stop_reason;
      const turnUsage = billedUsage(tier, message);
      usage = addUsage(usage, turnUsage.usage);
      spent += turnUsage.costUsd;

      if (message.stop_reason === "refusal") {
        throw new AgentError("Claude declined this request. Try rephrasing it.", "refusal");
      }

      if (message.stop_reason === "pause_turn") {
        messages.push({ role: "assistant", content: message.content });
        if (++pauses > MAX_PAUSE_CONTINUATIONS) break;
        continue;
      }

      const toolUses = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");

      if (toolUses.length === 0) {
        messages.push({ role: "assistant", content: message.content });
        if (message.stop_reason === "max_tokens") {
          throw new AgentError("The response ran too long and was cut off. Try a narrower request.", "truncated");
        }
        if (opts.requireTerminal && result === undefined && !nudged) {
          nudged = true;
          const terminal = appTools.find((t) => t.terminal);
          messages.push({
            role: "user",
            content: `Now call the ${terminal?.name ?? "submit"} tool with your final output. Do not reply in plain text.`,
          });
          continue;
        }
        break;
      }

      // A tool input cut off at max_tokens can still look valid; never run it.
      if (message.stop_reason === "max_tokens") {
        throw new AgentError("The response ran too long and was cut off. Try a narrower request.", "truncated");
      }

      messages.push({ role: "assistant", content: message.content });
      // Chat answers are what comes after the last tool result, so the live text starts over here.
      if (text.length > answerStart) emit({ type: "text_reset", text: "" });
      answerStart = text.length;

      const toolResults: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      let finished = false;
      for (const use of toolUses) {
        const tool = toolByName.get(use.name);
        if (!tool) {
          toolResults.push({ type: "tool_result", tool_use_id: use.id, is_error: true, content: `Unknown tool: ${use.name}` });
          continue;
        }
        const parsed = tool.schema.safeParse(use.input);
        if (!parsed.success) {
          toolResults.push({
            type: "tool_result",
            tool_use_id: use.id,
            is_error: true,
            content: `Invalid input. Fix these fields and call ${use.name} again: ${summarizeIssues(parsed.error)}`,
          });
          continue;
        }
        if (tool.label) emit({ type: "action", text: tool.label(parsed.data) });
        if (tool.terminal) {
          result = parsed.data as T;
          finished = true;
          toolResults.push({ type: "tool_result", tool_use_id: use.id, content: "Saved." });
          continue;
        }
        try {
          const out = tool.run ? await tool.run(parsed.data) : "Done.";
          toolResults.push({ type: "tool_result", tool_use_id: use.id, content: out });
        } catch (e) {
          toolResults.push({
            type: "tool_result",
            tool_use_id: use.id,
            is_error: true,
            content: e instanceof Error ? e.message : "Tool failed.",
          });
        }
      }
      messages.push({ role: "user", content: toolResults });
      if (finished) break;
    }
  } catch (err) {
    // Turns already billed travel with the error, so receipts and the monthly budget count them.
    if (err instanceof AgentError && !err.usage) {
      err.usage = usage;
      err.costUsd = spent;
      err.compat ??= compatInfo();
    }
    throw err;
  }

  const costUsd = spent;
  emit({ type: "usage", costUsd, model: tier });
  return { result, text, messages, stopReason, usage, costUsd, compat: compatInfo() };

  function compatInfo(): RunResult["compat"] {
    if (!dropped.size) return undefined;
    return { features: [...dropped], reason: [...new Set([...dropped].map((f) => rejected.get(f)?.message).filter((m): m is string => !!m))].join(" · ") };
  }

  function announceServerTool(name: string, input: Record<string, unknown>) {
    if (name === "web_search" && typeof input.query === "string") {
      emit({ type: "search", query: input.query });
    } else if (name === "web_fetch" && typeof input.url === "string") {
      emit({ type: "read", url: input.url, host: hostOf(input.url) });
    } else if (name === "code_execution" || name === "bash_code_execution" || name === "text_editor_code_execution") {
      emit({ type: "status", text: "Filtering results" });
    }
  }
}

type UsageCounts = { input_tokens?: number | null; output_tokens?: number | null; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null; cache_creation?: { ephemeral_1h_input_tokens?: number } | null };

function countsOf(u: UsageCounts): Usage {
  return {
    ...emptyUsage(),
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
    cacheWrite1hTokens: u.cache_creation?.ephemeral_1h_input_tokens ?? 0,
  };
}

/**
 * What one response bills. Normally its top-level usage at the rates of the model that answered. When a
 * server-side fallback served the turn, top-level usage covers only the serving attempt, so every attempt
 * in usage.iterations is priced at its own model's rates (the declined one included).
 */
export function billedUsage(tier: ModelTier, message: Pick<Anthropic.Beta.BetaMessage, "model" | "usage">): { usage: Usage; costUsd: number } {
  const u = message.usage;
  const tools = { webSearches: u.server_tool_use?.web_search_requests ?? 0, webFetches: u.server_tool_use?.web_fetch_requests ?? 0 };
  const attempts = (u.iterations ?? []).filter((i): i is Anthropic.Beta.BetaMessageIterationUsage | Anthropic.Beta.BetaFallbackMessageIterationUsage => i.type === "message" || i.type === "fallback_message");
  if (attempts.some((i) => i.type === "fallback_message")) {
    let total = emptyUsage();
    let costUsd = 0;
    for (const a of attempts) {
      const counts = countsOf(a);
      total = addUsage(total, counts);
      costUsd += requestCost(tier, a.model ?? message.model, counts);
    }
    const searches = { ...emptyUsage(), ...tools };
    return { usage: addUsage(total, searches), costUsd: costUsd + requestCost(tier, message.model, searches) };
  }
  const counts = { ...countsOf(u), ...tools };
  return { usage: counts, costUsd: requestCost(tier, message.model, counts) };
}

function latestLine(buffer: string): string | null {
  const trimmed = buffer.replace(/\s+/g, " ").trim();
  if (!trimmed) return null;
  const sentences = trimmed.split(/(?<=[.!?])\s+/);
  const last = sentences.length > 1 ? sentences[sentences.length - 2] : sentences[0];
  const clean = last.replace(/^[#*\-\s]+/, "").replace(/\*\*/g, "");
  return clean.length > 140 ? clean.slice(0, 137) + "…" : clean;
}
