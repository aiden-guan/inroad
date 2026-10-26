import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { readWorkspace, readSecrets } from "@/lib/store/workspace";
import { namedTunnelUrl, resumeNamedTunnel, saveNamedTunnel, startTunnel, stopTunnel, tunnelStatus, tunnelTarget, tunnelToken } from "./tunnel";

const TOKEN = `eyJhIjoiYWNjb3VudCIsInQiOiJ0dW5uZWwiLCJzIjoi${"x".repeat(60)}`;

describe("tunnel target", () => {
  it("connects to the address the launcher listens on", () => {
    expect(tunnelTarget(undefined)).toBe("127.0.0.1");
    expect(tunnelTarget("127.0.0.1")).toBe("127.0.0.1");
    // Listening everywhere still answers on IPv4 loopback.
    expect(tunnelTarget("0.0.0.0")).toBe("127.0.0.1");
    expect(tunnelTarget("::")).toBe("[::1]");
    expect(tunnelTarget("::1")).toBe("[::1]");
    expect(tunnelTarget("fd00::5")).toBe("[fd00::5]");
    expect(tunnelTarget("localhost")).toBe("localhost");
    expect(tunnelTarget("10.0.0.4")).toBe("10.0.0.4");
  });
});

describe("named tunnel setup", () => {
  it("takes the token alone or inside the install command Cloudflare shows", () => {
    expect(tunnelToken(TOKEN)).toBe(TOKEN);
    expect(tunnelToken(`sudo cloudflared service install ${TOKEN}`)).toBe(TOKEN);
    expect(tunnelToken(`cloudflared tunnel run --token ${TOKEN}`)).toBe(TOKEN);
    expect(tunnelToken("not a token")).toBeNull();
    expect(tunnelToken("")).toBeNull();
  });

  it("wants an https hostname on the founder's own domain", () => {
    expect(namedTunnelUrl("inroad.acme.com")).toBe("https://inroad.acme.com");
    expect(namedTunnelUrl("https://Inroad.Acme.com/")).toBe("https://inroad.acme.com");
    expect(namedTunnelUrl("http://inroad.acme.com")).toBeNull();
    expect(namedTunnelUrl("https://quiet-river.trycloudflare.com")).toBeNull();
    expect(namedTunnelUrl("https://localhost")).toBeNull();
    expect(namedTunnelUrl("https://inroad.acme.com:8443")).toBeNull();
  });

  it("keeps the token in secrets.json, never in the workspace", async () => {
    await saveNamedTunnel({ token: `cloudflared service install ${TOKEN}`, url: "inroad.acme.com" });
    expect(readSecrets().webhook_in?.tunnelToken).toBe(TOKEN);
    expect(readWorkspace().integrations.webhook_in?.config.namedTunnelUrl).toBe("https://inroad.acme.com");
    expect(JSON.stringify(readWorkspace())).not.toContain(TOKEN);
    expect(tunnelStatus()).toMatchObject({ mode: "named", namedUrl: "https://inroad.acme.com" });

    await expect(saveNamedTunnel({ token: "nope", url: "inroad.acme.com" })).rejects.toThrow(/doesn't look like a tunnel token/);
    await saveNamedTunnel(null);
    expect(readSecrets().webhook_in?.tunnelToken).toBeUndefined();
    expect(tunnelStatus()).toMatchObject({ mode: "quick" });
    expect(tunnelStatus().namedUrl).toBeUndefined();
  });
});

/**
 * startTunnel against a fake cloudflared on PATH that prints what the real one prints and records how
 * it was started, so the token's path (environment, never argv) can be checked.
 */
describe.runIf(process.platform !== "win32")("running cloudflared", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "inroad-cloudflared-"));
  const log = path.join(dir, "started.txt");
  fs.writeFileSync(
    path.join(dir, "cloudflared"),
    `#!/bin/sh
echo "args=$*" > "${log}"
echo "token=\${TUNNEL_TOKEN:-}" >> "${log}"
case "$*" in
  *" run"*) echo "2026-10-22T09:00:00Z INF Registered tunnel connection connIndex=0 location=sjc01 protocol=quic" >&2 ;;
  *) echo "2026-10-22T09:00:00Z INF |  https://quiet-river-1234.trycloudflare.com  |" >&2 ;;
esac
exec sleep 30
`,
    { mode: 0o755 },
  );

  afterEach(async () => {
    await stopTunnel();
    await saveNamedTunnel(null);
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  const started = () => fs.readFileSync(log, "utf8");

  it("starts a quick tunnel at the launcher's address and stores the address it prints", async () => {
    vi.stubEnv("PATH", `${dir}${path.delimiter}${process.env.PATH}`);
    vi.stubEnv("INROAD_HOST", "127.0.0.1");
    const s = await startTunnel(3000);
    expect(s).toMatchObject({ running: true, mode: "quick", url: "https://quiet-river-1234.trycloudflare.com" });
    expect(started()).toContain("args=tunnel --no-autoupdate --url http://127.0.0.1:3000");
    expect(readWorkspace().integrations.webhook_in?.config.publicUrl).toBe("https://quiet-river-1234.trycloudflare.com");
    await stopTunnel({ byFounder: true });
    expect(readWorkspace().integrations.webhook_in?.config.publicUrl).toBeUndefined();
  });

  it("runs the named tunnel with its token in the environment, keeps its address, and brings it back on start", async () => {
    vi.stubEnv("PATH", `${dir}${path.delimiter}${process.env.PATH}`);
    await saveNamedTunnel({ token: TOKEN, url: "https://inroad.acme.com" });
    const s = await startTunnel(3000);
    expect(s).toMatchObject({ running: true, mode: "named", url: "https://inroad.acme.com" });
    expect(started()).toContain("args=tunnel --no-autoupdate run\n");
    expect(started()).toContain(`token=${TOKEN}`);
    expect(started().split("\n")[0]).not.toContain(TOKEN);
    expect(readWorkspace().integrations.webhook_in?.config).toMatchObject({ publicUrl: "https://inroad.acme.com", namedTunnelAuto: true });

    // A restart: the child is gone, and the server start brings the same address back.
    await stopTunnel();
    expect((await resumeNamedTunnel(3000))?.url).toBe("https://inroad.acme.com");

    // Turned off by hand, it stays off at the next start.
    await stopTunnel({ byFounder: true });
    expect(await resumeNamedTunnel(3000)).toBeNull();
  });
});
