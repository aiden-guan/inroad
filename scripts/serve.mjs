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
 * - Once Next answers, asks it to run its startup work (POST /api/startup): tighten data-file permissions
 *   and bring a named tunnel back, so hook and MCP URLs work again even if nobody opens the app.
 * - `--mock` points Anthropic, OpenAI and Firecrawl at the mock (`npm run mock:anthropic`, MOCK_PORT or 4010),
 *   keeps its data in .data-mock (GTM_DATA_DIR to change) and serves on 3100.
 * - Updates in one click: the app asks the launcher (over a loopback address and a token only the app is
 *   given, INROAD_LAUNCHER_URL and INROAD_LAUNCHER_TOKEN) what's new on GitHub and to update. The launcher
 *   stops the server, shows an "Updating" page on its port, pulls, installs and builds
 *   (scripts/source-update.mjs, which goes back to the old version if a step fails), then starts it again.
 *
 * Plain Node, no shell syntax, so it runs the same in cmd, PowerShell, bash and zsh.
 */
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import http from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchPlan } from "./launch-plan.mjs";
import { BLOCKED_REASON, checkSource, runSourceUpdate } from "./source-update.mjs";
import { updatingPage, UPDATE_STEPS } from "./updating-page.mjs";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

const plan = launchPlan(process.argv.slice(2), process.env, path.join(here, "peer-guard.cjs"));
if (plan.error) {
  console.error(plan.error);
  process.exit(2);
}
const { port, local } = plan;

if (plan.exposed) {
  console.warn(
    `[inroad] Listening on ${plan.host}, so other devices on your network can connect. They still get "only available on the computer it runs on" for every page and internal API.`,
  );
}

const next = require.resolve("next/dist/bin/next");

/* ───────────── Commands the update runs ───────────── */

const LOG_LINES = 400;
/** @type {{ phase: "idle" | "running" | "done" | "failed"; step: string | null; startedAt: string | null; finishedAt: string | null; result: unknown; backedUp: boolean; log: string[] }} */
const update = { phase: "idle", step: null, startedAt: null, finishedAt: null, result: null, backedUp: false, log: [] };

function keepLog(text) {
  for (const line of text.split("\n")) if (line.trim()) update.log.push(line);
  if (update.log.length > LOG_LINES) update.log.splice(0, update.log.length - LOG_LINES);
}

/** Runs a command in the repository and collects what it prints; `log` also shows it here and in the update log. */
function run(cmd, args, { timeoutMs = 30_000, log = false } = {}) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    const proc = spawn(cmd, args, {
      cwd: root,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", NEXT_TELEMETRY_DISABLED: "1" },
      // Node refuses to start a .cmd (npm on Windows) without a shell.
      shell: process.platform === "win32" && /\.cmd$/i.test(cmd),
      windowsHide: true,
    });
    const timer = setTimeout(() => proc.kill("SIGTERM"), timeoutMs);
    const collect = (sink) => (chunk) => {
      const text = chunk.toString();
      if (sink === "out") stdout += text;
      else stderr += text;
      if (log) {
        process.stdout.write(text.replace(/^(?=.)/gm, "[inroad update] "));
        keepLog(text);
      }
    };
    proc.stdout.on("data", collect("out"));
    proc.stderr.on("data", collect("err"));
    proc.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: 127, stdout, stderr: `${stderr}${err.message}` });
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

/** npm as it started this launcher (npm_execpath), else the one on PATH. */
const npmCli = process.env.npm_execpath && /npm-cli\.[cm]?js$/.test(process.env.npm_execpath) ? process.env.npm_execpath : null;
const npm = npmCli ? { cmd: process.execPath, args: [npmCli] } : { cmd: process.platform === "win32" ? "npm.cmd" : "npm", args: [] };

/* ───────────── The server ───────────── */

const token = crypto.randomBytes(24).toString("hex");
/** @type {import("node:child_process").ChildProcess | null} */
let child = null;

function startServer(controlUrl) {
  const proc = spawn(process.execPath, [next, ...plan.args], {
    stdio: "inherit",
    env: { ...plan.env, INROAD_LAUNCHER_URL: controlUrl, INROAD_LAUNCHER_TOKEN: token, INROAD_LAUNCH_MODE: plan.mode },
  });
  child = proc;
  proc.on("exit", (code, signal) => {
    // Stopped for an update: the launcher starts it again when the update is done.
    if (child !== proc) return;
    process.exit(code ?? (signal ? 128 + ({ SIGHUP: 1, SIGINT: 2, SIGTERM: 15 }[signal] ?? 0) : 0));
  });
  void runStartupWork(proc);
}

/** Startup work, as soon as the server answers (dev compiles on the first request, so allow a while). */
async function runStartupWork(proc) {
  for (let i = 0; i < 240 && proc.exitCode === null; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      const res = await fetch(`http://${local}:${port}/api/startup`, { method: "POST" });
      if (res.ok || res.status === 403) return;
    } catch {
      // not listening yet
    }
  }
}

function stopServer() {
  const proc = child;
  child = null;
  if (!proc || proc.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const force = setTimeout(() => proc.kill("SIGKILL"), 15_000);
    proc.once("exit", () => {
      clearTimeout(force);
      resolve();
    });
    proc.kill("SIGTERM");
  });
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    if (child && !child.killed) child.kill(signal);
    else process.exit(128 + ({ SIGHUP: 1, SIGINT: 2, SIGTERM: 15 }[signal] ?? 0));
  });
}

/* ───────────── While it updates: a page on the app's own port ───────────── */

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|::1|0\.0\.0\.0)(:\d+)?$|\.localhost(:\d+)?$/i;

