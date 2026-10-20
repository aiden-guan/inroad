import "server-only";
import { appOrigin, authorize } from "./auth";
import { callTool, getTool, inputSchema, TOOLS } from "./tools";

/**
 * The REST mirror of the MCP tools, for n8n, Zapier, Make, Clay HTTP columns and ChatGPT actions.
 * Same handlers, same validation, same per-key log. GET tools read query parameters; POST tools
 * read a JSON body. Responses are `{ ok: true, data }` or `{ ok: false, error }`.
 */

const MAX_BYTES = 1_000_000;

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { "cache-control": "no-store", ...headers } });
}

/** Query strings are all text; turn the numeric and boolean fields the schema expects back into values. */
function fromQuery(params: URLSearchParams, toolName: string): Record<string, unknown> {
  const t = getTool(toolName)!;
  const props = ((inputSchema(t).properties ?? {}) as Record<string, { type?: string }>) ?? {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of params.entries()) {
    const type = props[k]?.type;
    out[k] = type === "integer" || type === "number" ? Number(v) : type === "boolean" ? v === "true" : v;
  }
  return out;
}

export function restHandler(toolName: string) {
  return async (request: Request): Promise<Response> => {
    const auth = authorize(request);
    if (!auth.ok) {
      return json({ ok: false, error: auth.message }, auth.status, {
        ...(auth.status === 401 ? { "www-authenticate": 'Bearer realm="inroad"' } : {}),
        ...(auth.retryAfter ? { "retry-after": String(auth.retryAfter) } : {}),
      });
    }
    let input: unknown;
    if (request.method === "GET") {
      input = fromQuery(new URL(request.url).searchParams, toolName);
    } else {
      const raw = await request.text();
      if (raw.length > MAX_BYTES) return json({ ok: false, error: "Request too large (1 MB max). Send fewer records per call." }, 413);
      try {
        input = raw.trim() ? JSON.parse(raw) : {};
      } catch {
        return json({ ok: false, error: "Send a JSON body (Content-Type: application/json)." }, 400);
      }
    }
    const r = await callTool(toolName, input, { key: auth.key, via: "rest", base: appOrigin(request) });
    return r.ok ? json({ ok: true, data: r.data }) : json({ ok: false, error: r.message }, r.status);
  };
}

/** OpenAPI 3.1 for the REST mirror, generated from the same zod schemas the tools validate with. */
export function openApiSpec(origin: string) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const t of TOOLS) {
    const schema = inputSchema(t) as { properties?: Record<string, Record<string, unknown>>; required?: string[] };
    const op: Record<string, unknown> = {
      operationId: t.name,
      summary: t.title,
      description: `${t.description} Requires the "${t.scope}" scope.`,
      tags: [t.readOnly ? "Read" : "Write"],
      security: [{ bearerAuth: [] }, { apiKeyHeader: [] }],
      responses: {
        "200": { description: "OK", content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean", const: true }, data: { type: "object" } }, required: ["ok", "data"] } } } },
        "400": { $ref: "#/components/responses/Error" },
        "401": { $ref: "#/components/responses/Error" },
        "403": { $ref: "#/components/responses/Error" },
        "429": { $ref: "#/components/responses/Error" },
      },
    };
    if (t.rest.method === "GET") {
      op.parameters = Object.entries(schema.properties ?? {}).map(([name, s]) => ({
        name,
        in: "query",
        required: schema.required?.includes(name) ?? false,
        schema: s,
        ...(typeof s.description === "string" ? { description: s.description } : {}),
      }));
    } else {
      op.requestBody = { required: true, content: { "application/json": { schema } } };
    }
    paths[t.rest.path] = { ...(paths[t.rest.path] ?? {}), [t.rest.method.toLowerCase()]: op };
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "Inroad API",
      version: "1.0.0",
      description:
        "Read the founder's ICP and playbook, score and add accounts, log activity, and submit drafts to the founder's approval queue. Inroad never sends anything. The same tools are available over MCP at /api/mcp.",
    },
    servers: [{ url: `${origin}/api/v1` }],
    paths,
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", description: "An Inroad agent key (inr_…), from Integrations → AI agents." },
        apiKeyHeader: { type: "apiKey", in: "header", name: "X-API-Key" },
      },
      responses: {
        Error: {
          description: "Error",
          content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean", const: false }, error: { type: "string" } }, required: ["ok", "error"] } } },
        },
      },
    },
  };
}
