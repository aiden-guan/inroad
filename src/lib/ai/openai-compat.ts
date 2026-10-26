import "server-only";
import { createHash } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { firecrawlSearch } from "@/lib/connectors/firecrawl";
import { fetchText } from "@/lib/signals/http";
import { digestPage } from "@/lib/signals/website";
import { redactKeys } from "@/lib/store/ai-keys";
import { getSecret, readWorkspace } from "@/lib/store/workspace";
import type { ActiveProvider } from "./client";
import { AgentError, type AgentErrorCode } from "./errors";
import type { Source } from "./events";
import { addUsage, emptyUsage, type Usage } from "./models";

/**
 * One assistant turn on an OpenAI-compatible Chat Completions API (OpenAI, Gemini, Grok, Groq, OpenRouter,
 * Mistral, DeepSeek, Together, Ollama, or a custom endpoint).
 *
 * The engine keeps every conversation in Anthropic's message shape (it's what Ask threads persist and what
 * the workflows read citations from), so this file translates both ways:
 *  - out: system blocks, text, tool_use / tool_result, and web results become Chat Completions messages
 *  - in: the streamed reply becomes Anthropic-shaped blocks (text, tool_use)
 *
 * Web search and web fetch, which Anthropic runs server-side, run here as function tools: search through
 * the founder's Firecrawl key (left out when there is none), fetch through the app's guarded fetcher. They
 * resolve inside the turn and are recorded as server_tool_use + web_*_tool_result blocks, exactly where
 * Anthropic would put them, so seenWebUrls, citations and receipts work unchanged.
 */

type Msg = Anthropic.Beta.BetaMessageParam;
type Json = Record<string, unknown>;

export interface ChatToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}
export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ChatToolCall[];
  tool_call_id?: string;
}

/** Emulated server-tool blocks carry this id prefix, so the Anthropic path knows to turn them into text. */
export const EMULATED = "oaweb_";

const WEB_TOOLS = new Set(["web_search", "web_fetch"]);

/* ───────────── Anthropic-shaped history → Chat Completions messages ───────────── */

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((b: Json) => (b?.type === "text" ? String(b.text ?? "") : ""))
    .filter(Boolean)
    .join("\n");
}

/** A web result block as the text a model reads. Anthropic's encrypted search content is never forwarded. */
function webResultText(block: Json): string {
  const content = block.content as Json | Json[] | undefined;
  if (block.type === "web_search_tool_result") {
    if (!Array.isArray(content)) return `Search failed (${String((content as Json | undefined)?.error_code ?? "error")}).`;
    if (!content.length) return "No results.";
    return content
      .filter((r) => r.type === "web_search_result")
      .map((r) => `- ${String(r.title ?? r.url)} | ${String(r.url)}${r.text ? `\n  ${String(r.text)}` : ""}`)
      .join("\n");
  }
  const c = (content ?? {}) as Json;
  if (c.type !== "web_fetch_result") return `Couldn't read that page (${String(c.error_code ?? "error")}).`;
  const doc = (c.content ?? {}) as Json;
  const source = (doc.source ?? {}) as Json;
  const body = source.type === "text" ? String(source.data ?? "") : "[A document this provider can't read as text.]";
  return [`URL: ${String(c.url)}`, doc.title ? `Title: ${String(doc.title)}` : "", "", body].filter((l, i) => i === 2 || l).join("\n");
}

/** Mistral takes only 9-character alphanumeric tool call ids; everyone else takes ours as they are. */
export function toolIdFor(provider: Pick<ActiveProvider, "id">): (id: string) => string {
  if (provider.id !== "mistral") return (id) => id;
  return (id) => (/^[A-Za-z0-9]{9}$/.test(id) ? id : createHash("sha256").update(id).digest("base64").replace(/[^A-Za-z0-9]/g, "").slice(0, 9));
}

