/**
 * The request checks the real Messages API applies that Inroad's requests could trip, answered with the
 * same status and error shape. Anything the mock can't judge it lets through.
 */
import { breakpoints, messageBlocks, segments } from "./usage.mjs";

/** Size keywords strict tool schemas don't accept (the engine moves them into descriptions). */
const STRICT_UNSUPPORTED = ["minLength", "maxLength", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minItems", "maxItems", "pattern", "uniqueItems"];

function findKeyword(node, path = "input_schema") {
  if (!node || typeof node !== "object") return null;
  for (const [k, v] of Object.entries(node)) {
    if (STRICT_UNSUPPORTED.includes(k)) return `${path}.${k}`;
    const deeper = findKeyword(v, `${path}.${k}`);
    if (deeper) return deeper;
  }
  return null;
}

const invalid = (message) => ({ status: 400, type: "invalid_request_error", message });

/** Returns null when the request is fine, or the error the API would answer with. */
export function validateRequest(body) {
  if (!Array.isArray(body.messages) || !body.messages.length) return invalid("messages: at least one message is required");
  if (body.messages[0].role !== "user") return invalid("messages: first message must use the \"user\" role");
  if (typeof body.max_tokens !== "number" || body.max_tokens < 1) return invalid("max_tokens: field required");
  if (body.max_tokens > 128_000) return invalid(`max_tokens: ${body.max_tokens} > 128000, which is the maximum allowed number of output tokens for ${body.model}`);
  const model = String(body.model ?? "");
  const t = body.thinking;
  if (t && t.type === "enabled") return invalid("thinking.type.enabled: budget_tokens is not supported on this model. Use thinking.type.adaptive instead.");
  if (t && t.type === "disabled" && /opus|sonnet/.test(model)) return invalid("thinking.type.disabled: thinking cannot be disabled on this model. Lower output_config.effort instead.");
  if (body.tool_choice && (body.tool_choice.type === "any" || body.tool_choice.type === "tool")) {
    return invalid(`tool_choice: type "tool" and "any" are not supported for this model.`);
  }
  if (Array.isArray(body.fallbacks) && /haiku/.test(model)) return invalid("fallbacks: this model has no server-side fallback models.");

  for (const [i, tool] of (body.tools ?? []).entries()) {
    if (tool.strict) {
      const bad = findKeyword(tool.input_schema);
      if (bad) return invalid(`tools.${i}.custom.${bad}: strict mode does not support this keyword`);
    }
  }

  // Prompt caching: at most 4 breakpoints, and longer TTLs must come first.
  const segs = segments(body);
  const points = breakpoints(body, segs);
  const explicit = points.filter((p) => !p.auto);
  if (points.length > 4) return invalid(`A maximum of 4 blocks with cache_control may be provided. Found ${points.length}.`);
  if (body.cache_control && segs.length) {
    const last = explicit.find((p) => p.index === segs.length - 1);
    if (last && last.ttl !== (body.cache_control.ttl ?? "5m")) {
      return invalid("cache_control: the top-level cache_control ttl must match the ttl of a cache_control on the last block.");
    }
  }
  let seenShort = false;
  for (const p of [...points].sort((a, b) => a.index - b.index)) {
    if (p.ttl === "5m") seenShort = true;
    else if (seenShort) return invalid("cache_control: a ttl='1h' cache_control block must not come after a ttl='5m' cache_control block.");
  }

  for (const [i, m] of body.messages.entries()) {
    const blocks = messageBlocks(m);
    if (m.role !== "system" && !blocks.length) return invalid(`messages.${i}: all messages must have non-empty content except for the optional final assistant message`);
    for (const b of blocks) {
      if (b.type === "text" && !b.text) return invalid(`messages.${i}: text content blocks must be non-empty`);
    }
  }
  return null;
}
