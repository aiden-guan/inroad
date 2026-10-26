/** Events streamed from an agent run to the browser. Shared by server and client. */

export interface Source {
  title: string;
  url: string;
  host: string;
}

export type AgentEvent =
  | { type: "status"; text: string }
  | { type: "thinking"; text: string }
  | { type: "search"; query: string }
  | { type: "read"; url: string; host: string }
  | { type: "sources"; sources: Source[] }
  | { type: "action"; text: string }
  | { type: "writing"; chars: number }
  | { type: "text"; text: string }
  /** Replaces the streamed text so far: text before a tool call was working notes, or a failed attempt was re-issued. */
  | { type: "text_reset"; text: string }
  | { type: "usage"; costUsd: number; model: "strategist" | "operator" | "fast" }
  | { type: "result"; data: unknown }
  /** requestId and detail (what the API said) back "Copy details"; message is always plain words. */
  | { type: "error"; message: string; code?: string; requestId?: string; detail?: string }
  | { type: "done" };
