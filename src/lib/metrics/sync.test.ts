import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyWorkspace, getSecret, readWorkspace, replaceWorkspace } from "@/lib/store/workspace";
import { connectMetrics, disconnectMetrics, pollMetrics, syncMetrics } from "./sync";
import { POST as connectRoute, DELETE as disconnectRoute } from "@/app/api/metrics/[id]/route";
import { POST as syncRoute } from "@/app/api/metrics/[id]/sync/route";
import { currentMetrics, historyFor } from "@/lib/gtm/metrics";

const fetcher = vi.fn<typeof fetch>();
const KEY = "phx_private_test_key";
const config = { projectId: "12" };
const context = (id = "posthog") => ({ params: Promise.resolve({ id }) });
const request = (body: unknown) => new Request("http://localhost/api/metrics/posthog", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const counts = (n = 10) => Response.json({ results: [[n, n * 2, n * 3]] });

beforeEach(async () => {
  await replaceWorkspace(emptyWorkspace());
  fetcher.mockReset();
  vi.stubGlobal("fetch", fetcher);
});

describe("metric connection lifecycle", () => {
  it("records history on successful sync and isolates a replacement account", async () => {
    fetcher.mockResolvedValueOnce(counts());
    await connectMetrics("posthog", KEY, config);
    const first = currentMetrics(readWorkspace()).find((r) => r.provider === "posthog")!;
    expect(historyFor(readWorkspace(), first).points).toHaveLength(1);
    fetcher.mockResolvedValueOnce(counts(20)); await syncMetrics("posthog");
    const next = currentMetrics(readWorkspace()).find((r) => r.provider === "posthog")!;
    expect(next.id).toBe(first.id);
    fetcher.mockResolvedValueOnce(counts(99)); await connectMetrics("posthog", KEY, config);
    const replacement = currentMetrics(readWorkspace()).find((r) => r.provider === "posthog")!;
    expect(replacement.id).not.toBe(first.id);
    expect(historyFor(readWorkspace(), replacement).points.map((p) => p.value)).toEqual([99]);
    expect(readWorkspace().metricHistory?.[first.id]).toBeDefined();
    expect(JSON.stringify(readWorkspace().metricHistory)).not.toContain(KEY);
  });
  it("validates and imports before saving, and returns aggregate data without the key", async () => {
    fetcher.mockResolvedValueOnce(counts());
    const response = await connectRoute(request({ key: KEY, config: { ...config, token: "should-not-persist" } }), context());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(JSON.stringify(body)).not.toContain(KEY);
    expect(JSON.stringify(body)).not.toContain("should-not-persist");
    expect(getSecret("posthog", "apiKey")).toBe(KEY);
    expect(body.workspace.integrations.posthog.enabled).toBe(true);
    expect(body.workspace.businessMetrics.posthog.metrics[0].value).toBe(10);
  });

  it("does not replace a working key or snapshot when a replacement fails", async () => {
    fetcher.mockResolvedValueOnce(counts());
    await connectMetrics("posthog", KEY, config);
    const before = structuredClone(readWorkspace());
    fetcher.mockResolvedValueOnce(Response.json({}, { status: 401 }));
    const result = await connectMetrics("posthog", "phx_broken_new_key", { projectId: "99" });
    expect(result.ok).toBe(false);
    expect(readWorkspace()).toEqual(before);
    expect(getSecret("posthog", "apiKey")).toBe(KEY);
  });

  it.each(["incomplete", "query_error"])("keeps the last good numbers after %s and clears the error on recovery", async (failure) => {
    fetcher.mockResolvedValueOnce(counts());
    await connectMetrics("posthog", KEY, config);
    const snapshot = structuredClone(readWorkspace().businessMetrics?.posthog);
    fetcher.mockResolvedValueOnce(failure === "incomplete"
      ? Response.json({ results: [] })
      : Response.json({ detail: "There is no supertype for types String, UInt8: FUNCTION equals(mat_$is_identified, 1_UInt8)" }, { status: 400 }));
    const failed = await syncRoute(request({}), context());
    expect(failed.status).toBe(502);
    expect(readWorkspace().businessMetrics?.posthog).toEqual(snapshot);
    expect(readWorkspace().integrations.posthog?.lastError).toBeDefined();
    expect(readWorkspace().integrations.posthog?.lastError?.message).not.toMatch(/UInt8|FUNCTION|mat_\$/);
    fetcher.mockResolvedValueOnce(counts(20));
    expect((await syncMetrics("posthog"))?.ok).toBe(true);
    expect(readWorkspace().integrations.posthog?.lastError).toBeUndefined();
    expect(readWorkspace().businessMetrics?.posthog?.metrics[0].value).toBe(20);
  });

  it("enforces the automatic cadence and shares the due check between simultaneous callers", async () => {
    fetcher.mockResolvedValueOnce(counts());
    await connectMetrics("posthog", KEY, config);
    expect(await pollMetrics()).toEqual([]);
    const ws = structuredClone(readWorkspace());
    ws.integrations.posthog!.config.nextMetricSyncAt = "2020-01-01T00:00:00Z";
    await replaceWorkspace(ws);
    fetcher.mockResolvedValueOnce(counts());
    const results = await Promise.all([pollMetrics(), pollMetrics()]);
    expect(results.flat()).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("backs off automatic polling after failure", async () => {
    fetcher.mockResolvedValueOnce(counts());
    await connectMetrics("posthog", KEY, config);
    fetcher.mockResolvedValueOnce(Response.json({}, { status: 401 }));
    await syncMetrics("posthog");
    expect(await pollMetrics()).toEqual([]);
    expect(Date.parse(String(readWorkspace().integrations.posthog?.config.nextMetricSyncAt))).toBeGreaterThan(Date.now() + 59 * 60_000);
  });

  it("serializes disconnect after an in-flight sync and cannot resurrect the connection", async () => {
    fetcher.mockResolvedValueOnce(counts());
    await connectMetrics("posthog", KEY, config);
    let resolve!: (response: Response) => void;
    fetcher.mockImplementationOnce(() => new Promise<Response>((r) => { resolve = r; }));
    const syncing = syncMetrics("posthog");
    await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
    const disconnecting = disconnectMetrics("posthog");
    resolve(counts(30));
    await Promise.all([syncing, disconnecting]);
    expect(readWorkspace().integrations.posthog?.enabled).toBe(false);
    expect(getSecret("posthog", "apiKey")).toBeUndefined();
    expect(await pollMetrics()).toEqual([]);
    expect((await syncMetrics("posthog"))?.ok).toBe(false);
  });

  it("disconnects through the API, preserving historical aggregates on disk", async () => {
    fetcher.mockResolvedValueOnce(counts());
    await connectMetrics("posthog", KEY, config);
    expect((await disconnectRoute(request({}), context())).status).toBe(200);
    expect(getSecret("posthog", "apiKey")).toBeUndefined();
    expect(readWorkspace().businessMetrics?.posthog).toBeDefined();
    expect(readWorkspace().integrations.posthog?.enabled).toBe(false);
  });

  it("blocks real connections and polling in a sample workspace", async () => {
    await replaceWorkspace({ ...emptyWorkspace(), sample: true });
    expect((await connectMetrics("posthog", KEY, config)).ok).toBe(false);
    expect(await pollMetrics()).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects unknown providers and invalid project settings without a provider request", async () => {
    expect((await connectRoute(request({ key: KEY, config }), context("unknown"))).status).toBe(404);
    expect((await connectRoute(request({ key: KEY, config: { projectId: "../secret" } }), context())).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
