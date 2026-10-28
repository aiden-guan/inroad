import "server-only";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import appPackage from "../../../package.json";
import { AgentError } from "@/lib/ai/errors";
import { ensureDataDir, readDataFile, writeDataFile } from "@/lib/store/data-file";
import { DATA_DIR } from "@/lib/store/settings";
import { imageInfo } from "./files";
import type { GeneratedImage } from "./openai";

/** Local Codex owns OAuth and tokens. Inroad stores only whether it may use that sign-in. */
type Connection = { mode: "shared" | "private" };
export interface ChatGptStatus {
  available: boolean;
  connected: boolean;
  plan?: string;
  pending?: boolean;
  authUrl?: string;
  error?: string;
  requiresSignIn?: boolean;
}
const connectionFile = () => path.join(DATA_DIR, "chatgpt-connection.json");
const privateHome = () => path.join(DATA_DIR, "chatgpt-auth");
const connection = () => readDataFile<Connection | null>(connectionFile(), () => null);

function executable(): string | null {
  const candidates = process.env.INROAD_CODEX_PATH ? [process.env.INROAD_CODEX_PATH] : [
    "/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex",
    "/Applications/Codex.app/Contents/Resources/codex",
    ...[...(process.env.PATH ?? "").split(path.delimiter), "/opt/homebrew/bin", "/usr/local/bin"].filter(Boolean).map((dir) => path.join(dir, process.platform === "win32" ? "codex.exe" : "codex")),
  ];
  return candidates.find((candidate) => {
    if (!path.isAbsolute(candidate)) return false;
    try { fs.accessSync(candidate, fs.constants.X_OK); return fs.statSync(candidate).isFile(); } catch { return false; }
  }) ?? null;
}

type Message = { id?: number; method?: string; params?: Record<string, unknown>; result?: unknown; error?: { message?: string } };
type Account = { account: { type: string; planType?: string } | null };

/** A bounded stdio client. No shell, credential export, browser cookies or unofficial HTTP endpoints. */
class ChatGptClient {
  private child: ChildProcessWithoutNullStreams;
  private nextId = 0;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private listeners = new Set<(message: Message) => void>();
  private closed = false;
  private buffered = 0;

  constructor(binary: string, mode: Connection["mode"]) {
    const env = { ...process.env };
    // An inherited API key must never silently turn subscription generation into an API charge.
    for (const name of Object.keys(env)) {
      if (/(?:API_KEY|AUTH_TOKEN)$/.test(name) || ["CODEX_ACCESS_TOKEN", "GH_TOKEN", "GITHUB_TOKEN", "OPENAI_BASE_URL", "OPENAI_IDENTITY_TOKEN_FILE", "OPENAI_WORKLOAD_IDENTITY_CONTEXT", "OPENAI_FEDERATION_RULE_ID"].includes(name)) delete env[name];
    }
    if (mode === "private") { ensureDataDir(privateHome()); env.CODEX_HOME = privateHome(); }
    const config = [
      'model_provider="openai"', 'model_providers={}', 'web_search="disabled"',
      'mcp_servers={}', 'features.shell_tool=false', 'features.unified_exec=false',
      'features.plugins=false', 'features.hooks=false', 'features.multi_agent=false',
      'features.skill_search=false', 'features.skip_host_skill_discovery=true',
      'features.code_mode=false', 'features.view_image=false', 'features.image_generation=true',
    ];
    this.child = spawn(binary, ["app-server", "--listen", "stdio://", ...config.flatMap((value) => ["-c", value])], { env, cwd: os.tmpdir(), stdio: "pipe", windowsHide: true });
    this.child.stderr.resume(); // Never expose runtime diagnostics that may contain auth URLs or prompts.
    this.child.on("error", () => this.fail(new Error("Couldn't start Codex. Update or reinstall Codex, then reconnect ChatGPT.")));
    this.child.on("exit", () => this.fail(new Error("The ChatGPT connection stopped. Reconnect and try again.")));
    this.child.stdout.on("data", (data: Buffer) => {
      this.buffered += data.length;
      if (this.buffered > 48 * 1024 * 1024) this.fail(new Error("ChatGPT returned an image larger than Inroad can import."));
    });
    const lines = createInterface({ input: this.child.stdout });
    lines.on("line", (line) => {
      if (this.closed) return;
      let message: Message;
      try { message = JSON.parse(line); } catch { this.fail(new Error("Codex returned an unreadable response. Update Codex and try again.")); return; }
      if (!message || typeof message !== "object") { this.fail(new Error("Codex returned an unreadable response. Update Codex and try again.")); return; }
      if (message.id !== undefined && message.method) {
        // Image generation needs no local commands, MCP tools, file edits or additional permissions.
        this.send({ id: message.id, error: { code: -32601, message: "Inroad only permits built-in image generation." } });
      } else if (message.id !== undefined) {
        const request = this.pending.get(message.id);
        if (!request) return;
        clearTimeout(request.timer);
        this.pending.delete(message.id);
        if (message.error) request.reject(new Error("Codex couldn't complete this request. Check your ChatGPT sign-in and update Codex."));
        else request.resolve(message.result);
      } else for (const listener of this.listeners) listener(message);
    });
  }

