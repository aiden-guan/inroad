import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { toAgentError } from "./api-errors";

/**
 * Real SDK error objects, built the way the SDK builds them from an HTTP response, mapped to what the
 * founder reads. The SDK's own message is "400 {json}"; none of that may leak into the sentence.
 */

function apiError(status: number | undefined, type: string, message: string) {
  const body = { type: "error", error: { type, message }, request_id: "req_011CTest" };
  const headers = new Headers({ "request-id": "req_011CTest" });
  return status === undefined ? new Anthropic.APIError(undefined, body, undefined, headers, type as Anthropic.ErrorType) : Anthropic.APIError.generate(status, body, undefined, headers);
}

const cases: [string, number | undefined, string, string, string, RegExp][] = [
  ["out of credits", 400, "invalid_request_error", "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.", "no_credit", /out of credits\. Add credits in the Anthropic Console/],
  ["a disabled organization", 400, "invalid_request_error", "This organization has been disabled.", "auth", /disabled the organization/],
  ["a rejected key", 401, "authentication_error", "invalid x-api-key", "auth", /API key was rejected\. Update it in Settings/],
  ["a key without permission", 403, "permission_error", "Your API key does not have permission to use the specified resource.", "auth", /isn't allowed to do this/],
  ["a model the account can't use", 404, "not_found_error", "model: claude-sonnet-5-5", "model_unavailable", /can't use Sonnet 5\.5, which this step needs/],
  ["a request too large", 413, "request_too_large", "Request exceeds the maximum allowed number of bytes.", "too_large", /too much to send in one request/],
  ["a prompt too long", 400, "invalid_request_error", "prompt is too long: 1048576 tokens > 1000000 maximum", "context_too_long", /too much text for one request/],
  ["a rate limit", 429, "rate_limit_error", "Number of request tokens has exceeded your per-minute rate limit.", "rate_limit", /Rate limited by the Anthropic API/],
  ["an overload", 529, "overloaded_error", "Overloaded", "overloaded", /overloaded right now/],
  ["a server error", 500, "api_error", "Internal server error", "overloaded", /overloaded right now/],
  ["an overload mid-stream", undefined, "overloaded_error", "Overloaded", "overloaded", /overloaded right now/],
  ["any other rejection", 400, "invalid_request_error", "messages.1.content.0: unexpected tool_use_id", "bad_request", /turned this request down/],
  ["an unexpected status", 409, "conflict_error", "Conflict", "unknown", /Something went wrong talking to Claude \(error 409\)/],
];

describe("toAgentError", () => {
  it.each(cases)("says %s in plain words", (_what, status, type, message, code, copy) => {
    const err = toAgentError(apiError(status, type, message), "operator");
    expect(err.code).toBe(code);
    expect(err.message).toMatch(copy);
    // Never the SDK's "400 {json}" message, never the raw body.
    expect(err.message).not.toMatch(/[{}]|"type"|request_id|^\d{3}\s/);
    // What the API said, and its request id, stay available for "Copy details".
    expect(err.requestId).toBe("req_011CTest");
    expect(err.detail).toContain(message);
  });

  it("names the model the failing step needed", () => {
    expect(toAgentError(apiError(404, "not_found_error", "model: x"), "strategist").message).toContain("Opus 5.5");
    expect(toAgentError(apiError(404, "not_found_error", "model: x"), "fast").message).toContain("Haiku 5.5");
  });
});
