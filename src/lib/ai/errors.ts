import type { Usage } from "./models";

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

/** Where a founder adds credits when the API says the balance is too low. */
export const BILLING_URL = "https://console.anthropic.com/settings/billing";

export class AgentError extends Error {
  /** Spend from turns that completed before the failure (set by runAgent). */
  usage?: Usage;
  costUsd?: number;
  /** The API's request id, for "Copy details" when asking Anthropic support about a failure. */
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
