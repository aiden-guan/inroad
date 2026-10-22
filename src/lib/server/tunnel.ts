import "server-only";
import { spawn, type ChildProcess } from "node:child_process";
import { accessSync, constants } from "node:fs";
import path from "node:path";
import { nowISO } from "@/lib/domain/ids";
import { mutateWorkspace, readWorkspace } from "@/lib/store/workspace";

/**
 * "Enable public URL": a Cloudflare quick tunnel (`cloudflared tunnel --url`) run as a child of
 * this server, so cloud tools can reach the hook URLs and remote agents can reach MCP without the
 * founder keeping a terminal open. No account, no config file; the trycloudflare.com address
 * changes on every start, so it's stored as `integrations.webhook_in.config.publicUrl` (the same
 * field a pasted address uses) and cleared when the tunnel stops.
 *
 * Exposure is decided by src/proxy.ts, not here: tunnel requests carry Cloudflare headers, so only
 * /api/mcp, /api/v1 and /api/hooks answer through it. Everything else gets a 403.
 */

const URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;
const START_TIMEOUT_MS = 45_000;
const LOG_LINES = 12;

interface Proc {
  child: ChildProcess;
  port: number;
  url?: string;
  startedAt: string;
  ready: Promise<string>;
  log: string[];
}

// On globalThis so a dev-server reload doesn't lose track of a running child.
const g = globalThis as typeof globalThis & { __inroadTunnel?: { proc?: Proc; error?: string; hooked?: boolean } };
const state = (g.__inroadTunnel ??= {});

export interface TunnelStatus {
  installed: boolean;
  running: boolean;
  starting: boolean;
  url?: string;
  startedAt?: string;
  /** What went wrong last time, as a sentence the UI can show. */
  error?: string;
  /** Shown when cloudflared isn't installed. */
  installCommand: string;
}

