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
  | { type: "usage"; costUsd: number; model: "strategist" | "operator" | "fast" }
  | { type: "result"; data: unknown }
  | { type: "error"; message: string; code?: string }
  | { type: "done" };