/** Answers on the app's port while the server is stopped: a page that reloads itself, and the status the app polls. */
function servePlaceholder() {
  const placeholder = http.createServer((req, res) => {
    // Same rule as the app: only this computer, addressed by a local name (no DNS rebinding).
    if (!LOCAL_HOST.test(req.headers.host ?? "") || !/^(127\.|::1$|::ffff:127\.)/.test(req.socket.remoteAddress ?? "")) {
      res.writeHead(403, { "content-type": "text/plain" }).end("Inroad is only available on the computer it runs on.");
      return;
    }
    const status = { channel: "source", phase: "updating", step: update.step, startedAt: update.startedAt };
    if (req.url?.startsWith("/api/")) {
      res.writeHead(503, { "content-type": "application/json", "cache-control": "no-store", "retry-after": "2" }).end(JSON.stringify(status));
      return;
    }
    res.writeHead(503, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "retry-after": "2" }).end(updatingPage(update.step));
  });
  return new Promise((resolve) => {
    placeholder.once("error", () => resolve(null));
    placeholder.listen(Number(port), plan.host, () => resolve(placeholder));
  });
}

/* ───────────── The control channel the app talks to ───────────── */

/** One check of each kind at a time: a second caller waits for the first (a fetching check never takes a local one's answer). */
const checking = new Map();
function check(fetchFirst) {
  if (!checking.has(fetchFirst)) {
    checking.set(
      fetchFirst,
      checkSource({ run, fetch: fetchFirst }).finally(() => checking.delete(fetchFirst)),
    );
  }
  return checking.get(fetchFirst);
}

function publicUpdate() {
  const { log, ...rest } = update;
  return { ...rest, log: update.phase === "failed" ? log.slice(-40) : [] };
}

async function doUpdate(controlUrl, backedUp) {
  Object.assign(update, { phase: "running", step: "stopping", startedAt: new Date().toISOString(), finishedAt: null, result: null, backedUp, log: [] });
  console.log("[inroad] Updating: stopping the server.");
  await stopServer();
  const placeholder = await servePlaceholder();
  let result;
  try {
    result = await runSourceUpdate({
      run,
      root,
      mode: plan.mode,
      npm,
      next: path.join(root, "node_modules", "next", "dist", "bin", "next"),
      node: process.execPath,
      onStep: (step) => {
        update.step = step;
        console.log(`[inroad] Updating: ${UPDATE_STEPS[step] ?? step}`);
      },
    });
  } catch (err) {
    result = { ok: false, error: `The update stopped unexpectedly (${err instanceof Error ? err.message : String(err)}).`, rolledBack: false, step: update.step ?? "updating" };
  }
  if (placeholder) {
    placeholder.closeAllConnections();
    await new Promise((r) => placeholder.close(r));
  }
  Object.assign(update, { phase: result.ok ? "done" : "failed", step: null, finishedAt: new Date().toISOString(), result });
  console.log(result.ok ? `[inroad] Updated to ${result.to.slice(0, 7)}. Starting again.` : `[inroad] ${result.error}`);
  startServer(controlUrl);
}

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify(body));
}

/** A small JSON body, or {} when there's none or it isn't JSON. */
async function readBody(req) {
  let text = "";
  for await (const chunk of req) {
    text += chunk;
    if (text.length > 10_000) break;
  }
  try {
    return JSON.parse(text || "{}");
  } catch {
    return {};
  }
}

function authorized(req) {
  const given = Buffer.from(String(req.headers.authorization ?? ""));
  const want = Buffer.from(`Bearer ${token}`);
  return given.length === want.length && crypto.timingSafeEqual(given, want);
}

const control = http.createServer(async (req, res) => {
  if (!authorized(req)) return json(res, 401, { error: "Not allowed." });
  const url = new URL(req.url ?? "/", "http://launcher");
  try {
    if (req.method === "GET" && url.pathname === "/check") {
      const result = await check(url.searchParams.get("fetch") === "1");
      return json(res, 200, { mode: plan.mode, check: result, update: publicUpdate() });
    }
    if (req.method === "GET" && url.pathname === "/status") return json(res, 200, { mode: plan.mode, update: publicUpdate() });
    if (req.method === "POST" && url.pathname === "/update") {
      if (update.phase === "running") return json(res, 409, { error: "Inroad is already updating." });
      // Whether the app took a backup first, so it can say so afterwards (a sample or empty workspace has none).
      const { backedUp = false } = await readBody(req);
      // Everything that can stop an update is checked while the server still runs, so a refusal costs nothing.
      const result = await check(true);
      if (result.kind !== "git") return json(res, 409, { error: result.reason });
      if (result.fetchError) return json(res, 409, { error: result.fetchError });
      if (result.blocked) return json(res, 409, { error: BLOCKED_REASON[result.blocked] });
      if (!result.behind) return json(res, 409, { error: "Inroad is already up to date." });
      json(res, 202, { started: true, changes: result.behind });
      // Answer first: the request came from the server this stops.
      setTimeout(() => void doUpdate(controlUrlOf(), backedUp === true), 250);
      return;
    }
    return json(res, 404, { error: "Not found." });
  } catch (err) {
    return json(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
});

const controlUrlOf = () => {
  const address = control.address();
  return address && typeof address === "object" ? `http://127.0.0.1:${address.port}` : "";
};

// The launcher exits with the server (startServer's exit handler), never because of the control channel.
await new Promise((resolve) => control.listen(0, "127.0.0.1", resolve));
startServer(controlUrlOf());
