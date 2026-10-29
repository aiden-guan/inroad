/**
 * Plans one assistant turn: summarized thinking, server tools (web search with dynamic filtering, web
 * fetch), then the turn's main act, which a per-tool playbook writes when one matches (playbooks.mjs)
 * and a schema-driven fallback writes otherwise. Usage is computed from what the turn contains, and a
 * turn that outgrows max_tokens is cut off the way the real API cuts it.
 */
import { call, mockId, submitted, text } from "./blocks.mjs";
import { breakCaps, fake } from "./fake.mjs";
import { PLAYBOOKS } from "./playbooks.mjs";
import { hiddenThinkingTokens, messageBlocks, promptUsage, tokensOf } from "./usage.mjs";

export { mockId };

/* ───────────── Reading the conversation ───────────── */

export function textOf(content) {
  if (typeof content === "string") return content;
  return (content ?? [])
    .map((b) => (b.type === "text" ? b.text : b.type === "tool_result" ? (typeof b.content === "string" ? b.content : textOf(b.content)) : ""))
    .filter(Boolean)
    .join("\n");
}

/** Every app tool call so far, with the result the app sent back. */
export function toolCalls(messages) {
  const results = new Map();
  for (const m of messages) {
    if (m.role !== "user" || typeof m.content === "string") continue;
    for (const b of m.content) if (b.type === "tool_result") results.set(b.tool_use_id, { result: textOf(typeof b.content === "string" ? b.content : b.content), isError: !!b.is_error });
  }
  const out = [];
  for (const m of messages) {
    if (m.role !== "assistant" || typeof m.content === "string") continue;
    for (const b of m.content) if (b.type === "tool_use") out.push({ id: b.id, name: b.name, input: b.input, ...(results.get(b.id) ?? { result: null, isError: false }) });
  }
  return out;
}

/** Web search results the model has seen in this conversation (url, title). */
export function seenResults(messages) {
  const out = [];
  for (const m of messages) {
    if (m.role !== "assistant" || typeof m.content === "string") continue;
    for (const b of m.content) if (b.type === "web_search_tool_result" && Array.isArray(b.content)) for (const r of b.content) if (r.url) out.push(r);
  }
  return out;
}

function lastUserText(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "user") continue;
    if (typeof m.content === "string") return m.content;
    const t = m.content.filter((b) => b.type === "text").map((b) => b.text);
    if (t.length) return t.join("\n");
    if (m.content.some((b) => b.type === "tool_result")) return null;
  }
  return "";
}

export function context(body) {
  const tools = body.tools ?? [];
  const appTools = tools.filter((t) => !t.type || t.type === "custom");
  const messages = body.messages;
  const last = messages[messages.length - 1];
  const lastBlocks = messageBlocks(last);
  const pausedOn = last.role === "assistant" ? [...lastBlocks].reverse().find((b) => b.type === "server_tool_use") : undefined;
  const firstUser = messages.find((m) => m.role === "user");
  const calls = toolCalls(messages);
  return {
    body,
    model: body.model,
    effort: body.output_config?.effort,
    system: (typeof body.system === "string" ? body.system : (body.system ?? []).map((b) => b.text).join("\n\n")) ?? "",
    tools,
    appTools,
    toolNames: appTools.map((t) => t.name),
    tool: (name) => appTools.find((t) => t.name === name),
    terminals: appTools.filter((t) => /^(submit|save|finish)_/.test(t.name)),
    search: tools.find((t) => t.name === "web_search"),
    fetch: tools.find((t) => t.name === "web_fetch"),
    messages,
    afterToolResult: last.role === "user" && lastBlocks.some((b) => b.type === "tool_result"),
    pausedOn: pausedOn && !lastBlocks.some((b) => b.type === "web_search_tool_result" && b.tool_use_id === pausedOn.id) ? pausedOn : undefined,
    userText: lastUserText(messages) ?? "",
    firstText: firstUser ? textOf(firstUser.content) : "",
    calls,
    searched: messages.some((m) => m.role === "assistant" && messageBlocks(m).some((b) => b.type === "server_tool_use" && b.name === "web_search")),
    fetched: messages.some((m) => m.role === "assistant" && messageBlocks(m).some((b) => b.type === "server_tool_use" && b.name === "web_fetch")),
    results: seenResults(messages),
  };
}

/* ───────────── Building blocks ───────────── */

function thinking(ctx, lines) {
  const subject = (ctx.firstText.split("\n").find((l) => l.trim() && !/^Today is /.test(l)) ?? "the request").replace(/<[^>]+>/g, "").trim().slice(0, 70);
  // Long enough, like a real summary, that the UI's reasoning stream has lines to stream.
  const parts = lines ?? [
    `Reading what was asked: ${subject.replace(/[.:]+$/, "")}.`,
    "Starting from the workspace: the account, its open deal, and the last few touches.",
    ctx.afterToolResult ? "Checking what the tools sent back." : "Checking the material I was given before writing.",
    "Two of the signals are dated, so the fresher one should carry more weight.",
    "The recent hire is the stronger angle; the funding news is older and widely known.",
    "Keeping it short: one claim per line, each with its source.",
    "Making sure every claim has a source.",
  ];
  return { type: "thinking", thinking: parts.join(" ") + " ", signature: "mock-signature" };
}

