import "server-only";
import { automationTask } from "./tasks";
import { z } from "zod";
import { cleanSearchEndpoint } from "@/lib/search/providers";
import { getSecret, setSecrets } from "@/lib/store/workspace";
import { redact } from "@/lib/connectors/http";
import { Binding, type Capability, type ExternalTool, type ToolConnection } from "./types";
import { checkInput, mapRows } from "./mapping";
import { readAutomation, recordOperation, updateAutomation } from "./store";

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
export const ConnectionInput = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(100),
  kind: z.enum(["mcp", "openapi"]),
  endpoint: z.string().max(2000),
  key: z.string().max(1000).optional(),
  authHeader: z
    .string()
    .regex(/^[A-Za-z][A-Za-z0-9-]{0,79}$/)
    .default("Authorization"),
  authScheme: z.enum(["bearer", "raw"]).default("bearer"),
  spec: z.record(z.string(), z.unknown()).optional(),
  bindings: z.array(Binding).max(8).default([]),
  enabled: z.boolean().default(true),
});
export type ConnectionInput = z.infer<typeof ConnectionInput>;
const secretId = (id: string) => `tool_${id}`;

async function readBody(response: Response, wanted?: unknown): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let body = "";
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      body += decoder.decode(next.value, { stream: true });
      if (body.length > 2_000_000) throw new Error("The tool response exceeds 2 MB. Ask for fewer records.");
      if (wanted !== undefined && response.headers.get("content-type")?.includes("text/event-stream")) {
        const frames = body.replace(/\r\n/g, "\n").split("\n\n").slice(0, -1);
        const matched = frames.some((frame) => {
          const payload = frame
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trimStart())
            .join("\n");
          try {
            return obj(JSON.parse(payload)).id === wanted;
          } catch {
            return false;
          }
        });
        if (matched) return body;
      }
    }
    return body + decoder.decode();
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

/** Configured endpoints are chosen by the local user; never follow a redirect with their key. */
async function send(
  connection: ToolConnection,
  key: string,
  init: RequestInit,
  session?: string,
  signal?: AbortSignal,
  protocol = "2025-11-25",
): Promise<{ value: unknown; session?: string }> {
  const response = await fetch(connection.endpoint, {
    ...init,
    redirect: "manual",
    cache: "no-store",
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
    headers: {
      Accept: "application/json, text/event-stream",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(key ? { [connection.authHeader]: connection.authScheme === "bearer" ? `Bearer ${key}` : key } : {}),
      ...(connection.kind === "mcp" ? { "MCP-Protocol-Version": protocol } : {}),
      ...(session ? { "Mcp-Session-Id": session } : {}),
      ...init.headers,
    },
  });
  if (!response.ok)
    throw new Error(
      `The tool returned HTTP ${response.status}. ${response.status === 401 ? "Check its key." : response.status === 429 ? "Wait for its rate limit to reset." : "Check its address and API access."}`,
    );
  const wanted = init.body ? obj(JSON.parse(String(init.body))).id : undefined;
  const raw = await readBody(response, wanted);
  if (!raw.trim()) return { value: null, session: response.headers.get("mcp-session-id") ?? session };
  let value: unknown;
  if (response.headers.get("content-type")?.includes("text/event-stream")) {
    const packets = raw
      .replace(/\r\n/g, "\n")
      .split("\n\n")
      .flatMap((frame) => {
        const data = frame
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trimStart())
          .join("\n");
        if (!data) return [];
        try {
          return [JSON.parse(data)];
        } catch {
          return [];
        }
      });
    value = packets.find((packet) => obj(packet).id === wanted);
    if (!value) throw new Error("The MCP stream ended without a matching response.");
  } else {
    try {
      value = JSON.parse(raw);
    } catch {
      throw new Error("The tool did not return JSON.");
    }
  }
  return { value, session: response.headers.get("mcp-session-id") ?? session };
}

async function mcpSession(connection: ToolConnection, key: string, signal?: AbortSignal) {
  let protocol = "2025-11-25";
  const rpc = async (method: string, params: unknown, session?: string) => {
    const id = crypto.randomUUID();
    const result = await send(connection, key, { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id, method, params }) }, session, signal, protocol);
    const response = obj(result.value);
    if (response.id !== id || response.jsonrpc !== "2.0") throw new Error("The MCP server returned an invalid response.");
    if (response.error) throw new Error("The MCP server rejected the request. Check the tool configuration and permissions.");
    return { value: obj(response.result), session: result.session };
  };
  const initialized = await rpc("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "inroad", version: "0.2.0" } });
  const version = initialized.value.protocolVersion;
  if (!["2025-11-25", "2025-06-18", "2025-03-26"].includes(String(version))) throw new Error("This MCP server uses an unsupported protocol version.");
  protocol = String(version);
  await send(
    connection,
    key,
    { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) },
    initialized.session,
    signal,
    protocol,
  );
  return {
    rpc: (method: string, params: unknown) => rpc(method, params, initialized.session),
    close: () =>
      initialized.session
        ? send(connection, key, { method: "DELETE" }, initialized.session, AbortSignal.timeout(5000), protocol).catch(() => undefined)
        : Promise.resolve(undefined),
  };
}