export function toChatMessages(system: string[], messages: Msg[], idOf: (id: string) => string = (id) => id): ChatMessage[] {
  const out: ChatMessage[] = [];
  if (system.length) out.push({ role: "system", content: system.join("\n\n") });
  for (const m of messages) {
    const role = m.role as string;
    const blocks = typeof m.content === "string" ? null : (m.content as unknown as Json[]);
    if (role === "assistant") {
      if (!blocks) out.push({ role: "assistant", content: String(m.content) });
      else pushAssistant(out, blocks, idOf);
    } else if (role === "system") {
      // A note the app adds mid-conversation (Ask's date and context). Not every provider takes a system
      // message after the first turn, so it travels as a labeled user note.
      out.push({ role: "user", content: `[Context from the app, not the founder]\n${blocks ? textOf(blocks) : String(m.content)}` });
    } else if (!blocks) {
      out.push({ role: "user", content: String(m.content) });
    } else {
      for (const b of blocks) {
        if (b.type !== "tool_result") continue;
        const body = typeof b.content === "string" ? b.content : textOf(b.content);
        out.push({ role: "tool", tool_call_id: idOf(String(b.tool_use_id)), content: b.is_error ? `Error: ${body}` : body || "(no output)" });
      }
      const text = textOf(blocks);
      if (text) out.push({ role: "user", content: text });
    }
  }
  return repair(out);
}

function pushAssistant(out: ChatMessage[], blocks: Json[], idOf: (id: string) => string) {
  // Server-tool calls are forwarded only when their result is in the same message (code execution and the
  // like aren't: a call with no answer would be rejected).
  const answered = new Set(blocks.filter((b) => b.type === "web_search_tool_result" || b.type === "web_fetch_tool_result").map((b) => String(b.tool_use_id)));
  let text = "";
  let calls: ChatToolCall[] = [];
  const flush = () => {
    if (text || calls.length) out.push({ role: "assistant", content: text || null, ...(calls.length ? { tool_calls: calls } : {}) });
    text = "";
    calls = [];
  };
  for (const b of blocks) {
    if (b.type === "text") text += String(b.text ?? "");
    else if (b.type === "tool_use") calls.push({ id: idOf(String(b.id)), type: "function", function: { name: String(b.name), arguments: JSON.stringify(b.input ?? {}) } });
    else if (b.type === "server_tool_use" && WEB_TOOLS.has(String(b.name)) && answered.has(String(b.id))) {
      calls.push({ id: idOf(String(b.id)), type: "function", function: { name: String(b.name), arguments: JSON.stringify(b.input ?? {}) } });
    } else if (b.type === "web_search_tool_result" || b.type === "web_fetch_tool_result") {
      flush();
      out.push({ role: "tool", tool_call_id: idOf(String(b.tool_use_id)), content: webResultText(b) });
    }
    // thinking, redacted_thinking and other providers' server blocks don't travel.
  }
  flush();
}

/**
 * Every tool call answered (a run stopped mid-turn can leave one open, which every provider rejects), and
 * back-to-back user messages merged (some providers insist on alternating turns).
 */
function repair(messages: ChatMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const prev = out[out.length - 1];
    if (m.role === "user" && prev?.role === "user") {
      prev.content = `${prev.content ?? ""}\n\n${m.content ?? ""}`;
      continue;
    }
    out.push({ ...m });
    if (m.role === "assistant" && m.tool_calls?.length) {
      const answered = new Set<string>();
      for (let j = i + 1; j < messages.length && messages[j].role === "tool"; j++) answered.add(messages[j].tool_call_id ?? "");
      const missing = m.tool_calls.filter((c) => !answered.has(c.id));
      // Answer them after the real tool messages that follow.
      let j = i + 1;
      while (j < messages.length && messages[j].role === "tool") out.push({ ...messages[j++] });
      for (const c of missing) out.push({ role: "tool", tool_call_id: c.id, content: "No result: the run stopped before this ran." });
      i = j - 1;
    }
  }
  return out;
}

/**
 * Anthropic can't take web results another provider gathered (its own carry encrypted content), so on the way
 * to Anthropic they become plain text in the same place. Native blocks are left as they are.
 */
