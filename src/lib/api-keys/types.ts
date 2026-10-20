import type { ID, ISODateTime } from "@/lib/domain/types";

/**
 * Agent keys: how other agents (Meta Muse, Claude, Cursor, n8n, AI SDRs) reach Inroad over MCP or
 * REST. Shared by server and client; plain data only. The token itself is shown once and stored
 * only as a SHA-256 hash in `.data/keys.json`.
 */

export type Scope = "read" | "write_records" | "submit_drafts";

export type AccessLevel = "read" | "records" | "drafts";

export const ACCESS: { id: AccessLevel; label: string; blurb: string; scopes: Scope[] }[] = [
  { id: "read", label: "Read only", blurb: "Your ICP, playbook, scoring and search.", scopes: ["read"] },
  { id: "records", label: "Add leads and activity", blurb: "Also add companies and people, log activity and close out moves.", scopes: ["read", "write_records"] },
  { id: "drafts", label: "Submit drafts", blurb: "Also put drafts in your approval queue. Nothing is ever sent.", scopes: ["read", "write_records", "submit_drafts"] },
];

export function accessOf(scopes: Scope[]): AccessLevel {
  if (scopes.includes("submit_drafts")) return "drafts";
  if (scopes.includes("write_records")) return "records";
  return "read";
}

export type AgentClient = "muse" | "claude_code" | "claude_desktop" | "cursor" | "chatgpt" | "n8n" | "zapier" | "other";

export const CLIENTS: { id: AgentClient; name: string; domain?: string; access: AccessLevel; snippet: SnippetId }[] = [
  { id: "muse", name: "Meta Muse", domain: "meta.ai", access: "drafts", snippet: "muse" },
  { id: "claude_code", name: "Claude Code", domain: "claude.ai", access: "drafts", snippet: "claude_code" },
  { id: "claude_desktop", name: "Claude Desktop", domain: "claude.ai", access: "drafts", snippet: "claude_desktop" },
  { id: "cursor", name: "Cursor", domain: "cursor.com", access: "records", snippet: "cursor" },
  { id: "chatgpt", name: "ChatGPT", domain: "chatgpt.com", access: "read", snippet: "rest" },
  { id: "n8n", name: "n8n", domain: "n8n.io", access: "records", snippet: "rest" },
  { id: "zapier", name: "Zapier or Make", domain: "zapier.com", access: "records", snippet: "rest" },
  { id: "other", name: "Another agent", access: "records", snippet: "rest" },
];

export type SnippetId = "claude_code" | "cursor" | "claude_desktop" | "muse" | "rest";

export function clientMeta(id: AgentClient) {
  return CLIENTS.find((c) => c.id === id) ?? CLIENTS[CLIENTS.length - 1];
}

/** A key as the browser sees it. Never the token or its hash. */
export interface ApiKeyPublic {
  id: ID;
  name: string;
  client: AgentClient;
  scopes: Scope[];
  /** "inr_4kQ2…x9Fz" */
  preview: string;
  createdAt: ISODateTime;
  lastUsedAt?: ISODateTime;
  revokedAt?: ISODateTime;
  calls: number;
  /** From the MCP initialize handshake: "claude-code 2.1.4". */
  lastClient?: string;
}

/** One logged call, shown in the key's activity feed ("Muse added 40 accounts"). */
export interface AgentCall {
  id: ID;
  keyId: ID;
  at: ISODateTime;
  tool: string;
  via: "mcp" | "rest";
  ok: boolean;
  /** Built in code: "Added 40 companies (12 new, 28 already known)". */
  summary: string;
  ms?: number;
}

/** GET /api/mcp/keys */
export interface KeysResponse {
  keys: ApiKeyPublic[];
  calls: AgentCall[];
}

/** POST /api/mcp/keys */
export interface CreateKeyResponse {
  key: ApiKeyPublic;
  /** Shown once. */
  token: string;
}

/** "Muse couldn't add accounts: …" */
export const TOOL_VERBS: Record<string, string> = {
  get_icp: "read the ICP",
  get_playbook: "read the playbook",
  score_accounts: "score accounts",
  search_records: "search records",
  get_next_actions: "read next actions",
  add_accounts: "add accounts",
  log_activity: "log activity",
  submit_draft: "submit a draft",
  complete_action: "complete an action",
  get_account: "read an account",
};
