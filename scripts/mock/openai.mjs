/**
 * The OpenAI-compatible side of the mock: GET /v1/models and POST /v1/chat/completions, the API every
 * provider but Anthropic speaks in Inroad (OpenAI, Gemini, Grok, Groq, OpenRouter, Mistral, DeepSeek,
 * Together, Ollama, custom endpoints).
 *
 * A request is translated into the Anthropic shape the planner already understands (plan.mjs), planned the
 * same way, and streamed back as Chat Completions chunks. So every workflow's playbook works unchanged:
 *   - web_search / web_fetch arrive as function tools; when the planner wants a search, the reply is those
 *     function calls (finish_reason "tool_calls") and the app runs them itself, then asks again
 *   - thinking streams as `reasoning_content`, text as `content`, tool calls as indexed `tool_calls` deltas
 *   - usage arrives in a last chunk when `stream_options.include_usage` is set
 *   - faults come back in OpenAI's error shape (insufficient_quota, invalid_api_key, model_not_found, …)
 *   - a model whose name contains "strictparams" rejects optional fields (stream_options, reasoning_effort,
 *     max_completion_tokens) the way a strict endpoint does, to exercise compat mode
 */
import { takeFault, TURN_FAULTS } from "./faults.mjs";
import { mockId, planTurn } from "./plan.mjs";

const WEB = new Set(["web_search", "web_fetch"]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function json(res, status, body, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json", ...headers }).end(JSON.stringify(body));
}

function oaError(res, status, code, message) {
  const requestId = mockId("req");
  json(res, status, { error: { message, type: status >= 500 ? "server_error" : "invalid_request_error", code } }, { "x-request-id": requestId });
}

/** The same failures as faults.mjs, as OpenAI-compatible APIs send them. */
const HTTP = {
  credit: () => [429, "insufficient_quota", "You exceeded your current quota, please check your plan and billing details."],
  org_disabled: () => [403, "account_deactivated", "Your account has been deactivated."],
  context_too_long: () => [400, "context_length_exceeded", "This model's maximum context length is 128000 tokens. However, your messages resulted in 1048576 tokens. Please reduce the length of the messages."],
  bad_request: () => [400, "invalid_request_error", "Invalid parameter: messages with role 'tool' must be a response to a preceeding message with 'tool_calls'."],
  auth: () => [401, "invalid_api_key", "Incorrect API key provided: sk-mock****. You can find your API key at https://platform.openai.com/account/api-keys."],
  permission: () => [403, "permission_denied", "You are not allowed to sample from this model."],
  model_unavailable: (body) => [404, "model_not_found", `The model \`${body.model}\` does not exist or you do not have access to it.`],
  too_large: () => [413, "request_too_large", "Request too large."],
  rate_limit: () => [429, "rate_limit_exceeded", "Rate limit reached for requests. Please try again in 1s."],
  overloaded: () => [503, "server_error", "The server is overloaded or not ready yet."],
  server_error: () => [500, "server_error", "The server had an error while processing your request."],
};

/** "- title | url\n  snippet" lines (what the app sends back for a search) → search results. */
function parseResults(text) {
  const out = [];
  for (const line of String(text ?? "").split("\n")) {
    const m = /^- (.*) \| (https?:\/\/\S+)$/.exec(line.trim());
    if (m) out.push({ type: "web_search_result", title: m[1], url: m[2], encrypted_content: "", page_age: null });
  }
  return out;
}

/** A Chat Completions request in the Anthropic shape plan.mjs reads. */
export function toAnthropic(body) {
  const system = [];
  const messages = [];
  const tools = [];
  for (const t of body.tools ?? []) {
    const f = t.function ?? {};
    if (f.name === "web_search") tools.push({ type: "web_search_20250305", name: "web_search" });
    else if (f.name === "web_fetch") tools.push({ type: "web_fetch_20250910", name: "web_fetch" });
    else tools.push({ name: f.name, description: f.description, input_schema: f.parameters ?? { type: "object" } });
  }
  const web = new Map();
  const pushUser = (block) => {
    const last = messages[messages.length - 1];
    if (last?.role === "user") last.content.push(block);
    else messages.push({ role: "user", content: [block] });
  };
  for (const m of body.messages ?? []) {
    if (m.role === "system" && !messages.length) system.push(String(m.content ?? ""));
    else if (m.role === "user" || m.role === "system") pushUser({ type: "text", text: String(m.content ?? "") });
    else if (m.role === "assistant") {
      const blocks = [];
      if (m.content) blocks.push({ type: "text", text: String(m.content) });
      for (const tc of m.tool_calls ?? []) {
        let input = {};
        try {
          input = JSON.parse(tc.function?.arguments || "{}");
        } catch {
          // left empty
        }
        const name = tc.function?.name;
        if (WEB.has(name)) {
          web.set(tc.id, { name, input });
          blocks.push({ type: "server_tool_use", id: tc.id, name, input });
        } else blocks.push({ type: "tool_use", id: tc.id, name, input });
      }
      messages.push({ role: "assistant", content: blocks });
    } else if (m.role === "tool") {
      const call = web.get(m.tool_call_id);
      const last = messages[messages.length - 1];
      if (call && last?.role === "assistant") {
        last.content.push(
          call.name === "web_search"
            ? { type: "web_search_tool_result", tool_use_id: m.tool_call_id, content: parseResults(m.content) }
            : { type: "web_fetch_tool_result", tool_use_id: m.tool_call_id, content: { type: "web_fetch_result", url: call.input.url, content: { type: "document", source: { type: "text", media_type: "text/plain", data: String(m.content ?? "") } } } },
        );
      } else pushUser({ type: "tool_result", tool_use_id: m.tool_call_id, content: String(m.content ?? "") });
    }
  }
  return {
    model: body.model,
    max_tokens: body.max_completion_tokens ?? body.max_tokens ?? 32000,
    system: system.join("\n\n"),
    messages,
    tools,
    output_config: { effort: body.reasoning_effort ?? "medium" },
  };
}

/** The structural checks every OpenAI-compatible API makes: tool messages answer tool calls, and every call is answered. */
function invalid(body) {
  const msgs = body.messages;
  if (!Array.isArray(msgs) || !msgs.length) return "messages: required";
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    if (m.role === "tool") {
      let j = i - 1;
      while (j >= 0 && msgs[j].role === "tool") j--;
      if (j < 0 || msgs[j].role !== "assistant" || !(msgs[j].tool_calls ?? []).some((c) => c.id === m.tool_call_id)) {
        return "Invalid parameter: messages with role 'tool' must be a response to a preceeding message with 'tool_calls'.";
      }
    }
    if (m.role === "assistant" && m.tool_calls?.length) {
      const answered = new Set();
      for (let j = i + 1; j < msgs.length && msgs[j].role === "tool"; j++) answered.add(msgs[j].tool_call_id);
      const missing = m.tool_calls.find((c) => !answered.has(c.id));
      if (missing) return `An assistant message with 'tool_calls' must be followed by tool messages responding to each 'tool_call_id'. The following tool_call_ids did not have response messages: ${missing.id}`;
    }
  }
  return null;
}