export function anthropicSafe(messages: Msg[]): Msg[] {
  if (!messages.some((m) => Array.isArray(m.content) && (m.content as unknown as Json[]).some((b) => String(b.id ?? b.tool_use_id ?? "").startsWith(EMULATED)))) return messages;
  return messages.map((m) => {
    if (m.role !== "assistant" || !Array.isArray(m.content)) return m;
    const blocks = m.content as unknown as Json[];
    if (!blocks.some((b) => String(b.id ?? b.tool_use_id ?? "").startsWith(EMULATED))) return m;
    const content: Json[] = [];
    for (const b of blocks) {
      if (b.type === "server_tool_use" && String(b.id).startsWith(EMULATED)) continue;
      if ((b.type === "web_search_tool_result" || b.type === "web_fetch_tool_result") && String(b.tool_use_id).startsWith(EMULATED)) {
        content.push({ type: "text", text: `[${b.type === "web_search_tool_result" ? "Web search" : "Web page"}]\n${webResultText(b)}` });
        continue;
      }
      content.push(b);
    }
    return { ...m, content: (content.length ? content : [{ type: "text", text: "(no text)" }]) as unknown as Anthropic.Beta.BetaContentBlockParam[] };
  });
}

/* ───────────── Tools ───────────── */

export interface ChatTool {
  type: "function";
  function: { name: string; description: string; parameters: Json };
}

/** JSON Schema keywords some OpenAI-compatible providers reject (Gemini's subset is the narrowest). */
const DROP_KEYS = new Set(["$schema", "$id", "propertyNames", "patternProperties", "examples", "default"]);

export function chatSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(chatSchema);
  if (!node || typeof node !== "object") return node;
  const out: Json = {};
  for (const [k, v] of Object.entries(node as Json)) {
    if (DROP_KEYS.has(k)) continue;
    if (k === "additionalProperties" && v === false) continue;
    if (k === "const") {
      out.enum = [v];
      continue;
    }
    out[k] = chatSchema(v);
  }
  return out;
}

export function chatTool(name: string, description: string, schema: z.ZodType): ChatTool {
  return { type: "function", function: { name, description, parameters: chatSchema(z.toJSONSchema(schema, { target: "draft-7" })) as Json } };
}

const WEB_SEARCH_TOOL: ChatTool = {
  type: "function",
  function: {
    name: "web_search",
    description: "Search the web. Returns result titles, URLs and short snippets. Search in English, one specific query at a time.",
    parameters: { type: "object", properties: { query: { type: "string", description: "The search query" } }, required: ["query"] },
  },
};
const WEB_FETCH_TOOL: ChatTool = {
  type: "function",
  function: {
    name: "web_fetch",
    description: "Read a web page as text. Use a URL from search results, or one already given in the conversation.",
    parameters: { type: "object", properties: { url: { type: "string", description: "The full https:// URL" } }, required: ["url"] },
  },
};

/** The founder's Firecrawl key (Integrations), or a FIRECRAWL_API_KEY on a server; null means no web search off Anthropic. */
export function webSearchKey(): string | null {
  try {
    if (readWorkspace().integrations.firecrawl?.enabled) {
      const k = getSecret("firecrawl", "key");
      if (k) return k;
    }
  } catch {
    // no workspace yet
  }
  return process.env.FIRECRAWL_API_KEY || null;
}

/* ───────────── Compat: optional fields a provider rejected ───────────── */

type Optional = "reasoning_effort" | "stream_options" | "token_param" | "max_tokens";

/** Remembered per provider, endpoint, key and model for an hour, like the Anthropic path's compat mode. */
const rejected = (() => {
  const g = globalThis as unknown as { __inroadOaCompat?: Map<string, { at: number; drop: Set<Optional> }> };
  g.__inroadOaCompat ??= new Map();
  return g.__inroadOaCompat;
})();
const COMPAT_MS = 60 * 60_000;

function compatKey(p: ActiveProvider, model: string): string {
  return createHash("sha256").update(`${p.id}|${p.baseUrl}|${p.apiKey ?? ""}|${model}`).digest("hex").slice(0, 16);
}

