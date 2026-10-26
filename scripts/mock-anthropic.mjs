#!/usr/bin/env node
/**
 * Dev-only mock of the Anthropic Messages API, for exercising the agent engine and UI without spending
 * tokens. It speaks the real wire format (SSE, or JSON when stream is off) and behaves like the API where
 * Inroad depends on it:
 *   - each workflow's tools are used in order, with input built from the request (scripts/mock/playbooks.mjs);
 *     other tools get schema-valid input that respects their caps (scripts/mock/fake.mjs)
 *   - thinking → web search (with the dynamic-filtering code step) → web fetch → tool calls
 *   - usage that varies with the request, including simulated prompt caching (5m and 1h), server tool
 *     counts, and reasoning tokens that count toward max_tokens (scripts/mock/usage.mjs)
 *   - the request checks that matter (cache breakpoints and TTL order, strict schemas, thinking, tool_choice)
 *   - failures on demand: credit, auth, 404 model, 413, 429, 529, mid-stream overload, refusal, fallback,
 *     pause_turn, max_tokens, missing or invalid submit (scripts/mock/faults.mjs)
 * It also speaks the OpenAI-compatible Chat Completions API (GET /v1/models, POST /v1/chat/completions) that
 * every other provider uses, planned by the same playbooks (scripts/mock/openai.mjs), and fakes the Firecrawl
 * people capabilities and web search Inroad uses (scripts/mock/firecrawl.mjs).
 *
 *   node scripts/mock-anthropic.mjs            # listens on :4010 (MOCK_PORT to change)
 *   ANTHROPIC_BASE_URL=http://localhost:4010 ANTHROPIC_API_KEY=mock FIRECRAWL_API_URL=http://localhost:4010 npm run dev
 *   INROAD_AI_PROVIDER=openai OPENAI_BASE_URL=http://localhost:4010/v1 OPENAI_API_KEY=mock INROAD_AI_MODEL=mock-large npm run dev
 *
 * Control endpoints: POST/GET/DELETE /__mock/faults, GET/DELETE /__mock/requests, POST /__mock/reset.
 */
import http from "node:http";
import { clearFaults, httpFault, listFaults, queueFaults, takeFault, TURN_FAULTS } from "./mock/faults.mjs";
import { firecrawl } from "./mock/firecrawl.mjs";
import { chatCompletions, listModels } from "./mock/openai.mjs";
import { mockId, planTurn } from "./mock/plan.mjs";
import { promptUsage, resetCache } from "./mock/usage.mjs";
import { validateRequest } from "./mock/validate.mjs";
import { jsonMessage, streamMessage } from "./mock/wire.mjs";

const PORT = Number(process.env.MOCK_PORT ?? 4010);
const DELAY = Number(process.env.MOCK_DELAY ?? 120);

/** The last 200 requests, summarized, for tests and for debugging a flow by hand. */
const requests = [];

function json(res, status, body, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json", ...headers }).end(JSON.stringify(body));
}

function apiError(res, { status, type, message, headers = {} }) {
  const requestId = mockId("req");
  json(res, status, { type: "error", error: { type, message }, request_id: requestId }, { "request-id": requestId, ...headers });
}

async function readBody(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

function summarize(body, headers) {
  const markers = [];
  for (const b of typeof body.system === "string" ? [] : (body.system ?? [])) if (b.cache_control) markers.push(`system:${b.cache_control.ttl ?? "5m"}`);
  return {
    at: new Date().toISOString(),
    model: body.model,
    tools: (body.tools ?? []).map((t) => t.name),
    strict: (body.tools ?? []).filter((t) => t.strict).map((t) => t.name),
    messages: body.messages?.length ?? 0,
    maxTokens: body.max_tokens,
    effort: body.output_config?.effort ?? null,
    thinking: body.thinking ?? null,
    cacheControl: body.cache_control ?? null,
    systemMarkers: markers,
    fallbacks: body.fallbacks ?? null,
    betas: headers["anthropic-beta"] ?? null,
    stream: body.stream === true,
  };
}

async function control(req, res) {
  const path = req.url.split("?")[0];
  if (path === "/__mock/faults") {
    if (req.method === "POST") {
      queueFaults((await readBody(req)).faults);
      return json(res, 200, { queued: listFaults() });
    }
    if (req.method === "DELETE") clearFaults();
    return json(res, 200, { queued: listFaults() });
  }
  if (path === "/__mock/requests") {
    if (req.method === "DELETE") requests.length = 0;
    return json(res, 200, { requests });
  }
  if (path === "/__mock/reset" && req.method === "POST") {
    clearFaults();
    resetCache();
    requests.length = 0;
    return json(res, 200, { ok: true });
  }
  return json(res, 404, { error: "Unknown mock control endpoint" });
}

async function messages(req, res) {
  const body = await readBody(req);
  const summary = summarize(body, req.headers);
  requests.push(summary);
  if (requests.length > 200) requests.shift();

  const problem = validateRequest(body);
  if (problem) {
    console.log(`[mock] 400 ${problem.message}`);
    summary.status = problem.status;
    return apiError(res, problem);
  }
  const fault = takeFault(body, req.headers);
  if (fault) {
    const failure = httpFault(fault, body, req.headers);
    if (failure) {
      console.log(`[mock] fault ${fault.type} → ${failure.status}`);
      summary.status = failure.status;
      summary.fault = fault.type;
      return apiError(res, failure);
    }
  }
  const plan = planTurn(body, fault && TURN_FAULTS.has(fault.type) ? fault : null);
  summary.status = 200;
  summary.fault = fault?.type ?? null;
  summary.stop = plan.stop;
  summary.usage = plan.usage.end;
  const acts = plan.blocks.filter((b) => b.type === "tool_use").map((b) => b.name);
  console.log(
    `[mock] ${summary.tools.join(",") || "no tools"} | turn ${summary.messages} | ${acts.join(",") || plan.stop} | in ${plan.usage.end.input_tokens} read ${plan.usage.end.cache_read_input_tokens} write ${plan.usage.end.cache_creation_input_tokens} out ${plan.usage.end.output_tokens}${fault ? ` | fault ${fault.type}` : ""} | betas: ${summary.betas ?? "-"}`,
  );
  if (body.stream) return streamMessage(res, plan, { delay: DELAY });
  json(res, 200, jsonMessage(plan), { "request-id": plan.requestId });
}

async function handle(req, res) {
  if (req.url.startsWith("/v2/")) return firecrawl(req, res, DELAY);
  if (req.url.startsWith("/__mock/")) return control(req, res);
  if (req.method === "POST" && req.url.startsWith("/v1/messages/count_tokens")) {
    const body = await readBody(req);
    return json(res, 200, { input_tokens: promptUsage({ ...body, cache_control: undefined }).promptTokens });
  }
  if (req.method === "POST" && req.url.startsWith("/v1/messages")) return messages(req, res);
  if (req.method === "GET" && req.url.split("?")[0] === "/v1/models") return listModels(req, res);
  if (req.method === "POST" && req.url.startsWith("/v1/chat/completions")) return chatCompletions(req, res, { delay: DELAY, requests });
  res.writeHead(404).end();
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error("[mock] request failed:", err?.message ?? err);
    if (!res.headersSent) apiError(res, { status: 400, type: "invalid_request_error", message: String(err?.message ?? err) });
    else res.end();
  });
});

process.on("uncaughtException", (err) => console.error("[mock] uncaught:", err));
process.on("unhandledRejection", (err) => console.error("[mock] unhandled:", err));

server.listen(PORT, () => console.log(`[mock] Anthropic mock listening on http://localhost:${PORT}`));
