import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UNGUARDED } from "@/lib/server/local-request";
import { config, proxy } from "./proxy";

/**
 * The proxy is the only thing between the founder's browser (and any tunnel) and the local app.
 * "passes" means Next continues to the route (NextResponse.next()); anything else is a 403.
 *
 * Requests are built the way they reach the proxy from the launcher (scripts/serve.mjs): stamped with
 * their socket's address in x-inroad-peer, 127.0.0.1 unless a test says otherwise. The stamp itself
 * is tested over real sockets in src/lib/server/local-request.test.ts.
 */

beforeEach(() => {
  vi.stubEnv("INROAD_PEER_GUARD", "1");
});

function request(
  path: string,
  { method = "GET", host = "localhost:3000", peer = "127.0.0.1", headers = {} }: { method?: string; host?: string; peer?: string; headers?: Record<string, string> } = {},
) {
  return new NextRequest(`http://${host}${path}`, { method, headers: { host, "x-inroad-peer": peer, ...headers } });
}

const passes = (res: Response) => res.headers.get("x-middleware-next") === "1";

async function blocked(res: Response) {
  expect(passes(res)).toBe(false);
  expect(res.status).toBe(403);
  return res.headers.get("content-type")?.includes("json") ? ((await res.json()) as { error: string }).error : await res.text();
}

describe("proxy: local only", () => {
  it.each(["localhost:3000", "127.0.0.1:3000", "[::1]:3000", "0.0.0.0:3000", "inroad.localhost:3000", "localhost"])("serves the app on %s", (host) => {
    expect(passes(proxy(request("/today", { host })))).toBe(true);
    expect(passes(proxy(request("/api/workspace", { host })))).toBe(true);
  });

  it("refuses other hosts: pages get text, the API gets JSON", async () => {
    expect(await blocked(proxy(request("/today", { host: "evil.example.com" })))).toBe("Inroad is only available on the computer it runs on.");
    expect(await blocked(proxy(request("/api/workspace", { host: "evil.example.com" })))).toBe("This endpoint is only available on the computer running Inroad.");
    // DNS rebinding: an attacker's name pointed at 127.0.0.1 still carries its own Host header.
    expect(passes(proxy(request("/api/workspace", { host: "localhost.evil.com:3000" })))).toBe(false);
  });

  it("treats X-Forwarded-Host as a reason to refuse, never to allow", () => {
    expect(passes(proxy(request("/api/workspace", { headers: { "x-forwarded-host": "evil.example.com" } })))).toBe(false);
    expect(passes(proxy(request("/api/workspace", { headers: { "x-forwarded-host": "localhost:3000, evil.example.com" } })))).toBe(false);
    expect(passes(proxy(request("/api/workspace", { host: "evil.example.com", headers: { "x-forwarded-host": "localhost:3000" } })))).toBe(false);
    expect(passes(proxy(request("/api/workspace", { headers: { "x-forwarded-host": "localhost:3000" } })))).toBe(true);
  });

  it("refuses requests that came through a tunnel or reverse proxy", () => {
    const via = (headers: Record<string, string>) => passes(proxy(request("/today", { headers })));
    expect(via({ "cf-connecting-ip": "203.0.113.9" })).toBe(false);
    expect(via({ "cf-ray": "8a1b2c3d4e5f-SJC" })).toBe(false);
    expect(via({ "ngrok-trace-id": "abc123" })).toBe(false);
    expect(via({ "ngrok-skip-browser-warning": "1" })).toBe(false);
    expect(via({ forwarded: "for=203.0.113.9;proto=https" })).toBe(false);
    expect(via({ "x-forwarded-for": "203.0.113.9" })).toBe(false);
    expect(via({ "x-forwarded-for": "127.0.0.1, 203.0.113.9" })).toBe(false);
    expect(via({ "x-real-ip": "10.0.0.8" })).toBe(false);
    expect(via({ "x-forwarded-for": "127.0.0.1, ::1, ::ffff:127.0.0.1" })).toBe(true);
  });

  it("refuses a device on the network that claims to be this computer", async () => {
    // What curl from the same Wi-Fi sends: every header says localhost, the socket says otherwise.
    const spoofed = { headers: { "x-forwarded-for": "127.0.0.1", "x-real-ip": "127.0.0.1" } };
    for (const peer of ["192.0.2.2", "10.0.0.8", "::ffff:192.168.1.20", "fe80::1", ""]) {
      expect(await blocked(proxy(request("/api/settings", { peer, ...spoofed })))).toBe("This endpoint is only available on the computer running Inroad.");
      expect(passes(proxy(request("/api/workspace/sample", { method: "POST", peer, ...spoofed })))).toBe(false);
      expect(passes(proxy(request("/today", { peer, ...spoofed })))).toBe(false);
    }
    expect(passes(proxy(request("/api/settings", { peer: "::1" })))).toBe(true);
    expect(passes(proxy(request("/api/settings", { peer: "::ffff:127.0.0.1" })))).toBe(true);
  });

  it("refuses everything but the agent endpoints when the launcher didn't stamp the socket", async () => {
    vi.stubEnv("INROAD_PEER_GUARD", "");
    expect(await blocked(proxy(request("/api/settings")))).toBe(UNGUARDED);
    expect(await blocked(proxy(request("/today")))).toBe(UNGUARDED);
    expect(passes(proxy(request("/api/mcp", { method: "POST" })))).toBe(true);
    // The guard is loaded but this request has no stamp (it can't happen through the launcher): not local.
    vi.stubEnv("INROAD_PEER_GUARD", "1");
    const unstamped = new NextRequest("http://localhost:3000/api/settings", { headers: { host: "localhost:3000", "x-forwarded-for": "127.0.0.1" } });
    expect(passes(proxy(unstamped))).toBe(false);
  });
});