function genericResults(ctx) {
  const domain = /\(([a-z0-9-]+(?:\.[a-z0-9-]+)+)\)/i.exec(ctx.firstText)?.[1] ?? /\b([a-z0-9-]+\.(?:com|io|ai|co|dev|app))\b/i.exec(ctx.firstText)?.[1];
  const name = domain ? domain.split(".")[0].replace(/^./, (c) => c.toUpperCase()) : "Acme";
  const slug = name.toLowerCase();
  return {
    query: `${name} funding news 2026`,
    results: [
      { type: "web_search_result", title: `${name} raises $12M Series A to automate procurement`, url: `https://techcrunch.com/2026/09/12/${slug}-series-a`, encrypted_content: "x", page_age: "1 month ago" },
      { type: "web_search_result", title: `${name} careers: Head of Finance Operations`, url: `https://jobs.ashbyhq.com/${slug}/123`, encrypted_content: "x", page_age: "2 weeks ago" },
      { type: "web_search_result", title: "Why procurement teams are buying AI in 2026", url: "https://www.forbes.com/sites/procurement-ai", encrypted_content: "x", page_age: "3 weeks ago" },
    ],
  };
}

function searchBlocks(ctx, plan, found) {
  const sid = mockId("srvtoolu");
  plan.webSearches++;
  const blocks = [{ type: "server_tool_use", id: sid, name: "web_search", input: { query: found.query } }];
  // The dynamic-filtering tool version runs code over the results before they reach the context.
  if (ctx.search.type === "web_search_20260209") {
    const cid = mockId("srvtoolu");
    blocks.push(
      { type: "server_tool_use", id: cid, name: "bash_code_execution", input: { command: "python3 -c \"filter_results(min_relevance=0.6)\"" } },
      { type: "bash_code_execution_tool_result", tool_use_id: cid, content: { type: "bash_code_execution_result", stdout: `${found.results.length} results kept`, stderr: "", return_code: 0, content: [] } },
    );
  }
  blocks.push({ type: "web_search_tool_result", tool_use_id: sid, content: found.results });
  return blocks;
}

/* ───────────── The main act ───────────── */

function generic(ctx) {
  const terminal = ctx.terminals.find((t) => !submitted(ctx, t.name));
  if (terminal) return { blocks: [call(terminal.name, fake(terminal.input_schema, terminal.name))] };
  if (!ctx.afterToolResult && ctx.appTools.length && !ctx.calls.length && /add|create|log|save/i.test(ctx.userText)) {
    // Real models often narrate before a lookup; Ask treats that text as working notes, not the answer.
    const tool = ctx.appTools[0];
    return { blocks: [text("Let me check your workspace first. "), call(tool.name, fake(tool.input_schema, tool.name))] };
  }
  const reply = ctx.afterToolResult
    ? "Done — I've updated your workspace. Anything else you want me to take on?"
    : `Here's my take on “${ctx.userText.slice(0, 80)}”.\n\n**Lead with the pain, not the product.** Your best accounts are teams that just raised and are hiring for the role your product replaces.\n\n- Start with the three warmest accounts in your pipeline\n- Send the drafts I prepared this morning\n- Book follow-ups for Thursday`;
  return { blocks: [text(reply)] };
}

function playbookFor(ctx) {
  return PLAYBOOKS.find((p) => p.match(ctx));
}

const FALLBACK_MODEL = (model) => (/opus/.test(model) ? "claude-opus-4-8" : /sonnet/.test(model) ? "claude-sonnet-5" : null);

/**
 * Plans the turn. `fault` is a turn-shaping fault from faults.mjs (or null). Returns everything the wire
 * layer needs: blocks, stop reason, served model and usage.
 */