  private send(message: unknown) { if (!this.closed) this.child.stdin.write(`${JSON.stringify(message)}\n`); }
  rpc<T>(method: string, params: unknown = {}): Promise<T> {
    if (this.closed) return Promise.reject(new Error("The ChatGPT connection is closed."));
    const id = ++this.nextId;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error("ChatGPT took too long to respond. Try again.")); }, 30_000);
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject, timer });
      this.send({ id, method, params });
    });
  }
  async init() {
    await this.rpc("initialize", { clientInfo: { name: "inroad", title: "Inroad", version: appPackage.version }, capabilities: { experimentalApi: true } });
    this.send({ method: "initialized" });
  }
  onMessage(listener: (message: Message) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private fail(error: Error) {
    if (this.closed) return;
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(error); }
    this.pending.clear();
    for (const listener of this.listeners) listener({ method: "inroad/closed", params: { message: error.message } });
    this.close();
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(new Error("The ChatGPT connection was closed.")); }
    this.pending.clear();
    this.listeners.clear();
    this.child.kill();
  }
}

const runtime = globalThis as unknown as { __inroadChatGpt?: {
  login?: { client: ChatGptClient; id: string; url: string; timer: ReturnType<typeof setTimeout> };
  active?: AbortController;
} };
const state = runtime.__inroadChatGpt ??= {};

async function clientFor(mode: Connection["mode"]) {
  const binary = executable();
  if (!binary) throw new Error("Install the ChatGPT desktop app or Codex CLI on this computer, then connect again.");
  const client = new ChatGptClient(binary, mode);
  try { await client.init(); return client; } catch (error) { client.close(); throw error; }
}

async function inspect(client: ChatGptClient): Promise<ChatGptStatus> {
  const { account } = await client.rpc<Account>("account/read", { refreshToken: false });
  if (account?.type !== "chatgpt") return { available: true, connected: false, requiresSignIn: true, error: "Sign in with ChatGPT to use your plan for images." };
  const caps = await client.rpc<{ imageGeneration: boolean }>("modelProvider/capabilities/read");
  return caps.imageGeneration
    ? { available: true, connected: true, plan: account.planType }
    : { available: true, connected: false, error: "This Codex runtime doesn't offer image generation. Update Codex and reconnect." };
}

export async function chatGptStatus(): Promise<ChatGptStatus> {
  if (!executable()) return { available: false, connected: false };
  if (state.login) {
    let status: ChatGptStatus;
    try { status = await inspect(state.login.client); }
    catch {
      clearTimeout(state.login.timer); state.login.client.close(); delete state.login;
      return { available: true, connected: false, error: "ChatGPT sign-in stopped. Connect again to retry." };
    }
    if (status.connected) {
      writeDataFile(connectionFile(), { mode: "private" });
      clearTimeout(state.login.timer); state.login.client.close(); delete state.login;
      return status;
    }
    if (!status.requiresSignIn) {
      clearTimeout(state.login.timer); state.login.client.close(); delete state.login;
      return status;
    }
    return { available: true, connected: false, pending: true, authUrl: state.login.url };
  }
  const saved = connection();
  if (!saved) return { available: true, connected: false };
  const client = await clientFor(saved.mode);
  try { return await inspect(client); } finally { client.close(); }
}

export async function connectChatGpt(): Promise<ChatGptStatus> {
  if (state.login) return chatGptStatus();
  const saved = connection();
  const shared = await clientFor(saved?.mode ?? "shared");
  try {
    const status = await inspect(shared);
    if (status.connected) { writeDataFile(connectionFile(), saved ?? { mode: "shared" }); return status; }
    if (!status.requiresSignIn) return status;
  } finally { shared.close(); }
  // With no existing ChatGPT sign-in, use a separate Codex home so another client's login is untouched.
  const client = await clientFor("private");
  try {
    const existing = await inspect(client);
    if (existing.connected) { writeDataFile(connectionFile(), { mode: "private" }); client.close(); return existing; }
    const login = await client.rpc<{ type: string; loginId: string; authUrl: string }>("account/login/start", { type: "chatgpt" });
    const url = new URL(login.authUrl);
    if (login.type !== "chatgpt" || url.protocol !== "https:" || url.hostname !== "auth.openai.com") throw new Error("Codex returned an unexpected sign-in address. Update Codex and retry.");
    const timer = setTimeout(() => { client.close(); delete state.login; }, 5 * 60_000);
    state.login = { client, id: login.loginId, url: url.href, timer };
    return { available: true, connected: false, pending: true, authUrl: url.href };
  } catch (error) { client.close(); throw error; }
}

