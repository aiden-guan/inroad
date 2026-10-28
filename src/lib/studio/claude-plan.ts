import "server-only";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import type { RunOptions, RunResult } from "@/lib/ai/engine";
import { AgentError } from "@/lib/ai/errors";
import { emptyUsage } from "@/lib/ai/models";
import { ensureDataDir, readDataFile, writeDataFile } from "@/lib/store/data-file";
import { DATA_DIR } from "@/lib/store/settings";

/** The official local Claude runtime owns authentication; Inroad stores permission, never tokens. */
type Connection = { mode: "shared" | "private" };
export interface ClaudePlanStatus { available: boolean; connected: boolean; plan?: string; pending?: boolean; authUrl?: string; error?: string }
const connectionFile = () => path.join(DATA_DIR, "claude-plan-connection.json");
const privateHome = () => path.join(DATA_DIR, "claude-plan-auth");
const connection = () => readDataFile<Connection | null>(connectionFile(), () => null);
const state = (globalThis as unknown as { __inroadClaudePlan?: {
  pending?: { child: ChildProcessWithoutNullStreams; url?: string; timer: ReturnType<typeof setTimeout> };
  loginError?: string;
  active: Set<AbortController>;
} }).__inroadClaudePlan ??= { active: new Set() };

function executable(): string | null {
  const candidates: string[] = [];
  if (process.env.INROAD_CLAUDE_PATH) candidates.push(process.env.INROAD_CLAUDE_PATH);
  else {
    const desktop = path.join(os.homedir(), "Library/Application Support/Claude/claude-code");
    try {
      const versions = fs.readdirSync(desktop).filter((name) => /^\d+\.\d+\.\d+$/.test(name)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
      for (const version of versions) for (const build of fs.readdirSync(path.join(desktop, version)).filter((name) => /^[a-f0-9]{6,64}$/.test(name))) candidates.push(path.join(desktop, version, build, "claude.app/Contents/MacOS/claude"));
    } catch { /* Desktop is optional. */ }
    for (const dir of [path.join(os.homedir(), ".local/bin"), ...(process.env.PATH ?? "").split(path.delimiter), "/opt/homebrew/bin", "/usr/local/bin"].filter(Boolean)) candidates.push(path.join(dir, process.platform === "win32" ? "claude.exe" : "claude"));
  }
  return candidates.find((file) => {
    if (!path.isAbsolute(file)) return false;
    try { fs.accessSync(file, fs.constants.X_OK); return fs.statSync(file).isFile(); } catch { return false; }
  }) ?? null;
}

function environment(mode: Connection["mode"]): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const name of Object.keys(env)) {
    if (name.startsWith("ANTHROPIC_") || name.startsWith("CLAUDE_CODE_USE_") || /(?:API_KEY|AUTH_TOKEN)$/.test(name) || ["CLAUDE_CODE_OAUTH_TOKEN", "CLAUDECODE", "GH_TOKEN", "GITHUB_TOKEN"].includes(name)) delete env[name];
  }
  if (mode === "private") { ensureDataDir(privateHome()); env.CLAUDE_CONFIG_DIR = privateHome(); }
  env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = "1";
  return env;
}

// Safe mode keeps OAuth but skips user/project customizations. Bare mode would disable subscription auth.
const authFlags = () => ["--safe-mode", "--setting-sources", "", "--settings", JSON.stringify({ disableAllHooks: true, apiKeyHelper: "", forceLoginMethod: "claudeai" })];
function launch(args: string[], mode: Connection["mode"]) {
  const binary = executable();
  if (!binary) throw new AgentError("Install Claude Desktop with Claude Code, or the Claude Code CLI, then connect your Claude plan.", "auth");
  // The executable belongs to the installed Claude runtime, outside Inroad's build output.
  const child = spawn(/* turbopackIgnore: true */ binary, [...authFlags(), ...args], { cwd: os.tmpdir(), env: environment(mode), stdio: "pipe", windowsHide: true });
  child.stdin.on("error", () => {}); // An early runtime exit is reported by the process close/error handlers.
  return child;
}

