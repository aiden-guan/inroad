import "server-only";
import { appOrigin, authorize } from "./auth";
import { noteClient, type ApiKey } from "./store";
import { callTool, getTool, inputSchema, toolsFor } from "./tools";

/**
 * MCP over Streamable HTTP, stateless and by hand: JSON-RPC 2.0 over POST, answered with
 * application/json (no SSE, no sessions). Every request is authenticated on its own, which suits
 * route handlers and the stateless 2026-07-28 revision while still serving clients that open with
 * an initialize handshake (2025-03-26, 2025-06-18, 2025-11-25).
 */

export const SUPPORTED_VERSIONS = ["2026-07-28", "2025-11-25", "2025-06-18", "2025-03-26"] as const;
const LATEST = SUPPORTED_VERSIONS[0];
const MAX_BYTES = 1_000_000;

const SERVER_INFO = { name: "inroad", title: "Inroad", version: "1.0.0" };

const INSTRUCTIONS = `Inroad is the founder's go-to-market hub: their ICP, playbook, accounts, people, deals and next moves.
- Read get_icp and get_playbook before prospecting or writing. Use only approved_claims for statements about the founder's company.
- Use score_accounts before spending enrichment credits, and search_records to dedupe and check do-not-contact before any outreach.
- Read get_account before writing to someone at a company.
- Save leads with add_accounts and log what happened with log_activity.
- Anything written in the founder's name goes through submit_draft. Inroad never sends; the founder approves.
- Respect the caps in get_playbook: fewer, better conversations.`;

type Id = string | number | null;
interface RpcMessage {
  jsonrpc?: string;
  id?: Id;
  method?: string;
  params?: Record<string, unknown>;
}

const rpcError = (id: Id, code: number, message: string) => ({ jsonrpc: "2.0" as const, id, error: { code, message } });
const rpcResult = (id: Id, result: unknown) => ({ jsonrpc: "2.0" as const, id, result });

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });
}

/** Browsers may only call from our own origin (DNS-rebinding protection, per the transport spec). */
function originAllowed(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin || origin === "null") return true;
  try {
    return new URL(origin).host === (request.headers.get("host") ?? new URL(request.url).host);
  } catch {
    return false;
  }
}

function negotiate(requested: unknown): string {
  return typeof requested === "string" && (SUPPORTED_VERSIONS as readonly string[]).includes(requested) ? requested : LATEST;
}

function listTools(key: ApiKey) {
  return toolsFor(key.scopes).map((t) => ({
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: inputSchema(t),
    annotations: { title: t.title, readOnlyHint: t.readOnly, destructiveHint: false, idempotentHint: t.idempotent, openWorldHint: false },
  }));
}

async function handle(msg: RpcMessage, key: ApiKey, base: string): Promise<object | null> {
  const id: Id = msg.id ?? null;
  const isNotification = msg.id === undefined;
  if (msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    // A response from the client (to a request we never send) or garbage.
    return isNotification ? null : rpcError(id, -32600, "Invalid request");
  }
  if (isNotification) return null; // notifications/initialized, notifications/cancelled…

  const params = msg.params ?? {};
  switch (msg.method) {
    case "initialize": {
      const info = params.clientInfo as { name?: unknown; version?: unknown } | undefined;
      if (info && typeof info.name === "string") void noteClient(key.id, `${info.name}${typeof info.version === "string" ? ` ${info.version}` : ""}`);
      return rpcResult(id, {
        protocolVersion: negotiate(params.protocolVersion),
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      return rpcResult(id, { tools: listTools(key) });
    case "tools/call": {
      const name = typeof params.name === "string" ? params.name : "";
      if (!getTool(name)) return rpcError(id, -32602, `Unknown tool: ${name || "(none)"}`);
      const r = await callTool(name, params.arguments ?? {}, { key, via: "mcp", base });
      // Tool failures go back as results so the calling model can read them and correct itself.
      if (!r.ok) return rpcResult(id, { content: [{ type: "text", text: r.message }], isError: true });
      return rpcResult(id, { content: [{ type: "text", text: JSON.stringify(r.data) }], structuredContent: r.data, isError: false });
    }
    case "resources/list":
      return rpcResult(id, { resources: [] });
    case "prompts/list":
      return rpcResult(id, { prompts: [] });
    default:
      return rpcError(id, -32601, `Method not found: ${msg.method}`);
  }
}

export async function handleMcpPost(request: Request): Promise<Response> {
  if (!originAllowed(request)) return json(rpcError(null, -32000, "Origin not allowed."), 403);
  const version = request.headers.get("mcp-protocol-version");
  if (version && !(SUPPORTED_VERSIONS as readonly string[]).includes(version)) {
    return json(rpcError(null, -32000, `Unsupported MCP-Protocol-Version ${version}. Supported: ${SUPPORTED_VERSIONS.join(", ")}.`), 400);
  }

  const auth = authorize(request);
  if (!auth.ok) {
    return json(rpcError(null, auth.status === 429 ? -32000 : -32001, auth.message), auth.status, {
      ...(auth.status === 401 ? { "www-authenticate": 'Bearer realm="inroad", error="invalid_token"' } : {}),
      ...(auth.retryAfter ? { "retry-after": String(auth.retryAfter) } : {}),
    });
  }

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES) return json(rpcError(null, -32600, "Request too large (1 MB max)."), 413);
  const raw = await request.text();
  if (raw.length > MAX_BYTES) return json(rpcError(null, -32600, "Request too large (1 MB max)."), 413);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json(rpcError(null, -32700, "Parse error: send one JSON-RPC 2.0 message."), 400);
  }

  const base = appOrigin(request);
  if (Array.isArray(body)) {
    if (!body.length) return json(rpcError(null, -32600, "Empty batch."), 400);
    const out = (await Promise.all(body.slice(0, 20).map((m) => handle((m ?? {}) as RpcMessage, auth.key, base)))).filter(Boolean);
    return out.length ? json(out) : new Response(null, { status: 202 });
  }
  const out = await handle((body ?? {}) as RpcMessage, auth.key, base);
  return out ? json(out) : new Response(null, { status: 202 });
}

/** GET opens a server-to-client SSE stream in the spec; a stateless server doesn't offer one. */
export function mcpMethodNotAllowed(): Response {
  return json(
    { error: "This MCP server is stateless: POST JSON-RPC messages to this URL with Authorization: Bearer <agent key>. There is no event stream to GET." },
    405,
    { allow: "POST, OPTIONS" },
  );
}
