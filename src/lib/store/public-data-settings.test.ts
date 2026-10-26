import { afterEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/settings/route";
import { readSettings, writeSettings } from "./settings";

/**
 * Settings → General → Public records: an optional GitHub token (checked with GitHub before it saves,
 * only its last four shown) and an optional contact for SEC EDGAR. The HTTP layer is stubbed.
 */

const { fetchText } = vi.hoisted(() => ({ fetchText: vi.fn() }));
vi.mock("@/lib/signals/http", async (original) => ({ ...(await original<typeof import("@/lib/signals/http")>()), fetchText }));
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), connection: async () => undefined }));

const post = (body: unknown) => POST(new Request("http://localhost:3000/api/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
const TOKEN = "github_pat_11ABCDEFG0123456789abcdefghijkl";

afterEach(() => {
  writeSettings({ githubToken: undefined, secContact: undefined });
  fetchText.mockReset();
});

describe("public records settings", () => {
  it("saves a GitHub token GitHub accepts, and shows only its last four", async () => {
    fetchText.mockResolvedValue({ url: "https://api.github.com/rate_limit", status: 200, body: "{}" });
    const res = await post({ githubToken: ` ${TOKEN} ` });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ githubTokenHint: "…ijkl", secContact: null });
    expect(readSettings().githubToken).toBe(TOKEN);
    expect(fetchText.mock.calls[0][0]).toBe("https://api.github.com/rate_limit");
    expect(fetchText.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${TOKEN}`);
    const status = await (await GET()).json();
    expect(JSON.stringify(status)).not.toContain(TOKEN);
  });

  it("refuses a token GitHub rejects or that isn't one, and removes it on request", async () => {
    fetchText.mockResolvedValue({ url: "https://api.github.com/rate_limit", status: 401, body: '{"message":"Bad credentials"}' });
    expect((await post({ githubToken: TOKEN })).status).toBe(400);
    expect((await post({ githubToken: "not-a-token" })).status).toBe(400);
    expect(readSettings().githubToken).toBeUndefined();

    // GitHub unreachable: a plausible token still saves.
    fetchText.mockResolvedValue(null);
    expect((await post({ githubToken: TOKEN })).status).toBe(200);
    expect(await (await post({ githubToken: null })).json()).toMatchObject({ githubTokenHint: null });
  });

  it("keeps an SEC contact only when it's an email", async () => {
    expect((await post({ secContact: "not an email" })).status).toBe(400);
    expect(await (await post({ secContact: "Founder@Acme.com" })).json()).toMatchObject({ secContact: "founder@acme.com" });
    expect(await (await post({ secContact: "" })).json()).toMatchObject({ secContact: null });
  });
});
