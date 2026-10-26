import http from "node:http";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { proxy } from "@/proxy";
import { isLocalRequest, PEER_HEADER } from "./local-request";

/**
 * Locality over real sockets, the way the launcher runs the app: scripts/peer-guard.cjs is loaded
 * into this process, a plain Node HTTP server hands each request to the proxy, and requests arrive
 * once from loopback and once from this machine's own network address, which is what another
 * device on the same Wi-Fi looks like to the server.
 */

const require = createRequire(import.meta.url);
const originalEmit = http.Server.prototype.emit;
const originalGuard = process.env.INROAD_PEER_GUARD;

// The first non-loopback IPv4 address of this machine (CI runners and laptops have one).
const lan = Object.values(os.networkInterfaces())
  .flat()
  .find((i) => i && i.family === "IPv4" && !i.internal)?.address;

let server: http.Server;
let port = 0;

beforeAll(async () => {
  require(path.join(process.cwd(), "scripts", "peer-guard.cjs"));
  server = http.createServer((req, res) => {
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
    const request = new NextRequest(`http://${req.headers.host}${req.url}`, { method: req.method, headers });
    const out = proxy(request);
    const passed = out.headers.get("x-middleware-next") === "1";
    res.writeHead(passed ? 200 : out.status, { "content-type": "application/json" });
    res.end(JSON.stringify({ passed, peer: req.headers[PEER_HEADER] ?? null, local: isLocalRequest(request) }));
  });
  await new Promise<void>((resolve) => server.listen(0, "0.0.0.0", resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  http.Server.prototype.emit = originalEmit;
  if (originalGuard === undefined) delete process.env.INROAD_PEER_GUARD;
  else process.env.INROAD_PEER_GUARD = originalGuard;
});

/** A request to `address` that says, in every header it can, that it comes from this computer. */
function call(address: string, pathname: string, { method = "GET", extra = {} }: { method?: string; extra?: Record<string, string> } = {}) {
  return new Promise<{ status: number; body: { passed: boolean; peer: string | null; local: boolean } }>((resolve, reject) => {
    const req = http.request(
      { host: address, port, path: pathname, method, headers: { host: `localhost:${port}`, ...extra } },
      (res) => {
        let text = "";
        res.on("data", (c) => (text += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: JSON.parse(text) }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

const spoof = { "x-forwarded-for": "127.0.0.1", "x-real-ip": "127.0.0.1", [PEER_HEADER]: "127.0.0.1" };

describe("locality from the socket (scripts/peer-guard.cjs)", () => {
  it("stamps the real address and lets this computer in", async () => {
    const r = await call("127.0.0.1", "/api/settings");
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ passed: true, peer: "127.0.0.1", local: true });
  });

  it("overwrites an x-inroad-peer the caller sent", async () => {
    const r = await call("127.0.0.1", "/api/settings", { extra: { [PEER_HEADER]: "10.9.8.7" } });
    expect(r.body.peer).toBe("127.0.0.1");
  });

  it.skipIf(!lan)("refuses spoofed Host and X-Forwarded-For headers over a non-loopback socket", async () => {
    for (const [method, pathname] of [
      ["GET", "/api/settings"],
      ["GET", "/api/workspace"],
      ["POST", "/api/workspace/sample"],
      ["POST", "/api/mcp/keys"],
      ["GET", "/api/integrations/status"],
      ["POST", "/api/integrations/tunnel"],
      ["GET", "/today"],
    ] as const) {
      const r = await call(lan!, pathname, { method, extra: spoof });
      expect(r.status, `${method} ${pathname}`).toBe(403);
      expect(r.body.peer).toBe(lan);
      expect(r.body.local).toBe(false);
    }
  });

  it.skipIf(!lan)("still serves the agent endpoints there, which check a key on every call", async () => {
    const r = await call(lan!, "/api/mcp", { method: "POST" });
    expect(r.body.passed).toBe(true);
  });
});