function dropped(key: string): Set<Optional> {
  const hit = rejected.get(key);
  if (!hit || Date.now() - hit.at > COMPAT_MS) return new Set();
  return hit.drop;
}

/** Which optional fields a 400/422 points at; [] when dropping one can't help. */
export function droppable(message: string, sent: Set<Optional>): Optional[] {
  const out: Optional[] = [];
  if (sent.has("reasoning_effort") && /reasoning[_ ]effort|reasoning/i.test(message)) out.push("reasoning_effort");
  if (sent.has("stream_options") && /stream_options|include_usage/i.test(message)) out.push("stream_options");
  if (sent.has("max_tokens") && /max_(completion_)?tokens/i.test(message)) {
    out.push(/too large|at most|maximum|exceed|greater than|less than or equal/i.test(message) ? "max_tokens" : "token_param");
  }
  // "Extra inputs are not permitted" and the like, without naming the field: drop everything optional.
  if (!out.length && /extra (fields|inputs)( are)? not permitted|unrecognized|unknown (field|parameter|argument)|additional properties/i.test(message)) out.push(...sent);
  return out;
}

/* ───────────── Errors ───────────── */

export class ProviderHttpError extends Error {
  constructor(
    public status: number,
    public body: Json,
    public message: string,
    public requestId?: string,
  ) {
    super(message);
  }
}

function errorMessage(body: Json, raw: string): string {
  const e = body.error;
  if (e && typeof e === "object" && typeof (e as Json).message === "string") return String((e as Json).message);
  if (typeof e === "string") return e;
  if (typeof body.message === "string") return body.message;
  if (typeof body.detail === "string") return body.detail;
  if (Array.isArray(body.detail)) return JSON.stringify(body.detail).slice(0, 400);
  return raw.slice(0, 400);
}

function errorCode(body: Json): string {
  const e = body.error && typeof body.error === "object" ? (body.error as Json) : {};
  return String(e.code ?? e.type ?? body.code ?? body.type ?? "");
}

/** What the provider said, in plain words; its own text stays in `detail` (without the key) for "Copy details". */
export function toProviderError(err: ProviderHttpError, provider: ActiveProvider, model: string): AgentError {
  const code = errorCode(err.body);
  const message = redactKeys(err.message, [provider.apiKey]);
  const extra = { requestId: err.requestId, detail: [err.status, code, message].filter(Boolean).join(" · ") || undefined };
  const fail = (text: string, c: AgentErrorCode) => new AgentError(text, c, extra);
  const name = provider.name;
  const s = err.status;
  if (s === 402 || /insufficient_quota|credit|balance|billing|payment|quota/i.test(`${code} ${message}`)) {
    return fail(`Your ${name} account is out of credits or over its quota. Add credits with ${name}, then try again.`, "no_credit");
  }
  if (s === 401) return fail(`${name} rejected your API key. Update it in Settings.`, "auth");
  if (s === 403) {
    if (/region|country|territor|location/i.test(message)) return fail(`${name} isn't available where this computer is. Try another provider in Settings.`, "auth");
    return fail(`Your ${name} key isn't allowed to do this. Check its permissions, or use another key.`, "auth");
  }
  if (/does not support tools|tools? (is|are) not supported|tool use is not supported|function calling is not (enabled|supported)/i.test(message)) {
    return fail(`${model} can't use tools, which every step here needs. Pick another model in Settings.`, "model_unavailable");
  }
  if (s === 404 || /model.*(not found|does not exist|not available|no access|invalid model)/i.test(message)) {
    return fail(`${name} doesn't offer ${model} to your key. Pick another model in Settings.`, "model_unavailable");
  }
  if (s === 413) return fail("That was too much to send in one request. Try a smaller file or a shorter paste.", "too_large");
  if (/context[_ ]length|context window|maximum context|too many tokens|reduce the length|prompt is too long/i.test(message)) {
    return fail("There was too much text for this model in one request. Try a narrower request, start a new Ask thread, or pick a model with a longer context in Settings.", "context_too_long");
  }
  if (s === 429) return fail(`${name} is rate limiting this key. Wait a minute and try again.`, "rate_limit");
  if (s >= 500) return fail(`${name} is having trouble right now. Try again in a moment.`, "overloaded");
  if (s === 400 || s === 422) return fail(`${name} turned this request down. Try again; if it keeps happening, Copy details shows what it said.`, "bad_request");
  return fail(`Something went wrong talking to ${name}${s ? ` (error ${s})` : ""}. Try again in a moment.`, "unknown");
}