export async function disconnectChatGpt() {
  state.active?.abort();
  if (state.login) {
    const login = state.login; delete state.login; clearTimeout(login.timer);
    try { await login.client.rpc("account/login/cancel", { loginId: login.id }); } finally { login.client.close(); }
  }
  // Shared Codex credentials remain owned by Codex; Disconnect only revokes Inroad's local permission.
  const saved = connection();
  if (saved?.mode === "private") {
    const client = await clientFor("private");
    try { await client.rpc("account/logout"); } finally { client.close(); }
  }
  writeDataFile(connectionFile(), null);
}

export async function generateChatGptImage(opts: { prompt: string; w: number; h: number; signal?: AbortSignal }): Promise<GeneratedImage> {
  const saved = connection();
  if (!saved) throw new AgentError("Connect ChatGPT in Graphics before generating an image with your plan.", "auth");
  if (state.active) throw new AgentError("A ChatGPT image is already being generated. Wait for it to finish.", "rate_limit");
  const controller = new AbortController();
  state.active = controller;
  const signal = AbortSignal.any([controller.signal, ...(opts.signal ? [opts.signal] : []), AbortSignal.timeout(600_000)]);
  let client: ChatGptClient | undefined;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "inroad-chatgpt-image-"));
  fs.chmodSync(dir, 0o700);
  try {
    client = await clientFor(saved.mode);
    const status = await inspect(client);
    if (!status.connected) throw new AgentError(status.error ?? "Reconnect ChatGPT to generate images.", "auth");
    const { thread } = await client.rpc<{ thread: { id: string }; model: string }>("thread/start", {
      cwd: dir, sandbox: "read-only", approvalPolicy: "never", ephemeral: true,
      baseInstructions: "You generate a single PNG image with the built-in image generation tool. Do not use shell commands, files, skills, plugins, web search or other tools. Return only the generated image. Never substitute code, SVG, a description or an API call for an image.",
    });
    const current = client;
    const image = await new Promise<Buffer>((resolve, reject) => {
      let generated: Buffer | undefined;
      let failure: string | undefined;
      const stop = current.onMessage((event) => {
        const params = event.params ?? {};
        if (event.method === "inroad/closed") return finish(new Error("The ChatGPT connection stopped before the image finished."));
        if (params.threadId !== thread.id) return;
        if (event.method === "item/completed") {
          const item = params.item as { type?: string; status?: string; result?: string; savedPath?: string; failure?: { type?: string } };
          if (item?.type !== "imageGeneration") return;
          if (item.failure?.type === "usageLimitExceeded") failure = "Your ChatGPT image allowance is used up. Wait for it to reset or check your plan.";
          if (item.status === "completed") {
            if (item.result && item.result.length < 32 * 1024 * 1024) generated = Buffer.from(item.result, "base64");
            else if (item.savedPath) {
              // Never read an arbitrary path suggested by an agent. Only accept this job's own output.
              try {
                const file = fs.realpathSync(item.savedPath);
                if (file.startsWith(`${fs.realpathSync(dir)}${path.sep}`) && fs.statSync(file).size <= 24 * 1024 * 1024) generated = fs.readFileSync(file);
              } catch { /* Missing or outside the job: report no image below. */ }
            }
          }
        }
        if (event.method === "turn/completed") {
          const turn = params.turn as { status?: string };
          if (turn?.status !== "completed" || !generated) return finish(new Error(failure ?? "ChatGPT didn't return a finished image. Try again; Inroad won't switch to the API."));
          finish(undefined, generated);
        }
      });
      const abort = () => finish(new Error("ChatGPT image generation was cancelled or timed out."));
      function finish(error?: Error, result?: Buffer) { stop(); signal.removeEventListener("abort", abort); if (error) reject(error); else resolve(result!); }
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) return abort();
      void current.rpc("turn/start", {
        threadId: thread.id, input: [{ type: "text", text: `Generate one image with the built-in image generation tool. Return a PNG, not code. Aspect ratio ${opts.w}:${opts.h}.\n\n${opts.prompt}\n\nNo text, letters, logos or interface anywhere in the image.` }],
        sandboxPolicy: { type: "readOnly", networkAccess: false }, approvalPolicy: "never",
      }).catch((error: Error) => finish(error));
    });
    const info = imageInfo(image);
    if (!info || info.mime !== "image/png" || info.width < 64 || info.height < 64 || info.width > 8000 || info.height > 8000) throw new Error("ChatGPT didn't return a usable PNG image. Try again.");
    return { png: image, width: info.width, height: info.height, model: "ChatGPT plan", size: `${info.width}x${info.height}`, quality: "auto" };
  } finally {
    client?.close();
    if (state.active === controller) delete state.active;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
