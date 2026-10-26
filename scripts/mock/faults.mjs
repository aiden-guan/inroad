/**
 * Failures the real API produces, on demand, so error paths can be clicked through and tested offline.
 *
 * Queue them with POST /__mock/faults {"faults":[{"type":"credit"},{"type":"overloaded","times":2}]} (each
 * applies to the next matching request; "when" narrows it: {"tool":"submit_dossier","model":"…"}), or set
 * MOCK_FAULT=credit when starting the mock to make every request fail that way. GET /__mock/faults lists
 * the queue; DELETE clears it.
 */

const err = (status, type, message, headers = {}) => ({ kind: "http", status, type, message, headers });

/** HTTP errors: the status, error type and message the API sends for each case. */
export const HTTP_FAULTS = {
  credit: () =>
    err(400, "invalid_request_error", "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."),
  org_disabled: () => err(400, "invalid_request_error", "This organization has been disabled."),
  context_too_long: () => err(400, "invalid_request_error", "prompt is too long: 1048576 tokens > 1000000 maximum"),
  bad_request: () => err(400, "invalid_request_error", "messages.1.content.0.tool_use_id: unexpected tool_use_id found in tool_result blocks"),
  reject_betas: (body, headers) =>
    err(400, "invalid_request_error", `Unexpected value(s) \`${String(headers["anthropic-beta"] ?? "").split(",")[0]}\` for the \`anthropic-beta\` header. Please consult our documentation at docs.anthropic.com or try again without the header.`),
  reject_strict: () => err(400, "invalid_request_error", "tools.0.custom.strict: strict mode is not available for this tool schema"),
  // A model or route without mid-conversation system messages.
  system_role: (body) => err(400, "invalid_request_error", `messages.${(body.messages ?? []).findIndex((m) => m.role === "system")}: role 'system' is not supported on this model`),
  auth: () => err(401, "authentication_error", "invalid x-api-key"),
  permission: () => err(403, "permission_error", "Your API key does not have permission to use the specified resource."),
  model_unavailable: (body) => err(404, "not_found_error", `model: ${body.model}`),
  too_large: () => err(413, "request_too_large", "Request exceeds the maximum allowed number of bytes."),
  // retry-after-ms keeps the SDK's automatic retries fast in tests; the real API sends retry-after in seconds.
  rate_limit: () => err(429, "rate_limit_error", "Number of request tokens has exceeded your per-minute rate limit. Please try again later.", { "retry-after-ms": "5" }),
  overloaded: () => err(529, "overloaded_error", "Overloaded", { "retry-after-ms": "5" }),
  server_error: () => err(500, "api_error", "Internal server error", { "retry-after-ms": "5" }),
};

/** Faults that answer 200 and shape the turn instead. */
export const TURN_FAULTS = new Set([
  "overloaded_midstream", // an SSE error event after the message started
  "refusal", // stop_reason refusal with stop_details, no fallback
  "refusal_fallback", // the requested model declines and a fallback model serves the turn (fallback block, usage.iterations)
  "pause_turn", // the server-tool loop pauses after a search; the next request resumes it
  "max_tokens", // the turn runs out of output tokens before anything usable
  "no_submit", // replies in plain text instead of calling the submit tool
  "invalid_submit", // calls the submit tool with input that breaks its size caps
]);

const queue = [];
const sticky = process.env.MOCK_FAULT ? process.env.MOCK_FAULT.split(",").map((type) => ({ type: type.trim(), times: Infinity })) : [];

export function queueFaults(list) {
  for (const f of list ?? []) {
    if (!f || typeof f.type !== "string" || !(f.type in HTTP_FAULTS || TURN_FAULTS.has(f.type))) throw new Error(`Unknown fault: ${JSON.stringify(f)}`);
    queue.push({ type: f.type, times: f.times ?? 1, when: f.when ?? {}, model: f.model });
  }
}

export function clearFaults() {
  queue.length = 0;
}

export function listFaults() {
  return [...queue];
}

function matches(f, body, headers, toolNames) {
  if (f.when?.model && f.when.model !== body.model) return false;
  if (f.when?.tool && !toolNames.includes(f.when.tool)) return false;
  // These two reject a feature, so a request without it (the retry) goes through.
  if (f.type === "reject_betas" && !headers["anthropic-beta"]) return false;
  if (f.type === "reject_strict" && !(body.tools ?? []).some((t) => t.strict)) return false;
  if (f.type === "system_role" && !(body.messages ?? []).some((m) => m.role === "system")) return false;
  return true;
}

/** The fault for this request, if any (consumes one use of a queued fault). */
export function takeFault(body, headers = {}) {
  const toolNames = (body.tools ?? []).map((t) => t.name);
  const matching = (f) => matches(f, body, headers, toolNames);
  const i = queue.findIndex(matching);
  if (i >= 0) {
    const f = queue[i];
    if (--f.times <= 0) queue.splice(i, 1);
    return f;
  }
  return sticky.find(matching) ?? null;
}

export function httpFault(f, body, headers) {
  return HTTP_FAULTS[f.type]?.(body, headers) ?? null;
}