/* ───────────── Streaming ───────────── */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function parseBody(raw: string): Json {
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? (v as Json) : {};
  } catch {
    return {};
  }
}

const isQuota = (status: number, body: Json, raw: string) => status === 429 && /insufficient_quota|quota|credit|billing/i.test(`${errorCode(body)} ${raw}`);

/** Opens the stream, retrying connection drops, rate limits and server errors (with Retry-After) before anything streamed. */
async function openStream(provider: ActiveProvider, body: Json, signal?: AbortSignal): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${provider.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "text/event-stream",
          ...(provider.apiKey ? { authorization: `Bearer ${provider.apiKey}` } : {}),
        },
        body: JSON.stringify(body),
        signal,
        cache: "no-store",
      });
    } catch {
      if (signal?.aborted) throw new AgentError("Stopped.", "stopped");
      if (attempt < 2) {
        await sleep(800 * 2 ** attempt);
        continue;
      }
      throw new AgentError(
        provider.id === "ollama" ? "Couldn't reach Ollama on this computer. Make sure it's running, then try again." : `Couldn't reach ${provider.name}. Check your connection.`,
        "network",
      );
    }
    if (res.ok) return res;
    const raw = await res.text().catch(() => "");
    const parsed = parseBody(raw);
    if ((res.status === 429 && !isQuota(res.status, parsed, raw)) || res.status >= 500) {
      if (attempt < 3) {
        const after = Number(res.headers.get("retry-after"));
        await sleep(Number.isFinite(after) && after > 0 ? Math.min(20_000, after * 1000) : 1000 * 2 ** attempt);
        continue;
      }
    }
    throw new ProviderHttpError(res.status, parsed, errorMessage(parsed, raw), res.headers.get("x-request-id") ?? undefined);
  }
}

async function* events(res: Response): AsyncGenerator<Json> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).replace(/\r$/, "");
      buf = buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data) continue;
      if (data === "[DONE]") return;
      const parsed = parseBody(data);
      if (Object.keys(parsed).length) yield parsed;
    }
  }
}

export interface TurnHooks {
  text(delta: string): void;
  thinking(delta: string): void;
  /** A tool call's name is known (the engine shows "Writing it up" for a submit tool). */
  toolStart(name: string): void;
  /** Characters of a tool call's input so far. */
  toolInput(name: string, chars: number): void;
  search(query: string): void;
  read(url: string): void;
  sources(sources: Source[]): void;
}

interface CallResult {
  text: string;
  calls: { id: string; name: string; args: string }[];
  finish: string | null;
  usage: Usage;
  model: string;
}

/** Rough tokens for a provider that streams no usage: about four characters a token. */
const approx = (s: string) => Math.ceil(s.length / 4);

