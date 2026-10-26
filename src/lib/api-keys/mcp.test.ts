import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { sampleWorkspace } from "@/lib/sample";
import { DATA_DIR } from "@/lib/store/settings";
import { readWorkspace, replaceWorkspace } from "@/lib/store/workspace";
import { NOW } from "@/test/factories";
import { SUPPORTED_VERSIONS, handleMcpPost, mcpMethodNotAllowed } from "./mcp";
import { createKey, listKeys, rateLimit, revokeKey } from "./store";
import type { Scope } from "./types";

/**
 * The MCP endpoint end to end: a real key store and workspace in this file's temp data folder
 * (see src/test/setup.ts), requests built the way an MCP client sends them.
 */

const tokens: Record<"read" | "records" | "drafts", string> = { read: "", records: "", drafts: "" };

beforeAll(async () => {
  expect(DATA_DIR).toBe(process.env.GTM_DATA_DIR);
  await replaceWorkspace(sampleWorkspace(NOW));
  const make = async (name: string, scopes: Scope[]) => (await createKey({ name, client: "other", scopes })).token;
  tokens.read = await make("Reader", ["read"]);
  tokens.records = await make("Muse", ["write_records"]);
  tokens.drafts = await make("Claude", ["write_records", "submit_drafts"]);
});

interface RpcReply {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: Record<string, unknown> & { content?: { type: string; text: string }[]; isError?: boolean; structuredContent?: Record<string, unknown>; tools?: { name: string; inputSchema: Record<string, unknown>; annotations: { readOnlyHint: boolean } }[] };
  error?: { code: number; message: string };
}

