import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import { fileURLToPath } from "node:url";

/**
 * Starts scripts/mock-anthropic.mjs on a free loopback port for a test file. Nothing leaves this machine.
 * The control endpoints queue failures (`fault`), list what the engine sent (`requests`) and reset the
 * mock's prompt cache between tests (`reset`).
 */

const SCRIPT = fileURLToPath(new URL("../../scripts/mock-anthropic.mjs", import.meta.url));

export interface MockFault {
  type: string;
  times?: number;
  when?: { tool?: string; model?: string };
  /** refusal_fallback: the model that serves the turn. */
  model?: string;
}

export interface MockRequest {
  model: string;
  tools: string[];
  strict: string[];
  messages: number;
  maxTokens: number;
  effort: string | null;
  cacheControl: { type: string; ttl?: string } | null;
  systemMarkers: string[];
  betas: string | null;
  fallbacks: unknown;
  status?: number;
  fault?: string | null;
  stop?: string;
}

export interface MockServer {
  url: string;
  /** Lines the mock printed (stdout and stderr). */
  log: string[];
  fault: (...faults: MockFault[]) => Promise<void>;
  requests: () => Promise<MockRequest[]>;
  reset: () => Promise<void>;
  stop: () => void;
}

async function freePort(): Promise<number> {
  const srv = net.createServer();
  await new Promise<void>((resolve) => srv.listen(0, "127.0.0.1", resolve));
  const { port } = srv.address() as net.AddressInfo;
  await new Promise((resolve) => srv.close(resolve));
  return port;
}

export async function startMock(env: Record<string, string> = {}): Promise<MockServer> {
  const port = await freePort();
  const log: string[] = [];
  const child: ChildProcess = spawn(process.execPath, [SCRIPT], { env: { ...process.env, MOCK_PORT: String(port), MOCK_DELAY: "0", ...env }, stdio: ["ignore", "pipe", "pipe"] });
  // Its error log (failures tests ask for on purpose) stays out of the test output.
  child.stderr!.on("data", (chunk: Buffer) => log.push(chunk.toString().trim()));
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("mock Anthropic server did not start")), 10_000);
    child.once("exit", (code) => reject(new Error(`mock Anthropic server exited (${code})`)));
    child.stdout!.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString().split("\n")) if (line.trim()) log.push(line);
      if (log.some((l) => l.includes("listening"))) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
  const url = `http://127.0.0.1:${port}`;
  // Bound to the fetch that existed at start, so a test's fetch spy doesn't record control calls.
  const real = globalThis.fetch;
  const control = async (path: string, init?: RequestInit) => {
    const res = await real(`${url}${path}`, init);
    if (!res.ok) throw new Error(`mock ${path}: ${res.status} ${await res.text()}`);
    return res.json();
  };
  return {
    url,
    log,
    fault: async (...faults) => void (await control("/__mock/faults", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ faults }) })),
    requests: async () => (await control("/__mock/requests")).requests as MockRequest[],
    reset: async () => void (await control("/__mock/reset", { method: "POST" })),
    stop: () => void child.kill(),
  };
}