export function findCloudflared(): string | null {
  const name = process.platform === "win32" ? "cloudflared.exe" : "cloudflared";
  // Homebrew's bin dirs aren't on PATH when the app is started from a GUI or a launch agent.
  const dirs = [...(process.env.PATH ?? "").split(path.delimiter), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"];
  for (const dir of dirs) {
    if (!dir) continue;
    const file = path.join(dir, name);
    try {
      accessSync(file, constants.X_OK);
      return file;
    } catch {
      // not here
    }
  }
  return null;
}

export function installCommand(): string {
  if (process.platform === "darwin") return "brew install cloudflared";
  if (process.platform === "win32") return "winget install --id Cloudflare.cloudflared";
  return "curl -fsSL -o cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 && chmod +x cloudflared && sudo mv cloudflared /usr/local/bin/";
}

export function tunnelStatus(): TunnelStatus {
  const p = state.proc;
  return {
    installed: Boolean(findCloudflared()),
    running: Boolean(p?.url),
    starting: Boolean(p && !p.url),
    ...(p?.url ? { url: p.url, startedAt: p.startedAt } : {}),
    ...(state.error && !p ? { error: state.error } : {}),
    installCommand: installCommand(),
  };
}

/** Sets or clears the public address. Clearing only touches an address this tunnel set. */
async function setPublicUrl(url: string | null, ours?: string) {
  await mutateWorkspace((ws) => {
    const cur = ws.integrations.webhook_in ?? { id: "webhook_in" as const, enabled: false, config: {} };
    if (url) {
      ws.integrations.webhook_in = { ...cur, config: { ...cur.config, publicUrl: url, publicUrlTunnel: true } };
      return;
    }
    if (cur.config.publicUrlTunnel !== true || (ours && cur.config.publicUrl !== ours)) return;
    const config = { ...cur.config };
    delete config.publicUrl;
    delete config.publicUrlTunnel;
    ws.integrations.webhook_in = { ...cur, config };
  });
}

/** After a restart the child is gone but the stored address isn't: clear it so hook URLs don't point nowhere. */
export async function reconcileTunnel() {
  if (state.proc) return;
  const cfg = readWorkspace().integrations.webhook_in?.config;
  if (cfg?.publicUrlTunnel === true) await setPublicUrl(null);
}

/**
 * Where cloudflared connects: the address the launcher bound (INROAD_HOST, 127.0.0.1 by default). Not
 * "localhost", which can resolve to ::1 first while the app listens on IPv4 loopback only.
 */
export function tunnelTarget(host = process.env.INROAD_HOST): string {
  const h = (host ?? "").trim();
  if (!h || h === "0.0.0.0") return "127.0.0.1";
  if (h === "::" || h === "::1" || h === "[::1]") return "[::1]";
  return h.includes(":") && !h.startsWith("[") ? `[${h}]` : h;
}

function lastLine(log: string[]): string {
  const line = [...log].reverse().find((l) => /ERR|error|failed/i.test(l)) ?? log[log.length - 1] ?? "";
  return line.replace(/^\S+\s+(INF|ERR|WRN)\s+/, "").trim().slice(0, 200);
}

export async function startTunnel(port: number): Promise<TunnelStatus> {
  if (state.proc) {
    await state.proc.ready.catch(() => undefined);
    return tunnelStatus();
  }
  const bin = findCloudflared();
  if (!bin) {
    state.error = "cloudflared isn't installed on this computer.";
    return tunnelStatus();
  }
  state.error = undefined;

  const child = spawn(bin, ["tunnel", "--no-autoupdate", "--url", `http://${tunnelTarget()}:${port}`], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  const log: string[] = [];
  let resolveUrl!: (url: string) => void;
  let rejectUrl!: (err: Error) => void;
  const ready = new Promise<string>((res, rej) => {
    resolveUrl = res;
    rejectUrl = rej;
  });
  const proc: Proc = { child, port, startedAt: nowISO(), ready, log };
  state.proc = proc;

  const timeout = setTimeout(() => {
    rejectUrl(new Error("Cloudflare didn't hand out an address within 45 seconds. Check your internet connection and try again."));
    child.kill();
  }, START_TIMEOUT_MS);

  const onData = (chunk: Buffer) => {
    for (const line of chunk.toString("utf8").split(/\r?\n/)) {
      if (!line.trim()) continue;
      log.push(line);
      if (log.length > LOG_LINES) log.shift();
      const m = !proc.url && line.match(URL_RE);
      if (m) {
        proc.url = m[0].toLowerCase();
        clearTimeout(timeout);
        resolveUrl(proc.url);
      }
    }
  };
  child.stdout?.on("data", onData);
  child.stderr?.on("data", onData);

  child.on("error", (err) => {
    clearTimeout(timeout);
    rejectUrl(new Error(`Couldn't start cloudflared: ${err.message}`));
  });
  child.on("exit", (code) => {
    clearTimeout(timeout);
    const url = proc.url;
    if (state.proc === proc) state.proc = undefined;
    if (!url) rejectUrl(new Error(`cloudflared stopped before it was ready${code !== null ? ` (exit ${code})` : ""}${lastLine(log) ? `: ${lastLine(log)}` : "."}`));
    else if (!proc.child.killed) state.error = "The tunnel stopped on its own. Turn it on again for a new address.";
    if (url) void setPublicUrl(null, url);
  });

  // The tunnel lives and dies with this server.
  if (!state.hooked) {
    state.hooked = true;
    process.once("exit", () => g.__inroadTunnel?.proc?.child.kill());
  }

  try {
    const url = await ready;
    await setPublicUrl(url);
  } catch (err) {
    state.error = err instanceof Error ? err.message : "The tunnel didn't start.";
    if (state.proc === proc) state.proc = undefined;
    if (!child.killed) child.kill();
  }
  return tunnelStatus();
}

export async function stopTunnel(): Promise<TunnelStatus> {
  const p = state.proc;
  state.error = undefined;
  if (p) {
    state.proc = undefined;
    p.child.kill();
    if (p.url) await setPublicUrl(null, p.url);
  }
  return tunnelStatus();
}
