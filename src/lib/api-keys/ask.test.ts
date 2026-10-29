import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sampleWorkspace } from "@/lib/sample";
import { replaceWorkspace } from "@/lib/store/workspace";
import { NOW } from "@/test/factories";
import { handleMcpPost } from "./mcp";
import { createKey, listKeys, updateKey } from "./store";

/**
 * ask_inroad end to end against scripts/mock-anthropic.mjs: the key's model and thinking level
 * must reach the API request, and the answer and its cost must come back to the calling agent.
 */

const MOCK = fileURLToPath(new URL("../../../scripts/mock-anthropic.mjs", import.meta.url));
let mock: ChildProcess;
let sent: { model: string; output_config?: { effort?: string } }[];

async function freePort(): Promise<number> {
  const srv = net.createServer();
  await new Promise<void>((resolve) => srv.listen(0, "127.0.0.1", resolve));
  const { port } = srv.address() as net.AddressInfo;
  await new Promise((resolve) => srv.close(resolve));
  return port;
}

beforeAll(async () => {
  const port = await freePort();
  mock = spawn(process.execPath, [MOCK], { env: { ...process.env, MOCK_PORT: String(port), MOCK_DELAY: "0" }, stdio: ["ignore", "pipe", "pipe"] });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("mock Anthropic server did not start")), 10_000);
    mock.stdout!.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes("listening")) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${port}`;
  process.env.ANTHROPIC_API_KEY = "mock";
  await replaceWorkspace(sampleWorkspace(NOW));
});

afterAll(() => {
  mock?.kill();
});

beforeEach(() => {
  sent = [];
  const real = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    if (String(input).includes("/v1/messages")) sent.push(JSON.parse(String(init?.body)));
    return real(input, init);
  });
});

async function ask(token: string) {
  const res = await handleMcpPost(
    new Request("http://localhost:3000/api/mcp", {
      method: "POST",
      headers: { host: "localhost:3000", "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "ask_inroad", arguments: { question: "Which account should I work first?" } } }),
    }),
  );
  return (await res.json()) as { result: { isError: boolean; content: { text: string }[]; structuredContent?: { answer: string; model: string; effort: string; cost_usd: number } } };
}

describe("ask_inroad", () => {
  it("runs on the key's model and thinking level", async () => {
    const { key, token } = await createKey({ name: "Muse", client: "muse", scopes: ["read"], model: "strategist", effort: "high" });
    const r = await ask(token);
    expect(r.result.isError, r.result.content[0]?.text).toBe(false);
    expect(r.result.structuredContent).toMatchObject({ model: "Opus 5.5", effort: "high" });
    expect(r.result.structuredContent?.answer.length).toBeGreaterThan(0);
    expect(sent.length).toBeGreaterThan(0);
    for (const body of sent) {
      expect(body.model).toBe("claude-opus-5-5");
      expect(body.output_config?.effort).toBe("high");
    }
    const call = listKeys().calls.find((c) => c.keyId === key.id && c.tool === "ask_inroad");
    expect(call?.summary).toMatch(/^Answered a question on Opus 5\.5, high effort/);
  });

  it("follows a change of model, and keeps Haiku at low thinking", async () => {
    const { key, token } = await createKey({ name: "n8n", client: "n8n", scopes: ["read"] });
    await updateKey(key.id, { model: "fast", effort: "high" });
    const r = await ask(token);
    expect(r.result.isError, r.result.content[0]?.text).toBe(false);
    expect(r.result.structuredContent).toMatchObject({ model: "Haiku 5.5", effort: "low" });
    for (const body of sent) {
      expect(body.model).toBe("claude-haiku-5-5");
      expect(body.output_config?.effort).toBe("low");
    }
  });

  it("defaults old keys to Sonnet at low thinking", async () => {
    const { token } = await createKey({ name: "Cursor", client: "cursor", scopes: ["read"] });
    const r = await ask(token);
    expect(r.result.structuredContent).toMatchObject({ model: "Sonnet 5.5", effort: "low" });
    expect(sent.every((b) => b.model === "claude-sonnet-5-5")).toBe(true);
  });
});