function strictParams(body) {
  if (!/strictparams/.test(String(body.model))) return null;
  for (const field of ["stream_options", "reasoning_effort", "max_completion_tokens"]) {
    if (body[field] !== undefined) return `Unrecognized request argument supplied: ${field}`;
  }
  return null;
}

export function listModels(req, res) {
  const auth = String(req.headers.authorization ?? "");
  // Anthropic's SDK asks the same path with x-api-key: answer it in Anthropic's shape.
  if (req.headers["x-api-key"]) {
    return json(res, 200, { data: [{ type: "model", id: "claude-sonnet-5-5", display_name: "Sonnet 5.5", created_at: "2026-01-01T00:00:00Z" }], has_more: false, first_id: "claude-sonnet-5-5", last_id: "claude-sonnet-5-5" });
  }
  if (/^Bearer (bad|sk-bad)/.test(auth)) return oaError(res, 401, "invalid_api_key", "Incorrect API key provided: bad****. You can find your API key at https://platform.openai.com/account/api-keys.");
  json(res, 200, {
    object: "list",
    data: [
      { id: "mock-large", object: "model", owned_by: "mock" },
      { id: "mock-large-mini", object: "model", owned_by: "mock" },
      { id: "text-embedding-mock", object: "model", owned_by: "mock" },
      { id: "mock-routed", object: "model", owned_by: "mock", pricing: { prompt: "0.000002", completion: "0.000008" } },
    ],
  });
}