describe("proxy: cross-site writes", () => {
  const write = (headers: Record<string, string>, method = "POST", path = "/api/workspace/actions") => proxy(request(path, { method, headers }));

  it("lets the app's own origin change the workspace", () => {
    expect(passes(write({ origin: "http://localhost:3000", "sec-fetch-site": "same-origin" }))).toBe(true);
    expect(passes(write({ origin: "http://localhost:3000" }, "DELETE"))).toBe(true);
    // No Origin and no Fetch Metadata: a CLI client like curl, not a browser.
    expect(passes(write({}))).toBe(true);
    expect(passes(write({ "sec-fetch-site": "none" }))).toBe(true);
  });

  it("refuses writes from any other origin", async () => {
    expect(await blocked(write({ origin: "https://evil.example.com" }))).toBe("Cross-site requests can't change your workspace.");
    expect(passes(write({ origin: "http://localhost:4000" }, "PUT"))).toBe(false);
    expect(passes(write({ origin: "http://127.0.0.1:3000" }, "PATCH"))).toBe(false);
    expect(passes(write({ origin: "null" }))).toBe(false);
  });

  it("refuses cross-site and same-site fetches without an Origin", () => {
    expect(passes(write({ "sec-fetch-site": "cross-site" }))).toBe(false);
    expect(passes(write({ "sec-fetch-site": "same-site" }))).toBe(false);
    // A matching Origin can't launder a cross-site fetch.
    expect(passes(write({ origin: "http://localhost:3000", "sec-fetch-site": "cross-site" }))).toBe(false);
  });

  it("leaves safe methods and pages alone", () => {
    for (const method of ["GET", "HEAD", "OPTIONS"]) expect(passes(write({ origin: "https://evil.example.com", "sec-fetch-site": "cross-site" }, method))).toBe(true);
    expect(passes(write({ origin: "https://evil.example.com" }, "POST", "/companies"))).toBe(true);
  });
});

describe("proxy: tunnel routes", () => {
  const tunnel = "inroad-founder.ngrok.app";

  it.each(["/api/mcp", "/api/v1", "/api/v1/accounts", "/api/v1/openapi.json", "/api/hooks/instantly/s3cr3t"])("lets agents reach %s from anywhere (it authenticates each call)", (path) => {
    const res = proxy(request(path, { method: "POST", host: tunnel, headers: { "ngrok-trace-id": "t", "x-forwarded-for": "203.0.113.9", origin: "https://agent.example.com" } }));
    expect(passes(res)).toBe(true);
  });

  it.each(["/api/mcp/keys", "/api/v10", "/api/v1x/accounts", "/api/hooks", "/api/workspace", "/today"])("keeps %s local", (path) => {
    expect(passes(proxy(request(path, { method: "POST", host: tunnel, headers: { "ngrok-trace-id": "t" } })))).toBe(false);
  });

  it("runs on everything but static assets", () => {
    const matcher = new RegExp(`^${config.matcher[0]}$`);
    expect(["/", "/today", "/api/mcp", "/_next/data/x.json"].every((p) => matcher.test(p))).toBe(true);
    expect(["/_next/static/chunks/a.js", "/_next/image", "/favicon.ico"].some((p) => matcher.test(p))).toBe(false);
  });
});
