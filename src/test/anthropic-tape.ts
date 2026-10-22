import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inject } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { billedUsage } from "@/lib/ai/engine";
import { MODEL_IDS, type ModelTier } from "@/lib/ai/models";
// Plain JS, shared with the live smoke (scripts/live).
import { exchangeKey, messageFromEvents, startTapeProxy } from "../../scripts/live/tape-proxy.mjs";
import { startMock, type MockServer } from "./mock-anthropic";

/**
 * Recorded Anthropic exchanges ("tapes") for workflow tests. A test names its tape; the mode comes from
 * INROAD_TAPES:
 *   replay (default)  serve src/test/fixtures/anthropic/live/<name>.json if the live smoke recorded one,
 *                     else src/test/fixtures/anthropic/<name>.json (recorded from the mock). Offline, free.
 *   record            run against scripts/mock-anthropic.mjs and rewrite the mock tape (npm run tapes:record)
 *   live              go through the live smoke's spend-capped proxy to the real API (npm run smoke:live);
 *                     with INROAD_RECORD=1 the exchanges are saved as the live tape
 * Requests are matched by model, tool set and conversation length, in recorded order, so a workflow
 * that sends what it sent when the tape was made gets the same answers back.
 */

export type TapeMode = "replay" | "record" | "live";

export interface TapeExchange {
  key: string;
  request: { model: string; tools: string[]; messages: number; maxTokens: number; effort: string | null; cacheTtl: string | null; stream: boolean };
  status: number;
  headers: Record<string, string>;
  events?: Record<string, unknown>[];
  json?: unknown;
  costUsd?: number;
}

interface TapeFile {
  version: 1;
  name: string;
  source: "mock" | "live";
  recordedAt: string;
  exchanges: TapeExchange[];
}

export interface Tape {
  name: string;
  mode: TapeMode;
  source: "mock" | "live";
  /** Requests the tape had no answer for (replay only). A test should end with none. */
  misses: string[];
  exchanges: () => TapeExchange[];
  /** Brings exchanges() up to date with what was recorded so far (record and live modes). */
  refresh: () => Promise<void>;
  /** The final message each successful response described, as the SDK builds it. */
  messages: () => Anthropic.Beta.BetaMessage[];
  /** What the responses' usage says they cost, priced per request by the model that served each. */
  costUsd: () => number;
  close: () => Promise<void>;
}

const DIR = fileURLToPath(new URL("./fixtures/anthropic/", import.meta.url));
const mockPath = (name: string) => path.join(DIR, `${name}.json`);
const livePath = (name: string) => path.join(DIR, "live", `${name}.json`);

export function tapeMode(): TapeMode {
  const m = process.env.INROAD_TAPES;
  return m === "record" || m === "live" ? m : "replay";
}

function tierOf(model: string): ModelTier {
  return (Object.keys(MODEL_IDS) as ModelTier[]).find((t) => model.startsWith(MODEL_IDS[t])) ?? "operator";
}

function finalMessages(exchanges: TapeExchange[]): Anthropic.Beta.BetaMessage[] {
  return exchanges.filter((e) => e.status === 200 && e.events).map((e) => messageFromEvents(e.events) as Anthropic.Beta.BetaMessage);
}

function tapeCost(exchanges: TapeExchange[]): number {
  return finalMessages(exchanges).reduce((n, m) => n + billedUsage(tierOf(m.model), m).costUsd, 0);
}

function sse(events: Record<string, unknown>[]): string {
  return events.map((e) => `event: ${String(e.type)}\ndata: ${JSON.stringify(e)}\n\n`).join("");
}

async function replayServer(file: TapeFile) {
  const used = new Set<number>();
  const misses: string[] = [];
  const server = http.createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    const key = exchangeKey(body);
    const i = file.exchanges.findIndex((e, n) => !used.has(n) && e.key === key);
    if (i < 0) {
      misses.push(key);
      res.writeHead(418, { "content-type": "application/json", "x-should-retry": "false" });
      return void res.end(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: `No recorded response on tape "${file.name}" for ${key}. Re-record it: npm run tapes:record` } }));
    }
    used.add(i);
    const e = file.exchanges[i];
    res.writeHead(e.status, { ...e.headers, "x-should-retry": "false" });
    res.end(e.events ? sse(e.events) : JSON.stringify(e.json));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  return { url: `http://127.0.0.1:${port}`, misses, close: () => new Promise<void>((r) => server.close(() => r())) };
}

function point(url: string) {
  process.env.ANTHROPIC_BASE_URL = url;
  process.env.ANTHROPIC_API_KEY = "tape";
}

export async function useTape(name: string): Promise<Tape> {
  const mode = tapeMode();

  if (mode === "replay") {
    const file = [livePath(name), mockPath(name)].find((p) => fs.existsSync(p));
    if (!file) throw new Error(`No tape "${name}" in src/test/fixtures/anthropic. Record it from the mock: npm run tapes:record`);
    const tape = JSON.parse(fs.readFileSync(file, "utf8")) as TapeFile;
    const server = await replayServer(tape);
    point(server.url);
    return {
      name,
      mode,
      source: tape.source,
      misses: server.misses,
      exchanges: () => tape.exchanges,
      refresh: async () => {},
      messages: () => finalMessages(tape.exchanges),
      costUsd: () => tapeCost(tape.exchanges),
      close: server.close,
    };
  }

  if (mode === "record") {
    const mock: MockServer = await startMock();
    const proxy = await startTapeProxy({ upstream: mock.url, coalesce: true });
    proxy.start(name);
    point(proxy.url);
    let exchanges: TapeExchange[] = [];
    return {
      name,
      mode,
      source: "mock",
      misses: [],
      exchanges: () => exchanges,
      refresh: async () => void (exchanges = proxy.peek()),
      messages: () => finalMessages(exchanges),
      costUsd: () => tapeCost(exchanges),
      close: async () => {
        exchanges = proxy.stop();
        const file: TapeFile = { version: 1, name, source: "mock", recordedAt: new Date().toISOString(), exchanges };
        fs.mkdirSync(DIR, { recursive: true });
        fs.writeFileSync(mockPath(name), `${JSON.stringify(file, null, 1)}\n`);
        await proxy.close();
        mock.stop();
      },
    };
  }

  // live: the spend-capped proxy the smoke's global setup started (scripts/live/global-setup.ts).
  const proxyUrl = inject("liveProxy" as never) as string | undefined;
  if (!proxyUrl) throw new Error("INROAD_TAPES=live only runs under the live smoke: npm run smoke:live");
  const control = (p: string, body: unknown) => fetch(`${proxyUrl}${p}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
  await control("/__tape/start", { name });
  point(proxyUrl);
  let exchanges: TapeExchange[] = [];
  return {
    name,
    mode,
    source: "live",
    misses: [],
    exchanges: () => exchanges,
    refresh: async () => void (exchanges = ((await control("/__tape/peek", {})) as { exchanges: TapeExchange[] }).exchanges),
    messages: () => finalMessages(exchanges),
    costUsd: () => tapeCost(exchanges),
    close: async () => {
      exchanges = ((await control("/__tape/stop", {})) as { exchanges: TapeExchange[] }).exchanges;
      if (process.env.INROAD_RECORD === "1" && exchanges.length) {
        const file: TapeFile = { version: 1, name, source: "live", recordedAt: new Date().toISOString(), exchanges };
        fs.mkdirSync(path.dirname(livePath(name)), { recursive: true });
        fs.writeFileSync(livePath(name), `${JSON.stringify(file, null, 1)}\n`);
      }
    },
  };
}
