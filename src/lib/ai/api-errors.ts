import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { AgentError, type AgentErrorCode, type CompatFeature } from "./errors";
import { MODEL_LABELS, type ModelTier } from "./models";

/**
 * What the API said when it said no, turned into plain words. The SDK's own message is the status plus
 * the raw JSON body ("400 {"type":"error",…}"), which must never reach the founder.
 */

/** The error type and message from the API's JSON body (`{"type":"error","error":{…},"request_id":…}`). */
export function apiErrorParts(err: InstanceType<typeof Anthropic.APIError>): { type: string | null; message: string; requestId?: string } {
  const body = (err.error ?? {}) as { error?: { type?: string; message?: string }; request_id?: string };
  return {
    type: err.type ?? body.error?.type ?? null,
    message: typeof body.error?.message === "string" ? body.error.message : "",
    requestId: err.requestID ?? body.request_id ?? undefined,
  };
}

/** API failures in plain words; what the API said is kept as `detail` (with the request id) for "Copy details". */
export function toAgentError(err: InstanceType<typeof Anthropic.APIError>, tier: ModelTier = "operator"): AgentError {
  const { type, message, requestId } = apiErrorParts(err);
  const extra = { requestId, detail: [err.status, type, message].filter(Boolean).join(" · ") || undefined };
  const fail = (text: string, code: AgentErrorCode) => new AgentError(text, code, extra);

  if (/credit balance|purchase credits|plans & billing/i.test(message)) {
    return fail("Your Anthropic account is out of credits. Add credits in the Anthropic Console under Billing, then try again.", "no_credit");
  }
  if (/organization (has been |is )?disabled|disabled organization/i.test(message)) {
    return fail("Anthropic has disabled the organization this API key belongs to. Check the Anthropic Console, or use a key from another organization.", "auth");
  }
  if (err instanceof Anthropic.AuthenticationError || type === "authentication_error") {
    return fail("Your Anthropic API key was rejected. Update it in Settings.", "auth");
  }
  if (err instanceof Anthropic.PermissionDeniedError || type === "permission_error") {
    return fail("Your Anthropic API key isn't allowed to do this. Check its permissions in the Anthropic Console, or use another key.", "auth");
  }
  if (err instanceof Anthropic.NotFoundError || type === "not_found_error") {
    return fail(`Your Anthropic account can't use ${MODEL_LABELS[tier]}, which this step needs. Check which models your account can use in the Anthropic Console.`, "model_unavailable");
  }
  if (err.status === 413 || type === "request_too_large") {
    return fail("That was too much to send in one request. Try a smaller file or a shorter paste.", "too_large");
  }
  if (/prompt is too long|too many tokens|context (window|length)/i.test(message)) {
    return fail("There was too much text for one request. Try a narrower request, or start a new Ask thread.", "context_too_long");
  }
  if (err instanceof Anthropic.RateLimitError || type === "rate_limit_error") {
    return fail("Rate limited by the Anthropic API. Wait a minute and try again.", "rate_limit");
  }
  if (err instanceof Anthropic.InternalServerError || err.status === 529 || type === "overloaded_error" || type === "api_error") {
    return fail("Claude is overloaded right now. Try again in a moment.", "overloaded");
  }
  if (err instanceof Anthropic.BadRequestError || type === "invalid_request_error") {
    return fail("The Anthropic API turned this request down. Try again; if it keeps happening, Copy details shows what it said.", "bad_request");
  }
  return fail(`Something went wrong talking to Claude${err.status ? ` (error ${err.status})` : ""}. Try again in a moment.`, "unknown");
}

export type { CompatFeature };

const POINTS_AT: Record<CompatFeature, RegExp> = {
  fallback: /server-side-fallback|\bfallbacks?\b/i,
  binding: /thinking-binding|block_binding|prefix_mismatch|thinking\.binding/i,
  strict: /\bstrict\b|input_schema|additionalProperties|eager_input_streaming/i,
};

/**
 * Which optional features a 400 points at, so compat mode retries only what dropping a feature can fix:
 * a rejected fallback beta leaves the thinking binding on, and the other way round. A beta header the
 * message doesn't name drops both. Billing, size and every other rejection return [] and fail as they are.
 */
export function droppableFeatures(err: InstanceType<typeof Anthropic.APIError>): CompatFeature[] {
  if (!(err instanceof Anthropic.BadRequestError)) return [];
  const { message } = apiErrorParts(err);
  if (/credit balance|organization|prompt is too long|too many tokens/i.test(message)) return [];
  const named = (Object.keys(POINTS_AT) as CompatFeature[]).filter((f) => POINTS_AT[f].test(message));
  if (!named.includes("fallback") && !named.includes("binding") && /anthropic-beta|\bbetas?\b/i.test(message)) return [...named, "fallback", "binding"];
  return named;
}
