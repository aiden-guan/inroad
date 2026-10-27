import { describe, expect, it } from "vitest";
import { POST as receiveHook } from "@/app/api/hooks/[source]/[secret]/route";
import { restHandler } from "@/lib/api-keys/rest";
import { createKey } from "@/lib/api-keys/store";
import { inboundSecret } from "@/lib/hub/secrets";

const request = (path: string, body: string, headers: Record<string, string> = {}) =>
  new Request(`http://localhost:3000${path}`, { method: "POST", body, headers });

describe("public endpoint body limits", () => {
  it("rejects UTF-8 REST payloads exceeding one million bytes without Content-Length", async () => {
    const { token } = await createKey({ name: "Body limit test", client: "other", scopes: ["read"] });
    const handle = restHandler("score_accounts");
    const response = await handle(request("/api/v1/accounts/score", JSON.stringify({ pad: "é".repeat(500_001) }), { authorization: `Bearer ${token}` }));
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ ok: false, error: expect.stringContaining("1 MB max") });
    const valid = await handle(request("/api/v1/accounts/score", JSON.stringify({ accounts: [{ domain: "acme.com" }] }), { authorization: `Bearer ${token}` }));
    expect(valid.status).toBe(200);
    expect(await valid.json()).toMatchObject({ ok: true });
  });

  it("rejects oversized hook payloads and keeps the hook error envelope", async () => {
    const params = Promise.resolve({ source: "generic", secret: inboundSecret() });
    const response = await receiveHook(request("/api/hooks/generic/test", JSON.stringify({ pad: "é".repeat(500_001) })), { params });
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "Payload too large (1 MB max). Send fewer rows per request." });
    const valid = await receiveHook(request("/api/hooks/generic/test", JSON.stringify({ accounts: [{ domain: "acme.com" }] })), { params });
    expect(valid.status).toBe(200);
    expect(await valid.json()).toMatchObject({ ok: true });
  });

  it("authenticates REST and webhook callers before reading their bodies", async () => {
    const oversized = { "content-length": "2000000" };
    expect((await restHandler("score_accounts")(request("/api/v1/accounts/score", "{}", oversized))).status).toBe(401);
    expect((await receiveHook(request("/api/hooks/generic/invalid", "{}", oversized), { params: Promise.resolve({ source: "generic", secret: "invalid" }) })).status).toBe(401);
  });
});
