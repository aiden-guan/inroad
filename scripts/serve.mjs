#!/usr/bin/env node
/**
 * Starts Inroad: `npm run dev`, `npm start` and `npm run dev:mock` all come through here.
 *
 *   node scripts/serve.mjs dev            # next dev on http://localhost:3000
 *   node scripts/serve.mjs start          # next start (after `npm run build`)
 *   node scripts/serve.mjs dev --mock     # against the mock Anthropic API, with its own data folder
 *   node scripts/serve.mjs dev -p 3301    # any other next option passes through
 *
 * - Listens on 127.0.0.1 only, so other devices on the network can't connect at all. INROAD_HOST (or -H)
 *   changes that, for a VM or a container; the app still refuses every page and internal API from
 *   anywhere but this computer.
 * - Preloads scripts/peer-guard.cjs, which stamps each request with its socket's real address. Without
 *   it the app can't tell this computer from a caller who claims to be it, so it refuses everything.
 * - `--mock` points Anthropic and Firecrawl at the mock (`npm run mock:anthropic`, MOCK_PORT or 4010),
 *   keeps its data in .data-mock (GTM_DATA_DIR to change) and serves on 3100.
 *
 * Plain Node, no shell syntax, so it runs the same in cmd, PowerShell, bash and zsh.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));

const [mode, ...rest] = process.argv.slice(2);
if (mode !== "dev" && mode !== "start") {
  console.error("Usage: node scripts/serve.mjs dev|start [--mock] [next options]");
  process.exit(2);
}

const mock = rest.includes("--mock");
const args = rest.filter((a) => a !== "--mock");

/** The value of a flag like `-p 3301`, `--port=3301`; also drops it from `args`. */
function take(short, long) {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === short || a === long) {
      const value = args[i + 1];
      args.splice(i, 2);
      return value;
    }
    if (a.startsWith(`${long}=`)) {
      args.splice(i, 1);
      return a.slice(long.length + 1);
    }
  }
  return undefined;
}

const env = { ...process.env };
const host = take("-H", "--hostname") ?? (env.INROAD_HOST || "127.0.0.1");
const port = take("-p", "--port") ?? (mock ? "3100" : env.PORT || "3000");

if (mock) {
  const mockUrl = `http://localhost:${env.MOCK_PORT || 4010}`;
  env.ANTHROPIC_BASE_URL = mockUrl;
  env.ANTHROPIC_API_KEY = "mock";
  env.FIRECRAWL_API_URL = mockUrl;
  env.GTM_DATA_DIR ||= ".data-mock";
}

// The app reads these: where it listens (the tunnel connects there) and that the guard is loaded.
env.INROAD_HOST = host;
// Forward slashes: NODE_OPTIONS treats a backslash inside quotes as an escape, and Windows accepts both.
const guard = path.join(here, "peer-guard.cjs").replace(/\\/g, "/");
env.NODE_OPTIONS = [env.NODE_OPTIONS, `--require "${guard}"`].filter(Boolean).join(" ");

const LOOPBACK = /^(127\.\d+\.\d+\.\d+|::1|localhost)$/i;
if (!LOOPBACK.test(host)) {
  console.warn(
    `[inroad] Listening on ${host}, so other devices on your network can connect. They still get "only available on the computer it runs on" for every page and internal API.`,
  );
}

const next = require.resolve("next/dist/bin/next");
const child = spawn(process.execPath, [next, mode, "-H", host, "-p", String(port), ...args], { stdio: "inherit", env });

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    if (!child.killed) child.kill(signal);
  });
}
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 128 + ({ SIGHUP: 1, SIGINT: 2, SIGTERM: 15 }[signal] ?? 0) : 0)));
