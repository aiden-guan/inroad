import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, vi } from "vitest";
import { runAgent } from "@/lib/ai/engine";
import type { AgentEvent } from "@/lib/ai/events";
import type { Workspace } from "@/lib/domain/types";
import type { WorkflowContext, WorkflowDef } from "@/lib/workflows/types";

/**
 * Runs a workflow offline: the model is scripts/mock-anthropic.mjs (spawned per test file on a free port, the real
 * streaming wire format, tool inputs synthesized from each schema) and the workspace lives in memory. Every request
 * the engine sends is recorded, so a test can check what reached the model.
 */

const MOCK = fileURLToPath(new URL("../../scripts/mock-anthropic.mjs", import.meta.url));

export interface SentRequest {
  model: string;
  system: { text: string }[];
  tools?: { name: string }[];
  messages: { role: string; content: unknown }[];
}

async function freePort(): Promise<number> {
  const srv = net.createServer();
  await new Promise<void>((resolve) => srv.listen(0, "127.0.0.1", resolve));
  const { port } = srv.address() as net.AddressInfo;
  await new Promise((resolve) => srv.close(resolve));
  return port;
}

/** Starts the mock for this test file and records the requests each test sends. */
export function startMockModel(): { sent: SentRequest[] } {
  let mock: ChildProcess | undefined;
  const state = { sent: [] as SentRequest[] };
  beforeAll(async () => {
    const port = await freePort();
    mock = spawn(process.execPath, [MOCK], { env: { ...process.env, MOCK_PORT: String(port), MOCK_DELAY: "0" }, stdio: ["ignore", "pipe", "pipe"] });
    mock.stderr!.resume();
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("mock Anthropic server did not start")), 10_000);
      mock!.once("exit", (code) => reject(new Error(`mock Anthropic server exited (${code})`)));
      mock!.stdout!.on("data", (chunk: Buffer) => {
        if (chunk.toString().includes("listening")) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${port}`;
    process.env.ANTHROPIC_API_KEY = "mock";
  });
  afterAll(() => {
    mock?.kill();
  });
  beforeEach(() => {
    state.sent.length = 0;
    const real = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (String(input instanceof Request ? input.url : input).includes("/v1/messages")) state.sent.push(JSON.parse(String(init?.body)));
      return real(input, init);
    });
  });
  return state;
}

/** The text of every user message a request carried. */
export function userText(req: SentRequest): string {
  return req.messages
    .filter((m) => m.role === "user")
    .map((m) => (typeof m.content === "string" ? m.content : (m.content as { type: string; text?: string }[]).map((b) => b.text ?? "").join("\n")))
    .join("\n");
}

/**
 * Runs one workflow on an in-memory workspace. Returns its result, the workspace after, and what it emitted. `agent`
 * replaces the model call, for a case the mock can't produce (a model that never submits).
 */
export async function runOffline<A>(def: WorkflowDef<A>, args: A, ws: Workspace, opts: { agent?: WorkflowContext<A>["agent"] } = {}): Promise<{ result: unknown; ws: Workspace; events: AgentEvent[] }> {
  const events: AgentEvent[] = [];
  const parsed = def.args.parse(args);
  const ctx: WorkflowContext<A> = {
    runId: "run_offline",
    args: parsed,
    emit: (e) => events.push(e),
    signal: new AbortController().signal,
    agent: opts.agent ?? ((o) => runAgent({ ...o, emit: (e) => events.push(e) })),
    read: () => structuredClone(ws),
    mutate: async (fn) => fn(ws),
    noteFreeSignals: () => {},
  };
  const result = await def.run(ctx);
  return { result, ws, events };
}
