import type { Usage } from "./models";

export type AgentErrorCode =
  | "no_key"
  | "auth"
  | "rate_limit"
  | "refusal"
  | "overloaded"
  | "bad_request"
  | "network"
  | "truncated"
  | "stopped"
  | "unknown";

export class AgentError extends Error {
  /** Spend from turns that completed before the failure (set by runAgent). */
  usage?: Usage;
  costUsd?: number;

  constructor(
    message: string,
    public readonly code: AgentErrorCode,
  ) {
    super(message);
    this.name = "AgentError";
  }
}