async function callOnce(provider: ActiveProvider, body: Json, hooks: TurnHooks, signal?: AbortSignal): Promise<CallResult> {
  const res = await openStream(provider, body, signal);
  let text = "";
  let finish: string | null = null;
  let model = String(body.model);
  let usage: Usage | null = null;
  const calls = new Map<string, { id: string; name: string; args: string }>();
  let n = 0;
  for await (const chunk of events(res)) {
    if (chunk.error) {
      const e = chunk.error as Json;
      throw new ProviderHttpError(Number(e.code) || 500, chunk, String(e.message ?? "The stream failed."));
    }
    if (typeof chunk.model === "string") model = chunk.model;
    const u = (chunk.usage ?? (chunk.x_groq as Json | undefined)?.usage) as Json | undefined;
    if (u && typeof u.prompt_tokens === "number") {
      const cached = Number((u.prompt_tokens_details as Json | undefined)?.cached_tokens ?? 0);
      usage = { ...emptyUsage(), inputTokens: Math.max(0, Number(u.prompt_tokens) - cached), cacheReadTokens: cached, outputTokens: Number(u.completion_tokens ?? 0) };
    }
    const choice = (chunk.choices as Json[] | undefined)?.[0];
    if (!choice) continue;
    const delta = (choice.delta ?? {}) as Json;
    if (typeof delta.content === "string" && delta.content) {
      text += delta.content;
      hooks.text(delta.content);
    }
    const reasoning = delta.reasoning_content ?? delta.reasoning;
    if (typeof reasoning === "string" && reasoning) hooks.thinking(reasoning);
    const tcs = delta.tool_calls as Json[] | undefined;
    if (Array.isArray(tcs)) {
      tcs.forEach((tc, j) => {
        // OpenAI streams by index with the id only on the first piece; some providers send whole calls without an index.
        const slot = tc.index !== undefined ? `i${tc.index}` : tc.id ? `id${tc.id}` : `p${n}-${j}`;
        const fn = (tc.function ?? {}) as Json;
        let call = calls.get(slot);
        if (!call) {
          call = { id: typeof tc.id === "string" && tc.id ? tc.id : `call${createHash("sha256").update(`${Date.now()}-${n}-${j}`).digest("hex").slice(0, 9)}`, name: "", args: "" };
          calls.set(slot, call);
        }
        if (typeof fn.name === "string" && fn.name && !call.name) {
          call.name = fn.name;
          hooks.toolStart(call.name);
        }
        if (typeof fn.arguments === "string") {
          call.args += fn.arguments;
          if (call.name) hooks.toolInput(call.name, call.args.length);
        }
      });
    }
    if (typeof choice.finish_reason === "string") finish = choice.finish_reason;
    n++;
  }
  const out = [...calls.values()].filter((c) => c.name);
  return {
    text,
    calls: out,
    finish,
    model,
    usage: usage ?? { ...emptyUsage(), inputTokens: approx(JSON.stringify(body.messages ?? "")), outputTokens: approx(text + out.map((c) => c.args).join("")) },
  };
}

/* ───────────── Web tools ───────────── */

async function runSearch(query: string, key: string | null, seen: Set<string>, hooks: TurnHooks): Promise<Json | Json[]> {
  hooks.search(query);
  if (!key) return { type: "web_search_tool_result_error", error_code: "unavailable" };
  const r = await firecrawlSearch(key, query, 8);
  if (!r.ok) return { type: "web_search_tool_result_error", error_code: "unavailable", message: r.error.message };
  const fresh: Source[] = [];
  for (const x of r.value) {
    if (seen.has(x.url)) continue;
    seen.add(x.url);
    fresh.push({ title: x.title, url: x.url, host: hostOf(x.url) });
  }
  if (fresh.length) hooks.sources(fresh);
  // `text` isn't part of Anthropic's block (its snippet is encrypted); this path reads it back when the
  // conversation continues (webResultText), and nothing sends these blocks to Anthropic (anthropicSafe).
  return r.value.map((x) => ({ type: "web_search_result", url: x.url, title: x.title, page_age: null, encrypted_content: "", text: x.description }));
}

