import "server-only";
import { spawn, type ChildProcess } from "node:child_process";
import { accessSync, constants } from "node:fs";
import path from "node:path";
import { ActionError } from "@/lib/domain/actions";
import { nowISO } from "@/lib/domain/ids";
import { getSecret, mutateWorkspace, readWorkspace, setSecrets } from "@/lib/store/workspace";

/**
 * "Enable public URL": a Cloudflare tunnel run as a child of this server, so cloud tools can reach the
 * hook URLs and remote agents can reach MCP without the founder keeping a terminal open. The address
 * is stored as `integrations.webhook_in.config.publicUrl` (the same field a pasted address uses) and
 * cleared when the tunnel stops. Two kinds:
 *  - Quick (`cloudflared tunnel --url`): no account, no config, but a new trycloudflare.com address on
 *    every start, so every webhook and remote MCP URL has to be pasted again after a restart.
 *  - Named (`cloudflared tunnel run`, with the token from a tunnel the founder created in Cloudflare):
 *    a hostname on their own domain that never changes, and it starts again by itself whenever Inroad
 *    starts (src/lib/server/startup.ts), so tools set up once keep working. The token is kept in
 *    secrets.json and handed to cloudflared in its environment (TUNNEL_TOKEN), never on the command
 *    line where other users' `ps` could read it.
 *
 * Exposure is decided by src/proxy.ts, not here: tunnel requests carry Cloudflare headers, so only
 * /api/mcp, /api/v1 and /api/hooks answer through it. Everything else gets a 403.
 */

const URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;
// A named tunnel prints no address (the founder chose it); it's up once it registers a connection.
const REGISTERED_RE = /Registered tunnel connection|Connection [0-9a-f-]+ registered/i;
const TOKEN_KEY = "tunnelToken";
const START_TIMEOUT_MS = 45_000;
const LOG_LINES = 12;

interface Proc {
  child: ChildProcess;
  mode: "quick" | "named";
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
  /** Which tunnel turning it on starts: the founder's named one when it's set up, else a quick one. */
  mode: "quick" | "named";
  /** The named tunnel's address, when one is set up (whether or not it's running). */
  namedUrl?: string;
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

/* ───────────── Named tunnel: one address that survives restarts ───────────── */

/** The named tunnel's address, when one is set up (an address plus a saved token). */
export function namedTunnel(): { url: string } | null {
  const url = readWorkspace().integrations.webhook_in?.config.namedTunnelUrl;
  return typeof url === "string" && url && getSecret("webhook_in", TOKEN_KEY) ? { url } : null;
}

/**
 * The token from what the founder pasted: the token itself, or the whole install command Cloudflare
 * shows ("cloudflared service install eyJh…" or "… tunnel run --token eyJh…").
 */
export function tunnelToken(input: string): string | null {
  const words = input.trim().split(/\s+/).filter(Boolean);
  const token = words.find((w) => /^eyJ[A-Za-z0-9+/=_-]{40,}$/.test(w)) ?? (words.length === 1 && /^[A-Za-z0-9+/=_-]{40,}$/.test(words[0]) ? words[0] : null);
  return token ?? null;
}

/** https://inroad.example.com from what the founder typed; never a quick-tunnel or local address. */
export function namedTunnelUrl(input: string): string | null {
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !url.hostname.includes(".") || /trycloudflare\.com$|localhost$/i.test(url.hostname) || url.port) return null;
  return `https://${url.hostname.toLowerCase()}`;
}

/** Saves (or, with null, forgets) the named tunnel. A running tunnel is stopped first, so the next start uses the new setup. */
export async function saveNamedTunnel(input: { token: string; url: string } | null): Promise<TunnelStatus> {
  if (input) {
    const token = tunnelToken(input.token);
    if (!token) throw new ActionError("That doesn't look like a tunnel token. Paste the long token (it starts with eyJ) or the whole install command Cloudflare shows.");
    const url = namedTunnelUrl(input.url);
    if (!url) throw new ActionError("Use the public hostname you routed to this tunnel, like https://inroad.yourdomain.com.");
    await stopTunnel();
    setSecrets("webhook_in", { [TOKEN_KEY]: token });
    await mutateWorkspace((ws) => {
      const cur = ws.integrations.webhook_in ?? { id: "webhook_in" as const, enabled: false, config: {} };
      ws.integrations.webhook_in = { ...cur, config: { ...cur.config, namedTunnelUrl: url } };
    });
  } else {
    await stopTunnel();
    setSecrets("webhook_in", { [TOKEN_KEY]: null });
    await mutateWorkspace((ws) => {
      const cur = ws.integrations.webhook_in;
      if (!cur) return;
      const config = { ...cur.config };
      delete config.namedTunnelUrl;
      delete config.namedTunnelAuto;
      ws.integrations.webhook_in = { ...cur, config };
    });
  }
  return tunnelStatus();
}