export function planTurn(body, fault) {
  const ctx = context(body);
  const plan = { id: mockId("msg"), requestId: mockId("req"), requestedModel: body.model, model: body.model, blocks: [], stop: "end_turn", stopDetails: null, webSearches: 0, webFetches: 0 };
  const prompt = promptUsage(body);
  const book = playbookFor(ctx);

  if (fault?.type === "refusal" || (fault?.type === "refusal_fallback" && !FALLBACK_MODEL(body.model))) {
    plan.stop = "refusal";
    plan.stopDetails = { type: "refusal", category: "cyber", explanation: "This request was declined by a safety classifier." };
    return finish(plan, body, prompt, 0);
  }

  plan.blocks.push(thinking(ctx, book?.thinking?.(ctx)));

  if (ctx.pausedOn) {
    // Resuming a paused server-tool loop: the search that was running comes back first.
    plan.blocks.push({ type: "web_search_tool_result", tool_use_id: ctx.pausedOn.id, content: (book?.search?.(ctx) ?? genericResults(ctx)).results });
    plan.webSearches++;
  } else if (ctx.search && !ctx.searched && (book?.wantsSearch?.(ctx) ?? !ctx.afterToolResult)) {
    const found = book?.search?.(ctx) ?? genericResults(ctx);
    if (fault?.type === "pause_turn") {
      plan.blocks.push({ type: "server_tool_use", id: mockId("srvtoolu"), name: "web_search", input: { query: found.query } });
      plan.stop = "pause_turn";
      return finish(plan, body, prompt);
    }
    plan.blocks.push(...searchBlocks(ctx, plan, found));
  }
  if (ctx.fetch && !ctx.fetched && !ctx.afterToolResult && !ctx.pausedOn && (book?.wantsFetch?.(ctx) ?? true)) {
    const fid = mockId("srvtoolu");
    const url = book?.fetchUrl?.(ctx) ?? "https://example.com";
    plan.webFetches++;
    plan.blocks.push(
      { type: "server_tool_use", id: fid, name: "web_fetch", input: { url } },
      { type: "web_fetch_tool_result", tool_use_id: fid, content: { type: "web_fetch_result", url, retrieved_at: new Date().toISOString(), content: { type: "document", source: { type: "text", media_type: "text/plain", data: "Example Domain" }, title: "Example" } } },
    );
  }

  // The results this turn just produced count as seen by the act that follows.
  ctx.results = [...ctx.results, ...plan.blocks.filter((b) => b.type === "web_search_tool_result").flatMap((b) => b.content)];

  let act;
  if (fault?.type === "no_submit") {
    act = { blocks: [text("Here's what I found. The strongest reason to talk is their recent hiring, and the best person is the new team lead.")] };
  } else {
    act = book?.act(ctx) ?? generic(ctx);
    if (fault?.type === "invalid_submit") {
      const use = act.blocks.find((b) => b.type === "tool_use" && /^(submit|save|finish)_/.test(b.name)) ?? act.blocks.find((b) => b.type === "tool_use");
      const tool = use && ctx.tool(use.name);
      if (tool) breakCaps(tool.input_schema, use.input);
    }
  }
  plan.blocks.push(...act.blocks);
  plan.stop = act.blocks.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn";

  if (fault?.type === "refusal_fallback") {
    const fallback = fault.model ?? FALLBACK_MODEL(body.model);
    plan.blocks.unshift({ type: "fallback", from: { model: body.model }, to: { model: fallback }, trigger: { type: "refusal", category: "cyber" } });
    plan.model = fallback;
    plan.fallback = fallback;
  }
  if (fault?.type === "overloaded_midstream") plan.midstreamError = { type: "overloaded_error", message: "Overloaded" };
  return finish(plan, body, prompt, undefined, fault?.type === "max_tokens");
}

/** Output usage, truncation at max_tokens, and the usage objects for the wire. */
function finish(plan, body, prompt, forcedOutput, forceTruncate = false) {
  const visible = (b) =>
    b.type === "thinking" ? tokensOf(b.thinking) : b.type === "text" ? tokensOf(b.text) : b.type === "tool_use" || b.type === "server_tool_use" ? tokensOf(b.input) : 0;
  const hidden = plan.stop === "refusal" ? 0 : hiddenThinkingTokens(body.output_config?.effort, prompt.promptTokens);
  let output = forcedOutput ?? hidden + plan.blocks.reduce((n, b) => n + visible(b), 0);
  const max = body.max_tokens;
  if (forceTruncate || output > max) {
    // Out of room: reasoning comes first, so whatever didn't fit is cut, tool calls included.
    let budget = forceTruncate ? 0 : max - hidden;
    const kept = [];
    for (const b of plan.blocks) {
      const cost = visible(b);
      if (b.type === "thinking" || b.type === "fallback") kept.push(b);
      else if (b.type === "text" && budget > 0) kept.push({ ...b, text: b.text.slice(0, Math.max(1, budget * 4)) });
      else if (b.type !== "tool_use" && b.type !== "server_tool_use" && cost === 0 && budget > 0) kept.push(b);
      budget -= cost;
      if (budget <= 0) break;
    }
    // A server tool call cut off before its result would leave the turn unfinished; drop dangling ones.
    plan.blocks = kept.filter((b, i) => b.type !== "server_tool_use" || kept.slice(i + 1).some((r) => r.tool_use_id === b.id));
    plan.stop = "max_tokens";
    output = max;
  }
  const start = {
    input_tokens: prompt.input_tokens,
    cache_creation_input_tokens: prompt.cache_creation_input_tokens,
    cache_read_input_tokens: prompt.cache_read_input_tokens,
    cache_creation: prompt.cache_creation,
  };
  const end = {
    ...start,
    output_tokens: output,
    server_tool_use: plan.webSearches || plan.webFetches ? { web_search_requests: plan.webSearches, web_fetch_requests: plan.webFetches } : null,
  };
  if (plan.fallback) {
    // The requested model declined before writing anything; the fallback served the turn on its own cache namespace.
    const fresh = { input_tokens: prompt.promptTokens, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 } };
    end.iterations = [
      { type: "message", model: plan.requestedModel, ...start, output_tokens: 0 },
      { type: "fallback_message", model: plan.fallback, ...fresh, output_tokens: output },
    ];
    Object.assign(start, fresh);
    Object.assign(end, fresh);
  }
  plan.usage = { start, end };
  return plan;
}