export async function chatCompletions(req, res, { delay, requests }) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const body = raw ? JSON.parse(raw) : {};
  const summary = {
    at: new Date().toISOString(),
    api: "chat",
    model: body.model,
    tools: (body.tools ?? []).map((t) => t.function?.name),
    messages: body.messages?.length ?? 0,
    maxTokens: body.max_completion_tokens ?? body.max_tokens ?? null,
    effort: body.reasoning_effort ?? null,
    streamUsage: !!body.stream_options?.include_usage,
    stream: body.stream === true,
  };
  requests.push(summary);
  if (requests.length > 200) requests.shift();

  const problem = invalid(body) ?? strictParams(body);
  if (problem) {
    summary.status = 400;
    console.log(`[mock] chat 400 ${problem}`);
    return oaError(res, 400, "invalid_request_error", problem);
  }
  const anthropic = toAnthropic(body);
  const fault = takeFault(anthropic, req.headers);
  if (fault && HTTP[fault.type]) {
    const [status, code, message] = HTTP[fault.type](body);
    summary.status = status;
    summary.fault = fault.type;
    console.log(`[mock] chat fault ${fault.type} → ${status}`);
    return oaError(res, status, code, message);
  }
  const plan = planTurn(anthropic, fault && TURN_FAULTS.has(fault.type) ? fault : null);

  // A search or fetch the planner wants this turn: hand it to the app as function calls, and stop there.
  const webCalls = plan.blocks.filter((b) => b.type === "server_tool_use" && WEB.has(b.name) && summary.tools.includes(b.name));
  const thinking = plan.blocks.filter((b) => b.type === "thinking").map((b) => b.thinking).join("");
  const text = webCalls.length ? "" : plan.blocks.filter((b) => b.type === "text").map((b) => b.text).join("");
  const calls = webCalls.length ? webCalls : plan.blocks.filter((b) => b.type === "tool_use");
  const finish = calls.length ? "tool_calls" : plan.stop === "max_tokens" ? "length" : plan.stop === "refusal" ? "content_filter" : "stop";
  const u = plan.usage.end;
  const usage = {
    prompt_tokens: u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens,
    completion_tokens: u.output_tokens,
    total_tokens: u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens + u.output_tokens,
    prompt_tokens_details: { cached_tokens: u.cache_read_input_tokens },
  };
  summary.status = 200;
  summary.fault = fault?.type ?? null;
  summary.stop = finish;
  console.log(`[mock] chat ${summary.tools.join(",") || "no tools"} | turn ${summary.messages} | ${calls.map((c) => c.name).join(",") || finish}`);

  const id = mockId("chatcmpl");
  const created = Math.floor(Date.now() / 1000);
  const chunk = (delta, finish_reason = null) => ({ id, object: "chat.completion.chunk", created, model: body.model, choices: [{ index: 0, delta, finish_reason }] });

  if (!body.stream) {
    return json(res, 200, {
      id,
      object: "chat.completion",
      created,
      model: body.model,
      choices: [{ index: 0, finish_reason: finish, message: { role: "assistant", content: text || null, ...(calls.length ? { tool_calls: calls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.input) } })) } : {}) } }],
      usage,
    });
  }

  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "x-request-id": plan.requestId });
  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
  send(chunk({ role: "assistant", content: "" }));
  for (const piece of thinking.match(/.{1,60}/gs) ?? []) {
    send(chunk({ reasoning_content: piece }));
    await sleep(delay / 6);
  }
  if (fault?.type === "overloaded_midstream") {
    send({ error: { message: "The server is overloaded or not ready yet.", code: 503 } });
    return res.end();
  }
  for (const piece of text.match(/.{1,40}/gs) ?? []) {
    send(chunk({ content: piece }));
    await sleep(delay / 8);
  }
  calls.forEach((c, index) => {
    const args = JSON.stringify(c.input ?? {});
    send(chunk({ tool_calls: [{ index, id: c.id.replace(/^(toolu|srvtoolu)_/, "call_"), type: "function", function: { name: c.name, arguments: "" } }] }));
    for (const piece of args.match(/.{1,80}/gs) ?? []) send(chunk({ tool_calls: [{ index, function: { arguments: piece } }] }));
  });
  send(chunk({}, finish));
  if (body.stream_options?.include_usage) send({ id, object: "chat.completion.chunk", created, model: body.model, choices: [], usage });
  res.write("data: [DONE]\n\n");
  res.end();
}
