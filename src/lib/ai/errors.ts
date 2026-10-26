import type { Usage } from "./models";

/**
 * Optional request features the engine can leave out and still work: the betas (server-side refusal
 * fallbacks and thinking-binding controls) and strict tool schemas (zod still validates every input).
 */
/**
 * Optional request features compat mode can leave out, each on its own: the refusal fallback (its beta and
 * `fallbacks`), the thinking-block binding (its beta and `thinking.block_binding`), and strict tool schemas.
 */
export type CompatFeature = "fallback" | "binding" | "strict";

export type AgentErrorCode =
  | "no_key"
  | "auth"
  | "no_credit"
  | "model_unavailable"
  | "rate_limit"
  | "refusal"
  | "overloaded"
  | "bad_request"
  | "too_large"
  | "context_too_long"
  | "network"
  | "truncated"
  | "no_submit"
  | "stopped"
  | "unknown";

export class AgentError extends Error {
  /** Spend from turns that completed before the failure (set by runAgent). */
  usage?: Usage;
  costUsd?: number;
  /** The run had left out optional features the API rejected (set by runAgent). */
  compat?: { features: CompatFeature[]; reason: string };
  /** The API's request id, for "Copy details" when asking the provider's support about a failure. */
  requestId?: string;
  /** What the API said, verbatim (status · type · message). Never the message the founder reads. */
  detail?: string;

  constructor(
    message: string,
    public readonly code: AgentErrorCode,
    extra: { requestId?: string; detail?: string } = {},
  ) {
    super(message);
    this.name = "AgentError";
    this.requestId = extra.requestId;
    this.detail = extra.detail;
  }
}
