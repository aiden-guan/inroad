import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Binding } from "./types";
import { callCapability, callConnection, ConnectionInput, discoverConnection, openApiTools, removeConnection, saveConnection } from "./connections";
import { readAutomation, resetAutomation, updateAutomation } from "./store";
import { atPath, checkInput, mapRows } from "./mapping";
import { activeSearch, clearSearchCache, saveSearchSetup, searchWeb } from "@/lib/search/search";
import { readSettings, writeSettings } from "@/lib/store/settings";

let server: Server, endpoint: string;
const calls: { method: string; authorization?: string; protocol?: string; session?: string; url: string }[] = [];
const hit = { url: "https://company.example.org/about", title: "Company", description: "Finance software for growing teams" };
const spec = {
  openapi: "3.0.3",
  paths: {
    "/companies": {
      get: {
        operationId: "find_companies",
        parameters: [
          { name: "q", in: "query", required: true, schema: { type: "string" } },
          { name: "count", in: "query", schema: { type: "integer", maximum: 20 } },
        ],
      },
      post: { operationId: "create_company" },
    },
  },
};
beforeAll(async () => {
  server = createServer(async (req, res) => {
    calls.push({
      method: req.method!,
      authorization: req.headers.authorization,
      protocol: req.headers["mcp-protocol-version"] as string | undefined,
      session: req.headers["mcp-session-id"] as string | undefined,
      url: req.url!,
    });
    if (req.method === "DELETE") {
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.url?.startsWith("/api/companies")) {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: { matches: [hit] } }));
      return;
    }
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const packet = JSON.parse(raw);
    if (packet.method === "notifications/initialized") {
      res.writeHead(202);
      res.end();
      return;
    }
    if (packet.method === "initialize") {
      res.setHeader("mcp-session-id", "session-1");
      res.end(JSON.stringify({ jsonrpc: "2.0", id: packet.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} } } }));
      return;
    }
    if (packet.method === "tools/list") {
      const first = !packet.params.cursor;
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: packet.id,
          result: {
            tools: first
              ? [
                  {
                    name: "search",
                    inputSchema: {
                      type: "object",
                      properties: { query: { type: "string" }, limit: { type: "integer" } },
                      required: ["query"],
                      additionalProperties: false,
                    },
                    annotations: { readOnlyHint: true },
                  },
                ]
              : [{ name: "delete", inputSchema: {}, annotations: { readOnlyHint: false, destructiveHint: true } }],
            ...(first ? { nextCursor: "page2" } : {}),
          },
        }),
      );
      return;
    }
    if (packet.method === "tools/call") {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", method: "notifications/progress", params: {} })}\n\n`);
      res.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: packet.id, result: { structuredContent: { results: [hit] } } })}\n\n`);
      // Deliberately remain open: a client must resolve once the matching response arrives.
      return;
    }
    res.writeHead(400);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
beforeEach(async () => {
  calls.splice(0);
  await resetAutomation();
  clearSearchCache();
  writeSettings({ search: undefined, researchRequests: undefined, browserRequests: undefined });
});

describe("external connections", () => {
  it("discovers a paginated MCP server, negotiates sessions, reads an open SSE response, and cleans up", async () => {
    const connection = await saveConnection(
      ConnectionInput.parse({
        name: "MCP research",
        kind: "mcp",
        endpoint: `${endpoint}/mcp`,
        key: "mcp-test-secret",
        bindings: [Binding.parse({ capability: "search", tool: "search", fields: { url: "url", title: "title", description: "description" } })],
      }),
    );
    expect(connection.tools.map((t) => [t.name, t.readOnly])).toEqual([
      ["search", true],
      ["delete", false],
    ]);
    const result = await callCapability(connection.id, "search", "finance", 3);
    expect(result).toEqual([hit]);
    expect(calls.filter((c) => c.method === "DELETE")).toHaveLength(2);
    expect(calls.filter((c) => c.session).every((c) => c.protocol === "2025-06-18")).toBe(true);
    expect(calls.every((c) => c.authorization === "Bearer mcp-test-secret")).toBe(true);
    expect(JSON.stringify(readAutomation())).not.toContain("mcp-test-secret");
    await expect(callConnection(connection.id, "delete", {})).rejects.toThrow(/read-only/);
    const before = calls.length;
    await expect(callConnection(connection.id, "search", { query: 3 })).rejects.toThrow(/text/);
    expect(calls).toHaveLength(before);
  });

  it("imports only GET operations, maps nested results, and uses them as the selected search provider", async () => {
    const connection = await saveConnection(
      ConnectionInput.parse({
        name: "Existing API",
        kind: "openapi",
        endpoint: `${endpoint}/api`,
        spec,
        key: "api-test-secret",
        bindings: [
          {
            capability: "search",
            tool: "find_companies",
            queryField: "q",
            limitField: "count",
            resultPath: "data.matches",
            fields: { url: "url", title: "title", description: "description" },
          },
        ],
      }),
    );
    expect(connection.tools.map((t) => t.name)).toEqual(["find_companies"]);
    expect(saveSearchSetup({ provider: "connected", connectionId: connection.id })).toBeNull();
    const selected = activeSearch()!;
    expect(await searchWeb(selected, "finance", 3)).toEqual({ ok: true, value: [hit] });
    expect(calls[0]).toMatchObject({ method: "GET", url: "/api/companies?q=finance&count=3", authorization: "Bearer api-test-secret" });
    expect(JSON.stringify(readSettings())).not.toContain("api-test-secret");
    await updateAutomation((data) => {
      data.connections[0].enabled = false;
    });
    expect(activeSearch()).toBeNull();
    await expect(callConnection(connection.id, "find_companies", { q: "finance" })).rejects.toThrow(/disabled/);
    await removeConnection(connection.id);
    expect(readAutomation().connections).toEqual([]);
  });

  it("does not forward an existing key to a changed endpoint without re-entry", async () => {
    const connection = await saveConnection(ConnectionInput.parse({ name: "API", kind: "openapi", endpoint, spec, key: "existing-secret" }));
    await expect(discoverConnection(ConnectionInput.parse({ ...connection, endpoint: "https://different.example.org/api", spec }))).rejects.toThrow(/Re-enter/);
  });

  it("rejects redirects without leaking the key to a second destination", async () => {
    const connection = await saveConnection(ConnectionInput.parse({ name: "API", kind: "openapi", endpoint, spec, key: "redirect-secret" }));
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: "https://elsewhere.example.org" } }));
    vi.stubGlobal("fetch", fetch);
    await expect(callConnection(connection.id, "find_companies", { q: "finance" })).rejects.toThrow(/302/);
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][1].redirect).toBe("manual");
  });

  it("rejects external schema refs and path escapes", () => {
    expect(() => openApiTools({ ...spec, paths: { "/lookup": { get: { parameters: [{ $ref: "https://elsewhere.example.org/secret" }] } } } })).toThrow(/local/);
    expect(() => openApiTools({ ...spec, paths: { "/%2e%2e/secrets": { get: {} } } })).toThrow(/path/);
    expect(() => checkInput({ type: "object", required: ["q"], properties: { q: { type: "string" } } }, {})).toThrow(/required/);
  });
});

describe("bounded mappings", () => {
  it("maps dotted fields and indices without evaluating expressions", () => {
    expect(atPath({ data: [{ domain: "company.org" }] }, "data[0].domain")).toBe("company.org");
    expect(mapRows({ records: [{ company: { domain: "company.org" } }] }, "records", { domain: "company.domain" })).toEqual([{ domain: "company.org" }]);
    expect(() => atPath({}, "__proto__.secret")).toThrow(/plain field/);
    expect(() => atPath({}, "constructor.name")).toThrow(/plain field/);
    expect(() => mapRows({}, "missing", {})).toThrow(/result path/);
  });
});