async function runFetch(url: string, hooks: TurnHooks): Promise<Json> {
  if (!/^https?:\/\//i.test(url)) return { type: "web_fetch_tool_error", error_code: "invalid_input" };
  hooks.read(url);
  const res = await fetchText(url, { timeoutMs: 15_000, maxBytes: 2_000_000, accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5" });
  if (!res || res.status >= 400) return { type: "web_fetch_tool_error", error_code: "url_not_accessible" };
  const html = /<html|<body|<head/i.test(res.body.slice(0, 2000));
  const page = html ? digestPage(res.url, res.body, 12_000) : null;
  const text = page ? [page.description, page.text].filter(Boolean).join("\n\n") : res.body.slice(0, 12_000);
  return {
    type: "web_fetch_result",
    url: res.url,
    retrieved_at: new Date().toISOString(),
    content: { type: "document", title: page?.title || null, source: { type: "text", media_type: "text/plain", data: text } },
  };
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/* ───────────── One turn ───────────── */

export interface TurnInput {
  provider: ActiveProvider;
  model: string;
  system: string[];
  messages: Msg[];
  tools: ChatTool[];
  /** Web tool uses left in this run (shared across turns); the tool is offered while any remain. */
  web: { search: number; fetch: number };
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  /** Sent only when the caller set an output cap; otherwise the model's own limit applies. */
  maxTokens?: number;
  seenSources: Set<string>;
  hooks: TurnHooks;
  signal?: AbortSignal;
}

export interface TurnOutput {
  content: Anthropic.Beta.BetaContentBlock[];
  stopReason: "end_turn" | "tool_use" | "max_tokens" | "refusal";
  usage: Usage;
  costUsd: number;
  /** No price is known for the model: the cost above is 0, not free. */
  unpriced: boolean;
  model: string;
}

/** Web search/fetch rounds inside one turn before the model has to answer with what it has. */
const MAX_WEB_ROUNDS = 8;

export async function runOpenAITurn(input: TurnInput): Promise<TurnOutput> {
  const { provider, model, hooks, signal } = input;
  const idOf = toolIdFor(provider);
  const searchKey = webSearchKey();
  const content: Json[] = [];
  let usage = emptyUsage();
  let costUsd = 0;
  let servedBy = model;
  const price = provider.prices[model];
  const ck = compatKey(provider, model);

  for (let round = 0; round <= MAX_WEB_ROUNDS; round++) {
    const offerSearch = !!searchKey && input.web.search > 0 && round < MAX_WEB_ROUNDS;
    const offerFetch = input.web.fetch > 0 && round < MAX_WEB_ROUNDS;
    const tools = [...input.tools, ...(offerSearch ? [WEB_SEARCH_TOOL] : []), ...(offerFetch ? [WEB_FETCH_TOOL] : [])];
    const history = content.length ? [...input.messages, { role: "assistant", content } as unknown as Msg] : input.messages;

    let result: CallResult | null = null;
    for (let attempt = 0; !result; attempt++) {
      const drop = dropped(ck);
      const sent = new Set<Optional>();
      const body: Json = { model, messages: toChatMessages(input.system, history, idOf), stream: true };
      if (tools.length) body.tools = tools;
      if (provider.preset.caps.streamUsage && !drop.has("stream_options")) {
        body.stream_options = { include_usage: true };
        sent.add("stream_options");
      }
      if (input.maxTokens && !drop.has("max_tokens")) {
        const param = drop.has("token_param") ? (provider.preset.caps.tokenParam === "max_tokens" ? "max_completion_tokens" : "max_tokens") : provider.preset.caps.tokenParam;
        body[param] = input.maxTokens;
        sent.add("max_tokens");
      }
      if (provider.preset.caps.reasoningEffort && input.effort && !drop.has("reasoning_effort")) {
        body.reasoning_effort = input.effort === "low" ? "low" : input.effort === "medium" ? "medium" : "high";
        sent.add("reasoning_effort");
      }
      try {
        result = await callOnce(provider, body, hooks, signal);
      } catch (err) {
        if (signal?.aborted) throw new AgentError("Stopped.", "stopped");
        if (err instanceof ProviderHttpError && (err.status === 400 || err.status === 422) && attempt < 3) {
          const fix = droppable(err.message, sent).filter((f) => !drop.has(f));
          // A renamed cap that's rejected too goes away entirely.
          if (fix.includes("token_param") && drop.has("token_param")) fix.splice(fix.indexOf("token_param"), 1, "max_tokens");
          if (fix.length) {
            console.warn(`[agent] ${provider.name} rejected ${fix.join(", ")}; retrying without: ${redactKeys(err.message, [provider.apiKey])}`);
            rejected.set(ck, { at: Date.now(), drop: new Set([...drop, ...fix]) });
            continue;
          }
        }
        if (err instanceof ProviderHttpError) throw toProviderError(err, provider, model);
        throw err;
      }
    }

    usage = addUsage(usage, result.usage);
    servedBy = result.model || servedBy;
    if (price) costUsd += (result.usage.inputTokens * price.input + result.usage.cacheReadTokens * (price.cacheRead ?? price.input) + result.usage.outputTokens * price.output) / 1_000_000;
    if (result.text) content.push({ type: "text", text: result.text, citations: null });

    const web = result.calls.filter((c) => WEB_TOOLS.has(c.name) && (c.name === "web_search" ? offerSearch : offerFetch));
    const app = result.calls.filter((c) => !web.includes(c));
    for (const c of web) {
      const id = `${EMULATED}${createHash("sha256").update(`${c.id}-${round}`).digest("hex").slice(0, 12)}`;
      let args: Json = {};
      try {
        args = JSON.parse(c.args || "{}") as Json;
      } catch {
        // left empty: the tool says the input was invalid
      }
      content.push({ type: "server_tool_use", id, name: c.name, input: args });
      if (c.name === "web_search") {
        const query = String(args.query ?? "").trim();
        input.web.search--;
        usage.webSearches++;
        content.push({ type: "web_search_tool_result", tool_use_id: id, content: query ? await runSearch(query, searchKey, input.seenSources, hooks) : { type: "web_search_tool_result_error", error_code: "invalid_input" } });
      } else {
        input.web.fetch--;
        usage.webFetches++;
        content.push({ type: "web_fetch_tool_result", tool_use_id: id, content: await runFetch(String(args.url ?? "").trim(), hooks) });
      }
    }
    for (const c of app) {
      let parsed: unknown = {};
      try {
        parsed = JSON.parse(c.args || "{}");
      } catch {
        // invalid JSON: an empty input fails the tool's schema, and the model is told to fix it
      }
      content.push({ type: "tool_use", id: c.id, name: c.name, input: parsed });
    }
    const done = (stopReason: TurnOutput["stopReason"]): TurnOutput => ({
      content: content as unknown as Anthropic.Beta.BetaContentBlock[],
      stopReason,
      usage,
      costUsd,
      unpriced: !price,
      model: servedBy,
    });
    if (app.length) return done("tool_use");
    if (web.length) continue;
    return done(result.finish === "length" ? "max_tokens" : result.finish === "content_filter" ? "refusal" : "end_turn");
  }
  return { content: content as unknown as Anthropic.Beta.BetaContentBlock[], stopReason: "end_turn", usage, costUsd, unpriced: !price, model: servedBy };
}

/* ───────────── Key check and model list ───────────── */

export interface ModelListing {
  ok: true;
  models: string[];
  /** Per-million-token prices the provider published with the list (OpenRouter does). */
  prices: Record<string, { input: number; output: number }>;
}

/** Lists the models a key can use, which also proves the key works. */
export async function listModels(baseUrl: string, apiKey: string | undefined, name: string): Promise<ModelListing | { ok: false; status?: number; error: string }> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/models`, {
      headers: { accept: "application/json", ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return { ok: false, error: `Couldn't reach ${name} at ${baseUrl}.` };
  }
  const raw = await res.text().catch(() => "");
  const body = parseBody(raw);
  if (!res.ok) return { ok: false, status: res.status, error: redactKeys(errorMessage(body, raw), [apiKey]) };
  const rows = Array.isArray(body.data) ? (body.data as Json[]) : Array.isArray(body.models) ? (body.models as Json[]) : [];
  const models: string[] = [];
  const prices: ModelListing["prices"] = {};
  for (const r of rows) {
    const id = String(r.id ?? r.name ?? "").trim();
    if (!id) continue;
    models.push(id);
    const p = r.pricing as Json | undefined;
    const input = Number(p?.prompt);
    const output = Number(p?.completion);
    if (Number.isFinite(input) && Number.isFinite(output) && (input > 0 || output > 0)) prices[id] = { input: input * 1_000_000, output: output * 1_000_000 };
  }
  return { ok: true, models, prices };
}