/** Turning the named tunnel on or off also decides whether it comes back when Inroad starts. */
async function rememberAuto(on: boolean) {
  await mutateWorkspace((ws) => {
    const cur = ws.integrations.webhook_in;
    if (cur && cur.config.namedTunnelAuto !== on) ws.integrations.webhook_in = { ...cur, config: { ...cur.config, namedTunnelAuto: on } };
  });
}

/** Called when the server starts: brings the named tunnel back if it was on, so its address keeps working. */
export async function resumeNamedTunnel(port: number): Promise<TunnelStatus | null> {
  const named = namedTunnel();
  if (!named || readWorkspace().integrations.webhook_in?.config.namedTunnelAuto !== true) return null;
  return startTunnel(port);
}

export function tunnelStatus(): TunnelStatus {
  const p = state.proc;
  const named = namedTunnel();
  return {
    installed: Boolean(findCloudflared()),
    running: Boolean(p?.url),
    starting: Boolean(p && !p.url),
    mode: p?.mode ?? (named ? "named" : "quick"),
    ...(named ? { namedUrl: named.url } : {}),
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

  const named = namedTunnel();
  const token = named ? getSecret("webhook_in", TOKEN_KEY) : undefined;
  const child = named
    ? spawn(bin, ["tunnel", "--no-autoupdate", "run"], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true, env: { ...process.env, TUNNEL_TOKEN: token } })
    : spawn(bin, ["tunnel", "--no-autoupdate", "--url", `http://${tunnelTarget()}:${port}`], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  const log: string[] = [];
  let resolveUrl!: (url: string) => void;
  let rejectUrl!: (err: Error) => void;
  const ready = new Promise<string>((res, rej) => {
    resolveUrl = res;
    rejectUrl = rej;
  });
  const proc: Proc = { child, mode: named ? "named" : "quick", port, startedAt: nowISO(), ready, log };
  state.proc = proc;

  const timeout = setTimeout(() => {
    rejectUrl(
      new Error(
        named
          ? "Your named tunnel didn't connect within 45 seconds. Check your internet connection, and that the token is from this tunnel."
          : "Cloudflare didn't hand out an address within 45 seconds. Check your internet connection and try again.",
      ),
    );
    child.kill();
  }, START_TIMEOUT_MS);

  const onData = (chunk: Buffer) => {
    for (const line of chunk.toString("utf8").split(/\r?\n/)) {
      if (!line.trim()) continue;
      log.push(line);
      if (log.length > LOG_LINES) log.shift();
      const found = proc.url ? null : named ? (REGISTERED_RE.test(line) ? named.url : null) : (line.match(URL_RE)?.[0].toLowerCase() ?? null);
      if (found) {
        proc.url = found;
        clearTimeout(timeout);
        resolveUrl(found);
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
    else if (!proc.child.killed) state.error = proc.mode === "named" ? "The tunnel stopped on its own. Turn it on again." : "The tunnel stopped on its own. Turn it on again for a new address.";
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
    if (named) await rememberAuto(true);
  } catch (err) {
    state.error = err instanceof Error ? err.message : "The tunnel didn't start.";
    if (state.proc === proc) state.proc = undefined;
    if (!child.killed) child.kill();
  }
  return tunnelStatus();
}

export async function stopTunnel({ byFounder = false }: { byFounder?: boolean } = {}): Promise<TunnelStatus> {
  const p = state.proc;
  state.error = undefined;
  // Turned off by hand: don't bring it back on the next start.
  if (byFounder) await rememberAuto(false);
  if (p) {
    state.proc = undefined;
    p.child.kill();
    if (p.url) await setPublicUrl(null, p.url);
  }
  return tunnelStatus();
}
