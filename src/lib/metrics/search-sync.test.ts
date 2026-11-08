import { beforeEach, expect, it, vi } from "vitest";
import { emptyWorkspace, getSecret, readWorkspace, replaceWorkspace } from "@/lib/store/workspace";
import { connectSearchMetrics, disconnectSearchMetrics, pollSearchMetrics, syncSearchMetrics } from "./search-sync";
import { POST, DELETE } from "@/app/api/search-metrics/[id]/route";

const fetcher = vi.fn<typeof fetch>();
const KEY = "bing_search_test_private_key";
const context = { params: Promise.resolve({ id: "bing-webmaster" }) };
const request = (body: unknown) => new Request("http://localhost/api/search-metrics/bing-webmaster", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const report = (clicks = 5) => Response.json({ d: [{ Date: new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10), Clicks: clicks, Impressions: 100 }] });

beforeEach(async () => { await replaceWorkspace(emptyWorkspace()); fetcher.mockReset(); vi.stubGlobal("fetch", fetcher); });

it("saves search aggregates and secrets independently of existing business metrics and dashboard settings", async () => {
  const ws = emptyWorkspace();
  ws.growthDashboard = { cards: [{ id: "metric:posthog:active_7d", wide: true }] };
  ws.integrations.posthog = { id: "posthog", enabled: true, config: { projectId: "123", region: "eu" } };
  ws.businessMetrics = { posthog: { provider: "posthog", syncedAt: "2026-11-01T00:00:00Z", windowStart: "2026-10-01T00:00:00Z", windowEnd: "2026-11-01T00:00:00Z", accountLabel: "Existing project", environment: "live", metrics: [], notes: [] } };
  await replaceWorkspace(ws);
  fetcher.mockResolvedValueOnce(report());
  const response = await POST(request({ key: KEY, config: { siteUrl: "https://example.com/", token: "must-not-save" } }), context);
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.workspace.growthDashboard).toEqual(ws.growthDashboard);
  expect(body.workspace.integrations.posthog).toEqual(ws.integrations.posthog);
  expect(body.workspace.businessMetrics).toEqual(ws.businessMetrics);
  expect(body.workspace.searchMetrics["bing-webmaster"].metrics[0].value).toBe(5);
  expect(JSON.stringify(body)).not.toMatch(/bing_search_test_private_key|must-not-save/);
  expect(getSecret("bing-webmaster", "apiKey")).toBe(KEY);
  expect(await pollSearchMetrics()).toEqual([]);
});

it("keeps the last good search snapshot and credentials when syncs or reconnections fail", async () => {
  fetcher.mockResolvedValueOnce(report());
  await connectSearchMetrics("bing-webmaster", KEY, { siteUrl: "https://example.com/" });
  const before = structuredClone(readWorkspace().searchMetrics);
  fetcher.mockResolvedValueOnce(Response.json({ d: [{ Date: "invalid", Clicks: 0, Impressions: 0 }] }));
  expect((await syncSearchMetrics("bing-webmaster"))?.ok).toBe(false);
  expect(readWorkspace().searchMetrics).toEqual(before);
  fetcher.mockResolvedValueOnce(Response.json({}, { status: 401 }));
  expect((await connectSearchMetrics("bing-webmaster", "new_invalid_private_key", { siteUrl: "https://other.example/" })).ok).toBe(false);
  expect(getSecret("bing-webmaster", "apiKey")).toBe(KEY);
  expect(readWorkspace().searchMetrics).toEqual(before);
});

it("serializes disconnect behind an in-flight sync and cannot resurrect it", async () => {
  fetcher.mockResolvedValueOnce(report()); await connectSearchMetrics("bing-webmaster", KEY, { siteUrl: "https://example.com/" });
  let finish!: (response: Response) => void;
  fetcher.mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve; }));
  const pending = syncSearchMetrics("bing-webmaster");
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  const disconnected = disconnectSearchMetrics("bing-webmaster"); finish(report(10)); await Promise.all([pending, disconnected]);
  expect(readWorkspace().integrations["bing-webmaster"]?.enabled).toBe(false);
  expect(readWorkspace().searchMetrics?.["bing-webmaster"]?.metrics[0].value).toBe(10);
  expect(getSecret("bing-webmaster", "apiKey")).toBeUndefined();
  expect(await pollSearchMetrics()).toEqual([]);
  expect((await DELETE(request({}), context)).status).toBe(200);
});

it("does not connect or poll sample workspaces", async () => {
  await replaceWorkspace({ ...emptyWorkspace(), sample: true });
  expect((await connectSearchMetrics("bing-webmaster", KEY, { siteUrl: "https://example.com/" })).ok).toBe(false);
  expect(await pollSearchMetrics()).toEqual([]);
  expect(fetcher).not.toHaveBeenCalled();
});
