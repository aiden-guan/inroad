import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ connect: vi.fn(), fetchText: vi.fn(), publicUrl: vi.fn() }));
vi.mock("playwright-core", () => ({ chromium: { connectOverCDP: mocks.connect } }));
vi.mock("@/lib/signals/http", () => ({ fetchText: mocks.fetchText, isPublicUrl: mocks.publicUrl }));
import { readResearchPage } from "./pages";
import { writeSettings } from "@/lib/store/settings";
import { readAutomation, resetAutomation } from "@/lib/automation/store";
beforeEach(async () => {
  await resetAutomation();
  writeSettings({ search: { provider: "auto", browser: "off" }, browserRequests: undefined });
  mocks.fetchText.mockReset();
  mocks.connect.mockReset();
  mocks.publicUrl.mockReset().mockResolvedValue(true);
  vi.stubEnv("TINYFISH_API_KEY", "tinyfish-test-secret");
});
describe("page extraction", () => {
  it("uses ordinary HTTP first without opening a paid browser", async () => {
    mocks.fetchText.mockResolvedValue({ url: "https://company.org", status: 200, body: "Readable evidence from a company website. ".repeat(10) });
    const result = await readResearchPage("https://company.org");
    expect(result.method).toBe("http");
    expect(mocks.connect).not.toHaveBeenCalled();
    expect(readAutomation().receipts[0].costUsd).toBe(0);
  });
  it("does not render automatically without opt-in and rejects private targets before any browser call", async () => {
    mocks.fetchText.mockResolvedValue(null);
    await expect(readResearchPage("https://company.org")).rejects.toThrow(/too little/);
    mocks.publicUrl.mockResolvedValue(false);
    await expect(readResearchPage("http://127.0.0.1", { mode: "browser" })).rejects.toThrow(/publicly accessible/);
    expect(mocks.connect).not.toHaveBeenCalled();
  });
  it("renders an isolated session, blocks writes, extracts evidence, and always terminates the session", async () => {
    writeSettings({ search: { provider: "auto", browser: "tinyfish" } });
    mocks.fetchText.mockResolvedValue(null);
    const abort = vi.fn(),
      next = vi.fn();
    let intercepted!: (route: { request: () => { method: () => string; url: () => string }; abort: typeof abort; continue: typeof next }) => Promise<unknown>;
    const page = {
      goto: vi.fn(),
      locator: () => ({ waitFor: vi.fn() }),
      waitForLoadState: vi.fn().mockResolvedValue(undefined),
      url: () => "https://company.org/about",
      content: async () => `<html><title>Company</title><body><main>${"Evidence from a company about page. ".repeat(25)}</main></body></html>`,
    };
    const context = {
      routeWebSocket: vi.fn(),
      route: vi.fn(async (_glob, handler) => {
        intercepted = handler;
      }),
      newPage: async () => page,
    };
    const close = vi.fn().mockResolvedValue(undefined);
    mocks.connect.mockResolvedValue({ newContext: vi.fn().mockResolvedValue(context), close });
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ session_id: "br-test-123", cdp_url: "wss://session.tinyfish.io/cdp" }, { status: 201 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetch);
    const result = await readResearchPage("https://company.org/about");
    expect(result).toMatchObject({ method: "browser", provider: "TinyFish Browser", title: "Company" });
    await intercepted({ request: () => ({ method: () => "POST", url: () => "https://company.org/submit" }), abort, continue: next });
    expect(abort).toHaveBeenCalledOnce();
    expect(next).not.toHaveBeenCalled();
    expect(fetch.mock.calls[0][0]).toBe("https://api.browser.tinyfish.ai");
    expect(JSON.parse(fetch.mock.calls[0][1].body)).not.toHaveProperty("url");
    expect(fetch.mock.calls[1][0]).toBe("https://api.browser.tinyfish.ai/br-test-123");
    expect(fetch.mock.calls[1][1].method).toBe("DELETE");
    expect(close).toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("tinyfish-test-secret");
  });
  it("cleans up after a failed CDP connection and keeps its credential out of errors", async () => {
    writeSettings({ search: { provider: "auto", browser: "tinyfish" } });
    mocks.connect.mockRejectedValue(new Error("wss://session.tinyfish.io?token=tinyfish-test-secret"));
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ session_id: "br-test-456", cdp_url: "wss://session.tinyfish.io/cdp" }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetch);
    await expect(readResearchPage("https://company.org", { mode: "browser" })).rejects.toThrow("Browser extraction failed");
    expect(fetch.mock.calls[1][1].method).toBe("DELETE");
    expect(JSON.stringify(readAutomation())).not.toContain("tinyfish-test-secret");
  });
});