function resolveSchema(raw: unknown, document: Record<string, unknown>, depth = 0): Record<string, unknown> {
  if (depth > 12) throw new Error("The API schema has recursive or deeply nested references.");
  const schema = obj(raw);
  if (typeof schema.$ref === "string") {
    if (!schema.$ref.startsWith("#/")) throw new Error("Only local OpenAPI references are supported.");
    let value: unknown = document;
    for (const key of schema.$ref.slice(2).split("/")) value = obj(value)[key.replace(/~1/g, "/").replace(/~0/g, "~")];
    if (!value) throw new Error("An API schema reference could not be resolved.");
    return resolveSchema(value, document, depth + 1);
  }
  return Object.fromEntries(
    Object.entries(schema).map(([key, value]) => [
      key,
      key === "properties"
        ? Object.fromEntries(Object.entries(obj(value)).map(([name, child]) => [name, resolveSchema(child, document, depth + 1)]))
        : key === "items"
          ? resolveSchema(value, document, depth + 1)
          : value,
    ]),
  );
}

export function openApiTools(spec: Record<string, unknown>): ExternalTool[] {
  if (!/^3\./.test(String(spec.openapi))) throw new Error("Import an OpenAPI 3 JSON document.");
  const tools: ExternalTool[] = [];
  for (const [path, raw] of Object.entries(obj(spec.paths))) {
    if (
      !path.startsWith("/") ||
      /[?#\\]/.test(path) ||
      decodeURIComponent(path)
        .split("/")
        .some((p) => p === ".." || p === ".")
    )
      throw new Error("The API contains an invalid operation path.");
    const item = obj(raw);
    const operation = obj(item.get);
    if (!Object.keys(operation).length) continue;
    const params = [...(Array.isArray(item.parameters) ? item.parameters : []), ...(Array.isArray(operation.parameters) ? operation.parameters : [])].map((p) =>
      resolveSchema(p, spec),
    );
    if (params.some((p) => !["query", "path"].includes(String(p.in)))) continue;
    const properties = Object.fromEntries(params.map((p) => [String(p.name), resolveSchema(p.schema, spec)]));
    tools.push({
      name: String(operation.operationId ?? `get_${path}`).slice(0, 200),
      description: String(operation.summary ?? operation.description ?? path).slice(0, 1000),
      readOnly: true,
      path,
      inputSchema: { type: "object", properties, required: params.filter((p) => p.required).map((p) => p.name), additionalProperties: false },
      parameters: params.map((p) => ({ name: String(p.name), in: p.in as "query" | "path", required: Boolean(p.required) })),
    });
  }
  if (!tools.length) throw new Error("No compatible GET operations were found. Writes and external references are not imported.");
  if (tools.length > 200) throw new Error("Import at most 200 read operations at a time.");
  if (new Set(tools.map((t) => t.name)).size !== tools.length) throw new Error("Give each API operation a unique operationId.");
  return tools;
}

export async function discoverConnection(input: ConnectionInput): Promise<ToolConnection> {
  const endpoint = cleanSearchEndpoint(input.endpoint);
  if (!endpoint) throw new Error("Use an HTTPS endpoint, or HTTP on localhost, without credentials or query parameters.");
  if (["host", "cookie", "connection", "content-length", "proxy-authorization"].includes(input.authHeader.toLowerCase()))
    throw new Error("Choose Authorization or the service's API-key header.");
  if (input.key && /[\r\n]/.test(input.key)) throw new Error("Paste the key on one line.");
  const previous = input.id ? readAutomation().connections.find((c) => c.id === input.id) : undefined;
  const connection: ToolConnection = {
    id: previous?.id ?? crypto.randomUUID(),
    name: input.name,
    kind: input.kind,
    endpoint,
    enabled: input.enabled,
    authHeader: input.authHeader,
    authScheme: input.authScheme,
    tools: [],
    bindings: input.bindings,
    createdAt: previous?.createdAt ?? new Date().toISOString(),
    checkedAt: new Date().toISOString(),
  };
  const key = input.key ?? (previous ? getSecret("hub", secretId(previous.id)) : undefined) ?? "";
  if (
    previous &&
    getSecret("hub", secretId(previous.id)) &&
    input.key === undefined &&
    (previous.endpoint !== endpoint || previous.authHeader !== input.authHeader || previous.authScheme !== input.authScheme)
  )
    throw new Error("Re-enter the key when changing the server or authentication settings.");
  if (input.kind === "openapi") connection.tools = input.spec ? openApiTools(input.spec) : (previous?.tools ?? []);
  else {
    const session = await mcpSession(connection, key);
    let cursor: string | undefined;
    try {
      for (let page = 0; page < 10; page++) {
        const result = await session.rpc("tools/list", cursor ? { cursor } : {});
        if (!Array.isArray(result.value.tools)) throw new Error("The MCP server did not return a tool list.");
        for (const raw of result.value.tools) {
          const tool = obj(raw);
          if (typeof tool.name !== "string") continue;
          connection.tools.push({
            name: tool.name,
            description: String(tool.description ?? "").slice(0, 1000),
            inputSchema: obj(tool.inputSchema),
            readOnly: obj(tool.annotations).readOnlyHint === true && obj(tool.annotations).destructiveHint !== true,
          });
        }
        cursor = typeof result.value.nextCursor === "string" ? result.value.nextCursor : undefined;
        if (!cursor) break;
      }
    } finally {
      await session.close();
    }
    if (cursor || connection.tools.length > 200) throw new Error("This server has too many tools. Use a server exposing at most 200 tools.");
  }
  if (!connection.tools.length) throw new Error("No tools were discovered.");
  for (const binding of connection.bindings)
    if (!connection.tools.some((t) => t.name === binding.tool && t.readOnly)) throw new Error("Map each capability to a tool the server marks read-only.");
  return connection;
}

export async function saveConnection(input: ConnectionInput) {
  const connection = await discoverConnection(input);
  if (input.key !== undefined) setSecrets("hub", { [secretId(connection.id)]: input.key || null });
  await updateAutomation((data) => {
    data.connections = [...data.connections.filter((c) => c.id !== connection.id), connection];
  });
  return connection;
}
export async function removeConnection(id: string) {
  await updateAutomation((data) => {
    data.connections = data.connections.filter((c) => c.id !== id);
  });
  setSecrets("hub", { [secretId(id)]: null });
}

async function runConnection(id: string, toolName: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
  const connection = readAutomation().connections.find((c) => c.id === id && c.enabled);
  if (!connection) throw new Error("That connection is missing or disabled.");
  const tool = connection.tools.find((t) => t.name === toolName);
  if (!tool?.readOnly) throw new Error("Only discovered read-only tools can run.");
  if (JSON.stringify(args).length > 100_000) throw new Error("Tool arguments exceed 100 KB.");
  checkInput(tool.inputSchema, args);
  const key = getSecret("hub", secretId(id)) ?? "";
  const started = Date.now();
  try {
    let value: unknown;
    if (connection.kind === "mcp") {
      const session = await mcpSession(connection, key, signal);
      let result;
      try {
        result = (await session.rpc("tools/call", { name: toolName, arguments: args })).value;
      } finally {
        await session.close();
      }
      if (result.isError) throw new Error("The MCP tool reported a failure. Check the mapped arguments.");
      value = result.structuredContent;
      if (value === undefined) {
        const text = (Array.isArray(result.content) ? result.content : [])
          .map(obj)
          .filter((c) => c.type === "text")
          .map((c) => c.text)
          .join("\n");
        try {
          value = JSON.parse(text);
        } catch {
          value = { text };
        }
      }
    } else {
      let path = tool.path!;
      const url = new URL(connection.endpoint);
      for (const parameter of tool.parameters ?? []) {
        const arg = args[parameter.name];
        if (arg === undefined) continue;
        if (parameter.in === "path" && [".", ".."].includes(String(arg))) throw new Error("Path parameters cannot be dot segments.");
        if (parameter.in === "path") path = path.replace(`{${parameter.name}}`, encodeURIComponent(String(arg)));
        else for (const item of Array.isArray(arg) ? arg : [arg]) url.searchParams.append(parameter.name, String(item));
      }
      if (/\{[^}]+\}/.test(path)) throw new Error("Provide all required path parameters.");
      url.pathname = `${url.pathname.replace(/\/$/, "")}${path}`;
      value = (await send({ ...connection, endpoint: url.href }, key, { method: "GET" }, undefined, signal)).value;
    }
    await recordOperation({
      kind: "connection",
      provider: connection.name,
      query: toolName,
      durationMs: Date.now() - started,
      resultCount: Array.isArray(value) ? value.length : 1,
      cached: false,
      costUsd: null,
    });
    return value;
  } catch (error) {
    const message = redact(error instanceof Error ? error.message : "Tool request failed.", [key]);
    await recordOperation({
      kind: "connection",
      provider: connection.name,
      query: toolName,
      durationMs: Date.now() - started,
      resultCount: 0,
      cached: false,
      costUsd: null,
      error: message,
    });
    throw new Error(message);
  }
}

export async function callCapability(id: string, capability: Capability, query: string, limit = 10, signal?: AbortSignal) {
  const connection = readAutomation().connections.find((c) => c.id === id && c.enabled);
  const binding = connection?.bindings.find((b) => b.capability === capability);
  if (!binding) throw new Error(`Map the ${capability} capability for this connection first.`);
  const args = {
    ...binding.defaults,
    ...(binding.queryField ? { [binding.queryField]: query } : {}),
    ...(binding.limitField ? { [binding.limitField]: limit } : {}),
  };
  return mapRows(await callConnection(id, binding.tool, args, signal), binding.resultPath, binding.fields);
}

export const callConnection = (id: string, toolName: string, args: Record<string, unknown>, signal?: AbortSignal) =>
  automationTask(signal, (active) => runConnection(id, toolName, args, active));