function post(body: unknown, { token = tokens.read, headers = {} }: { token?: string | null; headers?: Record<string, string> } = {}) {
  return handleMcpPost(
    new Request("http://localhost:3000/api/mcp", {
      method: "POST",
      headers: { host: "localhost:3000", "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

async function rpc(method: string, params?: Record<string, unknown>, opts?: Parameters<typeof post>[1]): Promise<RpcReply> {
  const res = await post({ jsonrpc: "2.0", id: 1, method, params }, opts);
  expect(res.status).toBe(200);
  return (await res.json()) as RpcReply;
}

const call = (name: string, args: Record<string, unknown>, token = tokens.read) => rpc("tools/call", { name, arguments: args }, { token });

describe("auth and transport", () => {
  it("refuses a missing, malformed, unknown or revoked key", async () => {
    const { key, token } = await createKey({ name: "Revoked", client: "other", scopes: ["read"] });
    await revokeKey(key.id);
    for (const t of [null, "not-a-key", `inr_${"x".repeat(32)}`, token]) {
      const res = await post({ jsonrpc: "2.0", id: 1, method: "ping" }, { token: t });
      expect(res.status).toBe(401);
      expect(res.headers.get("www-authenticate")).toBe('Bearer realm="inroad", error="invalid_token"');
      expect(((await res.json()) as RpcReply).error?.code).toBe(-32001);
    }
  });

  it("accepts the key as a bearer token or an X-API-Key header", async () => {
    expect((await rpc("ping")).result).toEqual({});
    expect((await rpc("ping", undefined, { token: null, headers: { "x-api-key": tokens.read } })).result).toEqual({});
  });

  it("refuses browsers on other origins (DNS rebinding) but not our own or non-browser clients", async () => {
    const res = await post({ jsonrpc: "2.0", id: 1, method: "ping" }, { headers: { origin: "https://evil.example.com" } });
    expect(res.status).toBe(403);
    expect(((await res.json()) as RpcReply).error).toEqual({ code: -32000, message: "Origin not allowed." });
    expect((await rpc("ping", undefined, { headers: { origin: "http://localhost:3000" } })).result).toEqual({});
    expect((await rpc("ping", undefined, { headers: { origin: "null" } })).result).toEqual({});
  });

  it("checks the MCP-Protocol-Version header", async () => {
    const res = await post({ jsonrpc: "2.0", id: 1, method: "ping" }, { headers: { "mcp-protocol-version": "2024-01-01" } });
    expect(res.status).toBe(400);
    expect(((await res.json()) as RpcReply).error?.message).toContain("Unsupported MCP-Protocol-Version 2024-01-01");
    expect((await rpc("ping", undefined, { headers: { "mcp-protocol-version": "2025-06-18" } })).result).toEqual({});
  });

  it("rejects bodies that aren't JSON-RPC, empty batches and oversized requests", async () => {
    const parse = await post("{not json");
    expect(parse.status).toBe(400);
    expect(((await parse.json()) as RpcReply).error?.code).toBe(-32700);
    expect((await post([])).status).toBe(400);
    expect((await post({ jsonrpc: "2.0", id: 1, method: "ping" }, { headers: { "content-length": "2000000" } })).status).toBe(413);
    expect((await post(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping", params: { pad: "x".repeat(1_000_001) } }))).status).toBe(413);
    expect((await post({ jsonrpc: "2.0", id: 1, method: "ping", params: { pad: "é".repeat(500_001) } })).status).toBe(413);
  });

  it("rate-limits each key", async () => {
    const { key, token } = await createKey({ name: "Busy", client: "other", scopes: ["read"] });
    for (let i = 0; i < 120; i++) rateLimit(key.id);
    const res = await post({ jsonrpc: "2.0", id: 1, method: "ping" }, { token });
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    // Other keys are unaffected.
    expect((await post({ jsonrpc: "2.0", id: 1, method: "ping" })).status).toBe(200);
  });

  it("answers GET with 405: the server is stateless", async () => {
    const res = mcpMethodNotAllowed();
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST, OPTIONS");
  });
});

describe("JSON-RPC", () => {
  it("negotiates the protocol version and records the client on initialize", async () => {
    const init = await rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "claude-code", version: "2.1.4" } }, { token: tokens.drafts });
    expect(init.result).toMatchObject({ protocolVersion: "2025-06-18", capabilities: { tools: { listChanged: false } }, serverInfo: { name: "inroad", version: "1.0.0" } });
    expect(init.result?.instructions).toContain("submit_draft");
    expect((await rpc("initialize", { protocolVersion: "1999-01-01" })).result?.protocolVersion).toBe(SUPPORTED_VERSIONS[0]);
    await vi.waitFor(() => expect(listKeys().keys.find((k) => k.name === "Claude")?.lastClient).toBe("claude-code 2.1.4"));
  });

  it("accepts notifications with 202 and answers only the requests in a batch", async () => {
    const note = await post({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(note.status).toBe(202);
    expect(await note.text()).toBe("");
    const batch = await post([{ jsonrpc: "2.0", id: "a", method: "ping" }, { jsonrpc: "2.0", method: "notifications/cancelled" }, { jsonrpc: "2.0", id: 7, method: "prompts/list" }]);
    expect(await batch.json()).toEqual([
      { jsonrpc: "2.0", id: "a", result: {} },
      { jsonrpc: "2.0", id: 7, result: { prompts: [] } },
    ]);
  });

  it("returns JSON-RPC errors for invalid requests and unknown methods", async () => {
    const invalid = (await (await post({ id: 5, method: "ping" })).json()) as RpcReply;
    expect(invalid).toEqual({ jsonrpc: "2.0", id: 5, error: { code: -32600, message: "Invalid request" } });
    expect((await rpc("sampling/createMessage")).error).toEqual({ code: -32601, message: "Method not found: sampling/createMessage" });
    expect((await rpc("resources/list")).result).toEqual({ resources: [] });
  });
});

describe("tools", () => {
  const names = async (token: string) => (await rpc("tools/list", undefined, { token })).result?.tools?.map((t) => t.name);

  it("lists only the tools a key's scopes allow, in a fixed order", async () => {
    // New tools are appended, never inserted, so callers' prompt caches over the earlier ones keep hitting.
    const read = ["get_icp", "get_playbook", "score_accounts", "search_records", "get_next_actions", "get_account", "find_warm_paths", "list_intros", "get_growth", "get_copy_guide", "check_copy", "check_graphic", "ask_inroad"];
    expect(await names(tokens.read)).toEqual(read);
    expect(await names(tokens.records)).toEqual([
      "get_icp",
      "get_playbook",
      "score_accounts",
      "search_records",
      "get_next_actions",
      "add_accounts",
      "log_activity",
      "complete_action",
      "get_account",
      "find_warm_paths",
      "list_intros",
      "get_growth",
      "log_growth_week",
      "add_partners",
      "get_copy_guide",
      "check_copy",
      "check_graphic",
      "ask_inroad",
    ]);
    expect(await names(tokens.drafts)).toEqual([
      "get_icp",
      "get_playbook",
      "score_accounts",
      "search_records",
      "get_next_actions",
      "add_accounts",
      "log_activity",
      "submit_draft",
      "complete_action",
      "get_account",
      "find_warm_paths",
      "list_intros",
      "get_growth",
      "log_growth_week",
      "add_partners",
      "get_copy_guide",
      "check_copy",
      "check_graphic",
      "ask_inroad",
    ]);
  });

  it("publishes a JSON Schema and hints for each tool", async () => {
    const tools = (await rpc("tools/list", undefined, { token: tokens.drafts })).result?.tools ?? [];
    for (const t of tools) {
      expect(t.inputSchema).toMatchObject({ type: "object" });
      expect(t.inputSchema).not.toHaveProperty("$schema");
    }
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    expect(byName.get_icp.annotations.readOnlyHint).toBe(true);
    expect(byName.add_accounts.annotations.readOnlyHint).toBe(false);
    expect(byName.add_accounts.inputSchema).toMatchObject({ required: expect.arrayContaining(["source", "accounts"]) });
  });

  it("reads the ICP as structured content plus the same JSON as text", async () => {
    const r = await call("get_icp", {});
    expect(r.result?.isError).toBe(false);
    expect(r.result?.structuredContent).toEqual(expect.any(Object));
    expect(JSON.parse(r.result!.content![0].text)).toEqual(r.result?.structuredContent);
  });

  it("hands outside agents Studio's copy guide and lint", async () => {
    const guide = (await call("get_copy_guide", { format: "product_hunt", occasion: "launch" })).result?.structuredContent as {
      format: { parts: { key: string; limits: { max: number | null; kind: string; source: string | null }[] }[] };
      moves: { id: string }[];
      receipts: { id: string }[];
    };
    const tagline = guide.format.parts.find((p) => p.key === "tagline")!;
    expect(tagline.limits[0]).toMatchObject({ max: 60, kind: "hard", source: expect.stringContaining("producthunt.com") });
    expect(guide.moves.length).toBeGreaterThan(0);
    expect(guide.receipts.length).toBeGreaterThan(0);

    const bad = (await call("check_copy", { format: "product_hunt", parts: { tagline: "Unlock the power of seamless, effortless reconciliation", description: "x", first_comment: "Upvote us!" } })).result?.structuredContent as {
      passed: boolean;
      errors: { code: string }[];
    };
    expect(bad.passed).toBe(false);
    expect(bad.errors.map((e) => e.code)).toEqual(expect.arrayContaining(["AI_TELL", "PLATFORM_RULE"]));

    const good = (await call("check_copy", { format: "one_liner", parts: { line: "Close usage revenue in 6 hours instead of 4 days" } })).result?.structuredContent as { passed: boolean };
    expect(good.passed).toBe(true); // "6 hours" is in an approved claim
  });

  it("hands outside agents the graphic sizes and rules, and checks their SVGs", async () => {
    const guide = (await call("get_copy_guide", { format: "linkedin_post" })).result?.structuredContent as { visual: { sizes: { id: string; width: number }[]; image_prompt_rules: string[] } | null };
    expect(guide.visual?.sizes[0]).toMatchObject({ id: "linkedin", width: 1200 });
    expect(guide.visual?.image_prompt_rules.length).toBeGreaterThan(3);
    const textOnly = (await call("get_copy_guide", { format: "show_hn" })).result?.structuredContent as { visual: unknown };
    expect(textOnly.visual).toBeNull();

    const line = "Close usage revenue in 6 hours instead of 4 days";
    const svg = (extra = "") =>
      `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080"><rect width="1080" height="1080" fill="#F4F1EA"/><text x="80" y="400" font-size="56" fill="#14120F">${line}</text>${extra}<script>alert(1)</script></svg>`;
    const checked = (await call("check_graphic", { format: "one_liner", preset: "square", svg: svg(), parts: { line } })).result?.structuredContent as { passed: boolean; removed: string[] };
    expect(checked.passed).toBe(true);
    expect(checked.removed).toContain("a script");
    const invented = (await call("check_graphic", { format: "one_liner", preset: "square", svg: svg(`<text x="80" y="600" font-size="40" fill="#14120F">Loved by 2,000 teams</text>`), parts: { line } })).result
      ?.structuredContent as { passed: boolean; errors: { code: string }[] };
    expect(invented.passed).toBe(false);
    expect(invented.errors.map((e) => e.code)).toContain("TEXT_NOT_APPROVED");
  });

  it("reports scope, input and lookup failures as tool results the model can read", async () => {
    expect((await rpc("tools/call", { name: "drop_tables" })).error).toEqual({ code: -32602, message: "Unknown tool: drop_tables" });
    const scope = await call("add_accounts", { source: "muse", accounts: [{ domain: "acme.com" }] });
    expect(scope.result).toMatchObject({ isError: true, content: [{ type: "text", text: expect.stringContaining(`This key can't use add_accounts`) }] });
    const input = await call("search_records", {});
    expect(input.result?.content?.[0].text).toBe("Invalid input. input: Send query, domain, email or linkedin_url.");
    const missing = await call("get_account", { domain: "nobody.example" });
    expect(missing.result).toMatchObject({ isError: true, content: [{ text: "No company with that domain. Use search_records." }] });
  });

  it("adds accounts and people to the workspace on disk, skipping free mail and suppressed domains", async () => {
    const args = {
      source: "clay",
      accounts: [
        { domain: "https://www.acmebilling.io/pricing", name: "Acme Billing", description: "Usage-based invoicing", people: [{ name: "Ana Lima", title: "Controller", email: "ana@acmebilling.io" }] },
        { domain: "gmail.com" },
        { domain: "meterbook.example" },
      ],
    };
    const r = await call("add_accounts", args, tokens.records);
    expect(r.result?.isError).toBe(false);
    expect(r.result?.structuredContent).toMatchObject({ created: 1, updated: 0, skipped: 2, people_added: 1 });
    const results = r.result?.structuredContent?.results as { domain: string | null; status: string; reason?: string }[];
    expect(results.map((x) => [x.domain, x.status])).toEqual([
      ["acmebilling.io", "created"],
      [null, "skipped"],
      ["meterbook.example", "skipped"],
    ]);

    const ws = readWorkspace();
    expect(ws.accounts["acmebilling.io"]).toMatchObject({ name: "Acme Billing", source: "integration", oneLiner: "Usage-based invoicing" });
    const ana = Object.values(ws.people).find((p) => p.email === "ana@acmebilling.io");
    expect(ana).toMatchObject({ name: "Ana Lima", accountDomain: "acmebilling.io" });
    const onDisk = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "workspace.json"), "utf8"));
    expect(onDisk.accounts["acmebilling.io"].name).toBe("Acme Billing");
    expect(listKeys().calls[0]).toMatchObject({ tool: "add_accounts", via: "mcp", ok: true });

    // A retry is an upsert: nothing new.
    const again = await call("add_accounts", args, tokens.records);
    expect(again.result?.structuredContent).toMatchObject({ created: 0, people_added: 0 });
    expect(Object.values(readWorkspace().people).filter((p) => p.email === "ana@acmebilling.io")).toHaveLength(1);

    // And the new company is searchable.
    const found = await call("search_records", { domain: "acmebilling.io" });
    expect(found.result?.structuredContent).toMatchObject({ exists: true });
  });
});

describe("consumer tools", () => {
  it("merges weekly numbers from tools without overwriting the founder's", async () => {
    // The founder typed signups for this week; a billing tool then sends its part.
    const week = "2026-10-12";
    const ws = readWorkspace();
    ws.growthLog = [{ weekOf: week, signups: 120, source: "founder", loggedAt: "2026-10-19T17:00:00.000Z" }];
    await replaceWorkspace(ws);

    const r = await call("log_growth_week", { week_of: "2026-10-14", signups: 999, paying: 42, revenue_usd: 410, source_tool: "revenuecat" }, tokens.records);
    expect(r.result?.isError).toBe(false);
    expect(r.result?.structuredContent).toMatchObject({ status: "logged", week_of: week, kept_founder_values: ["signups"] });
    expect(readWorkspace().growthLog?.find((w) => w.weekOf === week)).toMatchObject({ signups: 120, paying: 42, revenueUsd: 410 });

    const first = await call("log_growth_week", { week_of: "2026-10-05", paying: 3, source_tool: "posthog" }, tokens.records);
    expect(first.result).toMatchObject({ isError: true, content: [{ text: "The first numbers for a week need signups." }] });

    const read = await call("get_growth", {});
    expect(read.result?.structuredContent).toMatchObject({ ready: true, weeks: [{ week_of: week, signups: 120, paying: 42 }] });
  });

  it("adds creators to the shortlist and dedupes them by handle", async () => {
    const partners = [{ kind: "creator", name: "Maya Runs", platform: "tiktok", handle: "maya.runs", followers: 18200, fit: "Beginner runners, weekly training vlogs" }];
    const r = await call("add_partners", { source: "modash", partners }, tokens.records);
    expect(r.result?.structuredContent).toEqual({ added: 1, updated: 0 });
    const again = await call("add_partners", { source: "modash", partners: [{ ...partners[0], handle: "@Maya.Runs" }] }, tokens.records);
    expect(again.result?.structuredContent).toEqual({ added: 0, updated: 1 });
    const added = Object.values(readWorkspace().partners ?? {});
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ handle: "@maya.runs", followers: 18200, stage: "shortlist", source: "integration" });
    // A read-only key can't write.
    const denied = await call("add_partners", { source: "modash", partners });
    expect(denied.result?.isError).toBe(true);
  });
});