type AccountStatus = { loggedIn?: boolean; authMethod?: string; apiProvider?: string; subscriptionType?: string };
async function account(mode: Connection["mode"]): Promise<AccountStatus> {
  const child = launch(["auth", "status"], mode);
  child.stdin.end(); child.stderr.resume();
  return new Promise((resolve, reject) => {
    let text = "";
    const timer = setTimeout(() => { child.kill(); reject(new AgentError("Claude took too long to read its sign-in. Try connecting again.", "auth")); }, 20_000);
    child.stdout.on("data", (chunk: Buffer) => { text += chunk.toString(); if (text.length > 64_000) child.kill(); });
    child.on("error", () => { clearTimeout(timer); reject(new AgentError("Couldn't start the local Claude runtime. Update Claude and reconnect.", "auth")); });
    child.on("close", () => {
      clearTimeout(timer);
      try { const parsed = JSON.parse(text); if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid status"); resolve(parsed as AccountStatus); } catch { reject(new AgentError("Couldn't read Claude's sign-in. Update Claude and reconnect.", "auth")); }
    });
  });
}
function statusFor(a: AccountStatus): ClaudePlanStatus {
  const connected = a.loggedIn === true && a.authMethod === "claude.ai" && a.apiProvider === "firstParty" && !!a.subscriptionType;
  return { available: true, connected, ...(connected ? { plan: a.subscriptionType } : {}) };
}

export async function claudePlanStatus(): Promise<ClaudePlanStatus> {
  if (!executable()) return { available: false, connected: false };
  if (state.pending) return { available: true, connected: false, pending: true, authUrl: state.pending.url };
  const saved = connection();
  if (!saved) return { available: true, connected: false, error: state.loginError };
  return statusFor(await account(saved.mode));
}

export async function connectClaudePlan(): Promise<ClaudePlanStatus> {
  if (state.pending) return claudePlanStatus();
  delete state.loginError;
  const saved = connection();
  const current = statusFor(await account(saved?.mode ?? "shared"));
  if (current.connected) { writeDataFile(connectionFile(), saved ?? { mode: "shared" }); return current; }
  const privateStatus = statusFor(await account("private"));
  if (privateStatus.connected) { writeDataFile(connectionFile(), { mode: "private" }); return privateStatus; }
  const child = launch(["auth", "login", "--claudeai"], "private");
  child.stdin.end();
  const timer = setTimeout(() => { if (state.pending?.child === child) { child.kill(); delete state.pending; state.loginError = "Claude sign-in timed out. Connect again to retry."; } }, 5 * 60_000);
  const pending = { child, timer, url: undefined as string | undefined };
  state.pending = pending;
  let loginOutput = "";
  const readUrl = (chunk: Buffer) => {
    loginOutput = (loginOutput + chunk.toString()).slice(-32_000);
    for (const raw of loginOutput.match(/https:\/\/[^\s\u001b]+/g) ?? []) {
      try { const url = new URL(raw); if (["claude.ai", "claude.com"].includes(url.hostname) && url.pathname.startsWith("/oauth/")) pending.url = url.href; } catch { /* Ignore diagnostics, never echo them. */ }
    }
  };
  child.stdout.on("data", readUrl); child.stderr.on("data", readUrl);
  child.on("error", () => { clearTimeout(timer); if (state.pending?.child === child) { delete state.pending; state.loginError = "Couldn't start Claude sign-in. Update Claude and reconnect."; } });
  child.on("close", async (code) => {
    if (state.pending?.child !== child) return;
    clearTimeout(timer);
    try {
      if (code !== 0 || !statusFor(await account("private")).connected) state.loginError = "Claude sign-in didn't finish. Connect again to retry.";
      else if (state.pending?.child === child) writeDataFile(connectionFile(), { mode: "private" });
    } catch { state.loginError = "Couldn't verify the Claude sign-in. Connect again to retry."; }
    finally { if (state.pending?.child === child) delete state.pending; }
  });
  return { available: true, connected: false, pending: true };
}

export async function disconnectClaudePlan() {
  for (const controller of state.active) controller.abort();
  if (state.pending) { const pending = state.pending; delete state.pending; clearTimeout(pending.timer); pending.child.kill(); }
  const saved = connection();
  if (saved?.mode === "private") {
    const child = launch(["auth", "logout"], "private");
    child.stdin.end(); child.stdout.resume(); child.stderr.resume();
    await new Promise<void>((resolve) => { const timer = setTimeout(() => { child.kill(); resolve(); }, 10_000); child.once("close", () => { clearTimeout(timer); resolve(); }); child.once("error", () => { clearTimeout(timer); resolve(); }); });
  }
  writeDataFile(connectionFile(), null);
  delete state.loginError;
}

/** Preserve image blocks for visual review; flatten conversation context into one SDK user message. */
function contentFor(messages: Anthropic.Beta.BetaMessageParam[]): Anthropic.Beta.BetaContentBlockParam[] {
  const blocks: Anthropic.Beta.BetaContentBlockParam[] = [];
  for (const message of messages) {
    blocks.push({ type: "text", text: `\n${message.role === "assistant" ? "Previous assistant response" : "Task and context"}:` });
    if (typeof message.content === "string") blocks.push({ type: "text", text: message.content });
    else for (const block of message.content) {
      if (block.type === "text" || block.type === "image") blocks.push(block);
      else if (block.type === "tool_result") blocks.push({ type: "text", text: typeof block.content === "string" ? block.content : JSON.stringify(block.content ?? "") });
    }
  }
  return blocks;
}

/** Runs the official CLI/Agent SDK protocol, never a copied OAuth token or an API compatibility proxy. */
export async function runClaudePlan<T>(opts: RunOptions): Promise<RunResult<T>> {
  const saved = connection();
  if (!saved) throw new AgentError("Connect your Claude plan in Studio before starting this work.", "auth");
  if (state.active.size >= 2) throw new AgentError("Two Claude-plan requests are already running. Wait for one to finish.", "rate_limit");
  const controller = new AbortController(); state.active.add(controller);
  const signal = AbortSignal.any([controller.signal, ...(opts.signal ? [opts.signal] : []), AbortSignal.timeout(240_000)]);
  let child: ChildProcessWithoutNullStreams | undefined;
  try {
    if (!statusFor(await account(saved.mode)).connected) throw new AgentError("Claude isn't signed in with a subscription. Reconnect your Claude plan; Inroad won't use an API key instead.", "auth");
    if (signal.aborted || !connection()) throw new AgentError("Claude-plan work was stopped or disconnected.", "stopped");
    const terminals = opts.tools?.filter((tool) => tool.terminal) ?? [];
    if (terminals.length !== 1) throw new AgentError("This Studio task needs one structured result to run through the Claude plan.", "bad_request");
    const tool = terminals[0];
    const schema = z.toJSONSchema(tool.schema, { target: "draft-7" });
    delete schema.$schema;
    const model = opts.tier === "strategist" ? "opus" : opts.tier === "fast" ? "haiku" : "sonnet";
    const system = [Array.isArray(opts.system) ? opts.system.join("\n\n") : opts.system, `Return the JSON input for ${tool.name}. ${tool.description} Do not run commands, access files, call other tools or delegate. The application will validate the JSON and render any SVG itself.`].join("\n\n");
    const args = ["--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}', "--tools", "", "--disallowedTools", "mcp__*", "--permission-mode", "dontAsk", "--no-session-persistence", "-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--model", model, "--max-turns", "3", "--json-schema", JSON.stringify(schema), "--system-prompt", system];
    if (opts.tier !== "fast") args.push("--effort", opts.effort === "low" ? "low" : opts.effort === "medium" ? "medium" : "high");
    child = launch(args, saved.mode); child.stderr.resume();
    const current = child;
    const result = await new Promise<{ output: unknown; model: string; usage: Record<string, number>; text: string }>((resolve, reject) => {
      let bytes = 0; let modelName = "Claude"; let final: { output: unknown; model: string; usage: Record<string, number>; text: string } | undefined;
      const abort = () => { current.kill(); reject(new AgentError("Claude-plan work was stopped or timed out.", "stopped")); };
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) { abort(); return; }
      current.on("error", () => reject(new AgentError("Couldn't start Claude. Update the local runtime and reconnect.", "auth")));
      current.stdout.on("data", (chunk: Buffer) => { bytes += chunk.length; if (bytes > 12 * 1024 * 1024) { current.kill(); reject(new AgentError("Claude returned more output than this task can accept.", "bad_request")); } });
      createInterface({ input: current.stdout }).on("line", (line) => {
        let event: { type?: string; subtype?: string; model?: string; is_error?: boolean; structured_output?: unknown; usage?: Record<string, number>; result?: string };
        try { event = JSON.parse(line); } catch { current.kill(); reject(new AgentError("Claude returned an unreadable response. Try again.", "bad_request")); return; }
        if (event?.type === "system" && event.subtype === "init" && event.model) modelName = event.model;
        if (event?.type !== "result") return;
        if (event.subtype !== "success" || event.is_error || event.structured_output === undefined) {
          const limited = /rate|usage|limit|quota|extra usage/i.test(event.result ?? "");
          reject(new AgentError(limited ? "Your Claude plan's usage limit was reached. Check Claude or wait for your allowance to reset." : "Claude didn't finish a valid result. Check your plan sign-in and try again; Inroad won't switch to API billing.", limited ? "rate_limit" : "unknown"));
          return;
        }
        final = { output: event.structured_output, model: modelName, usage: event.usage ?? {}, text: event.result ?? "" };
      });
      current.once("close", (code) => {
        signal.removeEventListener("abort", abort);
        if (code === 0 && final) resolve(final);
        else reject(new AgentError("Claude stopped before returning a finished result. Reconnect or try again.", "unknown"));
      });
      current.stdin.end(`${JSON.stringify({ type: "user", message: { role: "user", content: contentFor(opts.messages) } })}\n`);
    });
    const parsed = tool.schema.safeParse(result.output);
    if (!parsed.success) throw new AgentError("Claude's result didn't pass the task's format checks. Try again.", "bad_request");
    return {
      result: parsed.data as T, text: "", messages: opts.messages, stopReason: "tool_use", costUsd: 0,
      modelName: `Claude plan · ${result.model}`,
      usage: { ...emptyUsage(), inputTokens: result.usage.input_tokens ?? 0, outputTokens: result.usage.output_tokens ?? 0, cacheReadTokens: result.usage.cache_read_input_tokens ?? 0, cacheWriteTokens: result.usage.cache_creation_input_tokens ?? 0 },
    };
  } finally { child?.kill(); state.active.delete(controller); }
}
